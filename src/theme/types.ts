export type ThemeId =
  | 'medianoche'
  | 'bosque'
  | 'crepusculo'
  | 'brasa'
  | 'nieve'
  | 'menta'
  | 'lavanda'
  | 'durazno';

export type ThemePreference = ThemeId | 'auto';

export interface SyntaxColors {
  keyword: string;
  type: string;
  string: string;
  number: string;
  comment: string;
  operator: string;
  identifier: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  category: 'dark' | 'light';
  isDark: boolean;

  // Base interface tokens
  fondo: string;
  superficie: string;
  superficieSecundaria: string;
  borde: string;
  texto: string;
  textoSecundario: string;
  acento: string;
  acentoVariante: string;
  textoSobreAcento: string;
  lineaActiva: string;
  numeroLinea: string;
  exito: string;
  error: string;

  // Syntax highlighting tokens
  syntax: SyntaxColors;
}
