import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { GaboFile } from '../services/storage';

/**
 * Tabla CRC32 para la generación ZIP sin compresión (Store).
 */
function makeCrcTable(): Uint32Array {
  const cTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    cTable[n] = c;
  }
  return cTable;
}

const crcTable = makeCrcTable();

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function stringToUtf8(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const utf8: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) utf8.push(charcode);
    else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(
        0xe0 | (charcode >> 12),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return new Uint8Array(utf8);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const len = bytes.byteLength;
  let result = '';
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += chars[b0 >> 2];
    result += chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < len ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < len ? chars[b2 & 63] : '=';
  }
  return result;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function writeUint16LE(arr: Uint8Array, offset: number, val: number) {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >>> 8) & 0xff;
}

function writeUint32LE(arr: Uint8Array, offset: number, val: number) {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >>> 8) & 0xff;
  arr[offset + 2] = (val >>> 16) & 0xff;
  arr[offset + 3] = (val >>> 24) & 0xff;
}

function buildStoreZip(entries: ZipEntry[]): Uint8Array {
  let totalLocalSize = 0;
  let totalCentralDirSize = 0;

  const processed = entries.map((entry) => {
    const nameBytes = stringToUtf8(entry.name);
    const crc = crc32(entry.data);
    const localHeaderSize = 30 + nameBytes.length + entry.data.length;
    const centralHeaderSize = 46 + nameBytes.length;

    totalLocalSize += localHeaderSize;
    totalCentralDirSize += centralHeaderSize;

    return {
      entry,
      nameBytes,
      crc,
      localHeaderSize,
      centralHeaderSize,
    };
  });

  const endRecordSize = 22;
  const totalZipSize = totalLocalSize + totalCentralDirSize + endRecordSize;
  const out = new Uint8Array(totalZipSize);

  let localOffset = 0;
  const localOffsets: number[] = [];

  for (const item of processed) {
    localOffsets.push(localOffset);

    // Local file header signature
    writeUint32LE(out, localOffset, 0x04034b50);
    writeUint16LE(out, localOffset + 4, 20); // version needed
    writeUint16LE(out, localOffset + 6, 0); // flags
    writeUint16LE(out, localOffset + 8, 0); // compression: store (no compression)
    writeUint16LE(out, localOffset + 10, 0); // time
    writeUint16LE(out, localOffset + 12, 0); // date
    writeUint32LE(out, localOffset + 14, item.crc);
    writeUint32LE(out, localOffset + 18, item.entry.data.length);
    writeUint32LE(out, localOffset + 22, item.entry.data.length);
    writeUint16LE(out, localOffset + 26, item.nameBytes.length);
    writeUint16LE(out, localOffset + 28, 0); // extra field length

    out.set(item.nameBytes, localOffset + 30);
    out.set(item.entry.data, localOffset + 30 + item.nameBytes.length);

    localOffset += item.localHeaderSize;
  }

  const centralDirStart = localOffset;
  let cdOffset = centralDirStart;

  for (let i = 0; i < processed.length; i++) {
    const item = processed[i];
    const localHdrOffset = localOffsets[i];

    // Central directory header signature
    writeUint32LE(out, cdOffset, 0x02014b50);
    writeUint16LE(out, cdOffset + 4, 20); // version made by
    writeUint16LE(out, cdOffset + 6, 20); // version needed
    writeUint16LE(out, cdOffset + 8, 0); // flags
    writeUint16LE(out, cdOffset + 10, 0); // compression: store
    writeUint16LE(out, cdOffset + 12, 0); // time
    writeUint16LE(out, cdOffset + 14, 0); // date
    writeUint32LE(out, cdOffset + 16, item.crc);
    writeUint32LE(out, cdOffset + 20, item.entry.data.length);
    writeUint32LE(out, cdOffset + 24, item.entry.data.length);
    writeUint16LE(out, cdOffset + 28, item.nameBytes.length);
    writeUint16LE(out, cdOffset + 30, 0); // extra field length
    writeUint16LE(out, cdOffset + 32, 0); // comment length
    writeUint16LE(out, cdOffset + 34, 0); // disk start
    writeUint16LE(out, cdOffset + 36, 0); // internal attributes
    writeUint32LE(out, cdOffset + 38, 0); // external attributes
    writeUint32LE(out, cdOffset + 42, localHdrOffset);

    out.set(item.nameBytes, cdOffset + 46);
    cdOffset += item.centralHeaderSize;
  }

  // End of central directory record (EOCD)
  writeUint32LE(out, cdOffset, 0x06054b50);
  writeUint16LE(out, cdOffset + 4, 0); // disk number
  writeUint16LE(out, cdOffset + 6, 0); // disk start
  writeUint16LE(out, cdOffset + 8, processed.length); // entries on disk
  writeUint16LE(out, cdOffset + 10, processed.length); // total entries
  writeUint32LE(out, cdOffset + 12, totalCentralDirSize);
  writeUint32LE(out, cdOffset + 16, centralDirStart);
  writeUint16LE(out, cdOffset + 20, 0); // comment length

  return out;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface DocxToken {
  text: string;
  color: string;
  bold?: boolean;
  italic?: boolean;
}

// 1. AZUL COBALTO (#0033B3): Modularidad y estructura
const MODULARITY_KEYWORDS = new Set([
  'algoritmo',
  'inicio',
  'fin',
  'procedimiento',
  'fin_procedimiento',
  'funcion',
  'fin_funcion',
  'var',
  'devolver',
  'registro',
  'fin_registro',
]);

// 2. AZUL CERCETA / ENTRADA Y SALIDA (#005A8C): Instrucciones I/O
const IO_KEYWORDS = new Set([
  'mostrar',
  'leer',
  'imprimir',
]);

// 3. MORADO / PÚRPURA DE CONTROL (#7A1FA2): Estructuras condicionales y bucles
const CONTROL_KEYWORDS = new Set([
  'si',
  'entonces',
  'sino',
  'fin_si',
  'para',
  'hasta',
  'hacer',
  'fin_para',
  'mientras',
  'fin_mientras',
  'repetir',
  'fin_repetir',
  'en_caso',
  'caso',
  'otro_caso',
  'fin_caso',
  'sea',
]);

// 4. CIAN / VERDE PETRÓLEO (#00627A): Tipos de datos
const TYPE_KEYWORDS = new Set([
  'entero',
  'real',
  'cadena',
  'booleano',
  'caracter',
]);

// 5. MAGENTA / OPERADORES LÓGICOS Y RELACIONALES (#AF00DB): Conectores lógicos
const LOGICAL_KEYWORDS = new Set([
  'or',
  'and',
  'not',
  'mod',
  'div',
]);

// 6. VERDE ESMERALDA (#098658): Valores lógicos booleanos
const BOOLEAN_KEYWORDS = new Set([
  'true',
  'false',
  'verdadero',
  'falso',
]);

/**
 * Extrae nombres de funciones y procedimientos definidos por el usuario en el archivo.
 */
function extractSubprograms(content: string): Set<string> {
  const subprograms = new Set<string>([
    'poblardb',
    'menuop',
    'confirmar',
    'finalizar',
    'compinv',
  ]);
  const regex = /(?:procedimiento|funcion)\s+([a-zA-Z_\u00C0-\u017F][a-zA-Z0-9_\u00C0-\u017F]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    if (m[1]) {
      subprograms.add(m[1].toLowerCase());
    }
  }
  return subprograms;
}

/**
 * Tokeniza una línea de código GaboScript aplicando el resaltado estricto
 * con los colores HEX exactos requeridos.
 */
function tokenizeDocxLine(line: string, subprograms: Set<string>): DocxToken[] {
  const tokens: DocxToken[] = [];
  let i = 0;
  const n = line.length;
  let prevWord = '';

  while (i < n) {
    // 10. VERDE BOSQUE (#2E6B3E): Comentarios explicativos // ... o /* ... */
    if (line.slice(i, i + 2) === '//') {
      tokens.push({ text: line.slice(i), color: '2E6B3E', italic: true });
      break;
    }
    if (line.slice(i, i + 2) === '/*') {
      const endIdx = line.indexOf('*/', i + 2);
      if (endIdx === -1) {
        tokens.push({ text: line.slice(i), color: '2E6B3E', italic: true });
        break;
      } else {
        tokens.push({ text: line.slice(i, endIdx + 2), color: '2E6B3E', italic: true });
        i = endIdx + 2;
        continue;
      }
    }

    // 9. ROJO OSCURO / GRANATE (#A31515): Cadenas entre comillas dobles (o simples)
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
      if (j < n) j++;
      tokens.push({ text: line.slice(i, j), color: 'A31515' });
      i = j;
      continue;
    }

    // 8. MARRÓN TIERRA / PARÁMETROS (#8C4600): Modificadores E:, S:, E/S:, E/S
    const prevChar = i > 0 ? line[i - 1] : ' ';
    const isWordStart = !/[a-zA-Z0-9_]/.test(prevChar);

    if (isWordStart) {
      if (line.slice(i, i + 4).toUpperCase() === 'E/S:') {
        tokens.push({ text: line.slice(i, i + 4), color: '8C4600', bold: true });
        i += 4;
        continue;
      }
      if (line.slice(i, i + 3).toUpperCase() === 'E/S') {
        tokens.push({ text: line.slice(i, i + 3), color: '8C4600', bold: true });
        i += 3;
        continue;
      }
      if (
        (line.slice(i, i + 2).toUpperCase() === 'E:' || line.slice(i, i + 2).toUpperCase() === 'S:') &&
        (i + 2 >= n || !/[a-zA-Z0-9_]/.test(line[i + 2]))
      ) {
        tokens.push({ text: line.slice(i, i + 2), color: '8C4600', bold: true });
        i += 2;
        continue;
      }
    }

    // 2. AZUL CERCETA / ENTRADA Y SALIDA (#005A8C): Operadores de flujo <<, >>
    const twoChar = line.slice(i, i + 2);
    if (twoChar === '<<' || twoChar === '>>') {
      tokens.push({ text: twoChar, color: '005A8C', bold: true });
      i += 2;
      continue;
    }

    // 5. MAGENTA / OPERADORES LÓGICOS Y RELACIONALES (#AF00DB): <>, <=, >=, ==, !=
    if (
      twoChar === '<>' ||
      twoChar === '<=' ||
      twoChar === '>=' ||
      twoChar === '==' ||
      twoChar === '!='
    ) {
      tokens.push({ text: twoChar, color: 'AF00DB', bold: true });
      i += 2;
      continue;
    }

    // 5. MAGENTA / OPERADORES (#AF00DB): Asignación y comparación =, <, >
    if (line[i] === '=' || line[i] === '<' || line[i] === '>') {
      tokens.push({ text: line[i], color: 'AF00DB', bold: true });
      i++;
      continue;
    }

    // 6. VERDE ESMERALDA (#098658): Literales numéricos (0, 1, 2, 3, 4, 100, 1.6, etc.)
    if (/\d/.test(line[i])) {
      let j = i;
      while (j < n && /[\d.]/.test(line[j])) {
        j++;
      }
      tokens.push({ text: line.slice(i, j), color: '098658' });
      i = j;
      continue;
    }

    // Espacios en blanco (preservar formato e indentación)
    if (/\s/.test(line[i])) {
      let j = i;
      while (j < n && /\s/.test(line[j])) {
        j++;
      }
      tokens.push({ text: line.slice(i, j), color: '111111' });
      i = j;
      continue;
    }

    // 12. NEGRO CARBÓN (#111111): Operadores aritméticos (+, -, *) y signos de puntuación (,, :, ;, [, ], (, ))
    if (/[+\-*/^%:,;\(\)\[\]\{\}]/.test(line[i])) {
      tokens.push({ text: line[i], color: '111111' });
      i++;
      continue;
    }

    // Palabras e identificadores
    if (/[\p{L}_]/u.test(line[i])) {
      let j = i;
      while (j < n && /[\p{L}\p{N}_]/u.test(line[j])) {
        j++;
      }
      const word = line.slice(i, j);
      const lower = word.toLowerCase();

      // Verificar si viene seguido de '(' para llamadas a funciones/subprogramas
      let k = j;
      while (k < n && /\s/.test(line[k])) k++;
      const isCall = k < n && line[k] === '(';

      if (MODULARITY_KEYWORDS.has(lower)) {
        // 1. AZUL COBALTO (#0033B3): Modularidad y estructura
        tokens.push({ text: word, color: '0033B3', bold: true });
        prevWord = lower;
      } else if (IO_KEYWORDS.has(lower)) {
        // 2. AZUL CERCETA / ENTRADA Y SALIDA (#005A8C): Mostrar, Leer
        tokens.push({ text: word, color: '005A8C', bold: true });
        prevWord = lower;
      } else if (CONTROL_KEYWORDS.has(lower)) {
        // 3. MORADO / PÚRPURA DE CONTROL (#7A1FA2): Si, Entonces, Sino, Para, Mientras, etc.
        tokens.push({ text: word, color: '7A1FA2', bold: true });
        prevWord = lower;
      } else if (TYPE_KEYWORDS.has(lower)) {
        // 4. CIAN / VERDE PETRÓLEO (#00627A): Entero, Real, Cadena, Booleano
        tokens.push({ text: word, color: '00627A', bold: true });
        prevWord = lower;
      } else if (LOGICAL_KEYWORDS.has(lower)) {
        // 5. MAGENTA (#AF00DB): Conectores lógicos Or, And, Not
        tokens.push({ text: word, color: 'AF00DB', bold: true });
        prevWord = lower;
      } else if (BOOLEAN_KEYWORDS.has(lower)) {
        // 6. VERDE ESMERALDA (#098658): Valores lógicos True, False
        tokens.push({ text: word, color: '098658', bold: true });
        prevWord = lower;
      } else if (
        prevWord === 'procedimiento' ||
        prevWord === 'funcion' ||
        subprograms.has(lower) ||
        isCall
      ) {
        // 7. MARRÓN MOSTAZA / IDENTIFICADOR DE SUBPROGRAMAS (#664200): Nombres de funciones/procedimientos
        subprograms.add(lower);
        tokens.push({ text: word, color: '664200', bold: true });
        prevWord = lower;
      } else {
        // 12. NEGRO CARBÓN (#111111): Variables normales (op, i, chocoDes, chocoCant, etc.)
        tokens.push({ text: word, color: '111111' });
        prevWord = lower;
      }

      i = j;
      continue;
    }

    // 12. Cualquier otro carácter: NEGRO CARBÓN (#111111)
    tokens.push({ text: line[i], color: '111111' });
    i++;
  }

  return tokens;
}

