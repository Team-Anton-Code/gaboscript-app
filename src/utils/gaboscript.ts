/**
 * Motor de coloreado y tokenización de sintaxis de GaboScript.
 * Basado en las reglas y gramática de la extensión de VS Code (gaboscript.tmLanguage.json).
 */

export type TokenType =
  | 'keyword'
  | 'type'
  | 'string'
  | 'number'
  | 'comment'
  | 'operator'
  | 'function'
  | 'identifier'
  | 'text';

export interface CodeToken {
  text: string;
  type: TokenType;
}

// Palabras clave de control y estructura (insensibles a mayúsculas)
export const GABO_KEYWORDS = new Set([
  'algoritmo',
  'inicio',
  'fin',
  'si',
  'entonces',
  'fin_si',
  'sino',
  'para',
  'hacer',
  'fin_para',
  'repetir',
  'hasta',
  'fin_repetir',
  'mientras',
  'fin_mientras',
  'en_caso',
  'sea',
  'fin_caso',
  'caso',
  'otro_caso',
  'devolver',
  'var',
  'procedimiento',
  'fin_procedimiento',
  'funcion',
  'fin_funcion',
  'registro',
  'fin_registro',
]);

// Tipos de datos primitivos y modificadores de parámetro
export const GABO_TYPES = new Set([
  'entero',
  'real',
  'caracter',
  'cadena',
  'booleano',
  'verdadero',
  'falso',
  'true',
  'false',
  'e',
  's',
  'e/s',
]);

// Operadores de E/S y lógicos nombrados
export const GABO_NAMED_OPERATORS = new Set([
  'mostrar',
  'imprimir',
  'leer',
  'mod',
  'div',
  'and',
  'or',
  'not',
]);

/**
 * Tokeniza una línea de código GaboScript en segmentos estilizados
 * aplicando la gramática completa de la extensión.
 */
export function tokenizeLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let i = 0;
  const n = line.length;

  while (i < n) {
    // 1. Comentario de línea //
    if (line.slice(i, i + 2) === '//') {
      tokens.push({ text: line.slice(i), type: 'comment' });
      break;
    }

    // 2. Comentario de bloque /* ... */
    if (line.slice(i, i + 2) === '/*') {
      const endIdx = line.indexOf('*/', i + 2);
      if (endIdx === -1) {
        tokens.push({ text: line.slice(i), type: 'comment' });
        break;
      } else {
        tokens.push({ text: line.slice(i, endIdx + 2), type: 'comment' });
        i = endIdx + 2;
        continue;
      }
    }

    // 3. Cadena entre comillas dobles o comillas simples
    if (line[i] === '"' || line[i] === "'") {
      const quote = line[i];
      let j = i + 1;
      while (j < n && line[j] !== quote) {
        if (line[j] === '\\' && j + 1 < n) {
          j += 2;
        } else {
          j++;
        }
      }
      if (j < n) j++; // incluir comilla de cierre
      tokens.push({ text: line.slice(i, j), type: 'string' });
      i = j;
      continue;
    }

    // 4. Números (enteros y decimales)
    if (/\d/.test(line[i])) {
      let j = i;
      while (j < n && /[\d.]/.test(line[j])) {
        j++;
      }
      tokens.push({ text: line.slice(i, j), type: 'number' });
      i = j;
      continue;
    }

    // 5. Modificador de E/S
    if (i + 2 < n && line.slice(i, i + 3).toUpperCase() === 'E/S') {
      tokens.push({ text: line.slice(i, i + 3), type: 'type' });
      i += 3;
      continue;
    }

    // 6. Operadores de dos caracteres: <<, >>, <=, >=, ==, !=, <>
    const twoChar = line.slice(i, i + 2);
    if (
      twoChar === '<<' ||
      twoChar === '>>' ||
      twoChar === '<=' ||
      twoChar === '>=' ||
      twoChar === '==' ||
      twoChar === '!=' ||
      twoChar === '<>'
    ) {
      tokens.push({ text: twoChar, type: 'operator' });
      i += 2;
      continue;
    }

    // 7. Operadores de un caracter y puntuación
    if (/[=+\-*/^%<>:;,\(\)\[\]\{\}]/.test(line[i])) {
      const ch = line[i];
      // Si es puntuación estructural o agrupadores
      const isOperator = /[=+\-*/^%<>]/.test(ch);
      tokens.push({ text: ch, type: isOperator ? 'operator' : 'text' });
      i++;
      continue;
    }

    // 8. Espacios en blanco
    if (/\s/.test(line[i])) {
      let j = i;
      while (j < n && /\s/.test(line[j])) {
        j++;
      }
      tokens.push({ text: line.slice(i, j), type: 'text' });
      i = j;
      continue;
    }

    // 9. Palabras (identificadores, palabras clave o llamadas a función)
    if (/[\p{L}_]/u.test(line[i])) {
      let j = i;
      while (j < n && /[\p{L}\p{N}_]/u.test(line[j])) {
        j++;
      }
      const word = line.slice(i, j);
      const lower = word.toLowerCase();

      // Verificar si viene seguido de '(' para colorearlo como función
      let k = j;
      while (k < n && /\s/.test(line[k])) k++;
      const isCall = k < n && line[k] === '(';

      if (GABO_KEYWORDS.has(lower)) {
        tokens.push({ text: word, type: 'keyword' });
      } else if (GABO_TYPES.has(lower)) {
        tokens.push({ text: word, type: 'type' });
      } else if (GABO_NAMED_OPERATORS.has(lower)) {
        tokens.push({ text: word, type: 'operator' });
      } else if (isCall) {
        tokens.push({ text: word, type: 'function' });
      } else {
        tokens.push({ text: word, type: 'identifier' });
      }
      i = j;
      continue;
    }

    // Cualquier otro caracter
    tokens.push({ text: line[i], type: 'text' });
    i++;
  }

  return tokens;
}
