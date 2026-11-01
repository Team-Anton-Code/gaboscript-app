// @ts-nocheck
/**
 * Intérprete de GaboScript (recorrido de AST).
 * JavaScript puro, sin dependencias de VS Code ni de Node.
 *
 * El host de E/S se inyecta: cada entorno (VS Code, CLI, pruebas) aporta
 * `print`, `warn` y `readLine`. La ejecución puede detenerse de forma
 * cooperativa mediante `options.shouldStop`.
 */

import { GaboRuntimeError, StopExecution, ReturnSignal } from './errors';
import {
    coerceValue,
    defaultValueFor,
    createArrayValue,
    formatValue,
    isArrayValue,
    isRecordValue,
    describeValue,
    sameName,
    checkSafeInt,
    SAFE_INT,
} from './values';

const STEP_CHECK_MASK = 0x3fff; // ~16k sentencias: comprobar el botón "Detener"
const YIELD_MASK = 0x3ffff; // ~262k sentencias: ceder el control al host
const TRACE_LIMIT = 20000; // máximo de líneas que conserva la traza de una ejecución

export class Interpreter {
    /**
     * @param {any} program AST producido por parse().
     * @param {{print: (text: string) => void, warn?: (text: string) => void, readLine: (req: any) => Promise<string|null>}} host
     * @param {{realDecimals?: number, booleanOutput?: string, maxCallDepth?: number, shouldStop?: () => boolean, debugger?: any, collectTrace?: boolean}} [options]
     */
    constructor(program, host, options = {}) {
        this.program = program;
        this.host = host;
        this.options = {
            realDecimals: 2,
            booleanOutput: 'true/false',
            maxCallDepth: 1000,
            ...options,
        };

        this.subprograms = new Map();
        this.records = new Map();
        this.definitionErrors = [];
        this.frames = [];
        this.steps = 0;
        this.maxDepth = 1;
        this.collectTrace = options.collectTrace === true || Boolean(options.debugger);
        this.trace = this.collectTrace ? [] : null;
        this.traceTruncated = false;

        for (const sub of program.subprograms ?? []) {
            if (this.lookupSubprogram(sub.name)) {
                this.definitionErrors.push(
                    new GaboRuntimeError(`Ya existe un subprograma llamado '${sub.name}'. Los nombres deben ser únicos.`, sub.line, sub.col),
                );
            } else {
                this.subprograms.set(sub.name, sub);
            }
        }
        for (const record of program.records ?? []) {
            const previous = this.lookupRecord(record.name);
            if (previous) {
                this.definitionErrors.push(
                    new GaboRuntimeError(`Ya existe un registro llamado '${record.name}'. Los nombres deben ser únicos.`, record.line, record.col),
                );
            } else {
                this.records.set(record.name, record);
            }
        }
    }

    // ------------------------------------------------------------------ API

    async run() {
        if (this.definitionErrors.length > 0) throw this.definitionErrors[0];
        const main = this.createFrame(this.program.name, 'main', null, 0);
        this.frames.push(main);
        this.maxDepth = Math.max(this.maxDepth, this.frames.length);
        try {
            await this.execBlock(this.program.body, main);
        } finally {
            this.frames.pop();
        }
    }

    formatOptions() {
        return {
            realDecimals: this.options.realDecimals,
            booleanOutput: this.options.booleanOutput,
        };
    }

    // ------------------------------------------------------------ búsquedas

    lookupSubprogram(name) {
        if (this.subprograms.has(name)) return this.subprograms.get(name);
        for (const [key, value] of this.subprograms) {
            if (sameName(key, name)) return value;
        }
        return undefined;
    }

    lookupRecord(name) {
        if (this.records.has(name)) return this.records.get(name);
        for (const [key, value] of this.records) {
            if (sameName(key, name)) return value;
        }
        return undefined;
    }

    lookupVar(frame, name) {
        if (frame.vars.has(name)) return frame.vars.get(name);
        for (const [key, value] of frame.vars) {
            if (sameName(key, name)) return value;
        }
        return undefined;
    }

