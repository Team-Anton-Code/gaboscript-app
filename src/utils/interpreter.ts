/**
 * Adaptador del Intérprete y Compilador de GaboScript.
 * Conecta el runtime oficial de la extensión de VS Code con la aplicación móvil.
 */

import { check, formatDiagnostic, formatRuntimeError, run, RunResult } from '../runtime';

export interface ExecutionResult {
  output: string[];
  success: boolean;
  error?: string;
  diagnostics?: any[];
}

export interface InputRequest {
  typeName: string;
  line: number;
}

/**
 * Ejecutor interactivo de GaboScript que gestiona el ciclo de vida,
 * salida en tiempo real, pausas para `Leer >>` y detención cooperativa.
 */
export class InteractiveGaboRunner {
  private code: string;
  private stopped = false;
  private currentInputResolver: ((value: string | null) => void) | null = null;
  private onOutputCallback: (text: string) => void;
  private onInputRequestCallback: (req: { typeName: string; line: number }) => void;
  private onInputDoneCallback: () => void;
  private onFinishedCallback: (result: ExecutionResult) => void;

  constructor({
    code,
    onOutput,
    onInputRequest,
    onInputDone,
    onFinished,
  }: {
    code: string;
    onOutput: (text: string) => void;
    onInputRequest: (req: { typeName: string; line: number }) => void;
    onInputDone: () => void;
    onFinished: (result: ExecutionResult) => void;
  }) {
    this.code = code;
    this.onOutputCallback = onOutput;
    this.onInputRequestCallback = onInputRequest;
    this.onInputDoneCallback = onInputDone;
    this.onFinishedCallback = onFinished;
  }

  public async start(): Promise<void> {
    this.stopped = false;
    const outputLines: string[] = [];

    const append = (text: string) => {
      outputLines.push(text);
      this.onOutputCallback(text);
    };

    try {
      const result: RunResult = await run(
        this.code,
        {
          print: (text: string) => {
            append(text);
          },
          warn: (text: string) => {
            append(text);
          },
          readLine: (req) => {
            if (this.stopped) return Promise.resolve(null);
            this.onInputRequestCallback(req);

            return new Promise<string | null>((resolve) => {
              this.currentInputResolver = (val) => {
                this.currentInputResolver = null;
                this.onInputDoneCallback();
                resolve(val);
              };
            });
          },
        },
        {
          shouldStop: () => this.stopped,
        }
      );

      if (result.ok) {
        append('\n✓ Proceso finalizado correctamente.');
        this.onFinishedCallback({
          output: outputLines,
          success: true,
        });
      } else if (result.phase === 'stopped') {
        append('\n■ Ejecución detenida por el usuario.');
        this.onFinishedCallback({
          output: outputLines,
          success: false,
          error: 'Ejecución detenida por el usuario',
        });
      } else if (result.phase === 'syntax') {
        append('\n✗ Error de sintaxis:');
        for (const diag of result.diagnostics ?? []) {
          if (diag.severity === 'error') {
            append(`   · ${formatDiagnostic(diag)}`);
          }
        }
        this.onFinishedCallback({
          output: outputLines,
          success: false,
          error: 'Errores de sintaxis',
          diagnostics: result.diagnostics,
        });
      } else {
        const errorMsg = formatRuntimeError(result.error ?? { message: 'Error de ejecución' });
        append(`\n✗ ${errorMsg}`);
        this.onFinishedCallback({
          output: outputLines,
          success: false,
          error: errorMsg,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      append(`\n✗ Error inesperado: ${msg}`);
      this.onFinishedCallback({
        output: outputLines,
        success: false,
        error: msg,
      });
    }
  }

  public sendInput(value: string) {
    if (this.currentInputResolver) {
      this.onOutputCallback(`> ${value}\n`);
      this.currentInputResolver(value);
    }
  }

  public stop() {
    this.stopped = true;
    if (this.currentInputResolver) {
      const res = this.currentInputResolver;
      this.currentInputResolver = null;
      this.onInputDoneCallback();
      res(null);
    }
  }
}

/**
 * Ejecución simple de GaboScript por lotes (para compatibilidad).
 */
export async function executeGaboScript(
  code: string,
  providedInputs: string[] = []
): Promise<ExecutionResult> {
  const output: string[] = [];
  let inputIdx = 0;

  const res = await run(
    code,
    {
      print: (text) => output.push(text),
      warn: (text) => output.push(text),
      readLine: async () => {
        if (inputIdx < providedInputs.length) {
          return providedInputs[inputIdx++];
        }
        return '0';
      },
    }
  );

  if (res.ok) {
    return { output, success: true };
  } else if (res.phase === 'syntax') {
    const diags = (res.diagnostics ?? []).map((d) => formatDiagnostic(d));
    return {
      output: [...output, ...diags],
      success: false,
      error: 'Errores de sintaxis',
      diagnostics: res.diagnostics,
    };
  } else {
    const errorMsg = formatRuntimeError(res.error ?? { message: 'Error de ejecución' });
    return {
      output: [...output, errorMsg],
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Verifica la sintaxis del código sin ejecutar.
 */
export function checkGaboScript(code: string) {
  return check(code);
}
