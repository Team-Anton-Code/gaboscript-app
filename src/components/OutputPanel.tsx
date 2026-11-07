import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/ThemeContext';

interface OutputPanelProps {
  visible: boolean;
  onClose: () => void;
  logs: string[];
  onClear: () => void;
  onRestart: () => void;
  isRunning?: boolean;
  waitingForInput?: { typeName: string; line: number } | null;
  onSubmitInput?: (value: string) => void;
  algorithmName?: string;
  fileName?: string;
}

export default function OutputPanel({
  visible,
  onClose,
  logs,
  onClear,
  onRestart,
  isRunning = false,
  waitingForInput = null,
  onSubmitInput,
  algorithmName,
  fileName,
}: OutputPanelProps) {
  const { theme, isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<any>(null);
  const inputRef = useRef<any>(null);

  const [inputText, setInputText] = useState('');
  const [modalVisible, setModalVisible] = useState(visible);
  const isClosingRef = useRef(false);

  const screenHeight = Dimensions.get('window').height;
  const [slideY] = useState(() => new Animated.Value(screenHeight));

  const displayName = fileName || algorithmName || 'Terminal';
  const topInset = Math.max(insets.top, Platform.OS === 'android' ? 24 : 0);

  // Manejar apertura y cierre con animación suave completa
  useEffect(() => {
    if (visible) {
      isClosingRef.current = false;
      setModalVisible(true);
      Animated.timing(slideY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (modalVisible && !isClosingRef.current) {
      isClosingRef.current = true;
      Animated.timing(slideY, {
        toValue: screenHeight,
        duration: 240,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setModalVisible(false);
      });
    }
  }, [visible, modalVisible, screenHeight, slideY]);

  const handleRequestClose = () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.timing(slideY, {
      toValue: screenHeight,
      duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setModalVisible(false);
      onClose();
    });
  };

  // Auto-scroll al final cada vez que se agregan líneas a los logs o se solicita entrada
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [logs, visible, waitingForInput]);

  // Enfocar automáticamente el campo de entrada cuando el algoritmo solicita Leer >>
  useEffect(() => {
    if (waitingForInput && visible) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [waitingForInput, visible]);

  const handleSend = () => {
    if (!onSubmitInput) return;
    const value = inputText;
    setInputText('');
    onSubmitInput(value);
  };

  return (
    <Modal
      visible={modalVisible}
      animationType="none"
      transparent={true}
      statusBarTranslucent={true}
      onRequestClose={handleRequestClose}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <Animated.View
          style={[
            styles.fullScreen,
            {
              backgroundColor: theme.fondo,
              paddingBottom: insets.bottom,
              paddingLeft: insets.left,
              paddingRight: insets.right,
              transform: [{ translateY: slideY }],
            },
          ]}
        >
        <KeyboardAvoidingView
          style={styles.keyboardContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Cabecera de la Terminal: Fondo uniforme sólido de la cabecera sin franja ni sombra negra */}
          <View
            style={[
              styles.header,
              {
                backgroundColor: theme.superficie,
                borderBottomColor: theme.borde,
                paddingTop: topInset,
                height: 52 + topInset,
              },
            ]}
          >
            {/* Lado Izquierdo: Muestra únicamente el nombre del archivo */}
            <View style={styles.headerLeft}>
              <Text
                style={[styles.headerTitle, { color: theme.texto }]}
                numberOfLines={1}
              >
                {displayName}
              </Text>
            </View>

            {/* Lado Derecho (Iconos sin texto): Refrescar a la izquierda, X en el extremo derecho */}
            <View style={styles.headerRight}>
              {/* Icono de Refrescar / Actualizar: Siempre re-ejecuta el algoritmo desde cero */}
              <TouchableOpacity
                style={styles.iconBtn}
                activeOpacity={0.7}
                onPress={onRestart}
                hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
              >
                <MaterialCommunityIcons
                  name="refresh"
                  size={22}
                  color={theme.textoSecundario}
                />
              </TouchableOpacity>

              {/* Icono de X: para cerrar la terminal */}
              <TouchableOpacity
                style={styles.iconBtn}
                activeOpacity={0.7}
                onPress={handleRequestClose}
                hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={24}
                  color={theme.texto}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Consola Interactiva: Salida de datos a pantalla completa */}
          <ScrollView
            ref={scrollViewRef}
            style={styles.logScroll}
            contentContainerStyle={styles.logContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            {logs.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptySubtitle, { color: theme.textoSecundario }]}>
                  Consola vacía.
                </Text>
              </View>
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

          {/* Consola Interactiva: Entrada de datos por teclado limpia sin Leer ni Mostrar */}
          <View
            style={[
              styles.inputContainer,
              {
                backgroundColor: theme.superficie,
                borderTopColor: waitingForInput ? theme.acento : theme.borde,
                borderTopWidth: waitingForInput ? 2 : StyleSheet.hairlineWidth,
              },
            ]}
          >
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
                  ? 'Ejecutando programa...'
                  : 'Programa inactivo'
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
              disabled={!isRunning || !inputText.trim()}
              style={[
                styles.sendButton,
                {
                  backgroundColor:
                    isRunning && inputText.trim() ? theme.acento : theme.lineaActiva,
                  opacity: isRunning && inputText.trim() ? 1 : 0.4,
                },
              ]}
            >
              <MaterialCommunityIcons
                name="send"
                size={15}
                color={
                  isRunning && inputText.trim()
                    ? theme.textoSobreAcento
                    : theme.textoSecundario
                }
              />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  </Modal>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
  },
  keyboardContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  logScroll: {
    flex: 1,
  },
  logContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexGrow: 1,
    gap: 4,
  },
  logLine: {
    fontSize: 13,
    lineHeight: 20,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptySubtitle: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  inputContainer: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
  },
  terminalInput: {
    flex: 1,
    fontSize: 13.5,
    paddingVertical: 0,
    paddingHorizontal: 6,
    height: 36,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
