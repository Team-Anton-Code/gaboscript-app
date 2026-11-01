// @ts-nocheck
/**
 * Analizador sintáctico (parser) de GaboScript.
 * Descenso recursivo + Pratt para expresiones. JavaScript puro, sin dependencias.
 *
 * Siempre devuelve un AST (con nodos parciales) y una lista de diagnósticos;
 * nunca lanza excepciones por errores del programa del usuario.
 */

import { tokenize, TERMINATOR_KEYWORDS, PRIMITIVE_TYPES } from './lexer';

// Precedencias de expresiones (mayor = más fuerte).
const PREC = { OR: 1, AND: 2, CMP: 3, ADD: 4, MUL: 5, POW: 6 };

/**
 * Jerarquía de agrupación de GaboScript, de dentro hacia fuera:
 * ( ) → [ ] → { } → ( ) → [ ] → { }…
 * Es la convención matemática de los apuntes: paréntesis dentro de corchetes
 * dentro de llaves, y al necesitar otro nivel se vuelve a empezar por ( ).
 */
const GROUPING = {
    '(': { close: ')', level: 1, label: 'paréntesis' },
    '[': { close: ']', level: 2, label: 'corchetes' },
    '{': { close: '}', level: 3, label: 'llaves' },
};
const GROUP_LABEL = { 1: 'paréntesis', 2: 'corchetes', 3: 'llaves' };
const GROUP_ONE = { 1: 'un paréntesis', 2: 'un corchete', 3: 'una llave' };
const GROUP_OTHER = { 1: 'otro paréntesis', 2: 'otro corchete', 3: 'otra llave' };
function expectedInnerLevel(parentLevel) {
    return parentLevel === 1 ? 3 : parentLevel - 1;
}

/**
 * Parsea el código fuente.
 * @param {string} source
 * @returns {{program: any, diagnostics: Array<any>, tokens: Array<any>}}
 */
export function parse(source) {
    const diagnostics = [];
    const tokens = tokenize(source, diagnostics);
    const parser = new Parser(tokens, diagnostics);
    const program = parser.parseProgram();
    return { program, diagnostics, tokens };
}

class Parser {
    constructor(tokens, diagnostics) {
        this.tokens = tokens;
        this.pos = 0;
        this.diagnostics = diagnostics;
        /** Niveles de las agrupaciones abiertas (1 paréntesis, 2 corchetes, 3 llaves). */
        this.groupStack = [];
    }

    // ------------------------------------------------------------------ base

    peek(k = 0) {
        return this.tokens[Math.min(this.pos + k, this.tokens.length - 1)];
    }

    next() {
        const token = this.peek();
        if (token.type !== 'eof') this.pos++;
        return token;
    }

    atEof() {
        return this.peek().type === 'eof';
    }

    atSym(value) {
        const t = this.peek();
        return t.type === 'sym' && t.value === value;
    }

    atKw(value) {
        const t = this.peek();
        return t.type === 'keyword' && t.value === value;
    }

    atIdent() {
        return this.peek().type === 'ident';
    }

    atType() {
        const t = this.peek();
        if (t.type === 'keyword') return PRIMITIVE_TYPES.has(capitalize(t.value));
        return t.type === 'ident';
    }

    matchSym(value) {
        if (this.atSym(value)) {
            this.next();
            return true;
        }
        return false;
    }

    matchKw(value) {
        if (this.atKw(value)) {
            this.next();
            return true;
        }
        return false;
    }

    error(token, message, length = Math.max(1, token.raw?.length ?? 1), code = null) {
        const diagnostic = { severity: 'error', message, line: token.line, col: token.col, length };
        if (code) diagnostic.code = code;
        this.diagnostics.push(diagnostic);
    }

    warn(token, message, length = Math.max(1, token.raw?.length ?? 1), code = null) {
        const diagnostic = { severity: 'warning', message, line: token.line, col: token.col, length };
        if (code) diagnostic.code = code;
        this.diagnostics.push(diagnostic);
    }

