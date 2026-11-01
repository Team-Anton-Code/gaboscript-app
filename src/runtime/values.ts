/**
 * Valores del runtime de GaboScript: creación, copia, formatos y conversiones.
 */

export interface TypeInfo {
  kind: 'prim' | 'record';
  name: string;
}

export interface ArrayValue {
  __gabo: 'array';
  name?: string;
  elemType: TypeInfo;
  shape: number[];
  data: any[];
}

export interface RecordValue {
  __gabo: 'record';
  typeName: string;
  fields: Record<string, any>;
}

export const SAFE_INT = Number.MAX_SAFE_INTEGER;

export function isArrayValue(value: any): value is ArrayValue {
  return Boolean(value) && typeof value === 'object' && value.__gabo === 'array';
}

export function isRecordValue(value: any): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && value.__gabo === 'record';
}

export function isIntegerValue(value: any): boolean {
  return typeof value === 'number' && Number.isInteger(value);
}

export function valueTypeName(value: any): string {
  if (typeof value === 'boolean') return 'Booleano';
  if (typeof value === 'number') return Number.isInteger(value) ? 'Entero' : 'Real';
  if (typeof value === 'string') return 'Cadena';
  if (isArrayValue(value)) return 'Arreglo';
  if (isRecordValue(value)) return `Registro ${value.typeName}`;
  return 'desconocido';
}

export function describeValue(value: any): string {
  if (isArrayValue(value)) {
    return `un arreglo ${formatShape(value.shape)} de ${value.elemType.name}`;
  }
  if (isRecordValue(value)) {
    return `un registro ${value.typeName}`;
  }
  if (typeof value === 'string') {
    return `una Cadena ("${truncate(value, 24)}")`;
  }
  return `un valor de tipo ${valueTypeName(value)} (${truncate(String(value), 24)})`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function formatShape(shape: number[]): string {
  return shape.join('x');
}

export function defaultValueFor(typeInfo: TypeInfo, ctx: any): any {
  if (typeInfo.kind === 'record') {
    return createRecordInstance(typeInfo.name, ctx, ctx.recordDepth ?? 0);
  }
  switch (typeInfo.name) {
    case 'Entero': return 0;
    case 'Real': return 0;
    case 'Booleano': return false;
    case 'Caracter': return '';
    case 'Cadena': return '';
    default:
      return ctx.error(`El tipo '${typeInfo.name}' no es un tipo conocido.`);
  }
}

export function createRecordInstance(typeName: string, ctx: any, depth = 0): any {
  if (depth > 32) {
    return ctx.error(`El registro '${typeName}' se contiene a sí mismo (demasiados niveles). Revisa su definición.`);
  }
  const def = ctx.resolveRecord(typeName);
  if (!def) {
    return ctx.error(`El tipo '${typeName}' no existe. Declara el registro con 'Registro ${typeName} ... Fin_Registro' o revisa el nombre.`);
  }
  const fields = Object.create(null);
  for (const field of def.fields) {
    fields[field.name] = defaultValueFor(field.type, { ...ctx, recordDepth: depth + 1 });
  }
  return { __gabo: 'record', typeName: def.name, fields };
}

export function createArrayValue(shape: number[], elemType: TypeInfo, ctx: any, name?: string): any {
  const total = shape.reduce((a, b) => a * b, 1);
  if (!shape.every((n) => Number.isInteger(n) && n >= 1)) {
    return ctx.error(`Las dimensiones de un arreglo deben ser enteros mayores que 0 (se recibió ${formatShape(shape)}).`);
  }
  if (total > 5_000_000) {
    return ctx.error(`El arreglo '${name}' es demasiado grande (${formatShape(shape)} = ${total} elementos).`);
  }
  const build = (dims: number[]): any[] => {
    const [dim, ...rest] = dims;
    const items = new Array(dim);
    for (let i = 0; i < dim; i++) {
      items[i] = rest.length === 0 ? defaultValueFor(elemType, ctx) : build(rest);
    }
    return items;
  };
  return { __gabo: 'array', name, elemType, shape: [...shape], data: build(shape) };
}

export function cloneValue(value: any, ctx: any): any {
  if (isArrayValue(value)) {
    const clone = (dims: number[], src: any[]): any[] => {
      if (dims.length === 0) return cloneValue(src, ctx);
      const items = new Array(dims[0]);
      for (let i = 0; i < dims[0]; i++) items[i] = clone(dims.slice(1), src[i]);
      return items;
    };
    return { ...value, data: clone(value.shape, value.data) };
  }
  if (isRecordValue(value)) {
    const fields = Object.create(null);
    for (const [key, val] of Object.entries(value.fields)) fields[key] = cloneValue(val, ctx);
    return { ...value, fields };
  }
  return value;
}

export function coerceValue(value: any, typeInfo: TypeInfo, ctx: any): any {
  if (isArrayValue(value)) {
    return ctx.error(`No se puede asignar ${describeValue(value)} a una variable de tipo ${typeInfoLabel(typeInfo)}.`);
  }
  if (typeInfo.kind === 'record') {
    if (!isRecordValue(value)) {
      return ctx.error(`Se esperaba un registro '${typeInfo.name}' pero se obtuvo ${describeValue(value)}.`);
    }
    if (!sameName(value.typeName, typeInfo.name)) {
      return ctx.error(`No se puede asignar un registro '${value.typeName}' a una variable de tipo '${typeInfo.name}'.`);
    }
    return cloneValue(value, ctx);
  }
  switch (typeInfo.name) {
    case 'Entero': {
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (typeof value !== 'number') {
        return ctx.error(`Se esperaba un valor de tipo Entero, pero se obtuvo ${describeValue(value)}.`);
      }
      if (!Number.isFinite(value)) {
        return ctx.error('El valor no es un número representable (¿desbordamiento?).');
      }
      if (!Number.isInteger(value)) {
        ctx.warn?.(`Se truncó el valor ${formatNumber(value, {})} a ${Math.trunc(value)} para asignarlo a un Entero.`);
        return checkSafeInt(Math.trunc(value), ctx);
      }
      return checkSafeInt(value, ctx);
    }
    case 'Real': {
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (typeof value !== 'number') {
        return ctx.error(`Se esperaba un valor de tipo Real, pero se obtuvo ${describeValue(value)}.`);
      }
      if (!Number.isFinite(value)) {
        return ctx.error('El valor no es un número representable (¿desbordamiento?).');
      }
      return value;
    }
    case 'Booleano': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      return ctx.error(`Se esperaba un valor de tipo Booleano (True/False o 0/1), pero se obtuvo ${describeValue(value)}.`);
    }
    case 'Cadena': {
      if (typeof value === 'string') return value;
      return ctx.error(`Se esperaba un valor de tipo Cadena, pero se obtuvo ${describeValue(value)}.`);
    }
    case 'Caracter': {
      if (typeof value === 'string' && value.length <= 1) return value;
      return ctx.error(`Se esperaba un solo carácter, pero se obtuvo ${describeValue(value)}.`);
    }
    default:
      return ctx.error(`El tipo '${typeInfo.name}' no es un tipo conocido.`);
  }
}

