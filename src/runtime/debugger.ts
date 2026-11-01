// @ts-nocheck
/**
 * Depurador cooperativo del runtime de GaboScript.
 *
 * El intérprete avisa antes de ejecutar cada sentencia (`onStatement`). Esta
 * sesión decide si hay que detenerse (entrada, punto de interrupción, paso o
 * pausa manual), captura una foto del estado y espera a que la extensión pida
 * continuar. Es JavaScript puro: no depende de VS Code ni de Node.
 */

import { StopExecution } from './errors';
import {
    formatShape,
    formatValue,
    isArrayValue,
    isRecordValue,
    valueTypeName,
} from './values';

/** Máximo de sentencias que se conservan en la traza de una ejecución. */
export const TRACE_LIMIT = 20000;

/** Cada cuántas sentencias se cede el turno al host para atender la pausa. */
const YIELD_EVERY = 256;

/** Cede el turno sin el retardo mínimo de los temporizadores en Windows. */
const yieldToHost = typeof setImmediate === 'function'
    ? () => new Promise((resolve) => setImmediate(resolve))
    : () => new Promise((resolve) => setTimeout(resolve, 0));

/** Hijos que se muestran de golpe al expandir un valor grande. */
const MAX_CHILDREN = 1000;

const MAX_TEXT = 80;

/**
 * Sesión de depuración. El intérprete la invoca desde cada sentencia y la
 * extensión la controla con `resume`, `requestPause` y `stop`.
 */
export class DebugSession {
    /**
     * @param {{onEvent?: (event: any) => void, pauseOnStart?: boolean, breakpoints?: Iterable<number>}} [options]
     */
    constructor(options = {}) {
        this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
        this.pauseOnStart = options.pauseOnStart !== false;
        this.breakpoints = new Set();

        /** 'idle' | 'running' | 'paused' | 'finished' */
        this.state = 'idle';
        this.mode = 'continue';
        this.targetDepth = 0;
        this.started = false;
        this.finished = false;
        this.stopRequested = false;
        this.pauseRequested = false;

        this.steps = 0;
        this.maxDepth = 1;
        this.currentLine = 0;
        this.pausedReason = null;
        this.snapshot = null;

        this._frames = [];
        this._recordDefs = new Map();
        this._resumeResolve = null;
        this._ticksSinceYield = 0;
        this._pausedDepth = 0;
        /** Tiempo (ms) que la ejecución ha pasado detenida para no contarlo. */
        this.pausedMs = 0;
        this._pauseStartedAt = 0;

        this.setBreakpoints(options.breakpoints ?? []);
    }

    /** Sustituye los puntos de interrupción (números de línea, base 1). */
    setBreakpoints(lines) {
        this.breakpoints = new Set(
            [...lines]
                .map((line) => Number(line))
                .filter((line) => Number.isInteger(line) && line > 0),
        );
        return this.breakpoints;
    }

    get paused() {
        return this.state === 'paused';
    }

    get busy() {
        return this.state === 'running' || this.state === 'paused';
    }

    /**
     * Pide una pausa en la próxima sentencia. Devuelve `false` si la sesión ya
     * no está ejecutándose.
     */
    requestPause() {
        if (this.state !== 'running') return false;
        this.pauseRequested = true;
        return true;
    }

    /**
     * Reanuda una sesión en pausa.
     * @param {'continue' | 'over' | 'into' | 'out'} command
     */
    resume(command = 'continue') {
        if (this.state !== 'paused') return false;
        const valid = new Set(['continue', 'over', 'into', 'out']);
        this.mode = valid.has(command) ? command : 'continue';
        this.targetDepth = this._pausedDepth;
        this.pausedReason = null;
        this.state = 'running';
        this.pauseRequested = false;
        this.snapshot = null;
        this._frames = [];
        this._recordDefs = new Map();
        if (this._pauseStartedAt) {
            this.pausedMs += Date.now() - this._pauseStartedAt;
            this._pauseStartedAt = 0;
        }

        const resolve = this._resumeResolve;
        this._resumeResolve = null;
        this.emit({ type: 'resumed', command: this.mode });
        if (resolve) resolve();
        return true;
    }