    /** Comprueba que una agrupación respete el ciclo ( ) → [ ] → { } → ( )… */
    checkGrouping(token, group) {
        const parentLevel = this.groupStack[this.groupStack.length - 1];
        if (parentLevel === undefined) return;
        const expectedLevel = expectedInnerLevel(parentLevel);
        if (group.level === expectedLevel) return;
        const parent = GROUP_LABEL[parentLevel];
        const expected = GROUP_ONE[expectedLevel];
        const actual = group.level === parentLevel
            ? GROUP_OTHER[group.level]
            : GROUP_ONE[group.level];
        this.error(
            token,
            `Orden de agrupación incorrecto: dentro de ${parent} (nivel ${parentLevel}) debe ir ${expected} (nivel ${expectedLevel}), no ${actual}. La jerarquía es ( ) → [ ] → { } → ( )…`,
            1,
            'group-order',
        );
    }

    /** Diagnóstico de un bloque que quedó abierto, señalando su apertura. */
    missingCloser(header, closer, construct) {
        const unexpected = this.peek();
        const detail = unexpected.type === 'eof'
            ? 'se llegó al final del archivo'
            : `se encontró '${unexpected.raw}' en la línea ${unexpected.line}`;
        this.error(
            header,
            `Falta '${closer}' para cerrar ${construct} abierto aquí (${detail}).`,
            Math.max(1, header.raw?.length ?? 1),
            'missing-close',
        );
    }

    expectSym(value, message) {
        if (this.atSym(value)) return this.next();
        this.error(this.peek(), message);
        return null;
    }

    expectKw(value, message) {
        if (this.atKw(value)) return this.next();
        this.error(this.peek(), message);
        return null;
    }

    expectIdent(message) {
        if (this.atIdent()) return this.next();
        this.error(this.peek(), message);
        return null;
    }

    /**
     * Consume el ';' obligatorio al final de una sentencia o cabecera. Si
     * falta, se informa justo después del último token de la sentencia.
     */
    requireSemicolon() {
        if (this.atSym(';')) {
            this.next();
            return;
        }

        const previous = this.tokens[Math.max(0, this.pos - 1)];
        const token = previous ?? this.peek();
        const col = previous
            ? previous.col + Math.max(1, previous.raw?.length ?? 1)
            : this.peek().col;
        this.diagnostics.push({
            severity: 'error',
            message: 'Falta punto y coma (;) al final de la sentencia.',
            line: token.line,
            col,
            length: 1,
            code: 'missing-semi',
        });
    }

    /**
     * Exige que una condición sea una comparación explícita. Se aceptan las
     * comparaciones combinadas con `And`/`Or`; una variable, una constante o
     * un literal lógico por sí solos no son una condición válida.
     */
    validateCondition(expr, token, construct) {
        if (hasErrorNode(expr) || isExplicitCondition(expr)) return;
        this.error(
            token,
            `La condición del '${construct}' debe ser una comparación explícita (por ejemplo: x = y o x <> y).`,
            Math.max(1, token.raw?.length ?? 1),
            'explicit-condition',
        );
    }

    // -------------------------------------------------------------- programa

    parseProgram() {
        const records = [];
        const subprograms = [];

        while (this.atKw('registro')) records.push(this.parseRecord());

        let name = 'Algoritmo';
        const programHeader = this.peek();
        if (this.matchKw('algoritmo')) {
            const nameToken = this.expectIdent("Se esperaba el nombre del algoritmo (por ejemplo: Algoritmo mi_programa).");
            if (nameToken) name = nameToken.value;
        } else {
            this.error(this.peek(), "El programa debe comenzar con la palabra 'Algoritmo'. Se encontró otra construcción.");
        }

        if (!this.matchKw('inicio')) {
            this.error(this.peek(), "Se esperaba 'Inicio' después de la cabecera del Algoritmo.");
        }

        const body = this.parseBody();

        if (!this.matchKw('fin')) {
            this.missingCloser(programHeader, 'Fin', "el 'Algoritmo'");
        }

        while (!this.atEof()) {
            if (this.atKw('procedimiento') || this.atKw('funcion')) {
                subprograms.push(this.parseSubprogram());
            } else if (this.atKw('registro')) {
                records.push(this.parseRecord());
            } else if (this.atSym(';')) {
                this.warn(this.peek(), 'Punto y coma (;) inesperado.', 1, 'unexpected-semi');
                this.next();
            } else {
                this.error(this.peek(), "Solo se permiten definiciones de 'Procedimiento', 'Funcion' o 'Registro' después del 'Fin' del Algoritmo.");
                this.next();
            }
        }

        return { kind: 'Program', name, body, subprograms, records, line: 1, col: 1 };
    }