/**
 * Convierte una línea de código en runs XML coloreados con Consolas para OpenXML.
 */
function lineToWordRuns(line: string, subprograms: Set<string>): string {
  if (line.length === 0) {
    return `<w:r>
      <w:rPr>
        <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>
        <w:sz w:val="19"/>
        <w:color w:val="111111"/>
      </w:rPr>
      <w:t xml:space="preserve"> </w:t>
    </w:r>`;
  }

  const tokens = tokenizeDocxLine(line, subprograms);
  if (tokens.length === 0) {
    return `<w:r>
      <w:rPr>
        <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>
        <w:sz w:val="19"/>
        <w:color w:val="111111"/>
      </w:rPr>
      <w:t xml:space="preserve"> </w:t>
    </w:r>`;
  }

  return tokens
    .map((token) => {
      return `<w:r>
        <w:rPr>
          <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>
          <w:sz w:val="19"/>
          <w:color w:val="${token.color}"/>
          ${token.bold ? '<w:b/>' : ''}
          ${token.italic ? '<w:i/>' : ''}
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(token.text)}</w:t>
      </w:r>`;
    })
    .join('');
}

/**
 * Genera el paquete OpenXML completo (.docx) con el resaltado estricto solicitado,
 * título limpio (nombre del algoritmo) y sin encabezados ni pies genéricos.
 */
