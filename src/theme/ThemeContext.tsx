import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Theme, ThemePreference } from './types';
import { THEMES } from './themes';

interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => Promise<void>;
  isDark: boolean;
  isLoading: boolean;
}

const STORAGE_KEY = '@gaboscript_theme_pref';

const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES.medianoche,
  preference: 'medianoche',
  setPreference: async () => {},
  isDark: true,
  isLoading: true,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('medianoche');
  const [isLoading, setIsLoading] = useState(true);

  // Load saved theme preference
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (mounted && saved && (saved === 'auto' || saved in THEMES)) {
          setPreferenceState(saved as ThemePreference);
        }
      })
      .catch((err) => {
        console.warn('Failed to load theme preference', err);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setPreference = async (newPref: ThemePreference) => {
    setPreferenceState(newPref);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, newPref);
    } catch (err) {
      console.warn('Failed to save theme preference', err);
    }
  };

  const theme = useMemo(() => {
    if (preference === 'auto') {
      return systemScheme === 'light' ? THEMES.nieve : THEMES.medianoche;
    }
    return THEMES[preference] || THEMES.medianoche;
  }, [preference, systemScheme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        preference,
        setPreference,
        isDark: theme.isDark,
        isLoading,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