    parseSubprogram() {
        const header = this.next(); // 'procedimiento' | 'funcion'
        const isFunction = header.value === 'funcion';
        const nameToken = this.expectIdent(`Se esperaba el nombre del ${isFunction ? 'Funcion' : 'Procedimiento'}.`);
        const name = nameToken ? nameToken.value : '<sin_nombre>';

        const params = [];
        if (this.matchSym('(')) {
            params.push(...this.parseParams());
            this.expectSym(')', 'Se esperaba ")" para cerrar la lista de parámetros.');
        } else {
            this.error(this.peek(), "Se esperaba '(' con la lista de parámetros del subprograma.");
        }

        let returnType = null;
        if (isFunction) {
            if (this.expectSym(':', "Se esperaba ':' y el tipo que devuelve la Función.")) {
                returnType = this.parseType();
            } else {
                returnType = { kind: 'prim', name: 'Entero' };
            }
        }

        this.requireSemicolon();
        if (!this.matchKw('inicio')) {
            this.error(this.peek(), "Se esperaba 'Inicio' para comenzar el cuerpo del subprograma.");
        }
        const body = this.parseBody();
        const closer = isFunction ? 'fin_funcion' : 'fin_procedimiento';
        if (!this.matchKw(closer)) {
            this.missingCloser(
                header,
                isFunction ? 'Fin_Funcion' : 'Fin_Procedimiento',
                `el subprograma '${name}'`,
            );
        }

        return { kind: 'Subprogram', isFunction, name, params, returnType, body, line: header.line, col: header.col };
    }

    parseParams() {
        const params = [];
        let lastMode = 'E';

        while (!this.atSym(')') && !this.atEof()) {
            const explicitMode = this.tryConsumeMode();
            const mode = explicitMode ?? lastMode;
            if (explicitMode) lastMode = explicitMode;

            // Un grupo es `[modo:] nombre {',' nombre} ':' Tipo`. Los nombres
            // se acumulan hasta encontrar ':' y el tipo cierra el grupo.
            const names = [];
            let type = null;
            let guard = 0;
            while (!this.atSym(')') && !this.atEof() && guard++ < 4096) {
                const nameToken = this.expectIdent("Se esperaba el nombre de un parámetro.");
                if (!nameToken) {
                    this.next();
                    continue;
                }
                names.push({ name: nameToken.value, line: nameToken.line, col: nameToken.col });
                if (this.matchSym(':')) {
                    type = this.parseType();
                    break;
                }
                if (this.matchSym(',')) {
                    continue;
                }
                this.error(this.peek(), "Se esperaba ':' con el tipo del parámetro o ',' para separar nombres.");
                break;
            }

            if (type) {
                for (const item of names) {
                    params.push({ name: item.name, type, mode, line: item.line, col: item.col });
                }
            }

            if (!this.matchSym(',')) break;
        }

        return params;
    }

    /** Detecta un modo de parámetro contextual (`E:`, `S:` o `E/S:`) sin consumirlo. */
    peekMode() {
        const t = this.peek();
        if (t.type !== 'ident') return null;
        const lower = t.value.toLowerCase();
        if (lower !== 'e' && lower !== 's') return null;

        const n1 = this.peek(1);
        if (!n1 || n1.type !== 'sym') return null;

        if (n1.value === ':') {
            const after = this.peek(2);
            if (after && after.type === 'ident') return lower === 'e' ? 'E' : 'S';
            return null;
        }

        if (lower === 'e' && n1.value === '/') {
            const n2 = this.peek(2);
            const n3 = this.peek(3);
            const n4 = this.peek(4);
            if (n2 && n2.type === 'ident' && n2.value.toLowerCase() === 's' && n3 && n3.type === 'sym' && n3.value === ':') {
                if (n4 && n4.type === 'ident') return 'E/S';
            }
        }

        return null;
    }

