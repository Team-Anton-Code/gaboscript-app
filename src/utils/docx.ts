import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { GaboFile } from '../services/storage';
import { CodeToken, tokenizeLine } from './gaboscript';

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

/**
 * Colores de sintaxis para Word (fondo blanco, alta legibilidad).
 * Basado en la paleta oficial de VS Code Light+.
 */
function getTokenColor(type: CodeToken['type']): { color: string; italic?: boolean; bold?: boolean } {
  switch (type) {
    case 'keyword':
      return { color: '0000FF', bold: true }; // Azul oscuro/púrpura
    case 'type':
      return { color: '267F99', bold: true }; // Verde azulado / Teal
    case 'string':
      return { color: 'A31515' }; // Rojo oscuro carmesí
    case 'number':
      return { color: '098658' }; // Verde oscuro
    case 'comment':
      return { color: '008000', italic: true }; // Verde comentario en cursiva
    case 'function':
      return { color: '795E26' }; // Marrón/Ocre funciones
    case 'operator':
      return { color: '1E293B', bold: true }; // Operadores oscuros
    case 'identifier':
      return { color: '001080' }; // Azul identificadores
    default:
      return { color: '1E293B' }; // Texto estándar
  }
}

/**
 * Convierte una línea de código en runs XML coloreados para OpenXML.
 */
function lineToWordRuns(line: string): string {
  const tokens = tokenizeLine(line);
  if (tokens.length === 0) {
    return `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/><w:color w:val="1E293B"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>`;
  }

  return tokens
    .map((token) => {
      const { color, italic, bold } = getTokenColor(token.type);
      return `<w:r>
        <w:rPr>
          <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>
          <w:sz w:val="19"/>
          <w:color w:val="${color}"/>
          ${italic ? '<w:i/>' : ''}
          ${bold ? '<w:b/>' : ''}
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(token.text)}</w:t>
      </w:r>`;
    })
    .join('');
}

/**
 * Genera el paquete OpenXML completo (.docx) con resaltado de sintaxis,
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
  const lines = file.content.split('\n');

  const rowsXml = lines
    .map((line, idx) => {
      const lineNum = idx + 1;
      const runs = lineToWordRuns(line);
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
                <w:color w:val="94A3B8"/>
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
