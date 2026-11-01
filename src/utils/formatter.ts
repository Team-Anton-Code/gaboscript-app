const OPENING_KEYWORDS = [
  'Inicio',
  'Si',
  'En_Caso',
  'Caso',
  'Funcion',
  'Procedimiento',
  'Mientras',
  'Para',
  'Repetir',
  'Registro',
  'Hacer',
  'Entonces',
];

const CLOSING_KEYWORDS = [
  'Fin',
  'Fin_Si',
  'Fin_Caso',
  'Fin_Funcion',
  'Fin_Procedimiento',
  'Fin_Mientras',
  'Fin_Para',
  'Fin_Repetir',
  'Fin_Registro',
];

/**
 * Formats GaboScript code with standard 2-space indentation based on block keywords.
 */
export function formatGaboScript(code: string): string {
  const lines = code.split('\n');
  let currentIndent = 0;
  const formattedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Preserve blank lines
    if (!trimmed) {
      formattedLines.push('');
      continue;
    }

    // Preserve comments at current indent or starting comments
    if (trimmed.startsWith('//')) {
      formattedLines.push('  '.repeat(currentIndent) + trimmed);
      continue;
    }

    // Check if line starts with closing keywords
    const startsWithClosing = CLOSING_KEYWORDS.some((kw) => {
      const regex = new RegExp(`^${kw}(\\b|;|\\s|$)`, 'i');
      return regex.test(trimmed);
    });

    const isSino = /^Sino(\b|;|\\s|$)/i.test(trimmed);

    let lineIndent = currentIndent;

    if (startsWithClosing) {
      currentIndent = Math.max(0, currentIndent - 1);
      lineIndent = currentIndent;
    } else if (isSino) {
      lineIndent = Math.max(0, currentIndent - 1);
    }

    // Check if line opens a block for following lines
    let opensBlock = false;

    if (isSino) {
      opensBlock = true;
    } else {
      // Check if line ends with or contains opening keywords
      for (const kw of OPENING_KEYWORDS) {
        const regex = new RegExp(`(^|\\s|:)${kw}(\\b|;|\\s|$)`, 'i');
        if (regex.test(trimmed)) {
          opensBlock = true;
          break;
        }
      }
    }

    formattedLines.push('  '.repeat(lineIndent) + trimmed);

    if (opensBlock && !startsWithClosing) {
      currentIndent++;
    }
  }

  return formattedLines.join('\n');
}
