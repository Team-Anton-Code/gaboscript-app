import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../theme/ThemeContext';
import { DARK_THEMES, LIGHT_THEMES } from '../theme/themes';
import { Theme } from '../theme/types';

export default function SettingsScreen() {
  const router = useRouter();
  const { theme, preference, setPreference } = useAppTheme();
  const insets = useSafeAreaInsets();

  const screenHeight = Dimensions.get('window').height;
  const slideY = useRef(new Animated.Value(screenHeight)).current;
  const isClosingRef = useRef(false);

  useEffect(() => {
    // Animación suave de entrada: deslizar hacia arriba
    Animated.timing(slideY, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slideY]);

  const handleClose = () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    // Animación suave de salida: deslizar completamente hacia abajo antes de desmontar
    Animated.timing(slideY, {
      toValue: screenHeight,
      duration: 240,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      router.back();
    });
  };

  // Interceptar el botón físico de retroceso en Android
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => sub.remove();
  }, []);

  const renderThemeCard = (t: Theme) => {
    const isSelected = preference === t.id;

    return (
      <TouchableOpacity
        key={t.id}
        activeOpacity={0.85}
        onPress={() => setPreference(t.id)}
        style={[
          styles.themeCard,
          {
            backgroundColor: t.fondo,
            borderColor: isSelected ? t.acento : t.borde,
            borderWidth: isSelected ? 2 : 1,
          },
        ]}
      >
        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text
              style={[
                styles.themeName,
                { color: t.texto, fontWeight: isSelected ? '700' : '600' },
              ]}
            >
              {t.name}
            </Text>
            {/* Color preview dots */}
            <View style={styles.dotsRow}>
              <View style={[styles.dot, { backgroundColor: t.acento }]} />
              <View style={[styles.dot, { backgroundColor: t.syntax.keyword }]} />
              <View style={[styles.dot, { backgroundColor: t.syntax.string }]} />
              <View style={[styles.dot, { backgroundColor: t.syntax.number }]} />
            </View>
          </View>

          {isSelected && (
            <View style={[styles.checkCircle, { backgroundColor: t.acento }]}>
              <MaterialCommunityIcons
                name="check"
                size={16}
                color={t.textoSobreAcento}
              />
            </View>
          )}
        </View>

        {/* Mini Code Snippet Preview */}
        <View
          style={[
            styles.snippetBox,
            {
              backgroundColor: t.superficie,
              borderColor: t.borde,
            },
          ]}
        >
          <View style={styles.snippetLine}>
            <Text
              style={[
                styles.snippetText,
                {
                  color: t.syntax.comment,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                },
              ]}
            >
              {'// GaboScript'}
            </Text>
          </View>
          <View style={styles.snippetLine}>
            <Text
              style={[
                styles.snippetText,
                {
                  color: t.syntax.keyword,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                },
              ]}
            >
              Algoritmo{' '}
            </Text>
            <Text
              style={[
                styles.snippetText,
                {
                  color: t.texto,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                },
              ]}
            >
              demo
            </Text>
          </View>
          <View style={styles.snippetLine}>
            <Text
              style={[
                styles.snippetText,
                {
                  color: t.syntax.keyword,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                },
              ]}
            >
              Inicio
            </Text>
          </View>
          <View style={styles.snippetLine}>
            <Text
              style={[
                styles.snippetText,
                {
                  color: t.syntax.operator,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                },
              ]}
            >
              {'  '}Mostrar {'<<'}{' '}
            </Text>
            <Text
              style={[
                styles.snippetText,
                {
                  color: t.syntax.string,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                },
              ]}
            >
              {'"Hola!"'}
            </Text>
            <Text
              style={[
                styles.snippetText,
                {
                  color: t.syntax.operator,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                },
              ]}
            >
              ;
            </Text>
          </View>
          <View style={styles.snippetLine}>
            <Text
              style={[
                styles.snippetText,
                {
                  color: t.syntax.keyword,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                },
              ]}
            >
              Fin
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <Animated.View
        style={[
          styles.container,
          {
            backgroundColor: theme.fondo,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
            transform: [{ translateY: slideY }],
          },
        ]}
      >
        {/* Header */}
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
            onPress={handleClose}
          >
          <MaterialCommunityIcons
            name="chevron-left"
            size={28}
            color={theme.texto}
          />
        </TouchableOpacity>

        <Text style={[styles.headerTitle, { color: theme.texto }]}>
          Ajustes de Tema
        </Text>

        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Automatic Theme Option */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setPreference('auto')}
          style={[
            styles.autoCard,
            {
              backgroundColor: theme.superficie,
              borderColor: preference === 'auto' ? theme.acento : theme.borde,
              borderWidth: preference === 'auto' ? 2 : 1,
            },
          ]}
        >
          <View style={styles.autoLeft}>
            <MaterialCommunityIcons
              name="theme-light-dark"
              size={24}
              color={theme.acento}
            />
            <View>
              <Text style={[styles.autoTitle, { color: theme.texto }]}>
                Automático (Sistema)
              </Text>
              <Text
                style={[styles.autoDesc, { color: theme.textoSecundario }]}
              >
                Alterna entre Nieve y Medianoche según el sistema
              </Text>
            </View>
          </View>
          {preference === 'auto' && (
            <View style={[styles.checkCircle, { backgroundColor: theme.acento }]}>
              <MaterialCommunityIcons
                name="check"
                size={16}
                color={theme.textoSobreAcento}
              />
            </View>
          )}
        </TouchableOpacity>

        {/* TEMAS OSCUROS */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textoSecundario }]}>
            TEMAS OSCUROS
          </Text>
          <View style={styles.grid}>
            {DARK_THEMES.map((t) => renderThemeCard(t))}
          </View>
        </View>

        {/* TEMAS CLAROS */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textoSecundario }]}>
            TEMAS CLAROS
          </Text>
          <View style={styles.grid}>
            {LIGHT_THEMES.map((t) => renderThemeCard(t))}
          </View>
        </View>
      </ScrollView>
    </Animated.View>
  </View>
);
}

const styles = StyleSheet.create({
  container: {
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
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 24,
    paddingBottom: 40,
  },
  autoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 14,
    minHeight: 56,
  },
  autoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  autoTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  autoDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  grid: {
    gap: 14,
  },
  themeCard: {
    borderRadius: 14,
    padding: 14,
    gap: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  themeName: {
    fontSize: 15,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  snippetBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    gap: 3,
  },
  snippetLine: {
    flexDirection: 'row',
  },
  snippetText: {
    fontSize: 11,
    lineHeight: 16,
  },
});