function buildDocx(file: GaboFile): Uint8Array {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const cleanTitle = file.name.replace(/\.(gabo|txt)$/i, '');
  const lines = file.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const subprograms = extractSubprograms(file.content);

  const rowsXml = lines
    .map((line, idx) => {
      const lineNum = idx + 1;
      const runs = lineToWordRuns(line, subprograms);
      return `<w:tr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="720" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>
          </w:tcPr>
          <w:p>
            <w:pPr>
              <w:jc w:val="right"/>
              <w:spacing w:before="20" w:after="20"/>
            </w:pPr>
            <w:r>
              <w:rPr>
                <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>
                <w:sz w:val="18"/>
                <w:color w:val="777777"/>
              </w:rPr>
              <w:t>${lineNum}</w:t>
            </w:r>
          </w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="8280" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>
          </w:tcPr>
          <w:p>
            <w:pPr>
              <w:spacing w:before="20" w:after="20"/>
            </w:pPr>
            ${runs}
          </w:p>
        </w:tc>
      </w:tr>`;
    })
    .join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:spacing w:after="160"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/>
          <w:b/>
          <w:sz w:val="38"/>
          <w:color w:val="0F172A"/>
        </w:rPr>
        <w:t>${escapeXml(cleanTitle)}</w:t>
      </w:r>
    </w:p>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="0" w:type="auto"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
          <w:left w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
          <w:bottom w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
          <w:right w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
          <w:insideH w:val="single" w:sz="4" w:space="0" w:color="F1F5F9"/>
          <w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="720"/>
        <w:gridCol w:w="8280"/>
      </w:tblGrid>
      ${rowsXml}
    </w:tbl>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: stringToUtf8(contentTypesXml) },
    { name: '_rels/.rels', data: stringToUtf8(rootRelsXml) },
    { name: 'word/document.xml', data: stringToUtf8(documentXml) },
  ];

  return buildStoreZip(entries);
}

/**
 * Exporta directamente el código GaboScript a un archivo Microsoft Word (.docx)
 * y abre el diálogo nativo del sistema para guardarlo en Files o compartirlo.
 */
export async function exportToDocx(file: GaboFile): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('La función de compartir o guardar archivos no está disponible en este dispositivo.');
  }

  const docxBytes = buildDocx(file);
  const base64 = uint8ArrayToBase64(docxBytes);

  const cleanBaseName = file.name.replace(/\.(gabo|txt)$/i, '');
  const targetDocxUri = `${FileSystem.cacheDirectory || ''}${cleanBaseName}.docx`;

  await FileSystem.writeAsStringAsync(targetDocxUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const fileInfo = await FileSystem.getInfoAsync(targetDocxUri);
  if (!fileInfo.exists) {
    throw new Error('No se pudo preparar el archivo DOCX en el almacenamiento accesible.');
  }

  await Sharing.shareAsync(targetDocxUri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    UTI: 'com.microsoft.word.doc',
    dialogTitle: `Guardar o compartir ${cleanBaseName}.docx`,
  });
}
