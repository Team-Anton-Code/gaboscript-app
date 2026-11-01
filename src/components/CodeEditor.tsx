import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAppTheme } from '../theme/ThemeContext';
import { tokenizeLine } from '../utils/gaboscript';

export interface CodeEditorRef {
  insertSnippet: (snippet: string, cursorOffset?: number) => void;
  undo: () => void;
  redo: () => void;
  focus: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface CodeEditorProps {
  value: string;
  onChangeText: (text: string) => void;
}

const LINE_HEIGHT = 22;
const FONT_SIZE = 14;
const CHAR_WIDTH = 8.5; // Estimación en px de caracteres monospace

function getTranslucentSelectionColor(hexColor: string): string {
  if (hexColor.startsWith('#') && hexColor.length === 7) {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, 0.32)`;
  }
  return 'rgba(0, 122, 255, 0.32)';
}

const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(
  ({ value, onChangeText }, ref) => {
    const { theme } = useAppTheme();
    const textInputRef = useRef<any>(null);

    // Rastreo de la posición del cursor sin forzar controlled selection en cada tecla (solución al Backspace)
    const currentSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
    const [cursorPos, setCursorPos] = useState(0);
    const [programmaticSelection, setProgrammaticSelection] = useState<
      { start: number; end: number } | undefined
    >(undefined);

    // Historial para deshacer/rehacer
    const [history, setHistory] = useState<string[]>([value]);
    const [historyIndex, setHistoryIndex] = useState(0);

    const lines = useMemo(() => value.split('\n'), [value]);

    // Calcular ancho horizontal dinámico sin salto de línea automático
    const codeAreaWidth = useMemo(() => {
      let maxLen = 35;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > maxLen) {
          maxLen = lines[i].length;
        }
      }
      return Math.max(600, Math.ceil(maxLen * CHAR_WIDTH + 250));
    }, [lines]);

    // Calcular índice de la línea activa desde la posición actual del cursor
    const activeLineIndex = useMemo(() => {
      let charCount = 0;
      for (let i = 0; i < lines.length; i++) {
        const lineLen = lines[i].length + 1;
        if (cursorPos >= charCount && cursorPos < charCount + lineLen) {
          return i;
        }
        charCount += lineLen;
      }
      return Math.max(0, lines.length - 1);
    }, [lines, cursorPos]);

    const recordHistory = (newVal: string) => {
      setHistory((prev) => {
        const next = prev.slice(0, historyIndex + 1);
        next.push(newVal);
        return next;
      });
      setHistoryIndex((prev) => prev + 1);
    };

    const handleTextChange = (text: string) => {
      onChangeText(text);
      recordHistory(text);
    };

    const handleSelectionChange = (
      e: NativeSyntheticEvent<{ selection: { start: number; end: number } }>
    ) => {
      currentSelectionRef.current = e.nativeEvent.selection;
      setCursorPos(e.nativeEvent.selection.start);
      if (programmaticSelection) {
        setProgrammaticSelection(undefined);
      }
    };

    useImperativeHandle(ref, () => ({
      insertSnippet: (snippet: string, cursorOffset?: number) => {
        const start = currentSelectionRef.current.start;
        const end = currentSelectionRef.current.end;
        const before = value.slice(0, start);
        const after = value.slice(end);
        const nextValue = before + snippet + after;

        onChangeText(nextValue);
        recordHistory(nextValue);

        const newPos = start + (cursorOffset !== undefined ? cursorOffset : snippet.length);
        currentSelectionRef.current = { start: newPos, end: newPos };
        setCursorPos(newPos);
        setProgrammaticSelection({ start: newPos, end: newPos });

        textInputRef.current?.focus();
        setTimeout(() => {
          textInputRef.current?.focus();
        }, 30);
      },
      focus: () => {
        textInputRef.current?.focus();
      },
      undo: () => {
        if (historyIndex > 0) {
          const prevIndex = historyIndex - 1;
          const prevVal = history[prevIndex];
          setHistoryIndex(prevIndex);
          onChangeText(prevVal);
        }
      },
      redo: () => {
        if (historyIndex < history.length - 1) {
          const nextIndex = historyIndex + 1;
          const nextVal = history[nextIndex];
          setHistoryIndex(nextIndex);
          onChangeText(nextVal);
        }
      },
      canUndo: historyIndex > 0,
      canRedo: historyIndex < history.length - 1,
    }));

    const translucentSelection = useMemo(
      () => getTranslucentSelectionColor(theme.acentoVariante || theme.acento),
      [theme.acentoVariante, theme.acento]
    );

    return (
      <View style={[styles.container, { backgroundColor: theme.fondo }]}>
        {/* Scroll Vertical Principal */}
        <ScrollView
          style={styles.editorScroll}
          contentContainerStyle={styles.editorScrollContent}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="always"
        >
          {/* Fila del Editor: Columna de Números fija + Código con Scroll Horizontal */}
          <View style={styles.editorRow}>
            {/* Línea activa resaltada detrás del gutter */}
            <View
              pointerEvents="none"
              style={[
                styles.activeLineHighlight,
                {
                  top: activeLineIndex * LINE_HEIGHT,
                  height: LINE_HEIGHT,
                  backgroundColor: theme.lineaActiva,
                },
              ]}
            />

            {/* Columna de Números de Línea */}
            <View style={[styles.gutter, { borderRightColor: theme.borde }]}>
              {lines.map((_, idx) => {
                const isActive = idx === activeLineIndex;
                return (
                  <View key={`num-${idx}`} style={styles.lineNumBox}>
                    <Text
                      style={[
                        styles.lineNumText,
                        {
                          color: isActive ? theme.texto : theme.numeroLinea,
                          fontWeight: isActive ? '700' : '400',
                          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                        },
                      ]}
                    >
                      {idx + 1}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Scroll Horizontal del Área de Código (Sin Word Wrap) */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              keyboardShouldPersistTaps="always"
              style={styles.horizontalScroll}
              contentContainerStyle={[
                styles.horizontalScrollContent,
                { width: codeAreaWidth },
              ]}
            >
              {/* Capa de Resaltado de Sintaxis */}
              <View pointerEvents="none" style={[styles.highlightLayer, { width: codeAreaWidth }]}>
                {lines.map((line, lineIdx) => {
                  const tokens = tokenizeLine(line);
                  return (
                    <View key={`line-${lineIdx}`} style={styles.codeLine}>
                      {tokens.length === 0 ? (
                        <Text
                          style={[
                            styles.tokenText,
                            {
                              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                            },
                          ]}
                        >
                          {' '}
                        </Text>
                      ) : (
                        tokens.map((token, tIdx) => {
                          let color = theme.texto;
                          if (token.type === 'keyword') color = theme.syntax.keyword;
                          else if (token.type === 'type') color = theme.syntax.type;
                          else if (token.type === 'string') color = theme.syntax.string;
                          else if (token.type === 'number') color = theme.syntax.number;
                          else if (token.type === 'comment') color = theme.syntax.comment;
                          else if (token.type === 'operator') color = theme.syntax.operator;
                          else if (token.type === 'function') color = theme.syntax.operator;

                          return (
                            <Text
                              key={`t-${lineIdx}-${tIdx}`}
                              style={[
                                styles.tokenText,
                                {
                                  color,
                                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                                },
                              ]}
                            >
                              {token.text}
                            </Text>
                          );
                        })
                      )}
                    </View>
                  );
                })}
              </View>

              {/* Input Nativo de Edición (Caret uniforme, Backspace sincronizado, Selección transparente) */}
              <TextInput
                ref={textInputRef}
                style={[
                  styles.textInput,
                  {
                    width: codeAreaWidth,
                    color: Platform.OS === 'web' ? 'transparent' : 'rgba(0,0,0,0.01)',
                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                  },
                ]}
                cursorColor={theme.acentoVariante || theme.acento}
                selectionColor={translucentSelection}
                value={value}
                onChangeText={handleTextChange}
                onSelectionChange={handleSelectionChange}
                selection={programmaticSelection}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                keyboardType="default"
                textAlignVertical="top"
                scrollEnabled={false}
              />
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    );
  }
);

CodeEditor.displayName = 'CodeEditor';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  editorScroll: {
    flex: 1,
  },
  editorScrollContent: {
    paddingVertical: 8,
    minHeight: '100%',
  },
  activeLineHighlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 0,
  },
  editorRow: {
    flexDirection: 'row',
    position: 'relative',
    zIndex: 1,
  },
  gutter: {
    width: 44,
    borderRightWidth: 1,
    paddingRight: 6,
    alignItems: 'flex-end',
    userSelect: 'none',
  },
  lineNumBox: {
    height: LINE_HEIGHT,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  lineNumText: {
    fontSize: 12,
    lineHeight: LINE_HEIGHT,
    includeFontPadding: false,
  },
  horizontalScroll: {
    flex: 1,
  },
  horizontalScrollContent: {
    paddingLeft: 8,
    paddingRight: 24,
    position: 'relative',
  },
  highlightLayer: {
    position: 'absolute',
    top: 0,
    left: 8,
    zIndex: 1,
  },
  codeLine: {
    flexDirection: 'row',
    height: LINE_HEIGHT,
    alignItems: 'center',
    flexWrap: 'nowrap',
  },
  tokenText: {
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    includeFontPadding: false,
    flexWrap: 'nowrap',
  },
  textInput: {
    position: 'relative',
    zIndex: 2,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    padding: 0,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    paddingRight: 0,
    margin: 0,
    backgroundColor: 'transparent',
    minHeight: LINE_HEIGHT,
    flexWrap: 'nowrap',
    includeFontPadding: false,
  },
});

export default CodeEditor;