    tryConsumeMode() {
        const mode = this.peekMode();
        if (!mode) return null;
        if (mode === 'E/S') {
            this.next(); // E
            this.next(); // /
            this.next(); // S
            this.next(); // :
        } else {
            this.next(); // E | S
            this.next(); // :
        }
        return mode;
    }

    parseRecord() {
        const header = this.next(); // 'registro'
        this.matchSym(':'); // variante aceptada: Registro: Nombre;
        const nameToken = this.expectIdent("Se esperaba el nombre del Registro (por ejemplo: Registro Persona).");
        const name = nameToken ? nameToken.value : '<sin_nombre>';
        this.requireSemicolon();

        const fields = [];
        while (!this.atEof() && !this.atKw('fin_registro')) {
            const before = this.pos;
            if (this.atSym(';')) {
                this.next();
                continue;
            }
            if (this.matchKw('var')) {
                fields.push(...this.parseFieldList());
            } else if (this.atIdent()) {
                fields.push(...this.parseFieldList());
            } else {
                this.error(this.peek(), `Solo se permiten campos dentro del Registro '${name}' (campo: Tipo;) o 'Fin_Registro'.`);
                this.next();
            }
            if (this.pos === before) this.next();
        }

        if (!this.matchKw('fin_registro')) {
            this.missingCloser(header, 'Fin_Registro', `el Registro '${name}'`);
        }

        return { kind: 'RecordDef', name, fields, line: header.line, col: header.col };
    }

    parseFieldList() {
        const fields = [];
        const first = this.expectIdent('Se esperaba el nombre de un campo del Registro.');
        if (!first) return fields;
        const names = [first.value];
        while (this.matchSym(',')) {
            const extra = this.expectIdent('Se esperaba el nombre de un campo del Registro.');
            if (!extra) break;
            names.push(extra.value);
        }
        if (this.matchSym(':')) {
            const type = this.parseType();
            for (const name of names) {
                fields.push({ name, type, line: first.line, col: first.col });
            }
        } else {
            this.error(this.peek(), "Se esperaba ':' con el tipo del campo.");
        }
        this.requireSemicolon();
        return fields;
    }

    parseType() {
        const t = this.peek();
        if (t.type === 'keyword' && PRIMITIVE_TYPES.has(capitalize(t.value))) {
            this.next();
            return { kind: 'prim', name: capitalize(t.value), line: t.line, col: t.col };
        }
        if (t.type === 'ident') {
            this.next();
            return { kind: 'record', name: t.value, line: t.line, col: t.col };
        }
        this.error(t, 'Se esperaba un tipo: Entero, Real, Caracter, Cadena, Booleano o el nombre de un Registro.');
        return { kind: 'prim', name: 'Entero', line: t.line, col: t.col };
    }

    // ------------------------------------------------------------ sentencias

    /** Cuerpo de un bloque: se detiene en cualquier palabra que cierre un bloque. */
    parseBody() {
        const body = [];
        while (true) {
            const t = this.peek();
            if (t.type === 'eof') break;
            if (t.type === 'keyword' && TERMINATOR_KEYWORDS.has(t.value)) break;
            if (t.type === 'sym' && t.value === ';') {
                this.warn(t, 'Punto y coma (;) inesperado.', 1, 'unexpected-semi');
                this.next();
                continue;
            }
            const before = this.pos;
            const statement = this.parseStatement();
            if (statement) body.push(statement);
            if (this.pos === before) {
                this.error(t, 'No se entiende esta parte del código.');
                this.next();
            }
        }
        return body;
    }

