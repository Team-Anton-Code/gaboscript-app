import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { Platform, Alert, AppState, AppStateStatus } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  GaboFile,
  GaboFolder,
  initializeStorage,
  saveAllFiles,
  saveAllFolders,
  saveActiveFileId,
  saveOpenTabs,
  saveWorkspace,
} from '../services/storage';

interface FileContextValue {
  files: GaboFile[];
  folders: GaboFolder[];
  activeFile: GaboFile | null;
  activeFileId: string;
  openTabs: string[];
  currentFolderId: string | null;
  workspaceUri: string | null;
  workspaceName: string | null;
  setCurrentFolderId: (folderId: string | null) => void;
  setActiveFileId: (id: string) => void;
  openFile: (id: string) => void;
  closeTab: (id: string) => void;
  updateFileContent: (id: string, content: string) => void;
  createFile: (name: string, folderId: string | null, content?: string) => Promise<GaboFile>;
  renameFile: (id: string, newName: string) => Promise<void>;
  moveFile: (id: string, targetFolderId: string | null) => void;
  deleteFile: (id: string) => Promise<void>;
  createFolder: (name: string, folderId: string | null) => Promise<GaboFolder>;
  renameFolder: (id: string, newName: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  duplicateFile: (id: string) => Promise<GaboFile | null>;
  pickWorkspaceFolder: () => Promise<boolean>;
  clearWorkspace: () => Promise<void>;
  navigateUp: () => void;
  verifyWorkspaceExists: () => Promise<boolean>;
}

const FileContext = createContext<FileContextValue | null>(null);

function extractFolderName(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const parts = decoded.split(/[:/]/).filter(Boolean);
    const last = parts[parts.length - 1];
    return last || 'Carpeta de trabajo';
  } catch {
    return 'Carpeta de trabajo';
  }
}

/**
 * Calcula un nombre único incremental para evitar colisiones:
 * nombre.gabo -> nombre (1).gabo -> nombre (2).gabo
 */
function getAvailableFileName(
  desiredName: string,
  folderId: string | null,
  existingFiles: GaboFile[],
  excludeFileId?: string
): string {
  // Limpiar cualquier extensión previa (ej. .txt, .gabo, etc.)
  let base = desiredName.trim().replace(/\.[a-zA-Z0-9]+$/, '');
  if (!base) base = 'algoritmo';

  // Si ya contiene sufijo (N), extraer la raíz base
  const match = base.match(/^(.*?)(?: \((\d+)\))?$/);
  const rootName = match && match[1] ? match[1].trim() : base;

  const targetFolderFiles = existingFiles.filter(
    (f) => f.folderId === folderId && f.id !== excludeFileId
  );
  const existingNames = new Set(targetFolderFiles.map((f) => f.name.toLowerCase()));

  const candidate = `${rootName}.gabo`;
  if (!existingNames.has(candidate.toLowerCase())) {
    return candidate;
  }

  let counter = 1;
  while (existingNames.has(`${rootName.toLowerCase()} (${counter}).gabo`)) {
    counter++;
  }
  return `${rootName} (${counter}).gabo`;
}

