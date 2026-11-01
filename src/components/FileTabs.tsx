import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFiles } from '../context/FileContext';
import { useAppTheme } from '../theme/ThemeContext';
import GaboFileIcon from './GaboFileIcon';

export default function FileTabs() {
  const { files, openTabs, activeFileId, openFile, closeTab } = useFiles();
  const { theme } = useAppTheme();

  const openFileList = openTabs
    .map((tabId) => files.find((f) => f.id === tabId))
    .filter((f): f is NonNullable<typeof f> => Boolean(f));

  if (openFileList.length === 0) return null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.superficie,
          borderBottomColor: theme.borde,
        },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {openFileList.map((file) => {
          const isActive = file.id === activeFileId;
          return (
            <TouchableOpacity
              key={file.id}
              activeOpacity={0.8}
              onPress={() => openFile(file.id)}
              style={[
                styles.tab,
                {
                  backgroundColor: isActive
                    ? theme.lineaActiva
                    : theme.superficieSecundaria,
                  borderColor: isActive ? theme.acento : theme.borde,
                },
              ]}
            >
              <GaboFileIcon
                size={16}
                color={isActive ? theme.texto : theme.acento}
              />
              <Text
                style={[
                  styles.tabTitle,
                  {
                    color: isActive ? theme.texto : theme.textoSecundario,
                    fontWeight: isActive ? '600' : '400',
                  },
                ]}
                numberOfLines={1}
              >
                {file.name.replace(/\.(gabo|txt)$/i, '')}
              </Text>

              {/* Botón de cierre siempre visible, permitiendo cerrar incluso la única pestaña abierta */}
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  closeTab(file.id);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.closeBtn}
              >
                <MaterialCommunityIcons
                  name="close"
                  size={14}
                  color={isActive ? theme.texto : theme.textoSecundario}
                />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 38,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 6,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    gap: 6,
  },
  tabTitle: {
    fontSize: 12,
  },
  closeBtn: {
    padding: 2,
    marginLeft: 2,
  },
});
