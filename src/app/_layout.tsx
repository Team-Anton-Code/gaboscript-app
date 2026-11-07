import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useAppTheme } from '../theme/ThemeContext';
import { FileProvider } from '../context/FileContext';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { theme, isDark } = useAppTheme();

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.fondo }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            contentStyle: { backgroundColor: theme.fondo },
          }}
        />
        <Stack.Screen
          name="explorer"
          options={{
            animation: 'slide_from_left',
            presentation: 'transparentModal',
            contentStyle: { backgroundColor: 'transparent' },
            gestureEnabled: true,
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            animation: 'slide_from_bottom',
            presentation: 'transparentModal',
            contentStyle: { backgroundColor: 'transparent' },
            gestureEnabled: true,
          }}
        />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <FileProvider>
          <RootNavigator />
        </FileProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
