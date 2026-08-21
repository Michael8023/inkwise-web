// 根布局：Provider（React Query / 主题 / 会话引导）+ 认证守卫 + Stack 路由
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ToastHost } from "@/components/ui/overlay";
import { Spinner } from "@/components/ui/core";
import { useSessionStore } from "@/stores/session";
import { useThemeStore } from "@/theme/ThemeProvider";
import { THEMES } from "@/theme/tokens";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useSessionStore((s) => s.status);
  const pathname = usePathname();
  const theme = useThemeStore((s) => s.theme);

  const isAuthRoute = pathname.startsWith("/auth");
  if (status === "loading") {
    return (
      <View style={[styles.splash, { backgroundColor: THEMES[theme].bg }]}>
        <Spinner size="large" />
      </View>
    );
  }
  if (status === "signedOut" && !isAuthRoute) {
    return <Redirect href="/auth/login" />;
  }
  if (status === "signedIn" && isAuthRoute) {
    return <Redirect href="/" />;
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];

  useEffect(() => {
    void useSessionStore.getState().boot();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <StatusBar style={theme === "dark" ? "light" : "dark"} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: t.bg },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="auth/login" />
            <Stack.Screen name="auth/signup" />
            <Stack.Screen name="auth/verify" />
            <Stack.Screen name="auth/forgot" />
            <Stack.Screen name="paper/[id]" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="import" options={{ presentation: "modal" }} />
          </Stack>
        </AuthGate>
        <ToastHost />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
});