    /** Detiene la depuración (también despierta una pausa activa). */
    stop() {
        if (this.finished) return false;
        this.stopRequested = true;
        this.pauseRequested = false;
        const resolve = this._resumeResolve;
        this._resumeResolve = null;
        if (resolve) resolve();
        return true;
    }

    /**
     * El intérprete llama aquí antes de ejecutar una sentencia.
     * @param {any} interpreter
     * @param {any} node
     * @param {any} frame
     */
    async onStatement(interpreter, node, frame) {
        if (this.stopRequested) throw new StopExecution();
        if (this.state === 'idle') this.state = 'running';

        this.steps = interpreter.steps;
        const depth = interpreter.frames.length;
        this.maxDepth = Math.max(this.maxDepth, depth);
        this.currentLine = node?.line ?? frame?.currentLine ?? 0;

        const reason = this._pauseReason(node, depth);
        if (reason) await this._pause(interpreter, node, frame, reason);
        if (this.stopRequested) throw new StopExecution();

        this._ticksSinceYield++;
        if (this._ticksSinceYield >= YIELD_EVERY) {
            this._ticksSinceYield = 0;
            await yieldToHost();
            if (this.stopRequested) throw new StopExecution();
        }
    }

    /**
     * El runtime llama al terminar (también si hubo error de sintaxis). Cierra
     * la sesión y avisa a la extensión.
     * @param {any} [result]
     */
    finish(result) {
        if (this.finished) return;
        if (this._pauseStartedAt) {
            this.pausedMs += Date.now() - this._pauseStartedAt;
            this._pauseStartedAt = 0;
        }
        this.finished = true;
        this.stopRequested = true;
        const resolve = this._resumeResolve;
        this._resumeResolve = null;
        if (resolve) resolve();
        this.state = 'finished';
        this.snapshot = null;
        this._frames = [];
        this._recordDefs = new Map();
        if (result?.stats && Number.isFinite(result.stats.elapsedMs)) {
            // El tiempo del informe es el de ejecución real, sin las pausas
            // que el usuario haya dejado abiertas mientras inspeccionaba.
            result.stats.elapsedMs = Math.max(0, result.stats.elapsedMs - this.pausedMs);
        }
        this.emit({
            type: 'finished',
            result,
            stats: result?.stats ?? null,
        });
    }

    /** Pila de llamadas de la pausa actual (de la más interna a la más externa). */
    getCallStack() {
        if (!this.snapshot) return [];
        return [...this.snapshot.frames].reverse().map((frame) => ({
            index: frame.index,
            name: frame.name,
            kind: frame.kind,
            line: frame.line,
            callLine: frame.callLine,
            current: frame.current,
        }));
    }

    /** Variables de un marco de la pausa actual. */
    getVariables(frameIndex = this._frames.length - 1) {
        if (!this.snapshot) return [];
        const frame = this._frames.find((item) => item.index === frameIndex);
        if (!frame) return [];
        return frame.slots.map((slot) => buildVariableNode(slot, this._recordDefs, this._formatOptions));
    }

    /** Resumen serializable del estado actual (para pruebas y eventos). */
    getSnapshot() {
        return this.snapshot;
    }

    emit(event) {
        if (!this.onEvent) return;
        try {
            this.onEvent(event);
        } catch {
            // Un error del oyente no debe romper el programa del usuario.
        }
    }

    // ------------------------------------------------------------- interno

    _pauseReason(node, depth) {
        if (!this.started) {
            this.started = true;
            this.mode = 'continue';
            if (this.pauseOnStart) return 'entry';
        }
        if (node?.line && this.breakpoints.has(node.line)) return 'breakpoint';
        if (this.pauseRequested) return 'pause';
        if (this.mode === 'into') return 'step';
        if (this.mode === 'over' && depth <= this.targetDepth) return 'step';
        if (this.mode === 'out' && depth < this.targetDepth) return 'step';
        return null;
    }

