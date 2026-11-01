import AsyncStorage from '@react-native-async-storage/async-storage';

export interface GaboFile {
  id: string;
  name: string;
  folderId: string | null;
  content: string;
  createdAt: number;
  updatedAt: number;
  safUri?: string;
}

export interface GaboFolder {
  id: string;
  name: string;
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
  safUri?: string;
}

// v4 storage keys — completely clean of any mock or demo data
const FILES_KEY = '@gaboscript_files_v4';
const FOLDERS_KEY = '@gaboscript_folders_v4';
const ACTIVE_FILE_KEY = '@gaboscript_active_file_id_v4';
const OPEN_TABS_KEY = '@gaboscript_open_tabs_v4';
const WORKSPACE_URI_KEY = '@gaboscript_workspace_uri_v4';
const WORKSPACE_NAME_KEY = '@gaboscript_workspace_name_v4';

// Legacy keys to clean up automatically on first run
const LEGACY_KEYS = [
  '@gaboscript_files',
  '@gaboscript_folders',
  '@gaboscript_active_file_id',
  '@gaboscript_open_tabs',
  '@gaboscript_files_v2',
  '@gaboscript_folders_v2',
  '@gaboscript_active_file_id_v2',
  '@gaboscript_open_tabs_v2',
  '@gaboscript_files_v3',
  '@gaboscript_folders_v3',
  '@gaboscript_active_file_id_v3',
  '@gaboscript_open_tabs_v3',
];

async function cleanupLegacyStorage(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(LEGACY_KEYS);
  } catch {
    // Ignore legacy cleanup errors
  }
}

export async function initializeStorage(): Promise<{
  files: GaboFile[];
  folders: GaboFolder[];
  activeFileId: string;
  openTabs: string[];
  workspaceUri: string | null;
  workspaceName: string | null;
}> {
  try {
    await cleanupLegacyStorage();

    const [
      storedFiles,
      storedFolders,
      storedActiveId,
      storedTabs,
      storedWorkspaceUri,
      storedWorkspaceName,
    ] = await Promise.all([
      AsyncStorage.getItem(FILES_KEY),
      AsyncStorage.getItem(FOLDERS_KEY),
      AsyncStorage.getItem(ACTIVE_FILE_KEY),
      AsyncStorage.getItem(OPEN_TABS_KEY),
      AsyncStorage.getItem(WORKSPACE_URI_KEY),
      AsyncStorage.getItem(WORKSPACE_NAME_KEY),
    ]);

    const files: GaboFile[] = storedFiles ? JSON.parse(storedFiles) : [];
    const folders: GaboFolder[] = storedFolders ? JSON.parse(storedFolders) : [];

    let activeFileId = storedActiveId || '';
    if (activeFileId && !files.some((f) => f.id === activeFileId)) {
      activeFileId = '';
    }

    let openTabs: string[] = storedTabs ? JSON.parse(storedTabs) : [];
    openTabs = openTabs.filter((tabId) => files.some((f) => f.id === tabId));
    if (activeFileId && !openTabs.includes(activeFileId)) {
      openTabs.push(activeFileId);
    }

    return {
      files,
      folders,
      activeFileId,
      openTabs,
      workspaceUri: storedWorkspaceUri || null,
      workspaceName: storedWorkspaceName || null,
    };
  } catch (error) {
    console.error('Error initializing storage', error);
    return {
      files: [],
      folders: [],
      activeFileId: '',
      openTabs: [],
      workspaceUri: null,
      workspaceName: null,
    };
  }
}

export async function saveAllFiles(files: GaboFile[]) {
  await AsyncStorage.setItem(FILES_KEY, JSON.stringify(files));
}

export async function saveAllFolders(folders: GaboFolder[]) {
  await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

export async function saveActiveFileId(id: string) {
  if (id) {
    await AsyncStorage.setItem(ACTIVE_FILE_KEY, id);
  } else {
    await AsyncStorage.removeItem(ACTIVE_FILE_KEY);
  }
}

export async function saveOpenTabs(tabs: string[]) {
  await AsyncStorage.setItem(OPEN_TABS_KEY, JSON.stringify(tabs));
}

export async function saveWorkspace(uri: string | null, name: string | null) {
  if (uri) {
    await AsyncStorage.setItem(WORKSPACE_URI_KEY, uri);
  } else {
    await AsyncStorage.removeItem(WORKSPACE_URI_KEY);
  }
  if (name) {
    await AsyncStorage.setItem(WORKSPACE_NAME_KEY, name);
  } else {
    await AsyncStorage.removeItem(WORKSPACE_NAME_KEY);
  }
}