    parseStatement() {
        const t = this.peek();
        if (t.type === 'keyword') {
            switch (t.value) {
                case 'var': return this.parseVarDecl();
                case 'si': return this.parseIf();
                case 'mientras': return this.parseWhile();
                case 'repetir': return this.parseRepeat();
                case 'para': return this.parseFor();
                case 'en_caso': return this.parseEnCaso();
                case 'leer': return this.parseLeer();
                case 'mostrar':
                case 'imprimir': return this.parseMostrar();
                case 'devolver': return this.parseDevolver();
                default:
                    this.error(t, `No se reconoce la palabra '${t.raw}' en esta posición.`);
                    return null;
            }
        }
        if (t.type === 'ident') {
            return this.parseIdentStatement();
        }
        this.error(t, `No se reconoce el inicio de una sentencia ('${t.raw}').`);
        return null;
    }

    parseVarDecl() {
        const header = this.next(); // 'var'
        const items = [];
        let type = { kind: 'prim', name: 'Entero' };

        while (true) {
            const nameToken = this.expectIdent("Se esperaba un nombre de variable después de 'Var'.");
            if (!nameToken) break;
            const dims = [];
            while (this.atSym('[')) {
                this.next();
                dims.push(this.parseFreshExpression());
                this.expectSym(']', "Se esperaba ']' para cerrar la dimensión del arreglo.");
            }
            let init = null;
            if (this.matchSym('=')) {
                init = this.parseExpression();
            }
            items.push({ name: nameToken.value, dims, init, line: nameToken.line, col: nameToken.col });
            if (!this.matchSym(',')) break;
        }

        if (this.expectSym(':', "Se esperaba ':' con el tipo de las variables.")) {
            type = this.parseType();
        }
        this.requireSemicolon();

        return { kind: 'VarDecl', items, type, line: header.line, col: header.col };
    }

    parseIf() {
        const header = this.next(); // 'si'
        const condToken = this.peek();
        const cond = this.parseExpression();
        this.validateCondition(cond, condToken, 'Si');
        if (!this.matchKw('entonces')) {
            this.error(this.peek(), "Se esperaba 'Entonces' después de la condición del 'Si'.");
        }
        this.requireSemicolon();
        const then = this.parseBody();
        let otherwise = null;
        if (this.matchKw('sino')) {
            otherwise = this.parseBody();
        }
        if (!this.matchKw('fin_si')) {
            this.missingCloser(header, 'Fin_Si', "el 'Si'");
        }
        return { kind: 'If', cond, then, otherwise, line: header.line, col: header.col };
    }

    parseWhile() {
        const header = this.next(); // 'mientras'
        const condToken = this.peek();
        const cond = this.parseExpression();
        this.validateCondition(cond, condToken, 'Mientras');
        if (!this.matchKw('hacer')) {
            this.error(this.peek(), "Se esperaba 'Hacer' después de la condición del 'Mientras'.");
        }
        this.requireSemicolon();
        const body = this.parseBody();
        if (!this.matchKw('fin_mientras')) {
            this.missingCloser(header, 'Fin_Mientras', "el 'Mientras'");
        }
        return { kind: 'While', cond, body, line: header.line, col: header.col };
    }

    parseRepeat() {
        const header = this.next(); // 'repetir'
        const body = this.parseBody();
        if (!this.matchKw('hasta')) {
            this.missingCloser(header, 'Hasta (condición);', "el 'Repetir'");
            return { kind: 'Repeat', body, cond: { kind: 'Bool', value: true, line: header.line, col: header.col }, line: header.line, col: header.col };
        }
        let cond = { kind: 'Bool', value: true, line: header.line, col: header.col };
        let condToken = this.peek();
        if (this.matchSym('(')) {
            condToken = this.peek();
            cond = this.parseExpression();
            this.expectSym(')', "Se esperaba ')' para cerrar la condición del 'Hasta'.");
        } else {
            cond = this.parseExpression();
        }
        this.validateCondition(cond, condToken, 'Hasta');
        this.requireSemicolon();
        if (!this.matchKw('fin_repetir')) {
            this.missingCloser(header, 'Fin_Repetir', "el 'Repetir'");
        }
        return { kind: 'Repeat', body, cond, line: header.line, col: header.col };
    }

