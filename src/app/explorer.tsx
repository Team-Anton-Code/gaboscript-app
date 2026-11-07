import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    BackHandler,
    Dimensions,
    Easing,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GaboFileIcon from '../components/GaboFileIcon';
import { useFiles } from '../context/FileContext';
import { GaboFile, GaboFolder } from '../services/storage';
import { useAppTheme } from '../theme/ThemeContext';
import { exportToDocx } from '../utils/exporter';

function formatFileDate(timestamp: number, sizeBytes: number) {
  const kb = (sizeBytes / 1024).toFixed(1);
  const diffHours = (Date.now() - timestamp) / (1000 * 3600);
  let timeStr = 'hoy';
  if (diffHours >= 24 && diffHours < 48) timeStr = 'ayer';
  else if (diffHours >= 48) timeStr = `${Math.floor(diffHours / 24)} días`;
  return `${kb} KB · ${timeStr}`;
}

export default function ExplorerScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const screenWidth = Dimensions.get('window').width;
  const slideX = useRef(new Animated.Value(-screenWidth)).current;
  const isClosingRef = useRef(false);

  // Animación suave de entrada: deslizar de izquierda a derecha (slide right)
  useEffect(() => {
    Animated.timing(slideX, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideX]);

  // Animación suave de salida: deslizar de derecha a izquierda (slide left)
  const handleClose = (callback?: () => void) => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.timing(slideX, {
      toValue: -screenWidth,
      duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (callback) callback();
      router.back();
    });
  };
  const {
    files,
    folders,
    activeFileId,
    currentFolderId,
    workspaceUri,
    workspaceName,
    setCurrentFolderId,
    navigateUp,
    pickWorkspaceFolder,
    openFile,
    createFile,
    renameFile,
    moveFile,
    deleteFile,
    createFolder,
    renameFolder,
    deleteFolder,
    duplicateFile,
  } = useFiles();

  // Hardware back button en Android: navegar arriba en carpetas o cerrar con animación suave
  useEffect(() => {
    const onBackPress = () => {
      if (currentFolderId) {
        navigateUp();
      } else {
        handleClose();
      }
      return true;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [currentFolderId, navigateUp]);

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');

  // Action sheet / options modal for file or folder
  const [selectedFile, setSelectedFile] = useState<GaboFile | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<GaboFolder | null>(null);
  const [showFileOptions, setShowFileOptions] = useState(false);
  const [showFolderOptions, setShowFolderOptions] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTargetName, setRenameTargetName] = useState('');
  const [showMoveModal, setShowMoveModal] = useState(false);

  // Current folder object
  const currentFolder = useMemo(
    () => (currentFolderId ? folders.find((f) => f.id === currentFolderId) || null : null),
    [folders, currentFolderId]
  );

  // Breadcrumbs path calculation for multi-level hierarchical navigation
  const breadcrumbs = useMemo(() => {
    const crumbs: { id: string | null; name: string }[] = [
      { id: null, name: workspaceName || 'Raíz' },
    ];
    if (!currentFolderId) return crumbs;

    const path: { id: string; name: string }[] = [];
    let curr: GaboFolder | undefined = folders.find((f) => f.id === currentFolderId);
    while (curr) {
      path.unshift({ id: curr.id, name: curr.name });
      curr = curr.folderId ? folders.find((f) => f.id === curr?.folderId) : undefined;
    }
    return [...crumbs, ...path];
  }, [folders, currentFolderId, workspaceName]);

  // Filtered folders and files
  // Hierarchical rule: Carpetas FIRST (arriba), Archivos SECOND (abajo)
  const displayedFolders = useMemo(() => {
    let list = folders.filter((f) => f.folderId === currentFolderId);
    if (searchQuery.trim()) {
      list = folders.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return list;
  }, [folders, currentFolderId, searchQuery]);

  const displayedFiles = useMemo(() => {
    let list = files.filter((f) => f.folderId === currentFolderId);
    if (searchQuery.trim()) {
      list = files.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    return list;
  }, [files, currentFolderId, searchQuery]);

  // Actions
  const handleOpenFile = (fileId: string) => {
    openFile(fileId);
    handleClose();
  };

  // Enforce mandatory workspace before creating any file
  const handleRequestCreateFile = async () => {
    if (!workspaceUri) {
      Alert.alert(
        'Carpeta de trabajo requerida',
        'NO se permite crear ningún archivo sin que hayas seleccionado previamente una carpeta destino en el almacenamiento de tu teléfono.',
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

  // Enforce mandatory workspace before creating any folder
  const handleRequestCreateFolder = async () => {
    if (!workspaceUri) {
      Alert.alert(
        'Carpeta de trabajo requerida',
        'NO se permite crear ninguna carpeta sin que hayas seleccionado previamente una carpeta destino en el almacenamiento de tu teléfono.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Seleccionar carpeta',
            onPress: async () => {
              const selected = await pickWorkspaceFolder();
              if (selected) {
                setShowNewFolderModal(true);
              }
            },
          },
        ]
      );
      return;
    }
    setShowNewFolderModal(true);
  };

  const handleCreateFileSubmit = async () => {
    if (!newFileName.trim()) return;
    try {
      await createFile(newFileName.trim(), currentFolderId);
      setNewFileName('');
      setShowNewFileModal(false);
      handleClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear archivo';
      Alert.alert('Error', msg);
    }
  };

  const handleCreateFolderSubmit = async () => {
    if (!newFolderName.trim()) return;
    try {
      await createFolder(newFolderName.trim(), currentFolderId);
      setNewFolderName('');
      setShowNewFolderModal(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear carpeta';
      Alert.alert('Error', msg);
    }
  };

  const handleRenameSubmit = async () => {
    if (!renameTargetName.trim()) return;
    if (selectedFile) {
      await renameFile(selectedFile.id, renameTargetName.trim());
    } else if (selectedFolder) {
      await renameFolder(selectedFolder.id, renameTargetName.trim());
    }
    setShowRenameModal(false);
    setSelectedFile(null);
    setSelectedFolder(null);
  };

  const handleDeleteFile = (file: GaboFile) => {
    const cleanName = file.name.replace(/\.(gabo|txt)$/i, '');
    Alert.alert('Eliminar archivo', `¿Deseas eliminar permanentemente "${cleanName}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await deleteFile(file.id);
          setShowFileOptions(false);
        },
      },
    ]);
  };

  const handleDeleteFolder = (folder: GaboFolder) => {
    Alert.alert(
      'Eliminar carpeta',
      `¿Deseas eliminar "${folder.name}" y mover sus archivos a la raíz?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            await deleteFolder(folder.id);
            setShowFolderOptions(false);
          },
        },
      ]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <Animated.View
        style={[
          styles.safeArea,
          {
            backgroundColor: theme.fondo,
            transform: [{ translateX: slideX }],
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        {/* Top Header Bar: Se elimina el icono de tres puntos (...). Únicamente queda el botón de Tema */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: theme.fondo,
              borderBottomColor: theme.borde,
            },
          ]}
        >
          <TouchableOpacity
            style={styles.headerBtn}
            activeOpacity={0.7}
            onPress={() => {
              if (currentFolderId) {
                navigateUp();
              } else {
                handleClose();
              }
            }}
          >
          <MaterialCommunityIcons
            name="chevron-left"
            size={28}
            color={theme.texto}
          />
        </TouchableOpacity>

        <Text style={[styles.headerTitle, { color: theme.texto }]} numberOfLines={1}>
          {currentFolder ? currentFolder.name : workspaceName || 'Mis programas'}
        </Text>

        {/* Botón único de Tema en la cabecera */}
        <TouchableOpacity
          style={styles.headerBtn}
          activeOpacity={0.7}
          onPress={() => router.push('/settings')}
        >
          <MaterialCommunityIcons
            name="palette-outline"
            size={24}
            color={theme.texto}
          />
        </TouchableOpacity>
      </View>

      {/* Workspace Selection Banner / Status Bar */}
      {workspaceUri ? (
        <View
          style={[
            styles.workspaceInfoBar,
            { backgroundColor: theme.lineaActiva, borderBottomColor: theme.borde },
          ]}
        >
          <MaterialCommunityIcons name="folder-check" size={18} color={theme.acento} />
          <Text style={[styles.workspaceInfoText, { color: theme.texto }]} numberOfLines={1}>
            Carpeta: <Text style={{ fontWeight: '700' }}>{workspaceName}</Text>
          </Text>
          <TouchableOpacity
            style={styles.changeWorkspaceBtn}
            activeOpacity={0.7}
            onPress={pickWorkspaceFolder}
          >
            <Text style={[styles.changeWorkspaceText, { color: theme.acento }]}>
              Cambiar
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[
            styles.workspaceAlertBanner,
            { backgroundColor: theme.lineaActiva, borderColor: theme.acento },
          ]}
          activeOpacity={0.8}
          onPress={pickWorkspaceFolder}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={22} color={theme.acento} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.workspaceAlertTitle, { color: theme.texto }]}>
              Selecciona tu carpeta de trabajo
            </Text>
            <Text style={[styles.workspaceAlertSubtitle, { color: theme.textoSecundario }]}>
              Requerido para crear y gestionar archivos .gabo en tu dispositivo
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={theme.acento} />
        </TouchableOpacity>
      )}

      {/* Breadcrumb Navigation for Hierarchical Multilevel Explorer */}
      {breadcrumbs.length > 1 && (
        <View style={styles.breadcrumbWrapper}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.breadcrumbContent}>
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <React.Fragment key={`${crumb.id || 'root'}-${idx}`}>
                    {idx > 0 && (
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={16}
                        color={theme.textoSecundario}
                      />
                    )}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      disabled={isLast}
                      onPress={() => setCurrentFolderId(crumb.id)}
                    >
                      <Text
                        style={[
                          styles.breadcrumbText,
                          {
                            color: isLast ? theme.texto : theme.acento,
                            fontWeight: isLast ? '700' : '500',
                          },
                        ]}
                      >
                        {crumb.name}
                      </Text>
                    </TouchableOpacity>
                  </React.Fragment>
                );
              })}
            </View>
          </ScrollView>
        </View>
      )}

      {/* Search Input Bar */}
      <View style={styles.searchWrapper}>
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: theme.superficie,
              borderColor: theme.borde,
            },
          ]}
        >
          <MaterialCommunityIcons
            name="magnify"
            size={20}
            color={theme.textoSecundario}
          />
          <TextInput
            style={[styles.searchInput, { color: theme.texto }]}
            placeholder="Buscar archivos o carpetas"
            placeholderTextColor={theme.textoSecundario}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <MaterialCommunityIcons
                name="close-circle"
                size={18}
                color={theme.textoSecundario}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Main List Area: Hierarchical (Carpetas first, Archivos second) */}
      <ScrollView
        style={styles.listContainer}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {/* CARPETAS SECTION (Always top) */}
        {displayedFolders.length > 0 && (
          <View style={styles.section}>
            <Text
              style={[styles.sectionTitle, { color: theme.textoSecundario }]}
            >
              CARPETAS
            </Text>

            {displayedFolders.map((folder) => {
              const childCount = files.filter(
                (f) => f.folderId === folder.id
              ).length;

              return (
                <TouchableOpacity
                  key={folder.id}
                  style={[
                    styles.rowItem,
                    {
                      backgroundColor: theme.superficie,
                      borderColor: theme.borde,
                    },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => setCurrentFolderId(folder.id)}
                >
                  <View style={styles.rowLeft}>
                    {/* Folder Icon exactly 20x20 */}
                    <MaterialCommunityIcons
                      name="folder"
                      size={20}
                      color={theme.acento}
                    />
                    <View style={styles.rowInfo}>
                      <Text
                        style={[styles.rowTitle, { color: theme.texto }]}
                        numberOfLines={1}
                      >
                        {folder.name}
                      </Text>
                      <Text
                        style={[
                          styles.rowSubtitle,
                          { color: theme.textoSecundario },
                        ]}
                      >
                        {childCount} {childCount === 1 ? 'elemento' : 'elementos'}
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.moreBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => {
                      setSelectedFolder(folder);
                      setShowFolderOptions(true);
                    }}
                  >
                    <MaterialCommunityIcons
                      name="dots-vertical"
                      size={20}
                      color={theme.textoSecundario}
                    />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ARCHIVOS SECTION (Always bottom) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textoSecundario }]}>
            ARCHIVOS
          </Text>

          {displayedFiles.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={{ color: theme.textoSecundario }}>
                {displayedFolders.length === 0
                  ? 'No hay archivos ni carpetas aquí.'
                  : 'No hay archivos en esta carpeta.'}
              </Text>
            </View>
          ) : (
            displayedFiles.map((file) => {
              const isActive = file.id === activeFileId;
              const fileSizeBytes = new Blob([file.content]).size;

              return (
                <TouchableOpacity
                  key={file.id}
                  style={[
                    styles.rowItem,
                    isActive && styles.rowItemActive,
                    {
                      backgroundColor: isActive
                        ? theme.lineaActiva
                        : theme.superficie,
                      borderColor: isActive ? theme.acento : theme.borde,
                    },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => handleOpenFile(file.id)}
                >
                  <View style={styles.rowLeft}>
                    {/* GaboFileIcon exactly 20x20 matching folder icon */}
                    <GaboFileIcon
                      size={20}
                      color={isActive ? theme.texto : theme.acento}
                    />
                    <View style={styles.rowInfo}>
                      <Text
                        style={[
                          styles.rowTitle,
                          {
                            color: theme.texto,
                            fontWeight: isActive ? '700' : '600',
                          },
                        ]}
                        numberOfLines={1}
                      >
                        {file.name.replace(/\.(gabo|txt)$/i, '')}
                      </Text>
                      <Text
                        style={[
                          styles.rowSubtitle,
                          {
                            color: isActive
                              ? theme.acentoVariante || theme.acento
                              : theme.textoSecundario,
                          },
                        ]}
                      >
                        {isActive
                          ? 'Abierto en el editor'
                          : formatFileDate(file.updatedAt, fileSizeBytes)}
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.moreBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => {
                      setSelectedFile(file);
                      setShowFileOptions(true);
                    }}
                  >
                    <MaterialCommunityIcons
                      name="dots-vertical"
                      size={20}
                      color={theme.textoSecundario}
                    />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Bottom Action Buttons: Se retira el signo '+' del texto ya que tiene icono */}
      <View
        style={[
          styles.bottomActions,
          {
            backgroundColor: theme.fondo,
            borderTopColor: theme.borde,
          },
        ]}
      >
        {/* Nuevo archivo (Solid button in Accent color) */}
        <TouchableOpacity
          style={[
            styles.bottomBtn,
            styles.primaryBottomBtn,
            { backgroundColor: theme.acento },
          ]}
          activeOpacity={0.8}
          onPress={handleRequestCreateFile}
        >
          <MaterialCommunityIcons
            name="plus"
            size={20}
            color={theme.textoSobreAcento}
          />
          <Text
            style={[
              styles.primaryBtnText,
              { color: theme.textoSobreAcento },
            ]}
          >
            Nuevo archivo
          </Text>
        </TouchableOpacity>

        {/* Nueva carpeta (Secondary button with border) */}
        <TouchableOpacity
          style={[
            styles.bottomBtn,
            styles.secondaryBottomBtn,
            {
              backgroundColor: theme.superficie,
              borderColor: theme.borde,
            },
          ]}
          activeOpacity={0.8}
          onPress={handleRequestCreateFolder}
        >
          <Text style={[styles.secondaryBtnText, { color: theme.texto }]}>
            Nueva carpeta
          </Text>
        </TouchableOpacity>
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
              {
                backgroundColor: theme.superficie,
                borderColor: theme.borde,
              },
            ]}
          >
            <Text style={[styles.dialogTitle, { color: theme.texto }]}>
              Nuevo archivo GaboScript
            </Text>
            <Text style={[styles.dialogSubtitle, { color: theme.textoSecundario }]}>
              Guardando en:{' '}
              <Text style={{ fontWeight: '600', color: theme.texto }}>
                {currentFolder ? currentFolder.name : workspaceName || 'Carpeta de trabajo'}
              </Text>
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
              placeholder="nombre_archivo.gabo"
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
                <Text
                  style={{ color: theme.textoSobreAcento, fontWeight: '600' }}
                >
                  Crear
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal: New Folder */}
      <Modal
        visible={showNewFolderModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNewFolderModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowNewFolderModal(false)}
        >
          <View
            style={[
              styles.dialogCard,
              {
                backgroundColor: theme.superficie,
                borderColor: theme.borde,
              },
            ]}
          >
            <Text style={[styles.dialogTitle, { color: theme.texto }]}>
              Nueva carpeta
            </Text>
            <Text style={[styles.dialogSubtitle, { color: theme.textoSecundario }]}>
              Ubicación:{' '}
              <Text style={{ fontWeight: '600', color: theme.texto }}>
                {currentFolder ? currentFolder.name : workspaceName || 'Raíz'}
              </Text>
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
              placeholder="nombre_carpeta"
              placeholderTextColor={theme.textoSecundario}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleCreateFolderSubmit}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogBtn, { borderColor: theme.borde }]}
                onPress={() => setShowNewFolderModal(false)}
              >
                <Text style={{ color: theme.textoSecundario }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, { backgroundColor: theme.acento }]}
                onPress={handleCreateFolderSubmit}
              >
                <Text
                  style={{ color: theme.textoSobreAcento, fontWeight: '600' }}
                >
                  Crear
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal: File Options Sheet */}
      <Modal
        visible={showFileOptions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFileOptions(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFileOptions(false)}
        >
          <View
            style={[
              styles.sheetCard,
              {
                backgroundColor: theme.superficie,
                borderColor: theme.borde,
              },
            ]}
          >
            <Text style={[styles.sheetTitle, { color: theme.texto }]}>
              {selectedFile?.name.replace(/\.(gabo|txt)$/i, '')}
            </Text>

            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => {
                if (selectedFile) handleOpenFile(selectedFile.id);
                setShowFileOptions(false);
              }}
            >
              <MaterialCommunityIcons
                name="file-code"
                size={22}
                color={theme.acento}
              />
              <Text style={[styles.sheetItemText, { color: theme.texto }]}>
                Abrir en el editor
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => {
                if (selectedFile) {
                  setRenameTargetName(selectedFile.name.replace(/\.(gabo|txt)$/i, ''));
                  setShowFileOptions(false);
                  setShowRenameModal(true);
                }
              }}
            >
              <MaterialCommunityIcons
                name="pencil"
                size={22}
                color={theme.textoSecundario}
              />
              <Text style={[styles.sheetItemText, { color: theme.texto }]}>
                Renombrar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetItem}
              onPress={async () => {
                if (selectedFile) {
                  await duplicateFile(selectedFile.id);
                  setShowFileOptions(false);
                }
              }}
            >
              <MaterialCommunityIcons
                name="content-copy"
                size={22}
                color={theme.textoSecundario}
              />
              <Text style={[styles.sheetItemText, { color: theme.texto }]}>
                Duplicar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => {
                setShowFileOptions(false);
                setShowMoveModal(true);
              }}
            >
              <MaterialCommunityIcons
                name="folder-move"
                size={22}
                color={theme.textoSecundario}
              />
              <Text style={[styles.sheetItemText, { color: theme.texto }]}>
                Mover a carpeta
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetItem}
              onPress={async () => {
                setShowFileOptions(false);
                if (selectedFile) {
                  await exportToDocx(selectedFile);
                }
              }}
            >
              <MaterialCommunityIcons
                name="file-word-box"
                size={22}
                color={theme.acento}
              />
              <Text style={[styles.sheetItemText, { color: theme.texto }]}>
                Exportar a Word (.docx)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: theme.borde }]}
              onPress={() => {
                if (selectedFile) handleDeleteFile(selectedFile);
              }}
            >
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={22}
                color={theme.error}
              />
              <Text style={[styles.sheetItemText, { color: theme.error }]}>
                Eliminar archivo
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal: Folder Options Sheet */}
      <Modal
        visible={showFolderOptions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFolderOptions(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFolderOptions(false)}
        >
          <View
            style={[
              styles.sheetCard,
              {
                backgroundColor: theme.superficie,
                borderColor: theme.borde,
              },
            ]}
          >
            <Text style={[styles.sheetTitle, { color: theme.texto }]}>
              Carpeta: {selectedFolder?.name}
            </Text>

            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => {
                if (selectedFolder) {
                  setCurrentFolderId(selectedFolder.id);
                  setShowFolderOptions(false);
                }
              }}
            >
              <MaterialCommunityIcons
                name="folder-open"
                size={22}
                color={theme.acento}
              />
              <Text style={[styles.sheetItemText, { color: theme.texto }]}>
                Abrir carpeta
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => {
                if (selectedFolder) {
                  setRenameTargetName(selectedFolder.name);
                  setShowFolderOptions(false);
                  setShowRenameModal(true);
                }
              }}
            >
              <MaterialCommunityIcons
                name="pencil"
                size={22}
                color={theme.textoSecundario}
              />
              <Text style={[styles.sheetItemText, { color: theme.texto }]}>
                Renombrar carpeta
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sheetItem, { borderTopWidth: 1, borderTopColor: theme.borde }]}
              onPress={() => {
                if (selectedFolder) handleDeleteFolder(selectedFolder);
              }}
            >
              <MaterialCommunityIcons
                name="trash-can-outline"
                size={22}
                color={theme.error}
              />
              <Text style={[styles.sheetItemText, { color: theme.error }]}>
                Eliminar carpeta
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal: Rename */}
      <Modal
        visible={showRenameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRenameModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowRenameModal(false)}
        >
          <View
            style={[
              styles.dialogCard,
              {
                backgroundColor: theme.superficie,
                borderColor: theme.borde,
              },
            ]}
          >
            <Text style={[styles.dialogTitle, { color: theme.texto }]}>
              Renombrar
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
              value={renameTargetName}
              onChangeText={setRenameTargetName}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleRenameSubmit}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={[styles.dialogBtn, { borderColor: theme.borde }]}
                onPress={() => setShowRenameModal(false)}
              >
                <Text style={{ color: theme.textoSecundario }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, { backgroundColor: theme.acento }]}
                onPress={handleRenameSubmit}
              >
                <Text
                  style={{ color: theme.textoSobreAcento, fontWeight: '600' }}
                >
                  Guardar
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal: Move file to folder */}
      <Modal
        visible={showMoveModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMoveModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMoveModal(false)}
        >
          <View
            style={[
              styles.dialogCard,
              {
                backgroundColor: theme.superficie,
                borderColor: theme.borde,
              },
            ]}
          >
            <Text style={[styles.dialogTitle, { color: theme.texto }]}>
              Mover a...
            </Text>

            <TouchableOpacity
              style={[
                styles.moveTargetItem,
                {
                  backgroundColor: theme.lineaActiva,
                  borderColor: theme.borde,
                },
              ]}
              onPress={() => {
                if (selectedFile) moveFile(selectedFile.id, null);
                setShowMoveModal(false);
              }}
            >
              <MaterialCommunityIcons
                name="folder-home"
                size={22}
                color={theme.acento}
              />
              <Text style={{ color: theme.texto, fontWeight: '600' }}>
                Raíz ({workspaceName || 'Carpeta de trabajo'})
              </Text>
            </TouchableOpacity>

            {folders.map((f) => (
              <TouchableOpacity
                key={f.id}
                style={[
                  styles.moveTargetItem,
                  {
                    backgroundColor: theme.lineaActiva,
                    borderColor: theme.borde,
                  },
                ]}
                onPress={() => {
                  if (selectedFile) moveFile(selectedFile.id, f.id);
                  setShowMoveModal(false);
                }}
              >
                <MaterialCommunityIcons
                  name="folder"
                  size={20}
                  color={theme.acento}
                />
                <Text style={{ color: theme.texto }}>{f.name}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[
                styles.dialogBtn,
                { borderColor: theme.borde, marginTop: 10 },
              ]}
              onPress={() => setShowMoveModal(false)}
            >
              <Text style={{ color: theme.textoSecundario }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
  },
  headerBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
    paddingHorizontal: 4,
  },
  workspaceInfoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  workspaceInfoText: {
    fontSize: 13,
    flex: 1,
  },
  changeWorkspaceBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  changeWorkspaceText: {
    fontSize: 13,
    fontWeight: '600',
  },
  workspaceAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 12,
  },
  workspaceAlertTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  workspaceAlertSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  breadcrumbWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  breadcrumbContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breadcrumbText: {
    fontSize: 13,
  },
  searchWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 20,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 56,
  },
  rowItemActive: {
    borderWidth: 1.5,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
  },
  rowSubtitle: {
    fontSize: 12,
  },
  moreBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: -6,
  },
  emptyContainer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  bottomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  bottomBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryBottomBtn: {
    elevation: 2,
  },
  secondaryBottomBtn: {
    borderWidth: 1,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 10,
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  dialogSubtitle: {
    fontSize: 12,
    marginBottom: 4,
  },
  dialogInput: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 6,
  },
  dialogBtn: {
    minHeight: 40,
    paddingHorizontal: 18,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 6,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 12,
    paddingVertical: 8,
  },
  sheetItemText: {
    fontSize: 15,
  },
  moveTargetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    gap: 10,
    marginVertical: 4,
  },
});
