import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AccessoryBar from '../components/AccessoryBar';
import CodeEditor, { CodeEditorRef } from '../components/CodeEditor';
import FileTabs from '../components/FileTabs';
import GaboFileIcon from '../components/GaboFileIcon';
import OutputPanel from '../components/OutputPanel';
import { useFiles } from '../context/FileContext';
import { useAppTheme } from '../theme/ThemeContext';
import { exportToDocx } from '../utils/exporter';
import { formatGaboScript } from '../utils/formatter';
import { InteractiveGaboRunner } from '../utils/interpreter';

export default function EditorScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const {
    activeFile,
    files,
    workspaceUri,
    workspaceName,
    updateFileContent,
    createFile,
    openFile,
    pickWorkspaceFolder,
  } = useFiles();
  const insets = useSafeAreaInsets();

  const editorRef = useRef<CodeEditorRef>(null);

  // Output panel & interactive execution state
  const [logs, setLogs] = useState<string[]>([]);
  const [isOutputExpanded, setIsOutputExpanded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [waitingForInput, setWaitingForInput] = useState<{ typeName: string; line: number } | null>(null);
  const runnerRef = useRef<InteractiveGaboRunner | null>(null);

  // New file modal (for empty state)
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  // Detener la ejecución si el componente se desmonta
  useEffect(() => {
    return () => {
      if (runnerRef.current) {
        runnerRef.current.stop();
        runnerRef.current = null;
      }
    };
  }, []);

  // Ejecución interactiva de GaboScript
  const handleRunCode = useCallback(() => {
    if (!activeFile) return;

    // Si ya había una ejecución previa, detenerla
    if (runnerRef.current) {
      runnerRef.current.stop();
      runnerRef.current = null;
    }

    const cleanTitle = activeFile.name.replace(/\.(gabo|txt)$/i, '');
    setIsRunning(true);
    setIsOutputExpanded(true);
    setWaitingForInput(null);
    setLogs([`▷ Ejecutando ${cleanTitle}…\n`]);

    const runner = new InteractiveGaboRunner({
      code: activeFile.content,
      onOutput: (text: string) => {
        setLogs((prev) => [...prev, text]);
      },
      onInputRequest: (req) => {
        setWaitingForInput(req);
      },
      onInputDone: () => {
        setWaitingForInput(null);
      },
      onFinished: () => {
        setIsRunning(false);
        setWaitingForInput(null);
      },
    });

    runnerRef.current = runner;
    runner.start();
  }, [activeFile]);

  // Detener ejecución interactiva
  const handleStopCode = useCallback(() => {
    if (runnerRef.current) {
      runnerRef.current.stop();
      runnerRef.current = null;
    }
    setIsRunning(false);
    setWaitingForInput(null);
  }, []);

  // Enviar entrada escrita por el usuario para `Leer >>`
  const handleSubmitInput = useCallback((value: string) => {
    if (runnerRef.current) {
      runnerRef.current.sendInput(value);
    }
  }, []);

  // Dar formato al código
  const handleFormatCode = useCallback(() => {
    if (!activeFile) return;
    const formatted = formatGaboScript(activeFile.content);
    updateFileContent(activeFile.id, formatted);
  }, [activeFile, updateFileContent]);

  // Insertar atajos en el editor
  const handleInsertSnippet = useCallback((snippet: string, cursorOffset?: number) => {
    editorRef.current?.insertSnippet(snippet, cursorOffset);
  }, []);

  const handleInsertTab = useCallback(() => {
    editorRef.current?.insertSnippet('  ', 2);
  }, []);

  // Exportación directa a Word (.docx) sin menú intermedio
  const handleExportDocx = async () => {
    if (!activeFile) return;
    try {
      await exportToDocx(activeFile);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo generar el documento Word';
      Alert.alert('Error al exportar Word', msg);
    }
  };

  // Requerir carpeta de trabajo antes de crear archivos
  const handleRequestNewFile = async () => {
    if (!workspaceUri) {
      Alert.alert(
        'Carpeta de trabajo requerida',
        'NO se puede crear ningún archivo sin antes haber elegido una carpeta en el almacenamiento del teléfono donde se guardará todo dentro de ella.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Seleccionar carpeta',
            onPress: async () => {
              const selected = await pickWorkspaceFolder();
              if (selected) {
                setShowNewFileModal(true);
              }
            },
          },
        ]
      );
      return;
    }
    setShowNewFileModal(true);
  };

  const handleCreateFileSubmit = async () => {
    if (!newFileName.trim()) return;
    try {
      await createFile(newFileName.trim(), null);
      setNewFileName('');
      setShowNewFileModal(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear archivo';
      Alert.alert('Error', msg);
    }
  };

  const handleOpenWorkspaceOrExplorer = async () => {
    if (!workspaceUri) {
      const success = await pickWorkspaceFolder();
      if (success) {
        router.push('/explorer');
      }
    } else {
      router.push('/explorer');
    }
  };

  // ---- EMPTY STATE (Estilo VS Code cuando no hay archivo abierto) ----
  if (!activeFile) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.fondo,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        {/* Top Header */}
        <View
          style={[
            styles.header,
            { backgroundColor: theme.fondo, borderBottomColor: theme.borde },
          ]}
        >
          <TouchableOpacity
            style={styles.headerBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            onPress={() => router.push('/explorer')}
          >
            <MaterialCommunityIcons name="menu" size={24} color={theme.texto} />
          </TouchableOpacity>

          <Text style={[styles.emptyHeaderTitle, { color: theme.texto }]}>
            GaboScript IDE
          </Text>

          <View style={styles.headerBtn} />
        </View>

        {/* Welcome / Empty State */}
        <View style={styles.emptyState}>
          {/* GaboScript GS Logo */}
          <View style={[styles.logoBox, { backgroundColor: theme.superficie, borderColor: theme.borde }]}>
            <GaboFileIcon size={38} color={theme.acento} />
          </View>

          <Text style={[styles.welcomeTitle, { color: theme.texto }]}>
            Bienvenido a GaboScript
          </Text>

          {/* Firma del creador */}
          <Text style={[styles.authorCredit, { color: theme.acento }]}>
            by Carlos Antón
          </Text>

          <Text style={[styles.welcomeSubtitle, { color: theme.textoSecundario }]}>
            Editor móvil de algoritmos académicos
          </Text>

          {/* Carpeta de trabajo activa */}
          {workspaceName && (
            <View style={[styles.workspaceBadge, { backgroundColor: theme.lineaActiva, borderColor: theme.borde }]}>
              <MaterialCommunityIcons name="folder-outline" size={16} color={theme.acento} />
              <Text style={[styles.workspaceBadgeText, { color: theme.texto }]} numberOfLines={1}>
                {workspaceName}
              </Text>
            </View>
          )}

          {/* Primary Action: Crear nuevo archivo */}
          <TouchableOpacity
            style={[styles.ctaBtn, { backgroundColor: theme.acento }]}
            activeOpacity={0.85}
            onPress={handleRequestNewFile}
          >
            <MaterialCommunityIcons
              name="file-plus"
              size={20}
              color={theme.textoSobreAcento}
            />
            <Text style={[styles.ctaBtnText, { color: theme.textoSobreAcento }]}>
              Crear nuevo archivo
            </Text>
          </TouchableOpacity>

          {/* Secondary Action: Abrir archivo / Seleccionar carpeta */}
          <TouchableOpacity
            style={[
              styles.ctaBtnSecondary,
              { backgroundColor: theme.superficie, borderColor: theme.borde },
            ]}
            activeOpacity={0.8}
            onPress={handleOpenWorkspaceOrExplorer}
          >
            <MaterialCommunityIcons
              name={workspaceUri ? 'folder-open-outline' : 'folder-plus-outline'}
              size={20}
              color={theme.texto}
            />
            <Text style={[styles.ctaBtnTextSecondary, { color: theme.texto }]}>
              {workspaceUri ? 'Abrir explorador de archivos' : 'Seleccionar carpeta de trabajo'}
            </Text>
          </TouchableOpacity>

          {/* Archivos recientes en la carpeta */}
          {files.length > 0 && (
            <View style={styles.recentSection}>
              <Text style={[styles.recentTitle, { color: theme.textoSecundario }]}>
                ARCHIVOS EN LA CARPETA
              </Text>
              {files.slice(0, 5).map((file) => (
                <TouchableOpacity
                  key={file.id}
                  style={[styles.recentItem, { borderBottomColor: theme.borde }]}
                  activeOpacity={0.7}
                  onPress={() => openFile(file.id)}
                >
                  <GaboFileIcon size={16} color={theme.acento} />
                  <Text style={[styles.recentItemText, { color: theme.texto }]} numberOfLines={1}>
                    {file.name.replace(/\.(gabo|txt)$/i, '')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Modal: New File */}
        <Modal
          visible={showNewFileModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowNewFileModal(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowNewFileModal(false)}
          >
            <View
              style={[
                styles.dialogCard,
                { backgroundColor: theme.superficie, borderColor: theme.borde },
              ]}
            >
              <Text style={[styles.dialogTitle, { color: theme.texto }]}>
                Nuevo archivo GaboScript
              </Text>
              <Text style={[styles.dialogSubtitle, { color: theme.textoSecundario }]}>
                Ingresa el nombre del archivo
              </Text>
              <TextInput
                style={[
                  styles.dialogInput,
                  {
                    backgroundColor: theme.lineaActiva,
                    borderColor: theme.borde,
                    color: theme.texto,
                  },
                ]}
                placeholder="nombre_archivo"
                placeholderTextColor={theme.textoSecundario}
                value={newFileName}
                onChangeText={setNewFileName}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleCreateFileSubmit}
              />
              <View style={styles.dialogActions}>
                <TouchableOpacity
                  style={[styles.dialogBtn, { borderColor: theme.borde }]}
                  onPress={() => setShowNewFileModal(false)}
                >
                  <Text style={{ color: theme.textoSecundario }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.dialogBtn, { backgroundColor: theme.acento }]}
                  onPress={handleCreateFileSubmit}
                >
                  <Text style={{ color: theme.textoSobreAcento, fontWeight: '600' }}>
                    Crear
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  }

  // ---- EDITOR VIEW (cuando hay archivo abierto) ----
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.fondo,
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Top Header Bar */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: theme.fondo,
              borderBottomColor: theme.borde,
            },
          ]}
        >
          {/* Left: Menu button */}
          <TouchableOpacity
            style={styles.headerBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            onPress={() => router.push('/explorer')}
          >
            <MaterialCommunityIcons name="menu" size={24} color={theme.texto} />
          </TouchableOpacity>

          {/* Espaciador central */}
          <View style={{ flex: 1 }} />

          {/* Right Actions: Undo, Redo, Format, Exportar Word (.docx), Run */}
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerBtn}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              activeOpacity={0.7}
              onPress={() => editorRef.current?.undo()}
            >
              <MaterialCommunityIcons
                name="undo"
                size={21}
                color={theme.textoSecundario}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerBtn}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              activeOpacity={0.7}
              onPress={() => editorRef.current?.redo()}
            >
              <MaterialCommunityIcons
                name="redo"
                size={21}
                color={theme.textoSecundario}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerBtn}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              activeOpacity={0.7}
              onPress={handleFormatCode}
            >
              <MaterialCommunityIcons
                name="format-indent-increase"
                size={21}
                color={theme.textoSecundario}
              />
            </TouchableOpacity>

            {/* Exportar directamente a Word (.docx) sin menú intermedio */}
            <TouchableOpacity
              style={styles.headerBtn}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              activeOpacity={0.7}
              onPress={handleExportDocx}
            >
              <MaterialCommunityIcons
                name="file-word-box"
                size={22}
                color={theme.acento}
              />
            </TouchableOpacity>

            {/* Circular Run Button */}
            <TouchableOpacity
              style={[
                styles.runBtn,
                {
                  backgroundColor: theme.acento,
                  shadowColor: theme.acento,
                },
              ]}
              activeOpacity={0.8}
              onPress={handleRunCode}
            >
              <MaterialCommunityIcons
                name="play"
                size={20}
                color={theme.textoSobreAcento}
                style={{ marginLeft: 2 }}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Pestañas de archivos abiertos (con nombres limpios sin extensión) */}
        <FileTabs />

        {/* Componente del Editor con Scroll Horizontal y Sin Word Wrap */}
        <View style={styles.editorArea}>
          <CodeEditor
            ref={editorRef}
            value={activeFile.content}
            onChangeText={(text) => updateFileContent(activeFile.id, text)}
          />
        </View>

        {/* Terminal interactiva de ejecución */}
        <OutputPanel
          logs={logs}
          isExpanded={isOutputExpanded}
          onToggleExpand={() => setIsOutputExpanded((prev) => !prev)}
          onClear={() => setLogs([])}
          isRunning={isRunning}
          onStop={handleStopCode}
          waitingForInput={waitingForInput}
          onSubmitInput={handleSubmitInput}
        />

        {/* Barra de atajos y símbolos encima del teclado en orden estricto */}
        <AccessoryBar
          onInsertText={handleInsertSnippet}
          onInsertTab={handleInsertTab}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardContainer: {
    flex: 1,
  },
  header: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  runBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  editorArea: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logoBox: {
    width: 72,
    height: 72,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  authorCredit: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 10,
    textAlign: 'center',
  },
  welcomeSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  workspaceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 24,
  },
  workspaceBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 10,
    marginBottom: 12,
    width: '100%',
    maxWidth: 290,
    justifyContent: 'center',
  },
  ctaBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  ctaBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 28,
    width: '100%',
    maxWidth: 290,
    justifyContent: 'center',
  },
  ctaBtnTextSecondary: {
    fontSize: 14,
    fontWeight: '500',
  },
  recentSection: {
    width: '100%',
    maxWidth: 290,
    marginTop: 8,
  },
  recentTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  recentItemText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 14,
    borderWidth: 1,
    padding: 20,
  },
  dialogTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  dialogSubtitle: {
    fontSize: 13,
    marginBottom: 16,
  },
  dialogInput: {
    height: 42,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 18,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  dialogBtn: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
});