    hasVar(frame, name) {
        return Boolean(this.lookupVar(frame, name));
    }

    // -------------------------------------------------------------- helpers

    createFrame(name, kind, returnType, callLine) {
        return { name, kind, returnType, callLine, currentLine: callLine, vars: new Map() };
    }

    ctx(node) {
        return {
            resolveRecord: (name) => this.lookupRecord(name),
            recordDepth: 0,
            error: (message) => {
                throw this.rtError(message, node);
            },
            warn: (message) => this.warn(message, node),
        };
    }

    rtError(message, node) {
        const line = node?.line ?? this.frames[this.frames.length - 1]?.currentLine ?? 1;
        const col = node?.col ?? 1;
        const frames = [...this.frames].reverse().map((f) => ({
            name: f.name,
            kind: f.kind,
            line: f.currentLine ?? 0,
            callLine: f.callLine ?? 0,
        }));
        return new GaboRuntimeError(message, line, col, frames);
    }

    warn(message, node) {
        const text = `Aviso (línea ${node?.line ?? '?'}): ${message}\n`;
        if (typeof this.host.warn === 'function') this.host.warn(text);
    }

    async yieldToHost() {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    async tick(node, frame) {
        if (node?.line) frame.currentLine = node.line;
        this.steps++;
        if (this.options.debugger) {
            // El depurador puede detener la ejecución aquí y esperar a que el
            // usuario pida continuar. También controla el botón «Pausar» y
            // comprueba la detención en cada sentencia.
            await this.options.debugger.onStatement(this, node, frame);
        }
        if (this.trace) this.recordTrace(node, frame);
        if ((this.steps & STEP_CHECK_MASK) === 0) {
            if (this.options.shouldStop && this.options.shouldStop()) throw new StopExecution();
        }
        if ((this.steps & YIELD_MASK) === 0) {
            await this.yieldToHost();
        }
    }

    recordTrace(node, frame) {
        if (this.trace.length >= TRACE_LIMIT) {
            this.traceTruncated = true;
            return;
        }
        this.trace.push({
            line: node?.line ?? frame?.currentLine ?? 0,
            depth: this.frames.length,
            frame: frame?.name ?? '',
            steps: this.steps,
        });
    }

    toBool(value, node) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        throw this.rtError(`La condición debe ser Booleana (True/False o 0/1), pero se obtuvo ${describeValue(value)}.`, node);
    }

