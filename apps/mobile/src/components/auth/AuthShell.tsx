// 认证页共用外壳
import { type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeStore } from "@/theme/ThemeProvider";
import { THEMES } from "@/theme/tokens";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  const inset = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: t.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: inset.top + 48, paddingBottom: inset.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={[styles.logo, { backgroundColor: t.primary }]}>
            <Text style={styles.logoText}>识</Text>
          </View>
          <Text style={[styles.title, { color: t.primary }]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: t.text2 }]}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24 },
  brand: { alignItems: "center", marginBottom: 32 },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  logoText: { color: "#fff", fontSize: 26, fontWeight: "700" },
  title: { fontSize: 24, fontWeight: "600" },
  subtitle: { fontSize: 13, marginTop: 6, textAlign: "center", lineHeight: 19 },
});