    parseFor() {
        const header = this.next(); // 'para'
        this.expectSym('(', "Se esperaba '(' después de 'Para'.");
        let varName = null;
        const varToken = this.expectIdent("Se esperaba la variable de control del 'Para'.");
        if (varToken) varName = varToken.value;
        this.expectSym('=', "Se esperaba '=' con el valor inicial del 'Para'.");
        const from = this.parseExpression();
        if (!this.matchKw('hasta')) {
            this.error(this.peek(), "Se esperaba 'Hasta' con el límite del 'Para'.");
        }
        let to = this.parseExpression();
        // Forma usada en clase: "Hasta i = 15" (equivale a "Hasta 15").
        if (to.kind === 'Binary' && to.op === '=') {
            if (to.left?.kind === 'Ident' && varName && sameWord(to.left.name, varName)) to = to.right;
            else if (to.right?.kind === 'Ident' && varName && sameWord(to.right.name, varName)) to = to.left;
        }
        let step = null;
        const stepToken = this.peek();
        if (stepToken.type === 'ident' && stepToken.value.toLowerCase() === 'paso') {
            this.next();
            step = this.parseExpression();
        }
        this.expectSym(')', "Se esperaba ')' para cerrar la cabecera del 'Para'.");
        if (!this.matchKw('hacer')) {
            this.error(this.peek(), "Se esperaba 'Hacer' después de la cabecera del 'Para'.");
        }
        this.requireSemicolon();
        const body = this.parseBody();
        if (!this.matchKw('fin_para')) {
            this.missingCloser(header, 'Fin_Para', "el 'Para'");
        }
        return { kind: 'For', varName, from, to, step, body, line: header.line, col: header.col };
    }

    parseEnCaso() {
        const header = this.next(); // 'en_caso'
        let guard;
        let guardToken = this.peek();
        if (this.matchSym('(')) {
            guardToken = this.peek();
            guard = this.parseExpression();
            this.expectSym(')', "Se esperaba ')' para cerrar la condición del 'En_Caso'.");
        } else {
            guard = this.parseExpression();
        }
        this.validateCondition(guard, guardToken, 'En_Caso');
        if (!this.matchKw('sea')) {
            this.error(this.peek(), "Se esperaba 'Sea' después de la condición del 'En_Caso'.");
        }
        this.requireSemicolon();

        const cases = [];
        let otherwise = null;
        while (this.atKw('caso')) {
            const caseToken = this.next();
            const condToken = this.peek();
            const cond = this.parseExpression();
            this.validateCondition(cond, condToken, 'Caso');
            this.requireSemicolon();
            const body = this.parseBody();
            cases.push({ cond, body, line: caseToken.line, col: caseToken.col });
        }
        if (this.matchKw('otro_caso')) {
            otherwise = this.parseBody();
        }
        if (!this.matchKw('fin_caso')) {
            this.missingCloser(header, 'Fin_Caso', "el 'En_Caso'");
        }
        return { kind: 'EnCaso', guard, cases, otherwise, line: header.line, col: header.col };
    }

    parseLeer() {
        const header = this.next(); // 'leer'
        if (!this.matchSym('>>')) {
            this.error(this.peek(), "Se esperaba '>>' después de 'Leer' (ejemplo: Leer >> edad;).");
        }
        const target = this.parseLValue();
        this.requireSemicolon();
        return { kind: 'Leer', target, line: header.line, col: header.col };
    }

    parseMostrar() {
        const header = this.next(); // 'mostrar' | 'imprimir'
        if (!this.matchSym('<<')) {
            this.error(this.peek(), "Se esperaba '<<' después de 'Mostrar' (ejemplo: Mostrar << resultado;).");
        }
        const args = [];
        args.push(this.parseExpression());
        while (this.matchSym(',')) {
            args.push(this.parseExpression());
        }
        this.requireSemicolon();
        return { kind: 'Mostrar', args, line: header.line, col: header.col };
    }

    parseDevolver() {
        const header = this.next(); // 'devolver'
        let value = null;
        if (!this.atSym(';') && !this.atEof()) {
            value = this.parseExpression();
        }
        this.requireSemicolon();
        return { kind: 'Devolver', value, line: header.line, col: header.col };
    }

