import {
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAppTheme } from '../theme/ThemeContext';

interface AccessoryBarProps {
  onInsertText: (snippet: string, cursorOffset?: number) => void;
  onInsertTab: () => void;
}

interface KeywordItem {
  label: string;
  type: 'io' | 'control' | 'type';
  action: () => { text: string; cursorOffset?: number };
}

export default function AccessoryBar({ onInsertText, onInsertTab }: AccessoryBarProps) {
  const { theme } = useAppTheme();

  // 1. Barra de Palabras Clave y Comandos en el orden estricto solicitado:
  // 1. mostrar <<
  // 2. Leer >>
  // 3. Si
  // 4. Sino
  // 5. En_Caso
  // 6. Mientras
  // 7. Para
  // 8. Repetir
  // 9. Funcion
  // 10. Procedimiento
  // 11. Registro
  // 12. Algoritmo
  // 13. Inicio
  // 14. Fin
  // 15. Tipos de variable (Entero, Real, Cadena, Booleano, Caracter, etc.)
  const keywords: KeywordItem[] = [
    {
      label: 'mostrar <<',
      type: 'io',
      action: () => ({ text: 'Mostrar << ', cursorOffset: 11 }),
    },
    {
      label: 'Leer >>',
      type: 'io',
      action: () => ({ text: 'Leer >> ', cursorOffset: 8 }),
    },
    {
      label: 'Si',
      type: 'control',
      action: () => ({
        text: 'Si (condicion) Entonces;\n  \nFin_Si',
        cursorOffset: 27,
      }),
    },
    {
      label: 'Sino',
      type: 'control',
      action: () => ({ text: 'Sino\n  ', cursorOffset: 7 }),
    },
    {
      label: 'En_Caso',
      type: 'control',
      action: () => ({
        text: 'En_Caso (variable) Sea;\n  Caso(1);\n    \n  Otro_Caso\n    \nFin_Caso',
        cursorOffset: 37,
      }),
    },
    {
      label: 'Mientras',
      type: 'control',
      action: () => ({
        text: 'Mientras (condicion) Hacer;\n  \nFin_Mientras',
        cursorOffset: 30,
      }),
    },
    {
      label: 'Para',
      type: 'control',
      action: () => ({
        text: 'Para (i = 1 Hasta n) Hacer;\n  \nFin_Para',
        cursorOffset: 30,
      }),
    },
    {
      label: 'Repetir',
      type: 'control',
      action: () => ({
        text: 'Repetir\n  \nHasta (condicion);\nFin_Repetir',
        cursorOffset: 10,
      }),
    },
    {
      label: 'Funcion',
      type: 'control',
      action: () => ({
        text: 'Funcion nombre(parametro: Entero): Entero;\nInicio\n  Devolver(0);\nFin_Funcion',
        cursorOffset: 15,
      }),
    },
    {
      label: 'Procedimiento',
      type: 'control',
      action: () => ({
        text: 'Procedimiento nombre(parametro: Entero);\nInicio\n  \nFin_Procedimiento',
        cursorOffset: 21,
      }),
    },
    {
      label: 'Registro',
      type: 'control',
      action: () => ({
        text: 'Registro: MiRegistro;\n  campo: Entero;\nFin_Registro',
        cursorOffset: 10,
      }),
    },
    {
      label: 'Algoritmo',
      type: 'control',
      action: () => ({
        text: 'Algoritmo mi_algoritmo\nInicio\n  \nFin',
        cursorOffset: 10,
      }),
    },
    {
      label: 'Inicio',
      type: 'control',
      action: () => ({ text: 'Inicio\n  ', cursorOffset: 9 }),
    },
    {
      label: 'Fin',
      type: 'control',
      action: () => ({ text: 'Fin', cursorOffset: 3 }),
    },
    // Tipos de variable
    {
      label: 'Entero',
      type: 'type',
      action: () => ({ text: 'Entero', cursorOffset: 6 }),
    },
    {
      label: 'Real',
      type: 'type',
      action: () => ({ text: 'Real', cursorOffset: 4 }),
    },
    {
      label: 'Cadena',
      type: 'type',
      action: () => ({ text: 'Cadena', cursorOffset: 6 }),
    },
    {
      label: 'Booleano',
      type: 'type',
      action: () => ({ text: 'Booleano', cursorOffset: 8 }),
    },
    {
      label: 'Caracter',
      type: 'type',
      action: () => ({ text: 'Caracter', cursorOffset: 8 }),
    },
    {
      label: 'Var',
      type: 'control',
      action: () => ({ text: 'Var ', cursorOffset: 4 }),
    },
  ];

  // 2. Barra de Símbolos Rápidos en el orden estricto solicitado:
  // Tab ; " << >> = < > ( ) { }
  const symbols = ['Tab', ';', '"', '<<', '>>', '=', '<', '>', '(', ')', '{', '}'];

  const getKeywordColor = (item: KeywordItem) => {
    switch (item.type) {
      case 'io':
        return theme.syntax.operator;
      case 'control':
        return theme.syntax.keyword;
      case 'type':
        return theme.syntax.type;
      default:
        return theme.texto;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.superficie, borderTopColor: theme.borde }]}>
      {/* Fila 1: Palabras clave y comandos */}
      <View style={styles.rowWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={styles.scrollContent}
        >
          {keywords.map((kw, idx) => (
            <TouchableOpacity
              key={`${kw.label}-${idx}`}
              activeOpacity={0.7}
              style={[
                styles.chip,
                {
                  backgroundColor: theme.superficieSecundaria,
                  borderColor: theme.borde,
                },
              ]}
              onPress={() => {
                const res = kw.action();
                onInsertText(res.text, res.cursorOffset);
              }}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: getKeywordColor(kw), fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
                ]}
              >
                {kw.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Fila 2: Símbolos Rápidos */}
      <View style={[styles.rowWrapper, styles.secondRow, { borderTopColor: theme.borde }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={styles.scrollContent}
        >
          {symbols.map((sym, idx) => {
            const isTab = sym === 'Tab';
            return (
              <TouchableOpacity
                key={`${sym}-${idx}`}
                activeOpacity={0.7}
                style={[
                  styles.symbolChip,
                  isTab ? styles.tabChip : null,
                  {
                    backgroundColor: isTab ? theme.superficieSecundaria : theme.lineaActiva,
                    borderColor: theme.borde,
                  },
                ]}
                onPress={() => {
                  if (isTab) {
                    onInsertTab();
                  } else {
                    onInsertText(sym);
                  }
                }}
              >
                <Text
                  style={[
                    styles.symbolText,
                    {
                      color: isTab ? theme.acento : theme.texto,
                      fontWeight: isTab ? '700' : '600',
                      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                    },
                  ]}
                >
                  {sym}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  rowWrapper: {
    height: 38,
    justifyContent: 'center',
  },
  secondRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
    paddingTop: 2,
  },
  scrollContent: {
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  symbolChip: {
    minWidth: 34,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabChip: {
    paddingHorizontal: 12,
  },
  symbolText: {
    fontSize: 13,
  },
});
