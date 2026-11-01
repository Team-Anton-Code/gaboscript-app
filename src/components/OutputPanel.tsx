import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppTheme } from '../theme/ThemeContext';

interface OutputPanelProps {
  logs: string[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onClear: () => void;
  isRunning?: boolean;
  onStop?: () => void;
  waitingForInput?: { typeName: string; line: number } | null;
  onSubmitInput?: (value: string) => void;
}

export default function OutputPanel({
  logs,
  isExpanded,
  onToggleExpand,
  onClear,
  isRunning = false,
  onStop,
  waitingForInput = null,
  onSubmitInput,
}: OutputPanelProps) {
  const { theme } = useAppTheme();
  const scrollViewRef = useRef<any>(null);
  const inputRef = useRef<any>(null);

  const [inputText, setInputText] = useState('');
  const [panelHeightMode, setPanelHeightMode] = useState<'normal' | 'tall'>('normal');

  // Auto-scroll al final cada vez que cambian los logs
  useEffect(() => {
    if (isExpanded) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 50);
    }
  }, [logs, isExpanded, waitingForInput]);

  // Enfocar automáticamente el input cuando el programa pide entrada
  useEffect(() => {
    if (waitingForInput && isExpanded) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [waitingForInput, isExpanded]);

  const handleSend = () => {
    if (!onSubmitInput) return;
    const value = inputText;
    setInputText('');
    onSubmitInput(value);
  };

  const toggleHeightMode = () => {
    setPanelHeightMode((prev) => (prev === 'normal' ? 'tall' : 'normal'));
  };

  if (!isExpanded) {
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        style={[
          styles.collapsedBar,
          {
            backgroundColor: theme.superficie,
            borderTopColor: theme.borde,
          },
        ]}
        onPress={onToggleExpand}
      >
        <View style={styles.headerLeft}>
          <MaterialCommunityIcons
            name="console"
            size={18}
            color={theme.acento}
          />
          <Text style={[styles.title, { color: theme.texto }]}>
            Terminal {logs.length > 0 ? `(${logs.length})` : ''}
          </Text>
        </View>

        <View style={styles.headerRight}>
          {isRunning ? (
            <View style={styles.runningBadge}>
              <View style={[styles.runningDot, { backgroundColor: theme.acento }]} />
              <Text style={[styles.statusText, { color: theme.acento }]}>
                {waitingForInput ? `Esperando entrada (${waitingForInput.typeName})...` : 'Ejecutando...'}
              </Text>
            </View>
          ) : logs.length > 0 ? (
            <Text
              style={[
                styles.statusText,
                {
                  color: logs[logs.length - 1].includes('Error') || logs[logs.length - 1].includes('✗')
                    ? theme.error
                    : theme.exito,
                },
              ]}
              numberOfLines={1}
            >
              {logs[logs.length - 1].trim()}
            </Text>
          ) : null}
          <MaterialCommunityIcons
            name="chevron-up"
            size={20}
            color={theme.textoSecundario}
          />
        </View>
      </TouchableOpacity>
    );
  }

  const containerHeight = panelHeightMode === 'normal' ? 220 : 340;

  return (
    <View
      style={[
        styles.expandedContainer,
        {
          height: containerHeight,
          backgroundColor: theme.fondo,
          borderTopColor: theme.borde,
        },
      ]}
    >
      {/* Barra superior de la terminal */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.superficie,
            borderBottomColor: theme.borde,
          },
        ]}
      >
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.headerTitleRow}
            activeOpacity={0.7}
            onPress={onToggleExpand}
          >
            <MaterialCommunityIcons
              name="console"
              size={18}
              color={theme.acento}
            />
            <Text style={[styles.title, { color: theme.texto }]}>Terminal Interactiva</Text>
            <MaterialCommunityIcons
              name="chevron-down"
              size={18}
              color={theme.textoSecundario}
            />
          </TouchableOpacity>

          {isRunning && (
            <View style={[styles.statusIndicator, { backgroundColor: theme.lineaActiva }]}>
              <Text style={[styles.statusBadgeText, { color: theme.acento }]}>
                {waitingForInput ? `Leer (${waitingForInput.typeName})` : 'En ejecución'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          {/* Botón Detener si está ejecutando */}
          {isRunning && onStop && (
            <TouchableOpacity
              onPress={onStop}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.stopBtn, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}
            >
              <MaterialCommunityIcons name="stop" size={16} color={theme.error} />
              <Text style={[styles.stopBtnText, { color: theme.error }]}>Detener</Text>
            </TouchableOpacity>
          )}

          {/* Toggle de altura (split view / maximizar) */}
          <TouchableOpacity
            onPress={toggleHeightMode}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.actionBtn}
          >
            <MaterialCommunityIcons
              name={panelHeightMode === 'normal' ? 'arrow-expand' : 'arrow-collapse'}
              size={16}
              color={theme.textoSecundario}
            />
          </TouchableOpacity>

          {/* Limpiar terminal */}
          {logs.length > 0 && (
            <TouchableOpacity
              onPress={onClear}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.actionBtn}
            >
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={16}
                color={theme.textoSecundario}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Salida de texto / logs */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.logScroll}
        contentContainerStyle={styles.logContent}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="always"
      >
        {logs.length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.textoSecundario }]}>
            Presiona el botón de ejecutar (▶) para ver la salida e interactuar con el algoritmo.
          </Text>
        ) : (
          logs.map((log, index) => {
            const isSuccess = log.includes('✓') || log.includes('finalizado correctamente');
            const isError = log.includes('✗') || log.includes('Error');
            const isUserInput = log.startsWith('>');
            const isNotice = log.includes('▷') || log.includes('■') || log.includes('Aviso');

            let textColor = theme.texto;
            if (isSuccess) textColor = theme.exito;
            else if (isError) textColor = theme.error;
            else if (isUserInput) textColor = theme.acento;
            else if (isNotice) textColor = theme.syntax.number;

            return (
              <Text
                key={`log-${index}`}
                style={[
                  styles.logLine,
                  {
                    color: textColor,
                    fontWeight: isUserInput || isSuccess || isError ? '600' : '400',
                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                  },
                ]}
              >
                {log}
              </Text>
            );
          })
        )}
      </ScrollView>

      {/* Barra de Entrada Interactiva (para Leer >>) */}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: theme.superficie,
            borderTopColor: waitingForInput ? theme.acento : theme.borde,
            borderTopWidth: waitingForInput ? 1.5 : StyleSheet.hairlineWidth,
          },
        ]}
      >
        <Text style={[styles.promptPrefix, { color: waitingForInput ? theme.acento : theme.textoSecundario }]}>
          {waitingForInput ? `Leer (${waitingForInput.typeName}):` : '>'}
        </Text>
        <TextInput
          ref={inputRef}
          style={[
            styles.terminalInput,
            {
              color: theme.texto,
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            },
          ]}
          value={inputText}
          onChangeText={setInputText}
          placeholder={
            waitingForInput
              ? `Ingresa ${waitingForInput.typeName} y presiona Enviar`
              : isRunning
              ? 'Ejecutando...'
              : 'La terminal aceptará entradas durante la ejecución'
          }
          placeholderTextColor={theme.textoSecundario}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          editable={isRunning}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={!isRunning}
          style={[
            styles.sendButton,
            {
              backgroundColor: isRunning ? theme.acento : theme.superficieSecundaria,
              opacity: isRunning ? 1 : 0.4,
            },
          ]}
        >
          <MaterialCommunityIcons
            name="send"
            size={14}
            color={isRunning ? theme.textoSobreAcento : theme.textoSecundario}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  collapsedBar: {
    height: 40,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  expandedContainer: {
    borderTopWidth: 1,
    flexDirection: 'column',
  },
  header: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
  },
  statusIndicator: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  runningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  runningDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionBtn: {
    padding: 4,
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  stopBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  logScroll: {
    flex: 1,
  },
  logContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 3,
  },
  logLine: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  emptyText: {
    fontSize: 12.5,
    fontStyle: 'italic',
  },
  inputContainer: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 8,
  },
  promptPrefix: {
    fontSize: 12,
    fontWeight: '700',
  },
  terminalInput: {
    flex: 1,
    fontSize: 12.5,
    paddingVertical: 0,
    paddingHorizontal: 4,
    height: 32,
  },
  sendButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