    parseIdentStatement() {
        const first = this.next();
        const base = { kind: 'Ident', name: first.value, line: first.line, col: first.col };
        const expr = this.parsePostfix(base, true);
        if (expr.kind === 'Call') {
            this.requireSemicolon();
            return { kind: 'CallStmt', call: expr, line: expr.line, col: expr.col };
        }
        if (this.matchSym('=')) {
            const value = this.parseExpression();
            this.requireSemicolon();
            return { kind: 'Assign', target: expr, value, line: expr.line, col: expr.col };
        }
        this.error(this.peek(), `Se esperaba '=' para asignar un valor a '${first.value}' o '(' para llamar a un subprograma.`);
        return null;
    }

    parseLValue() {
        const token = this.expectIdent("Se esperaba una variable (con '>>' se indica dónde guardar lo leído).");
        if (!token) return { kind: 'Ident', name: '<error>', line: this.peek().line, col: this.peek().col };
        return this.parsePostfix({ kind: 'Ident', name: token.value, line: token.line, col: token.col }, false);
    }

    // ------------------------------------------------------------ expresiones

    parseExpression() {
        return this.parseBinary(PREC.OR);
    }

    /** Expresión independiente (índices, argumentos, dimensiones): reinicia la jerarquía. */
    parseFreshExpression() {
        const saved = this.groupStack;
        this.groupStack = [];
        try {
            return this.parseExpression();
        } finally {
            this.groupStack = saved;
        }
    }

    parseBinary(minPrec) {
        let left = this.parseUnary();
        for (;;) {
            const info = this.binaryOpInfo(this.peek());
            if (!info || info.prec < minPrec) break;
            const opToken = this.next();
            const right = this.parseBinary(info.rightAssoc ? info.prec : info.prec + 1);
            left = { kind: 'Binary', op: info.op, left, right, line: opToken.line, col: opToken.col };
        }
        return left;
    }

    binaryOpInfo(token) {
        if (token.type === 'keyword') {
            switch (token.value) {
                case 'or': return { op: 'or', prec: PREC.OR };
                case 'and': return { op: 'and', prec: PREC.AND };
                case 'mod': return { op: 'mod', prec: PREC.MUL };
                case 'div': return { op: 'div', prec: PREC.MUL };
                default: return null;
            }
        }
        if (token.type !== 'sym') return null;
        switch (token.value) {
            case '=':
            case '==': return { op: '=', prec: PREC.CMP };
            case '<>':
            case '!=': return { op: '<>', prec: PREC.CMP };
            case '<': return { op: '<', prec: PREC.CMP };
            case '>': return { op: '>', prec: PREC.CMP };
            case '<=': return { op: '<=', prec: PREC.CMP };
            case '>=': return { op: '>=', prec: PREC.CMP };
            case '+': return { op: '+', prec: PREC.ADD };
            case '-': return { op: '-', prec: PREC.ADD };
            case '*': return { op: '*', prec: PREC.MUL };
            case '/': return { op: '/', prec: PREC.MUL };
            case '%': return { op: 'mod', prec: PREC.MUL };
            case '^': return { op: '^', prec: PREC.POW, rightAssoc: true };
            default: return null;
        }
    }

    parseUnary() {
        const t = this.peek();
        if (t.type === 'sym' && (t.value === '-' || t.value === '+')) {
            this.next();
            const operand = this.parseBinary(PREC.POW);
            return { kind: 'Unary', op: t.value, operand, line: t.line, col: t.col };
        }
        if (t.type === 'keyword' && t.value === 'not') {
            this.next();
            this.error(
                t,
                "El operador 'Not' no existe en GaboScript. Para negar una condición, compara explícitamente (por ejemplo: x <> y).",
                Math.max(1, t.raw?.length ?? 1),
                'not-unsupported',
            );
            // Se consume el operando para recuperarse y seguir revisando el
            // resto del programa, pero no se construye un nodo evaluable.
            this.parseBinary(PREC.POW);
            return { kind: 'Error', line: t.line, col: t.col };
        }
        return this.parsePostfix(this.parsePrimary(), true);
    }

