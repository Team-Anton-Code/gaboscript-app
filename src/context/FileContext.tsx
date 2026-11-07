import * as FileSystem from 'expo-file-system/legacy';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus, Platform } from 'react-native';
import {
    GaboFile,
    GaboFolder,
    initializeStorage,
    saveActiveFileId,
    saveAllFiles,
    saveAllFolders,
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
  isLoading: boolean;
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
  syncPhysicalFiles: (targetUri?: string | null) => Promise<void>;
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

function getNameFromSafUri(safUri: string): string {
  try {
    const clean = safUri.replace(/(\/|%2F)+$/i, '');
    const decoded = decodeURIComponent(clean);
    const slashParts = decoded.split('/');
    let lastPart = slashParts[slashParts.length - 1] || '';
    if (lastPart.includes(':')) {
      const colonParts = lastPart.split(':');
      lastPart = colonParts[colonParts.length - 1] || lastPart;
    }
    return lastPart.trim() || 'carpeta';
  } catch {
    return 'carpeta';
  }
}

function normalizeGaboFileName(name: string): string {
  let clean = name.trim();
  if (clean.endsWith('.gabo.txt')) {
    clean = clean.replace(/\.gabo\.txt$/i, '.gabo');
  } else if (clean.endsWith('.txt')) {
    clean = clean.replace(/\.txt$/i, '.gabo');
  } else if (!clean.endsWith('.gabo')) {
    clean = `${clean}.gabo`;
  }
  return clean;
}

function generateFolderId(name: string, parentFolderId: string | null): string {
  const safeName = name.trim().toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_');
  const parentPrefix = parentFolderId ? `${parentFolderId}_` : 'root_';
  return `folder_${parentPrefix}${safeName}`;
}

function generateFileId(name: string, parentFolderId: string | null): string {
  const safeName = name.trim().toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_');
  const parentPrefix = parentFolderId ? `${parentFolderId}_` : 'root_';
  return `file_${parentPrefix}${safeName}`;
}

function matchExistingFolder(
  prevFolders: GaboFolder[],
  uri: string,
  name: string,
  parentFolderId: string | null
): GaboFolder | undefined {
  const cleanUri = uri.replace(/(\/|%2F)+$/i, '');
  const cleanName = name.trim().toLowerCase();

  return prevFolders.find((f) => {
    if (f.safUri && f.safUri.replace(/(\/|%2F)+$/i, '') === cleanUri) {
      return true;
    }
    if (f.folderId === parentFolderId && f.name.trim().toLowerCase() === cleanName) {
      return true;
    }
    return false;
  });
}

function matchExistingFile(
  prevFiles: GaboFile[],
  uri: string,
  name: string,
  parentFolderId: string | null
): GaboFile | undefined {
  const cleanUri = uri.replace(/(\/|%2F)+$/i, '');
  const cleanName = normalizeGaboFileName(name).toLowerCase();

  return prevFiles.find((f) => {
    if (f.safUri && f.safUri.replace(/(\/|%2F)+$/i, '') === cleanUri) {
      return true;
    }
    if (f.folderId === parentFolderId && normalizeGaboFileName(f.name).toLowerCase() === cleanName) {
      return true;
    }
    return false;
  });
}

async function scanSafDirectoryRecursive(
  dirUri: string,
  parentFolderId: string | null = null,
  depth = 0,
  prevFiles: GaboFile[] = [],
  prevFolders: GaboFolder[] = []
): Promise<{ files: GaboFile[]; folders: GaboFolder[] }> {
  if (depth > 6) return { files: [], folders: [] };

  const foundFiles: GaboFile[] = [];
  const foundFolders: GaboFolder[] = [];

  try {
    const childrenUris = await FileSystem.StorageAccessFramework.readDirectoryAsync(dirUri);
    for (const childUri of childrenUris) {
      try {
        const rawName = getNameFromSafUri(childUri);
        if (rawName.startsWith('.')) continue;

        // Comprobación directa y robusta de directorio en SAF:
        // readDirectoryAsync tiene éxito si es directorio; lanza error si es archivo.
        let isDir = false;
        try {
          await FileSystem.StorageAccessFramework.readDirectoryAsync(childUri);
          isDir = true;
        } catch {
          isDir = false;
        }

        if (isDir) {
          const existingFolder = matchExistingFolder(prevFolders, childUri, rawName, parentFolderId);
          const folderId = existingFolder?.id || generateFolderId(rawName, parentFolderId);

          const folderObj: GaboFolder = {
            id: folderId,
            name: rawName,
            folderId: parentFolderId,
            createdAt: existingFolder?.createdAt || Date.now(),
            updatedAt: Date.now(),
            safUri: childUri,
          };
          foundFolders.push(folderObj);

          // Escaneo recursivo para subcarpetas y sus contenidos
          const sub = await scanSafDirectoryRecursive(
            childUri,
            folderId,
            depth + 1,
            prevFiles,
            prevFolders
          );
          foundFiles.push(...sub.files);
          foundFolders.push(...sub.folders);
        } else {
          // Es un archivo físico
          const finalFileName = normalizeGaboFileName(rawName);
          const existingFile = matchExistingFile(
            prevFiles,
            childUri,
            finalFileName,
            parentFolderId
          );

          let content = existingFile?.content || '';
          if (!content) {
            try {
              content = await FileSystem.readAsStringAsync(childUri);
            } catch {
              // ignore
            }
          }

          const fileId = existingFile?.id || generateFileId(finalFileName, parentFolderId);

          const fileObj: GaboFile = {
            id: fileId,
            name: finalFileName,
            folderId: parentFolderId,
            content,
            createdAt: existingFile?.createdAt || Date.now(),
            updatedAt: Date.now(),
            safUri: childUri,
          };
          foundFiles.push(fileObj);
        }
      } catch (childErr) {
        console.warn('Error reading SAF child:', childUri, childErr);
      }
    }
  } catch (err) {
    console.warn('Error scanning SAF directory:', dirUri, err);
  }

  return { files: foundFiles, folders: foundFolders };
}

async function scanLocalDirectoryRecursive(
  dirUri: string,
  parentFolderId: string | null = null,
  depth = 0,
  prevFiles: GaboFile[] = [],
  prevFolders: GaboFolder[] = []
): Promise<{ files: GaboFile[]; folders: GaboFolder[] }> {
  if (depth > 6) return { files: [], folders: [] };

  const foundFiles: GaboFile[] = [];
  const foundFolders: GaboFolder[] = [];

  try {
    const cleanDir = dirUri.endsWith('/') ? dirUri : `${dirUri}/`;
    const entries = await FileSystem.readDirectoryAsync(cleanDir);

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const itemUri = `${cleanDir}${entry}`;

      try {
        const info = await FileSystem.getInfoAsync(itemUri);
        if (!info.exists) continue;

        if (info.isDirectory) {
          const existingFolder = matchExistingFolder(prevFolders, itemUri, entry, parentFolderId);
          const folderId = existingFolder?.id || generateFolderId(entry, parentFolderId);

          const folderObj: GaboFolder = {
            id: folderId,
            name: entry,
            folderId: parentFolderId,
            createdAt: info.modificationTime
              ? info.modificationTime * 1000
              : existingFolder?.createdAt || Date.now(),
            updatedAt: info.modificationTime
              ? info.modificationTime * 1000
              : existingFolder?.updatedAt || Date.now(),
            safUri: itemUri,
          };
          foundFolders.push(folderObj);

          const sub = await scanLocalDirectoryRecursive(
            itemUri,
            folderId,
            depth + 1,
            prevFiles,
            prevFolders
          );
          foundFiles.push(...sub.files);
          foundFolders.push(...sub.folders);
        } else {
          const finalFileName = normalizeGaboFileName(entry);
          const existingFile = matchExistingFile(
            prevFiles,
            itemUri,
            finalFileName,
            parentFolderId
          );

          let content = existingFile?.content || '';
          if (!content) {
            try {
              content = await FileSystem.readAsStringAsync(itemUri);
            } catch {
              // ignore
            }
          }

          const fileId = existingFile?.id || generateFileId(finalFileName, parentFolderId);

          const fileObj: GaboFile = {
            id: fileId,
            name: finalFileName,
            folderId: parentFolderId,
            content,
            createdAt: info.modificationTime
              ? info.modificationTime * 1000
              : existingFile?.createdAt || Date.now(),
            updatedAt: info.modificationTime
              ? info.modificationTime * 1000
              : existingFile?.updatedAt || Date.now(),
            safUri: itemUri,
          };
          foundFiles.push(fileObj);
        }
      } catch (err) {
        console.warn('Error reading local entry:', itemUri, err);
      }
    }
  } catch (err) {
    console.warn('Error scanning local directory:', dirUri, err);
  }

  return { files: foundFiles, folders: foundFolders };
}