    async _pause(interpreter, node, frame, reason) {
        this.state = 'paused';
        this.pausedReason = reason;
        this.pauseRequested = false;
        this._pauseStartedAt = Date.now();
        this._formatOptions = interpreter.formatOptions();
        this._frames = interpreter.frames.map((item, index) => ({
            index,
            name: item.name,
            kind: item.kind,
            line: item.currentLine ?? 0,
            callLine: item.callLine ?? 0,
            slots: [...item.vars.values()],
        }));
        this._recordDefs = interpreter.records;
        this._pausedDepth = interpreter.frames.length;
        this.snapshot = buildSnapshot(interpreter, reason, this._formatOptions);
        this.snapshot.kind = node?.kind ?? null;
        this.snapshot.callName = node?.kind === 'CallStmt' ? (node.call?.name ?? null) : null;

        const wait = new Promise((resolve) => {
            this._resumeResolve = resolve;
        });
        this.emit({
            type: 'paused',
            reason,
            line: this.snapshot.line,
            steps: this.snapshot.steps,
            snapshot: this.snapshot,
        });
        await wait;
        this._resumeResolve = null;
        if (this.stopRequested) return;
        this.state = 'running';
    }
}

/**
 * Construye el nodo que muestra el panel de Variables. Los hijos se crean al
 * expandir para no recorrer arreglos enormes si el usuario no los abre.
 */
export function buildVariableNode(slot, recordDefs = new Map(), options = {}) {
    return buildNode(
        slot?.name ?? '?',
        slot?.cell?.value,
        slot?.type ?? null,
        null,
        recordDefs,
        options,
        'variable',
        [slot?.name ?? '?'],
        {
            kind: slot?.kind ?? 'local',
            mode: slot?.kind === 'param' ? slot?.mode ?? 'E' : null,
        },
    );
}

/**
 * Describe un valor de GaboScript para el árbol de Variables.
 *
 * @param {string} label Nombre visible (variable, campo o índice).
 * @param {unknown} value Valor interno del runtime.
 * @param {{kind: string, name: string} | null} declaredType Tipo declarado.
 * @param {number[] | null} arrayShape Forma del arreglo si es una dimensión interior.
 * @param {Map<string, any>} recordDefs Definiciones de Registro.
 * @param {any} options Ajustes de formato.
 * @param {'variable' | 'array-item' | 'record-field'} kind
 * @param {Array<string|number>} path Ruta del nodo (para claves estables).
 * @param {{kind?: string, mode?: string | null}} [extra]
 */
export function buildNode(
    label,
    value,
    declaredType = null,
    arrayShape = null,
    recordDefs = new Map(),
    options = {},
    kind = 'variable',
    path = [label],
    extra = {},
) {
    const isGaboArray = isArrayValue(value);
    const isArray = isGaboArray || (Array.isArray(value) && Array.isArray(arrayShape));
    const isRecord = isRecordValue(value);
    const shape = isArray ? (arrayShape ?? value.shape) : null;
    const childCount = isArray
        ? (shape?.reduce((total, size) => total * size, 1) ?? 0)
        : isRecord
            ? Object.keys(value.fields).length
            : 0;
    const expandable = (isArray || isRecord) && childCount > 0;

    return {
        key: `${kind}:${path.join('.')}`,
        kind,
        label,
        typeLabel: typeLabelFor(value, declaredType, recordDefs, shape),
        valueText: summarizeValue(value, options, shape),
        expandable,
        childCount,
        variableKind: extra.kind ?? null,
        mode: extra.mode ?? null,
        getChildren: () => {
            if (isArray) return buildArrayChildren(value, shape, declaredType, recordDefs, options, path);
            if (isRecord) return buildRecordChildren(value, recordDefs, options, path);
            return [];
        },
    };
}

function buildSnapshot(interpreter, reason, options) {
    const frames = interpreter.frames.map((frame, index) => ({
        index,
        name: frame.name,
        kind: frame.kind,
        line: frame.currentLine ?? 0,
        callLine: frame.callLine ?? 0,
        current: index === interpreter.frames.length - 1,
        variables: [...frame.vars.values()].map((slot) => {
            const isArray = isArrayValue(slot.cell.value);
            const isRecord = isRecordValue(slot.cell.value);
            return {
                name: slot.name,
                type: typeLabelFor(slot.cell.value, slot.type, interpreter.records),
                kind: slot.kind,
                mode: slot.kind === 'param' ? slot.mode : null,
                value: summarizeValue(slot.cell.value, options),
                expandable: Boolean(isArray || isRecord),
                childCount: isArray
                    ? slot.cell.value.shape.reduce((a, b) => a * b, 1)
                    : isRecord
                        ? Object.keys(slot.cell.value.fields).length
                        : 0,
            };
        }),
    }));

    const current = frames[frames.length - 1];
    return {
        reason,
        line: current?.line ?? 0,
        steps: interpreter.steps,
        maxDepth: Math.max(1, interpreter.frames.length),
        frames,
    };
}