export function checkSafeInt(value: number, ctx: any): number {
  if (Math.abs(value) > SAFE_INT) {
    return ctx.error(`Desbordamiento de Entero: ${value} supera el rango permitido (±2^53). Usa un valor Real o revisa la lógica.`);
  }
  return value;
}

export function typeInfoLabel(typeInfo: TypeInfo): string {
  return typeInfo.name;
}

export function sameName(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

export interface FormatOptions {
  realDecimals?: number;
  booleanOutput?: 'true/false' | '1/0' | 'verdadero/falso';
}

export function formatValue(value: unknown, options: FormatOptions = {}): string {
  if (typeof value === 'boolean') return formatBoolean(value, options);
  if (typeof value === 'number') return formatNumber(value, options);
  if (typeof value === 'string') return value;
  if (isArrayValue(value)) return `[arreglo ${formatShape(value.shape)} de ${value.elemType.name}]`;
  if (isRecordValue(value)) return formatRecord(value);
  if (value === null || value === undefined) return 'Nulo';
  return String(value);
}

function formatRecord(record: RecordValue): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(record.fields)) {
    parts.push(`${key} = ${formatValue(val, {})}`);
  }
  return `[${record.typeName}: ${parts.join(', ')}]`;
}

export function formatBoolean(value: boolean, options: FormatOptions = {}): string {
  const mode = String(options.booleanOutput ?? 'true/false').toLowerCase();
  if (mode === '1/0') return value ? '1' : '0';
  if (mode.startsWith('verdad')) return value ? 'Verdadero' : 'Falso';
  return value ? 'True' : 'False';
}

export function formatNumber(value: number, options: FormatOptions = {}): string {
  if (Number.isInteger(value)) return String(value);
  const decimals = options.realDecimals;
  if (typeof decimals === 'number' && decimals >= 0) {
    const fixed = value.toFixed(Math.min(decimals, 20));
    return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  }
  return String(value);
}