async function scanPhysicalWorkspace(
  targetUri: string | null,
  currentFiles: GaboFile[] = [],
  currentFolders: GaboFolder[] = []
): Promise<{ files: GaboFile[]; folders: GaboFolder[] }> {
  if (!targetUri) return { files: [], folders: [] };

  try {
    if (Platform.OS === 'android' && targetUri.startsWith('content://')) {
      return await scanSafDirectoryRecursive(targetUri, null, 0, currentFiles, currentFolders);
    } else if (targetUri.startsWith('file://')) {
      return await scanLocalDirectoryRecursive(targetUri, null, 0, currentFiles, currentFolders);
    }
  } catch (err) {
    console.warn('scanPhysicalWorkspace error:', err);
  }
  return { files: [], folders: [] };
}

async function migrateSafDirectoryContents(
  oldDirUri: string,
  newDirUri: string,
  folderId: string,
  allFiles: GaboFile[],
  allFolders: GaboFolder[]
): Promise<{ updatedFiles: Map<string, string>; updatedFolders: Map<string, string> }> {
  const updatedFiles = new Map<string, string>();
  const updatedFolders = new Map<string, string>();

  // 1. Migrar archivos contenidos en esta carpeta
  const childFiles = allFiles.filter((f) => f.folderId === folderId);
  for (const file of childFiles) {
    try {
      const baseName = file.name.replace(/\.gabo$/, '');
      const newFileUri = await FileSystem.StorageAccessFramework.createFileAsync(
        newDirUri,
        baseName,
        'text/plain'
      );
      if (newFileUri) {
        let contentToSave = file.content;
        if (!contentToSave && file.safUri) {
          try {
            contentToSave = await FileSystem.readAsStringAsync(file.safUri);
          } catch {
            // ignore
          }
        }
        await FileSystem.StorageAccessFramework.writeAsStringAsync(newFileUri, contentToSave || '');
        updatedFiles.set(file.id, newFileUri);
      }
    } catch (err) {
      console.warn('Error migrando archivo en carpeta renombrada:', file.name, err);
    }
  }

  // 2. Migrar subcarpetas recursivamente
  const childFolders = allFolders.filter((f) => f.folderId === folderId);
  for (const subFolder of childFolders) {
    try {
      const newSubDirUri = await FileSystem.StorageAccessFramework.makeDirectoryAsync(
        newDirUri,
        subFolder.name
      );
      if (newSubDirUri) {
        updatedFolders.set(subFolder.id, newSubDirUri);
        if (subFolder.safUri) {
          const subResult = await migrateSafDirectoryContents(
            subFolder.safUri,
            newSubDirUri,
            subFolder.id,
            allFiles,
            allFolders
          );
          subResult.updatedFiles.forEach((v, k) => updatedFiles.set(k, v));
          subResult.updatedFolders.forEach((v, k) => updatedFolders.set(k, v));
        }
      }
    } catch (err) {
      console.warn('Error migrando subcarpeta en carpeta renombrada:', subFolder.name, err);
    }
  }

  return { updatedFiles, updatedFolders };
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
  const [isLoading, setIsLoading] = useState(false);

  const filesRef = useRef(files);
  filesRef.current = files;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const isScanningRef = useRef(false);

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
    setIsLoading(false);
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

  const syncPhysicalFiles = useCallback(
    async (targetUri?: string | null) => {
      const uriToScan = targetUri !== undefined ? targetUri : workspaceUri;
      if (!uriToScan) {
        setFiles([]);
        setFolders([]);
        setIsLoading(false);
        await saveAllFiles([]);
        await saveAllFolders([]);
        return;
      }

      if (isScanningRef.current) return;
      isScanningRef.current = true;

      try {
        const { files: physicalFiles, folders: physicalFolders } = await scanPhysicalWorkspace(
          uriToScan,
          filesRef.current,
          foldersRef.current
        );

        setFiles(physicalFiles);
        setFolders(physicalFolders);
        await saveAllFiles(physicalFiles);
        await saveAllFolders(physicalFolders);

        // Limpiar pestañas de archivos que ya no existan físicamente
        const validFileIds = new Set(physicalFiles.map((f) => f.id));
        setOpenTabsState((prevTabs) => {
          const nextTabs = prevTabs.filter((id) => validFileIds.has(id));
          saveOpenTabs(nextTabs);
          return nextTabs;
        });

        setActiveFileIdState((prevActive) => {
          if (prevActive && !validFileIds.has(prevActive)) {
            const nextActive = physicalFiles[0]?.id || '';
            saveActiveFileId(nextActive);
            return nextActive;
          }
          return prevActive;
        });
      } catch (err) {
        console.warn('syncPhysicalFiles error:', err);
      } finally {
        isScanningRef.current = false;
      }
    },
    [workspaceUri]
  );

  const pickWorkspaceFolder = useCallback(async (): Promise<boolean> => {
    try {
      const permissions =
        await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) return false;
      const uri = permissions.directoryUri;
      const name = extractFolderName(uri);

      // 1. REINICIO SÍNCRONO INMEDIATO:
      // Poner isLoading = true y vaciar de golpe los archivos y carpetas para evitar parpadeos
      setIsLoading(true);
      setFiles([]);
      setFolders([]);
      setCurrentFolderId(null);
      setActiveFileIdState('');
      setOpenTabsState([]);
      setWorkspaceUri(uri);
      setWorkspaceName(name);

      await saveWorkspace(uri, name);
      await saveAllFiles([]);
      await saveAllFolders([]);
      await saveActiveFileId('');
      await saveOpenTabs([]);

      // 2. Cargar en tiempo real los archivos y carpetas físicos reales de la nueva carpeta elegida
      const { files: loadedFiles, folders: loadedFolders } = await scanPhysicalWorkspace(
        uri,
        [],
        []
      );
      setFiles(loadedFiles);
      setFolders(loadedFolders);
      await saveAllFiles(loadedFiles);
      await saveAllFolders(loadedFolders);
      setIsLoading(false);

      return true;
    } catch (err) {
      console.warn('pickWorkspaceFolder error:', err);
      setIsLoading(false);
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
    } else {
      // Si la carpeta existe y la app volvió a primer plano, sincronizar en tiempo real con disco físico
      await syncPhysicalFiles(workspaceUri);
    }
    return true;
  }, [workspaceUri, checkFolderPhysicallyExists, clearWorkspace, pickWorkspaceFolder, syncPhysicalFiles]);

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
        // Carga preliminar
        setFiles(data.files);
        setFolders(data.folders);
        setActiveFileIdState(data.activeFileId);
        setOpenTabsState(data.openTabs);

        // Sincronización inmediata con disco físico en tiempo real
        try {
          const { files: realFiles, folders: realFolders } = await scanPhysicalWorkspace(
            validWorkspace,
            data.files,
            data.folders
          );
          setFiles(realFiles);
          setFolders(realFolders);
          await saveAllFiles(realFiles);
          await saveAllFolders(realFolders);

          const validIds = new Set(realFiles.map((f) => f.id));
          const nextTabs = data.openTabs.filter((id) => validIds.has(id));
          setOpenTabsState(nextTabs);
          await saveOpenTabs(nextTabs);

          if (data.activeFileId && !validIds.has(data.activeFileId)) {
            const nextActive = realFiles[0]?.id || '';
            setActiveFileIdState(nextActive);
            await saveActiveFileId(nextActive);
          }
        } catch (syncErr) {
          console.warn('Initial storage physical sync error:', syncErr);
        }
      } else {
        setFiles([]);
        setFolders([]);
        setActiveFileIdState('');
        setOpenTabsState([]);
        await saveAllFiles([]);
        await saveAllFolders([]);
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

      closeTab(id);

      const nextFiles = files.filter((f) => f.id !== id);
      setFiles(nextFiles);
      await saveAllFiles(nextFiles);

      // Re-verificación física en tiempo real para purgar cualquier inconsistencia
      if (workspaceUri) {
        const { files: verifiedFiles } = await scanPhysicalWorkspace(workspaceUri, nextFiles, folders);
        setFiles(verifiedFiles);
        await saveAllFiles(verifiedFiles);
      }
    },
    [closeTab, files, folders, workspaceUri]
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

  const renameFolder = useCallback(
    async (id: string, newName: string) => {
      const target = folders.find((f) => f.id === id);
      if (!target) return;

      const trimmedName = newName.trim();
      if (!trimmedName || trimmedName === target.name) return;

      let updatedSafUri = target.safUri;
      let fileUriUpdates = new Map<string, string>();
      let folderUriUpdates = new Map<string, string>();

      if (target.safUri) {
        if (Platform.OS === 'android' && target.safUri.startsWith('content://')) {
          try {
            const parentFolder = target.folderId ? folders.find((f) => f.id === target.folderId) : null;
            const targetParentUri = parentFolder?.safUri || workspaceUri;

            if (targetParentUri) {
              // 1. Crear nuevo directorio físico con el nuevo nombre
              const newDirSafUri = await FileSystem.StorageAccessFramework.makeDirectoryAsync(
                targetParentUri,
                trimmedName
              );

              if (newDirSafUri) {
                // 2. Migrar contenidos físicos (archivos y subcarpetas)
                const migration = await migrateSafDirectoryContents(
                  target.safUri,
                  newDirSafUri,
                  target.id,
                  files,
                  folders
                );
                fileUriUpdates = migration.updatedFiles;
                folderUriUpdates = migration.updatedFolders;

                // 3. Eliminar directorio anterior
                try {
                  await FileSystem.StorageAccessFramework.deleteAsync(target.safUri);
                } catch (delErr) {
                  console.warn('Error eliminando directorio anterior en SAF:', delErr);
                }

                updatedSafUri = newDirSafUri;
              }
            }
          } catch (e) {
            console.warn('Error renombrando carpeta en SAF:', e);
          }
        } else if (target.safUri.startsWith('file://')) {
          try {
            const cleanTarget = target.safUri.replace(/\/+$/, '');
            const parentDir = cleanTarget.substring(0, cleanTarget.lastIndexOf('/') + 1);
            const newPath = `${parentDir}${trimmedName}/`;
            await FileSystem.moveAsync({ from: target.safUri, to: newPath });
            updatedSafUri = newPath;

            // Para archivos locales, actualizar todas las URIs hijas que comiencen por la ruta antigua
            const oldPrefix = target.safUri.endsWith('/') ? target.safUri : `${target.safUri}/`;
            files.forEach((f) => {
              if (f.safUri && f.safUri.startsWith(oldPrefix)) {
                fileUriUpdates.set(f.id, f.safUri.replace(oldPrefix, newPath));
              }
            });
            folders.forEach((f) => {
              if (f.id !== id && f.safUri && f.safUri.startsWith(oldPrefix)) {
                folderUriUpdates.set(f.id, f.safUri.replace(oldPrefix, newPath));
              }
            });
          } catch (e) {
            console.warn('Error renombrando carpeta local:', e);
          }
        }
      }

      // Actualizar estado de React y AsyncStorage
      const nextFolders = folders.map((f) => {
        if (f.id === id) {
          return { ...f, name: trimmedName, safUri: updatedSafUri, updatedAt: Date.now() };
        }
        if (folderUriUpdates.has(f.id)) {
          return { ...f, safUri: folderUriUpdates.get(f.id), updatedAt: Date.now() };
        }
        return f;
      });

      const nextFiles = files.map((f) => {
        if (fileUriUpdates.has(f.id)) {
          return { ...f, safUri: fileUriUpdates.get(f.id), updatedAt: Date.now() };
        }
        return f;
      });

      setFolders(nextFolders);
      setFiles(nextFiles);
      await saveAllFolders(nextFolders);
      await saveAllFiles(nextFiles);

      // Sincronizar en tiempo real con almacenamiento físico para revalidar
      if (workspaceUri) {
        const { files: verifiedFiles, folders: verifiedFolders } = await scanPhysicalWorkspace(
          workspaceUri,
          nextFiles,
          nextFolders
        );
        setFiles(verifiedFiles);
        setFolders(verifiedFolders);
        await saveAllFiles(verifiedFiles);
        await saveAllFolders(verifiedFolders);
      }
    },
    [folders, files, workspaceUri]
  );

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

      // Encontrar todos los IDs de carpetas que son descendientes recursivos
      const allDeletedFolderIds = new Set<string>([id]);
      let addedMore = true;
      while (addedMore) {
        addedMore = false;
        for (const f of folders) {
          if (f.folderId && allDeletedFolderIds.has(f.folderId) && !allDeletedFolderIds.has(f.id)) {
            allDeletedFolderIds.add(f.id);
            addedMore = true;
          }
        }
      }

      // Si el explorador estaba dentro de la carpeta eliminada, volver al padre o raíz
      setCurrentFolderId((prev) => {
        if (prev && allDeletedFolderIds.has(prev)) {
          return target?.folderId || null;
        }
        return prev;
      });

      // Cerrar pestañas asociadas a archivos dentro de estas carpetas
      const deletedFiles = files.filter(
        (f) => f.folderId && allDeletedFolderIds.has(f.folderId)
      );
      deletedFiles.forEach((f) => closeTab(f.id));

      // Limpia de inmediato el estado de archivos y carpetas eliminados
      const nextFolders = folders.filter((f) => !allDeletedFolderIds.has(f.id));
      const nextFiles = files.filter(
        (f) => !f.folderId || !allDeletedFolderIds.has(f.folderId)
      );

      setFolders(nextFolders);
      setFiles(nextFiles);
      await saveAllFolders(nextFolders);
      await saveAllFiles(nextFiles);

      // Re-consultar en tiempo real el almacenamiento físico (FileSystem.readDirectoryAsync)
      if (workspaceUri) {
        const { files: verifiedFiles, folders: verifiedFolders } = await scanPhysicalWorkspace(
          workspaceUri,
          nextFiles,
          nextFolders
        );
        setFiles(verifiedFiles);
        setFolders(verifiedFolders);
        await saveAllFiles(verifiedFiles);
        await saveAllFolders(verifiedFolders);
      }
    },
    [closeTab, files, folders, workspaceUri]
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
        isLoading,
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
        syncPhysicalFiles,
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