    requireInt(value, node, what) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw this.rtError(`Se esperaba un número entero para ${what}, pero se obtuvo ${describeValue(value)}.`, node);
        }
        if (!Number.isInteger(value)) {
            throw this.rtError(`Se esperaba un número entero para ${what}, pero se obtuvo ${formatValue(value, this.formatOptions())}.`, node);
        }
        return checkSafeInt(value, this.ctx(node));
    }

    numeric(value, node, what) {
        if (typeof value === 'number') return value;
        if (typeof value === 'boolean') return value ? 1 : 0;
        throw this.rtError(`Se esperaba un número ${what}, pero se obtuvo ${describeValue(value)}.`, node);
    }

    defineVar(frame, name, type, value, node) {
        const existing = this.lookupVar(frame, name);
        if (existing) {
            throw this.rtError(`Ya existe una variable llamada '${existing.name}'. Usa otro nombre o asigna con '='.`, node);
        }
        const slot = { name, type, cell: { value }, kind: 'local', mode: 'E' };
        frame.vars.set(name, slot);
        return slot;
    }

    // ------------------------------------------------------------- bloques

    async execBlock(statements, frame) {
        for (const statement of statements) {
            await this.execStmt(statement, frame);
        }
    }

    async execStmt(node, frame) {
        await this.tick(node, frame);
        switch (node.kind) {
            case 'VarDecl':
                return this.execVarDecl(node, frame);
            case 'Assign': {
                const target = await this.resolveTarget(node.target, frame);
                const value = await this.evalExpr(node.value, frame);
                target.set(coerceValue(value, target.type, this.ctx(node)));
                return;
            }
            case 'CallStmt':
                await this.callSubprogram(node.call, frame, false);
                return;
            case 'If': {
                const cond = this.toBool(await this.evalExpr(node.cond, frame), node.cond);
                if (cond) {
                    await this.execBlock(node.then, frame);
                } else if (node.otherwise) {
                    await this.execBlock(node.otherwise, frame);
                }
                return;
            }
            case 'While': {
                while (this.toBool(await this.evalExpr(node.cond, frame), node.cond)) {
                    await this.execBlock(node.body, frame);
                }
                return;
            }
            case 'Repeat': {
                do {
                    await this.execBlock(node.body, frame);
                } while (!this.toBool(await this.evalExpr(node.cond, frame), node.cond));
                return;
            }
            case 'For':
                return this.execFor(node, frame);
            case 'EnCaso':
                return this.execEnCaso(node, frame);
            case 'Leer':
                return this.execLeer(node, frame);
            case 'Mostrar': {
                const parts = [];
                for (const arg of node.args) {
                    parts.push(formatValue(await this.evalExpr(arg, frame), this.formatOptions()));
                }
                this.host.print(parts.join('') + '\n');
                return;
            }
            case 'Devolver': {
                if (frame.kind === 'main') {
                    throw this.rtError("'Devolver' solo se puede usar dentro de una Función.", node);
                }
                if (frame.kind === 'procedure') {
                    throw this.rtError(`Un Procedimiento no devuelve valores; '${frame.name}' no puede usar 'Devolver'.`, node);
                }
                if (!node.value) {
                    throw this.rtError(`La Función '${frame.name}' debe devolver un valor: Devolver(expresión);`, node);
                }
                const value = await this.evalExpr(node.value, frame);
                throw new ReturnSignal(coerceValue(value, frame.returnType, this.ctx(node)));
            }
            case 'Error':
                return;
            default:
                throw this.rtError(`El runtime no reconoce esta sentencia ('${node.kind}').`, node);
        }
    }

    async execVarDecl(node, frame) {
        for (const item of node.items) {
            let value;
            if (item.dims.length > 0) {
                const shape = [];
                for (const dim of item.dims) {
                    shape.push(this.requireInt(await this.evalExpr(dim, frame), dim, `la dimensión de '${item.name}'`));
                }
                value = createArrayValue(shape, node.type, this.ctx(item), item.name);
            } else {
                value = defaultValueFor(node.type, this.ctx(item));
            }
            const slot = this.defineVar(frame, item.name, node.type, value, item);
            if (item.init) {
                const initValue = await this.evalExpr(item.init, frame);
                slot.cell.value = coerceValue(initValue, node.type, this.ctx(item));
            }
        }
    }

    async execFor(node, frame) {
        const slot = this.lookupVar(frame, node.varName);
        if (!slot) {
            throw this.rtError(`La variable '${node.varName}' del 'Para' no está declarada. Declárala antes con 'Var ${node.varName}: Entero;'.`, node);
        }
        const from = this.requireInt(await this.evalExpr(node.from, frame), node.from, `el valor inicial de '${node.varName}'`);
        const to = this.requireInt(await this.evalExpr(node.to, frame), node.to, `el límite del 'Para'`);
        const step = node.step ? this.requireInt(await this.evalExpr(node.step, frame), node.step, 'el paso del Para') : 1;
        if (step === 0) {
            throw this.rtError("El paso de un 'Para' no puede ser 0.", node);
        }
        if (step > 0 ? from > to : from < to) return;
        for (let k = from; step > 0 ? k <= to : k >= to; k += step) {
            slot.cell.value = coerceValue(k, slot.type, this.ctx(node));
            await this.execBlock(node.body, frame);
        }
    }

    async execEnCaso(node, frame) {
        const guard = await this.evalExpr(node.guard, frame);
        let selector = null;
        let guardOk = true;
        if (typeof guard === 'boolean') {
            guardOk = guard;
        } else {
            selector = guard; // modo "valor": En_Caso (expresión) con Caso(valor)
        }
        if (!guardOk) return;

        let matched = false;
        for (const option of node.cases) {
            const value = await this.evalExpr(option.cond, frame);
            const match = selector === null ? this.toBool(value, option.cond) : this.looseEquals(value, selector, option.cond);
            if (match) {
                matched = true;
                await this.execBlock(option.body, frame);
                break;
            }
        }
        if (!matched && node.otherwise) {
            await this.execBlock(node.otherwise, frame);
        }
    }

    async execLeer(node, frame) {
        const target = await this.resolveTarget(node.target, frame);
        if (target.type.kind === 'record') {
            throw this.rtError(`No se puede leer un registro completo; usa 'Leer >> variable.campo;'.`, node);
        }
        for (let attempt = 0; attempt < 10000; attempt++) {
            const line = await this.readLine(node, target.type);
            if (line === null) {
                if (this.options.shouldStop && this.options.shouldStop()) throw new StopExecution();
                const error = this.rtError('La ejecución pidió una entrada y no hay ninguna disponible (¿se agotaron las entradas del archivo?).', node);
                error.noInput = true; // el CLI lo usa para dar una pista según el caso
                throw error;
            }
            const parsed = parseInput(line, target.type);
            if (parsed.ok) {
                target.set(coerceValue(parsed.value, target.type, this.ctx(node)));
                return;
            }
            this.host.print(`Entrada no válida ("${line.trim()}"): se esperaba ${parsed.expected}.\n`);
        }
        throw this.rtError('Demasiados intentos de entrada inválida.', node);
    }

    async readLine(node, typeInfo) {
        const request = { line: node.line, typeName: typeInfo?.name ?? 'valor' };
        const state = { done: false, value: null, error: null };
        Promise.resolve()
            .then(() => this.host.readLine(request))
            .then(
                (value) => { state.done = true; state.value = value ?? null; },
                (error) => { state.done = true; state.error = error; },
            );
        const shouldStop = this.options.shouldStop;
        while (!state.done) {
            if (shouldStop && shouldStop()) throw new StopExecution();
            await new Promise((resolve) => setTimeout(resolve, 40));
        }
        if (state.error) throw state.error;
        return state.value;
    }

    // ---------------------------------------------------------- referencias

    /**
     * Resuelve una expresión asignable (variable, elemento de arreglo o campo
     * de registro) a un par get/set con su tipo declarado.
     */
    async resolveTarget(node, frame) {
        if (node.kind === 'Ident') {
            const slot = this.lookupVar(frame, node.name);
            if (!slot) return this.undeclaredError(node, frame);
            return {
                type: slot.type,
                get: () => slot.cell.value,
                set: (value) => { slot.cell.value = value; },
                slot,
            };
        }
        if (node.kind === 'Field') {
            const parent = await this.resolveTarget(node.target, frame);
            const record = parent.get();
            if (!isRecordValue(record)) {
                throw this.rtError(`Se intentó acceder al campo '${node.name}' de ${describeValue(record)}. Los campos solo existen en registros.`, node);
            }
            const def = this.lookupRecord(record.typeName);
            const field = def ? def.fields.find((f) => sameName(f.name, node.name)) : undefined;
            if (!field) {
                throw this.rtError(`El registro '${record.typeName}' no tiene un campo llamado '${node.name}'.`, node);
            }
            const key = field.name;
            return {
                type: field.type,
                get: () => record.fields[key],
                set: (value) => { record.fields[key] = value; },
            };
        }
        if (node.kind === 'Index') {
            const parent = await this.resolveTarget(node.target, frame);
            let array;
            let host;
            let used;
            if (parent.array) {
                // El padre ya era un índice parcial: seguimos con la siguiente dimensión.
                array = parent.array;
                host = parent.dataHost;
                used = parent.used;
            } else {
                array = parent.get();
                if (!isArrayValue(array)) {
                    throw this.rtError(`Solo se pueden indexar arreglos; ${describeValue(array)} no es un arreglo.`, node);
                }
                host = array.data;
                used = 0;
            }
            const dim = used + 1;
            if (dim > array.shape.length) {
                throw this.rtError(`'${array.name}' solo tiene ${array.shape.length} dimensión(es) y se intentó acceder a la dimensión ${dim}.`, node);
            }
            const indexValue = await this.evalExpr(node.index, frame);
            const index = this.requireInt(indexValue, node.index, `el índice de '${array.name}'`);
            const limit = array.shape[dim - 1];
            if (index < 1 || index > limit) {
                throw this.rtError(`Índice ${index} fuera de rango [1..${limit}] en '${array.name}' (subíndice ${dim}). Recuerda que los índices comienzan en 1.`, node);
            }
            const next = host[index - 1];
            if (dim === array.shape.length) {
                return {
                    type: array.elemType,
                    get: () => host[index - 1],
                    set: (value) => { host[index - 1] = value; },
                };
            }
            return {
                type: array.elemType,
                used: dim,
                array,
                dataHost: next,
                get: () => {
                    throw this.rtError(`A '${array.name}' le faltan subíndices: tiene ${array.shape.length} dimensiones y solo se usaron ${dim}.`, node);
                },
                set: () => {
                    throw this.rtError(`No se puede asignar a una parte de '${array.name}': usa los ${array.shape.length} subíndices.`, node);
                },
            };
        }
        throw this.rtError('Esta expresión no se puede usar como destino de una asignación.', node);
    }

    undeclaredError(node, frame) {
        let message = `La variable '${node.name}' no está declarada.`;
        const main = this.frames[0];
        if (frame && frame.kind !== 'main' && main && this.lookupVar(main, node.name)) {
            message += ` Los subprogramas no ven las variables del Algoritmo principal: pásala como parámetro (E, S o E/S).`;
        }
        throw this.rtError(message, node);
    }

    // -------------------------------------------------------- expresiones

    async evalExpr(node, frame) {
        switch (node.kind) {
            case 'Num': return node.value;
            case 'Str': return node.value;
            case 'Char': return node.value;
            case 'Bool': return node.value;
            case 'Error': return 0;
            case 'Ident':
            case 'Index':
            case 'Field': {
                const target = await this.resolveTarget(node, frame);
                return target.get();
            }
            case 'Unary': {
                if (node.op === 'not') {
                    throw this.rtError("El operador 'Not' no existe en GaboScript.", node);
                }
                const operand = await this.evalExpr(node.operand, frame);
                const number = this.numeric(operand, node, `para '${node.op}'`);
                if (node.op === '-') {
                    const result = -number;
                    if (Number.isInteger(result)) checkSafeInt(result, this.ctx(node));
                    return result;
                }
                return number;
            }
            case 'Binary': {
                const left = await this.evalExpr(node.left, frame);
                if (node.op === 'and') {
                    if (!this.toBool(left, node.left)) return false;
                    return this.toBool(await this.evalExpr(node.right, frame), node.right);
                }
                if (node.op === 'or') {
                    if (this.toBool(left, node.left)) return true;
                    return this.toBool(await this.evalExpr(node.right, frame), node.right);
                }
                const right = await this.evalExpr(node.right, frame);
                return this.applyBinary(node.op, left, right, node, frame);
            }
            case 'Call':
                return this.callSubprogram(node, frame, true);
            default:
                throw this.rtError(`Expresión no soportada ('${node.kind}').`, node);
        }
    }

    applyBinary(op, left, right, node, frame) {
        switch (op) {
            case '=': return this.looseEquals(left, right, node);
            case '<>': return !this.looseEquals(left, right, node);
            case '<':
            case '>':
            case '<=':
            case '>=': return this.compareValues(op, left, right, node);
            case '+': return this.addValues(left, right, node);
            case '-': return this.arithmetic('-', left, right, node);
            case '*': return this.arithmetic('*', left, right, node);
            case '/': {
                const a = this.numeric(left, node, "para '/'");
                const b = this.numeric(right, node, "para '/'");
                if (b === 0) throw this.rtError('División entre cero.', node);
                return a / b;
            }
            case 'mod': {
                const a = this.numeric(left, node, "para 'Mod'");
                const b = this.numeric(right, node, "para 'Mod'");
                if (b === 0) throw this.rtError('Módulo entre cero (Mod).', node);
                const result = a % b;
                if (Number.isInteger(a) && Number.isInteger(b)) checkSafeInt(result, this.ctx(node));
                return result;
            }
            case 'div': {
                const a = this.numeric(left, node, "para 'Div'");
                const b = this.numeric(right, node, "para 'Div'");
                if (b === 0) throw this.rtError('División entre cero (Div).', node);
                const result = Math.trunc(a / b);
                if (Number.isInteger(a) && Number.isInteger(b)) checkSafeInt(result, this.ctx(node));
                return result;
            }
            case '^': {
                const a = this.numeric(left, node, "para '^'");
                const b = this.numeric(right, node, "para '^'");
                const result = a ** b;
                if (!Number.isFinite(result)) throw this.rtError('Desbordamiento al calcular una potencia (^).', node);
                if (Number.isInteger(a) && Number.isInteger(b) && Number.isInteger(result)) checkSafeInt(result, this.ctx(node));
                return result;
            }
            default:
                throw this.rtError(`Operador no soportado ('${op}').`, node);
        }
    }

    looseEquals(a, b, node) {
        const na = typeof a === 'boolean' ? (a ? 1 : 0) : a;
        const nb = typeof b === 'boolean' ? (b ? 1 : 0) : b;
        if (typeof na === 'number' && typeof nb === 'number') return na === nb;
        if (typeof na === 'string' && typeof nb === 'string') return na === nb;
        if (isArrayValue(a) || isArrayValue(b) || isRecordValue(a) || isRecordValue(b)) {
            throw this.rtError('No se pueden comparar arreglos ni registros directamente.', node);
        }
        throw this.rtError(`No se pueden comparar ${describeValue(a)} y ${describeValue(b)}.`, node);
    }

    compareValues(op, a, b, node) {
        let left = a;
        let right = b;
        if (typeof left === 'boolean') left = left ? 1 : 0;
        if (typeof right === 'boolean') right = right ? 1 : 0;
        if (typeof left === 'number' && typeof right === 'number') {
            switch (op) {
                case '<': return left < right;
                case '>': return left > right;
                case '<=': return left <= right;
                default: return left >= right;
            }
        }
        if (typeof left === 'string' && typeof right === 'string') {
            const cmp = left.localeCompare(right, 'es');
            switch (op) {
                case '<': return cmp < 0;
                case '>': return cmp > 0;
                case '<=': return cmp <= 0;
                default: return cmp >= 0;
            }
        }
        throw this.rtError(`No se pueden comparar ${describeValue(a)} y ${describeValue(b)} con '${op}'.`, node);
    }

    addValues(left, right, node) {
        const leftIsText = typeof left === 'string';
        const rightIsText = typeof right === 'string';
        if (leftIsText || rightIsText) {
            if (isArrayValue(left) || isArrayValue(right) || isRecordValue(left) || isRecordValue(right)) {
                throw this.rtError(`No se puede concatenar ${describeValue(left)} con ${describeValue(right)}.`, node);
            }
            const l = leftIsText ? left : formatValue(left, this.formatOptions());
            const r = rightIsText ? right : formatValue(right, this.formatOptions());
            return l + r;
        }
        return this.arithmetic('+', left, right, node);
    }

    arithmetic(op, left, right, node) {
        const a = this.numeric(left, node, `para '${op}'`);
        const b = this.numeric(right, node, `para '${op}'`);
        const bothInt = Number.isInteger(a) && Number.isInteger(b);
        let result;
        switch (op) {
            case '+': result = a + b; break;
            case '-': result = a - b; break;
            default: result = a * b; break;
        }
        if (!Number.isFinite(result)) {
            throw this.rtError(`Desbordamiento al calcular '${op}'.`, node);
        }
        if (bothInt && Number.isInteger(result)) return checkSafeInt(result, this.ctx(node));
        return result;
    }

    // --------------------------------------------------------- subprogramas

    async callSubprogram(node, callerFrame, asExpression) {
        const sub = this.lookupSubprogram(node.name);
        if (!sub) {
            if (this.lookupVar(callerFrame, node.name)) {
                throw this.rtError(`'${node.name}' es una variable, no un subprograma. Para llamarlo debe existir un Procedimiento o una Función con ese nombre.`, node);
            }
            throw this.rtError(`No existe un subprograma llamado '${node.name}'. ¿Lo definiste después del 'Fin' del Algoritmo?`, node);
        }
        if (asExpression && !sub.isFunction) {
            throw this.rtError(`'${sub.name}' es un Procedimiento y no devuelve ningún valor; no se puede usar dentro de una expresión.`, node);
        }
        if (node.args.length !== sub.params.length) {
            const list = sub.params.map((p) => `${p.name}: ${p.type.name}`).join(', ');
            throw this.rtError(
                `El subprograma '${sub.name}' espera ${sub.params.length} argumento(s) (${list || 'ninguno'}) y se recibieron ${node.args.length}.`,
                node,
            );
        }
        if (this.frames.length >= this.options.maxCallDepth) {
            throw this.rtError(`Demasiadas llamadas anidadas (límite: ${this.options.maxCallDepth}). ¿Hay una recursión infinita?`, node);
        }

        const frame = this.createFrame(sub.name, sub.isFunction ? 'function' : 'procedure', sub.returnType, node.line);
        const copyBacks = [];
        try {
            for (let i = 0; i < sub.params.length; i++) {
                await this.bindParam(sub.params[i], node.args[i], frame, callerFrame, copyBacks);
            }
            this.frames.push(frame);
            this.maxDepth = Math.max(this.maxDepth, this.frames.length);
            try {
                await this.execBlock(sub.body, frame);
            } catch (error) {
                if (error instanceof ReturnSignal) return error.value;
                throw error;
            } finally {
                this.frames.pop();
            }
            if (sub.isFunction) {
                throw this.rtError(`La Función '${sub.name}' terminó sin ejecutar 'Devolver(expresión);'.`, node);
            }
            return undefined;
        } finally {
            for (const copyBack of copyBacks) copyBack();
        }
    }

    async bindParam(param, argNode, calleeFrame, callerFrame, copyBacks) {
        if (param.mode === 'E') {
            const value = await this.evalExpr(argNode, callerFrame);
            let finalValue;
            if (isArrayValue(value)) {
                this.checkArrayElementType(value, param.type, argNode);
                finalValue = value;
            } else if (isRecordValue(value)) {
                // Los registros son tipos agregados: se comparten (igual que los
                // arreglos), de modo que los cambios hechos dentro del
                // subprograma son visibles para el llamador.
                if (param.type.kind !== 'record' || !sameName(value.typeName, param.type.name)) {
                    throw this.rtError(
                        `El parámetro '${param.name}' espera un registro '${param.type.name}' y se pasó ${describeValue(value)}.`,
                        argNode,
                    );
                }
                finalValue = value;
            } else {
                finalValue = coerceValue(value, param.type, this.ctx(argNode));
            }
            calleeFrame.vars.set(param.name, { name: param.name, type: param.type, cell: { value: finalValue }, kind: 'param', mode: 'E' });
            return;
        }

        // Modos S y E/S: paso por referencia.
        if (argNode.kind === 'Ident') {
            const slot = this.lookupVar(callerFrame, argNode.name);
            if (!slot) return this.undeclaredError(argNode, callerFrame);
            this.checkRefCompatibility(slot.type, slot.cell.value, param, argNode);
            // Se comparte la misma celda: los cambios dentro del subprograma se
            // reflejan en la variable del llamador (aunque sea a su vez un parámetro E/S).
            calleeFrame.vars.set(param.name, { name: param.name, type: param.type, cell: slot.cell, kind: 'param', mode: param.mode });
            return;
        }

        const target = await this.resolveTarget(argNode, callerFrame);
        this.checkRefCompatibility(target.type, target.get(), param, argNode);
        const cell = { value: target.get() };
        calleeFrame.vars.set(param.name, { name: param.name, type: param.type, cell, kind: 'param', mode: param.mode });
        copyBacks.push(() => {
            target.set(coerceValue(cell.value, target.type, this.ctx(argNode)));
        });
    }

    checkArrayElementType(array, paramType, node) {
        if (paramType.kind === 'record') {
            throw this.rtError(`El parámetro espera un registro '${paramType.name}' y se pasó un arreglo.`, node);
        }
        if (!sameName(array.elemType.name, paramType.name)) {
            throw this.rtError(`El parámetro espera valores de tipo '${paramType.name}' y se pasó el arreglo '${array.name}' de '${array.elemType.name}'.`, node);
        }
    }

    checkRefCompatibility(targetType, targetValue, param, argNode) {
        if (isArrayValue(targetValue)) {
            this.checkArrayElementType(targetValue, param.type, argNode);
            return;
        }
        if (param.type.kind === 'record') {
            if (!isRecordValue(targetValue) || !sameName(targetValue.typeName, param.type.name)) {
                throw this.rtError(`El parámetro '${param.name}' espera un registro '${param.type.name}' y se pasó ${describeValue(targetValue)}.`, argNode);
            }
            return;
        }
        const numeric = new Set(['Entero', 'Real', 'Booleano']);
        if (targetType.kind === 'prim' && numeric.has(targetType.name) && numeric.has(param.type.name)) return;
        if (targetType.kind === 'prim' && targetType.name === param.type.name) return;
        throw this.rtError(
            `El parámetro '${param.name}' es de tipo '${param.type.name}' y se pasó una variable de tipo '${typeLabelOf(targetValue, targetType)}'.`,
            argNode,
        );
    }
}