function buildArrayChildren(array, shape, declaredType, recordDefs, options, path) {
    const data = isArrayValue(array) ? array.data : array;
    const elemType = isArrayValue(array) ? array.elemType : declaredType;
    const count = Math.min(shape?.[0] ?? data.length, MAX_CHILDREN);
    const remaining = (shape ?? []).slice(1);
    const nodes = [];
    for (let i = 0; i < count; i++) {
        nodes.push(buildNode(
            `[${i + 1}]`,
            data[i],
            elemType,
            remaining.length > 0 ? remaining : null,
            recordDefs,
            options,
            'array-item',
            [...path, i + 1],
        ));
    }
    if ((shape?.[0] ?? data.length) > count) {
        nodes.push(noteNode(`… ${(shape?.[0] ?? data.length) - count} elementos más`, path));
    }
    return nodes;
}

function buildRecordChildren(record, recordDefs, options, path) {
    const def = recordDefs instanceof Map
        ? (recordDefs.get(record.typeName) ?? [...recordDefs.values()].find((item) => sameName(item.name, record.typeName)))
        : null;
    const fields = Object.entries(record.fields);
    const nodes = [];
    for (const [name, value] of fields.slice(0, MAX_CHILDREN)) {
        const fieldDef = def?.fields?.find((field) => sameName(field.name, name));
        nodes.push(buildNode(
            name,
            value,
            fieldDef?.type ?? null,
            null,
            recordDefs,
            options,
            'record-field',
            [...path, name],
            { kind: 'field', mode: null },
        ));
    }
    if (fields.length > MAX_CHILDREN) {
        nodes.push(noteNode(`… ${fields.length - MAX_CHILDREN} campos más`, path));
    }
    return nodes;
}

function noteNode(label, path) {
    return {
        key: `note:${path.join('.')}`,
        kind: 'note',
        label,
        typeLabel: '',
        valueText: '',
        expandable: false,
        childCount: 0,
        variableKind: null,
        mode: null,
        getChildren: () => [],
    };
}

function typeLabelFor(value, declaredType, recordDefs, shape = null) {
    if (isArrayValue(value)) {
        const dims = shape ?? value.shape;
        return `Arreglo ${formatShape(dims)} de ${value.elemType?.name ?? 'valor'}`;
    }
    if (Array.isArray(value) && Array.isArray(shape)) {
        return `Arreglo ${formatShape(shape)} de ${declaredType?.name ?? 'valor'}`;
    }
    if (isRecordValue(value)) return `Registro ${value.typeName}`;
    if (declaredType) {
        if (declaredType.kind === 'record') return `Registro ${declaredType.name}`;
        return declaredType.name;
    }
    return valueTypeName(value);
}

/** Texto compacto del valor (los arreglos y registros se expanden aparte). */
export function summarizeValue(value, options = {}, shape = null) {
    if (isArrayValue(value)) {
        const dims = shape ?? value.shape;
        return `[${formatShape(dims)}]`;
    }
    if (Array.isArray(value) && Array.isArray(shape)) {
        return `[${formatShape(shape)}]`;
    }
    if (isRecordValue(value)) {
        const count = Object.keys(value.fields).length;
        return `{ ${count} campo${count === 1 ? '' : 's'} }`;
    }
    if (typeof value === 'string') return quoteText(value);
    if (value === null || value === undefined) return 'Nulo';
    return formatValue(value, options);
}

function quoteText(text) {
    const escaped = text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
    if (escaped.length <= MAX_TEXT) return `"${escaped}"`;
    return `"${escaped.slice(0, MAX_TEXT - 1)}…"`;
}

function sameName(a, b) {
    return a === b || String(a).toLowerCase() === String(b).toLowerCase();
}