    parsePrimary() {
        const t = this.peek();
        switch (t.type) {
            case 'number':
                this.next();
                return { kind: 'Num', value: t.value, isReal: t.raw.includes('.'), line: t.line, col: t.col };
            case 'string':
                this.next();
                return { kind: 'Str', value: t.value, line: t.line, col: t.col };
            case 'char':
                this.next();
                return { kind: 'Char', value: t.value, line: t.line, col: t.col };
            case 'keyword':
                if (t.value === 'true' || t.value === 'false') {
                    this.next();
                    return { kind: 'Bool', value: t.value === 'true', line: t.line, col: t.col };
                }
                this.error(t, `Se esperaba una expresión y se encontró '${t.raw}'.`);
                return { kind: 'Error', line: t.line, col: t.col };
            case 'ident':
                this.next();
                return { kind: 'Ident', name: t.value, line: t.line, col: t.col };
            case 'sym':
                if (GROUPING[t.value]) {
                    const group = GROUPING[t.value];
                    this.checkGrouping(t, group);
                    this.next();
                    this.groupStack.push(group.level);
                    const expr = this.parseExpression();
                    this.groupStack.pop();
                    this.expectSym(
                        group.close,
                        `Se esperaba '${group.close}' para cerrar la agrupación de ${group.label}.`,
                    );
                    return expr;
                }
                this.error(t, `Se esperaba una expresión y se encontró '${t.raw}'.`);
                return { kind: 'Error', line: t.line, col: t.col };
            default:
                this.error(t, 'Se esperaba una expresión.');
                return { kind: 'Error', line: t.line, col: t.col };
        }
    }

    parsePostfix(base, allowCall) {
        let expr = base;
        for (;;) {
            if (this.atSym('[')) {
                const t = this.next();
                const index = this.parseFreshExpression();
                this.expectSym(']', "Se esperaba ']' para cerrar el índice.");
                expr = { kind: 'Index', target: expr, index, line: t.line, col: t.col };
                continue;
            }
            if (this.atSym('.')) {
                const t = this.next();
                const nameToken = this.expectIdent("Se esperaba el nombre del campo después de '.'.");
                if (!nameToken) break;
                expr = { kind: 'Field', target: expr, name: nameToken.value, line: t.line, col: t.col };
                continue;
            }
            if (allowCall && this.atSym('(')) {
                if (expr.kind !== 'Ident') {
                    this.error(this.peek(), 'Solo se pueden llamar subprogramas directamente por su nombre.');
                }
                this.next();
                const args = [];
                if (!this.atSym(')')) {
                    args.push(this.parseFreshExpression());
                    while (this.matchSym(',')) {
                        args.push(this.parseFreshExpression());
                    }
                }
                this.expectSym(')', "Se esperaba ')' para cerrar los argumentos de la llamada.");
                expr = { kind: 'Call', name: expr.kind === 'Ident' ? expr.name : '<error>', args, line: base.line, col: base.col };
                continue;
            }
            break;
        }
        return expr;
    }
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function sameWord(a, b) {
    return a === b || a.toLowerCase() === b.toLowerCase();
}

/** Operadores que convierten una expresión en una condición explícita. */
const COMPARISON_OPS = new Set(['=', '<>', '<', '>', '<=', '>=']);

/**
 * Una condición es explícita si es una comparación o una combinación de
 * condiciones con `And`/`Or` (por ejemplo: `x = y And z <> 0`).
 */
function isExplicitCondition(expr) {
    if (!expr || expr.kind !== 'Binary') return false;
    if (COMPARISON_OPS.has(expr.op)) return true;
    if (expr.op === 'and' || expr.op === 'or') {
        return isExplicitCondition(expr.left) && isExplicitCondition(expr.right);
    }
    return false;
}

/** Indica si la expresión ya contiene un nodo de error (para no duplicar avisos). */
function hasErrorNode(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.kind === 'Error') return true;
    if (node.kind === 'Binary') return hasErrorNode(node.left) || hasErrorNode(node.right);
    if (node.kind === 'Unary') return hasErrorNode(node.operand);
    if (node.kind === 'Call') return (node.args ?? []).some(hasErrorNode);
    if (node.kind === 'Index') return hasErrorNode(node.target) || hasErrorNode(node.index);
    if (node.kind === 'Field') return hasErrorNode(node.target);
    return false;
}