function typeLabelOf(value, fallback) {
    if (isArrayValue(value)) return `arreglo de ${value.elemType.name}`;
    if (isRecordValue(value)) return value.typeName;
    if (typeof value === 'number') return Number.isInteger(value) ? 'Entero' : 'Real';
    if (typeof value === 'boolean') return 'Booleano';
    if (typeof value === 'string') return 'Cadena';
    return fallback?.name ?? 'desconocido';
}

/** Interpreta una línea de entrada según el tipo del destino de `Leer`. */
export function parseInput(line, typeInfo) {
    const text = String(line).trim();
    if (typeInfo.kind === 'record') {
        return { ok: false, expected: 'algo distinto a un registro (lee sus campos)' };
    }
    switch (typeInfo.name) {
        case 'Entero': {
            const number = Number(text);
            if (text !== '' && Number.isFinite(number) && Number.isInteger(number) && Math.abs(number) <= SAFE_INT) {
                return { ok: true, value: number };
            }
            return { ok: false, expected: 'un número entero (por ejemplo: 42)' };
        }
        case 'Real': {
            const number = Number(text.replace(',', '.'));
            if (text !== '' && Number.isFinite(number)) {
                return { ok: true, value: number };
            }
            return { ok: false, expected: 'un número (por ejemplo: 3.5)' };
        }
        case 'Booleano': {
            const lower = text.toLowerCase();
            if (['true', 'verdadero', '1', 'si', 'sí'].includes(lower)) return { ok: true, value: true };
            if (['false', 'falso', '0', 'no'].includes(lower)) return { ok: true, value: false };
            return { ok: false, expected: "True/False (o 1/0)" };
        }
        case 'Caracter': {
            if (text.length === 1) return { ok: true, value: text };
            return { ok: false, expected: 'un solo carácter (por ejemplo: a)' };
        }
        case 'Cadena':
            return { ok: true, value: text };
        default:
            return { ok: false, expected: `un valor de tipo ${typeInfo.name}` };
    }
}
