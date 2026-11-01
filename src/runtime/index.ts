/**
 * API pública del runtime de GaboScript.
 * Extraído e implementado fielmente desde la extensión de VS Code.
 */

import { DebugSession, TRACE_LIMIT } from './debugger';
import { GaboRuntimeError, StopExecution } from './errors';
import { Interpreter } from './interpreter';
import { Diagnostic, tokenize } from './lexer';
import { parse } from './parser';
import { formatValue } from './values';

export { DebugSession, formatValue, GaboRuntimeError, Interpreter, parse, StopExecution, tokenize, TRACE_LIMIT };

export const RUNTIME_VERSION = '1.1.4';

export interface Host {
  print: (text: string) => void;
  warn?: (text: string) => void;
  readLine: (req: { line: number; typeName: string }) => Promise<string | null>;
}

export interface RunOptions {
  realDecimals?: number;
  booleanOutput?: 'true/false' | '1/0' | 'verdadero/falso';
  maxCallDepth?: number;
  shouldStop?: () => boolean;
  cancelPendingInput?: () => void;
  debugger?: DebugSession;
  collectTrace?: boolean;
}

export interface RunResult {
  ok: boolean;
  phase?: 'syntax' | 'runtime' | 'stopped';
  diagnostics?: Diagnostic[];
  error?: any;
  program?: any;
  stats?: {
    steps: number;
    maxDepth: number;
    elapsedMs: number;
    trace: any[];
    traceTruncated: boolean;
  };
}

/** Host de E/S por defecto: silencioso (útil en pruebas). */
export function createNullHost(): Host {
  return {
    print() {},
    warn() {},
    readLine() { return Promise.resolve(null); },
  };
}

/**
 * Ejecuta un programa GaboScript.
 */
export async function run(
  source: string,
  host: Host = createNullHost(),
  options: RunOptions = {}
): Promise<RunResult> {
  const startedAt = Date.now();
  const { program, diagnostics } = parse(source);
  const errors = (diagnostics || []).filter((d: any) => d.severity === 'error');
  if (errors.length > 0) {
    const result: RunResult = {
      ok: false,
      phase: 'syntax',
      diagnostics,
      program,
      stats: {
        steps: 0,
        maxDepth: 0,
        elapsedMs: Date.now() - startedAt,
        trace: [],
        traceTruncated: false,
      },
    };
    options.debugger?.finish(result);
    return result;
  }

  const interpreter = new Interpreter(program, host, options);
  let result: RunResult;
  try {
    await interpreter.run();
    result = { ok: true, diagnostics, program };
  } catch (error) {
    if (error instanceof StopExecution) {
      result = { ok: false, phase: 'stopped', diagnostics, error, program };
    } else if (error instanceof GaboRuntimeError) {
      result = { ok: false, phase: 'runtime', diagnostics, error, program };
    } else {
      options.debugger?.finish({ ok: false, phase: 'runtime', error });
      throw error;
    }
  }

  const interpAny = interpreter as any;
  result.stats = {
    steps: interpAny.steps ?? 0,
    maxDepth: interpAny.maxDepth ?? 0,
    elapsedMs: Date.now() - startedAt,
    trace: interpAny.trace ?? [],
    traceTruncated: Boolean(interpAny.traceTruncated),
  };
  options.debugger?.finish(result);
  return result;
}

/** Compila (analiza) sin ejecutar y devuelve los diagnósticos. */
export function check(source: string) {
  const { program, diagnostics } = parse(source);
  const errors = (diagnostics || []).filter((d: any) => d.severity === 'error');
  return { ok: errors.length === 0, diagnostics, program };
}

/** Texto legible de un error de ejecución (con pila de llamadas). */
export function formatRuntimeError(error: any): string {
  const lines: string[] = [];
  lines.push(
    `Error de ejecución (línea ${error.gaboLine || '?'}${error.gaboCol ? `, columna ${error.gaboCol}` : ''}): ${error.message}`
  );
  const frames = (error.frames ?? []).filter((f: any) => f.name);
  if (frames.length > 1) {
    lines.push('Pila de llamadas:');
    for (const frame of frames) {
      if (frame.callLine) {
        lines.push(`  · ${frame.name} (llamado en la línea ${frame.callLine})`);
      } else {
        lines.push(`  · ${frame.name}`);
      }
    }
  }
  return lines.join('\n');
}

/** Texto legible de diagnósticos de sintaxis. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const kind = diagnostic.severity === 'error' ? 'Error' : 'Aviso';
  return `${kind} (línea ${diagnostic.line}, columna ${diagnostic.col}): ${diagnostic.message}`;
}
