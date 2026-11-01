/**
 * Analizador léxico (lexer) de GaboScript.
 * Convierte el texto fuente en una lista de tokens con posición (línea/columna).
 */

export const KEYWORDS = new Set([
  // Estructura del programa
  'algoritmo', 'inicio', 'fin',
  // Declaraciones
  'var',
  // Control
  'si', 'entonces', 'sino', 'fin_si',
  'para', 'hasta', 'hacer', 'fin_para',
  'mientras', 'fin_mientras',
  'repetir', 'fin_repetir',
  'en_caso', 'sea', 'caso', 'otro_caso', 'fin_caso',
  // Entrada / salida / retorno
  'leer', 'mostrar', 'imprimir', 'devolver',
  // Subprogramas
  'procedimiento', 'fin_procedimiento', 'funcion', 'fin_funcion',
  // Registros
  'registro', 'fin_registro',
  // Operadores con nombre
  'and', 'or', 'not', 'mod', 'div',
  // Literales lógicos
  'true', 'false',
  // Tipos
  'entero', 'real', 'caracter', 'cadena', 'booleano',
]);

export const PRIMITIVE_TYPES = new Set(['Entero', 'Real', 'Caracter', 'Cadena', 'Booleano']);

export const TERMINATOR_KEYWORDS = new Set([
  'fin', 'sino', 'fin_si', 'fin_para', 'fin_mientras', 'fin_repetir',
  'fin_caso', 'otro_caso', 'caso', 'hasta', 'fin_procedimiento', 'fin_funcion',
]);

const IDENT_RE = /[\p{L}_][\p{L}\p{N}_]*/uy;
const NUMBER_RE = /\d+(\.\d+)?/y;

const SYMBOLS = [
  '<<', '>>', '<>', '<=', '>=', '==', '!=',
  '=', '<', '>', '+', '-', '*', '/', '^', '%',
  '(', ')', '[', ']', '{', '}', ',', ';', ':', '.',
];

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  line: number;
  col: number;
  length: number;
  code?: string;
}

export type TokenType = 'ident' | 'keyword' | 'number' | 'string' | 'char' | 'sym' | 'eof';

export interface Token {
  type: TokenType;
  value: any;
  raw: string;
  line: number;
  col: number;
  start: number;
  end: number;
}

export function tokenize(source: string, diagnostics: Diagnostic[] = []): Token[] {
  const text = source.replace(/\r\n?/g, '\n');
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const error = (message: string, at: { line: number; col: number }, length = 1) => {
    diagnostics.push({ severity: 'error', message, line: at.line, col: at.col, length });
  };

  const here = () => ({ line, col: i - lineStart + 1 });

  const advanceLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      if (text[k] === '\n') {
        line++;
        lineStart = k + 1;
      }
    }
  };

  while (i < text.length) {
    const ch = text[i];

    // Espacios en blanco
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\u00a0' || ch === '\ufeff') {
      advanceLines(i, i + 1);
      i++;
      continue;
    }

    // Comentario de línea
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }

    // Comentario de bloque
    if (ch === '/' && text[i + 1] === '*') {
      const at = here();
      const end = text.indexOf('*/', i + 2);
      if (end === -1) {
        error('Comentario /* sin cerrar (falta */).', at);
        i = text.length;
        continue;
      }
      advanceLines(i, end + 2);
      i = end + 2;
      continue;
    }

    // Números
    if (/[0-9]/.test(ch)) {
      const at = here();
      NUMBER_RE.lastIndex = i;
      const match = NUMBER_RE.exec(text);
      const raw = match ? match[0] : ch;
      tokens.push({
        type: 'number',
        value: Number(raw),
        raw,
        ...at,
        start: i,
        end: i + raw.length,
      });
      i += raw.length;
      continue;
    }

    // Cadenas
    if (ch === '"') {
      const at = here();
      let value = '';
      let k = i + 1;
      let closed = false;
      while (k < text.length) {
        const c = text[k];
        if (c === '\\' && (text[k + 1] === '"' || text[k + 1] === '\\')) {
          value += text[k + 1];
          k += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          break;
        }
        if (c === '\n') {
          break;
        }
        value += c;
        k++;
      }
      if (!closed) {
        error('Cadena sin cerrar (falta la comilla ").', at, Math.max(1, k - i));
        i = k < text.length && text[k] === '\n' ? k : text.length;
        continue;
      }
      tokens.push({ type: 'string', value, raw: text.slice(i, k + 1), ...at, start: i, end: k + 1 });
      i = k + 1;
      continue;
    }

    // Caracteres 'x'
    if (ch === "'") {
      const at = here();
      const close = text.indexOf("'", i + 1);
      const newline = text.indexOf('\n', i + 1);
      if (close === -1 || (newline !== -1 && newline < close)) {
        error("Carácter sin cerrar (falta la comilla ').", at);
        i++;
        continue;
      }
      const content = text.slice(i + 1, close);
      if (content.length !== 1) {
        error(`Un Caracter debe ser un único carácter (se encontró '${content}'). Usa comillas dobles para cadenas.`, at, close - i + 1);
      } else {
        tokens.push({ type: 'char', value: content, raw: text.slice(i, close + 1), ...at, start: i, end: close + 1 });
      }
      i = close + 1;
      continue;
    }

    // Identificadores y palabras clave
    IDENT_RE.lastIndex = i;
    const identMatch = IDENT_RE.exec(text);
    if (identMatch) {
      const raw = identMatch[0];
      const lower = raw.toLowerCase();
      const at = here();
      if (KEYWORDS.has(lower)) {
        tokens.push({ type: 'keyword', value: lower, raw, ...at, start: i, end: i + raw.length });
      } else {
        tokens.push({ type: 'ident', value: raw, raw, ...at, start: i, end: i + raw.length });
      }
      i += raw.length;
      continue;
    }

    // Símbolos
    const symbol = SYMBOLS.find((s) => text.startsWith(s, i));
    if (symbol) {
      const at = here();
      tokens.push({ type: 'sym', value: symbol, raw: symbol, ...at, start: i, end: i + symbol.length });
      i += symbol.length;
      continue;
    }

    const at = here();
    error(`Símbolo no reconocido: '${ch}'.`, at);
    i++;
  }

  tokens.push({ type: 'eof', value: '', raw: '', line, col: i - lineStart + 1, start: i, end: i });
  return tokens;
}