export function FileProvider({ children }: { children: React.ReactNode }) {
  const [files, setFiles] = useState<GaboFile[]>([]);
  const [folders, setFolders] = useState<GaboFolder[]>([]);
  const [activeFileId, setActiveFileIdState] = useState<string>('');
  const [openTabs, setOpenTabsState] = useState<string[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [workspaceUri, setWorkspaceUri] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);

  // Validación de existencia física de la carpeta de trabajo
  const checkFolderPhysicallyExists = useCallback(async (uri: string | null): Promise<boolean> => {
    if (!uri) return false;
    try {
      if (Platform.OS === 'android' && uri.startsWith('content://')) {
        await FileSystem.StorageAccessFramework.readDirectoryAsync(uri);
        return true;
      } else if (uri.startsWith('file://')) {
        const info = await FileSystem.getInfoAsync(uri);
        return Boolean(info.exists && info.isDirectory);
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const clearWorkspace = useCallback(async () => {
    setWorkspaceUri(null);
    setWorkspaceName(null);
    setFiles([]);
    setFolders([]);
    setCurrentFolderId(null);
    setActiveFileIdState('');
    setOpenTabsState([]);
    await saveWorkspace(null, null);
    await saveAllFiles([]);
    await saveAllFolders([]);
    await saveActiveFileId('');
    await saveOpenTabs([]);
  }, []);


  const pickWorkspaceFolder = useCallback(async (): Promise<boolean> => {
    try {
      const permissions =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) return false;
      const uri = permissions.directoryUri;
      const name = extractFolderName(uri);
      setWorkspaceUri(uri);
      setWorkspaceName(name);
      await saveWorkspace(uri, name);
      return true;
    } catch (err) {
      console.warn('pickWorkspaceFolder error:', err);
      return false;
    }
  }, []);

  const verifyWorkspaceExists = useCallback(async (): Promise<boolean> => {
    if (!workspaceUri) return true;
    const exists = await checkFolderPhysicallyExists(workspaceUri);
    if (!exists) {
      await clearWorkspace();
      Alert.alert(
        'Carpeta no encontrada',
        'La carpeta de trabajo seleccionada previamente fue borrada o ya no es accesible. Selecciona una nueva carpeta para continuar.',
        [{ text: 'Seleccionar carpeta', onPress: () => { pickWorkspaceFolder(); } }]
      );
      return false;
    }
    return true;
  }, [workspaceUri, checkFolderPhysicallyExists, clearWorkspace, pickWorkspaceFolder]);

  // Inicialización y verificación de existencia al arrancar
  useEffect(() => {
    initializeStorage().then(async (data) => {
      let validWorkspace = data.workspaceUri;
      if (data.workspaceUri) {
        const exists = await checkFolderPhysicallyExists(data.workspaceUri);
        if (!exists) {
          validWorkspace = null;
          await saveWorkspace(null, null);
          Alert.alert(
            'Carpeta no encontrada',
            'La carpeta de trabajo fue borrada del dispositivo. Por favor selecciona una nueva carpeta para continuar.'
          );
        }
      }

      setWorkspaceUri(validWorkspace);
      setWorkspaceName(validWorkspace ? data.workspaceName : null);

      if (validWorkspace) {
        setFiles(data.files);
        setFolders(data.folders);
        setActiveFileIdState(data.activeFileId);
        setOpenTabsState(data.openTabs);
      } else {
        setFiles([]);
        setFolders([]);
        setActiveFileIdState('');
        setOpenTabsState([]);
      }
    });
  }, [checkFolderPhysicallyExists]);

  // Verificar si la carpeta fue borrada cuando la app vuelve a primer plano
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active' && workspaceUri) {
        verifyWorkspaceExists();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [workspaceUri, verifyWorkspaceExists]);

  // Si activeFileId tiene valor, encuentra el archivo; si no hay archivo abierto, activeFile es null
  const activeFile = useMemo(() => {
    if (!activeFileId) return null;
    return files.find((f) => f.id === activeFileId) || null;
  }, [files, activeFileId]);

  const setActiveFileId = useCallback((id: string) => {
    setActiveFileIdState(id);
    saveActiveFileId(id);
  }, []);

  const openFile = useCallback(
    (id: string) => {
      setActiveFileIdState(id);
      saveActiveFileId(id);
      setOpenTabsState((prev) => {
        if (!prev.includes(id)) {
          const next = [...prev, id];
          saveOpenTabs(next);
          return next;
        }
        return prev;
      });
    },
    []
  );

  const closeTab = useCallback(
    (id: string) => {
      setOpenTabsState((prev) => {
        const next = prev.filter((tabId) => tabId !== id);
        saveOpenTabs(next);
        if (activeFileId === id) {
          const remainingId = next[next.length - 1] || '';
          setActiveFileIdState(remainingId);
          saveActiveFileId(remainingId);
        }
        return next;
      });
    },
    [activeFileId]
  );

  const updateFileContent = useCallback((id: string, content: string) => {
    setFiles((prev) => {
      const updated = prev.map((f) => {
        if (f.id === id) {
          if (f.safUri) {
            if (Platform.OS === 'android' && f.safUri.startsWith('content://')) {
              FileSystem.StorageAccessFramework.writeAsStringAsync(f.safUri, content).catch(
                console.warn
              );
            } else if (f.safUri.startsWith('file://')) {
              FileSystem.writeAsStringAsync(f.safUri, content).catch(console.warn);
            }
          }
          return { ...f, content, updatedAt: Date.now() };
        }
        return f;
      });
      saveAllFiles(updated);
      return updated;
    });
  }, []);


  const navigateUp = useCallback(() => {
    if (!currentFolderId) return;
    const curr = folders.find((f) => f.id === currentFolderId);
    setCurrentFolderId(curr?.folderId || null);
  }, [currentFolderId, folders]);

  const createFile = useCallback(
    async (name: string, folderId: string | null, content = ''): Promise<GaboFile> => {
      if (!workspaceUri) {
        throw new Error('Debes seleccionar una carpeta de trabajo antes de crear archivos.');
      }

      // Requerimiento 4 & 5: Extensión .gabo obligatoria y resolución de nombres duplicados
      const finalName = getAvailableFileName(name, folderId, files);

      const fileContent =
        content ||
        `// ${finalName}\nAlgoritmo ${finalName.replace('.gabo', '')}\nInicio\n  Mostrar << "Hola GaboScript";\nFin`;

      let safUri: string | undefined;
      const parentFolder = folderId ? folders.find((f) => f.id === folderId) : null;
      const targetDirUri = parentFolder?.safUri || workspaceUri;

      if (Platform.OS === 'android' && targetDirUri && targetDirUri.startsWith('content://')) {
        try {
          const baseName = finalName.replace(/\.gabo$/, '');
          safUri = await FileSystem.StorageAccessFramework.createFileAsync(
            targetDirUri,
            baseName,
            'text/plain'
          );
          if (safUri) {
            await FileSystem.StorageAccessFramework.writeAsStringAsync(safUri, fileContent);
          }
        } catch (err) {
          console.warn('SAF createFile error:', err);
        }
      } else if (targetDirUri && targetDirUri.startsWith('file://')) {
        try {
          const cleanDir = targetDirUri.endsWith('/') ? targetDirUri : `${targetDirUri}/`;
          const filePath = `${cleanDir}${finalName}`;
          await FileSystem.writeAsStringAsync(filePath, fileContent);
          safUri = filePath;
        } catch (err) {
          console.warn('Local createFile error:', err);
        }
      }

      const newFile: GaboFile = {
        id: `file-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: finalName,
        folderId,
        content: fileContent,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        safUri,
      };

      setFiles((prev) => {
        const next = [...prev, newFile];
        saveAllFiles(next);
        return next;
      });

      openFile(newFile.id);
      return newFile;
    },
    [files, folders, openFile, workspaceUri]
  );

  const createFolder = useCallback(
    async (name: string, folderId: string | null): Promise<GaboFolder> => {
      if (!workspaceUri) {
        throw new Error('Debes seleccionar una carpeta de trabajo antes de crear carpetas.');
      }

      const trimmedName = name.trim();
      let safUri: string | undefined;
      const parentFolder = folderId ? folders.find((f) => f.id === folderId) : null;
      const targetDirUri = parentFolder?.safUri || workspaceUri;

      if (Platform.OS === 'android' && targetDirUri && targetDirUri.startsWith('content://')) {
        try {
          safUri = await FileSystem.StorageAccessFramework.makeDirectoryAsync(
            targetDirUri,
            trimmedName
          );
        } catch (err) {
          console.warn('SAF makeDirectory error:', err);
        }
      } else if (targetDirUri && targetDirUri.startsWith('file://')) {
        try {
          const cleanDir = targetDirUri.endsWith('/') ? targetDirUri : `${targetDirUri}/`;
          const dirPath = `${cleanDir}${trimmedName}/`;
          await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
          safUri = dirPath;
        } catch (err) {
          console.warn('Local makeDirectory error:', err);
        }
      }

      const newFolder: GaboFolder = {
        id: `folder-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: trimmedName,
        folderId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        safUri,
      };

      setFolders((prev) => {
        const next = [...prev, newFolder];
        saveAllFolders(next);
        return next;
      });

      return newFolder;
    },
    [folders, workspaceUri]
  );

  // Sincronización al renombrar: Renombra el archivo físico en el disco
  const renameFile = useCallback(
    async (id: string, newName: string) => {
      const target = files.find((f) => f.id === id);
      if (!target) return;

      const finalName = getAvailableFileName(newName, target.folderId, files, id);
      if (finalName === target.name) return;

      let updatedSafUri = target.safUri;

      if (target.safUri) {
        if (Platform.OS === 'android' && target.safUri.startsWith('content://')) {
          try {
            const parentFolder = target.folderId ? folders.find((f) => f.id === target.folderId) : null;
            const targetDirUri = parentFolder?.safUri || workspaceUri;
            if (targetDirUri) {
              const baseName = finalName.replace(/\.gabo$/, '');
              const newSafUri = await FileSystem.StorageAccessFramework.createFileAsync(
                targetDirUri,
                baseName,
                'text/plain'
              );
              if (newSafUri) {
                await FileSystem.StorageAccessFramework.writeAsStringAsync(newSafUri, target.content);
                await FileSystem.StorageAccessFramework.deleteAsync(target.safUri);
                updatedSafUri = newSafUri;
              }
            }
          } catch (e) {
            console.warn('Error renombrando en SAF:', e);
          }
        } else if (target.safUri.startsWith('file://')) {
          try {
            const parentDir = target.safUri.substring(0, target.safUri.lastIndexOf('/') + 1);
            const newPath = `${parentDir}${finalName}`;
            await FileSystem.moveAsync({ from: target.safUri, to: newPath });
            updatedSafUri = newPath;
          } catch (e) {
            console.warn('Error renombrando archivo local:', e);
          }
        }
      }

      setFiles((prev) => {
        const next = prev.map((f) =>
          f.id === id ? { ...f, name: finalName, safUri: updatedSafUri, updatedAt: Date.now() } : f
        );
        saveAllFiles(next);
        return next;
      });
    },
    [files, folders, workspaceUri]
  );

  const moveFile = useCallback((id: string, targetFolderId: string | null) => {
    setFiles((prev) => {
      const next = prev.map((f) =>
        f.id === id ? { ...f, folderId: targetFolderId, updatedAt: Date.now() } : f
      );
      saveAllFiles(next);
      return next;
    });
  }, []);

  const deleteFile = useCallback(
    async (id: string) => {
      const target = files.find((f) => f.id === id);
      if (target?.safUri) {
        try {
          if (Platform.OS === 'android' && target.safUri.startsWith('content://')) {
            await FileSystem.StorageAccessFramework.deleteAsync(target.safUri);
          } else if (target.safUri.startsWith('file://')) {
            await FileSystem.deleteAsync(target.safUri);
          }
        } catch (err) {
          console.warn('Error eliminando archivo físico:', err);
        }
      }

      setFiles((prev) => {
        const next = prev.filter((f) => f.id !== id);
        saveAllFiles(next);
        return next;
      });
      closeTab(id);
    },
    [closeTab, files]
  );

  const duplicateFile = useCallback(
    async (id: string): Promise<GaboFile | null> => {
      const source = files.find((f) => f.id === id);
      if (!source) return null;

      const baseName = source.name.replace(/\.gabo$/, '');
      return await createFile(`${baseName}_copia`, source.folderId, source.content);
    },
    [createFile, files]
  );

  const renameFolder = useCallback(async (id: string, newName: string) => {
    setFolders((prev) => {
      const next = prev.map((f) =>
        f.id === id ? { ...f, name: newName.trim(), updatedAt: Date.now() } : f
      );
      saveAllFolders(next);
      return next;
    });
  }, []);

  const deleteFolder = useCallback(
    async (id: string) => {
      const target = folders.find((f) => f.id === id);
      if (target?.safUri) {
        try {
          if (Platform.OS === 'android' && target.safUri.startsWith('content://')) {
            await FileSystem.StorageAccessFramework.deleteAsync(target.safUri);
          } else if (target.safUri.startsWith('file://')) {
            await FileSystem.deleteAsync(target.safUri);
          }
        } catch (err) {
          console.warn('Error eliminando carpeta física:', err);
        }
      }

      // Cierra pestañas asociadas a archivos dentro de esta carpeta
      const deletedFiles = files.filter((f) => f.folderId === id);
      deletedFiles.forEach((f) => closeTab(f.id));

      setFolders((prev) => {
        const next = prev.filter((f) => f.id !== id && f.folderId !== id);
        saveAllFolders(next);
        return next;
      });

      setFiles((prev) => {
        const next = prev.filter((f) => f.folderId !== id);
        saveAllFiles(next);
        return next;
      });
    },
    [closeTab, files, folders]
  );

  return (
    <FileContext.Provider
      value={{
        files,
        folders,
        activeFile,
        activeFileId,
        openTabs,
        currentFolderId,
        workspaceUri,
        workspaceName,
        setCurrentFolderId,
        setActiveFileId,
        openFile,
        closeTab,
        updateFileContent,
        createFile,
        renameFile,
        moveFile,
        deleteFile,
        createFolder,
        renameFolder,
        deleteFolder,
        duplicateFile,
        pickWorkspaceFolder,
        clearWorkspace,
        navigateUp,
        verifyWorkspaceExists,
      }}
    >
      {children}
    </FileContext.Provider>
  );
}

export function useFiles() {
  const context = useContext(FileContext);
  if (!context) {
    throw new Error('useFiles must be used within a FileProvider');
  }
  return context;
}
