/**
 * Errores y señales internas del runtime de GaboScript.
 * JavaScript puro sin dependencias externas.
 */

export interface StackFrame {
  name: string;
  line: number;
  callLine?: number;
}

export class GaboRuntimeError extends Error {
  gaboLine: number;
  gaboCol: number;
  frames: StackFrame[];
  noInput?: boolean;

  constructor(message: string, line: number, col: number, frames: StackFrame[] = []) {
    super(message);
    this.name = 'GaboRuntimeError';
    this.gaboLine = line;
    this.gaboCol = col;
    this.frames = frames;
  }
}

export class StopExecution extends Error {
  constructor() {
    super('Ejecución detenida por el usuario.');
    this.name = 'StopExecution';
  }
}

export class ReturnSignal extends Error {
  value: unknown;

  constructor(value: unknown) {
    super('return');
    this.name = 'ReturnSignal';
    this.value = value;
  }
}

