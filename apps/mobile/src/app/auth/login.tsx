// 登录
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button, TextField } from "@/components/ui/core";
import { humanError, toAppError } from "@/lib/errors";
import { loginWithPassword } from "@/lib/auth";
import { useThemeStore } from "@/theme/ThemeProvider";
import { THEMES } from "@/theme/tokens";

export default function LoginScreen() {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("请输入邮箱和密码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await loginWithPassword(email, password);
      // 会话状态由 onAuthStateChange 驱动，AuthGate 自动跳转
      router.replace("/");
    } catch (err) {
      setError(humanError(toAppError(err, "LOGIN_FAILED")));
      setLoading(false);
    }
  };

  return (
    <AuthShell title="识谛" subtitle="让每一页阅读，都通向更清晰的理解">
      <TextField
        label="邮箱"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoFocus
      />
      <TextField
        label="密码"
        value={password}
        onChangeText={setPassword}
        placeholder="至少 10 位"
        secureTextEntry
      />
      {error ? (
        <Text style={[styles.error, { color: t.danger }]}>{error}</Text>
      ) : null}
      <Button title="登录" onPress={() => void submit()} loading={loading} style={{ marginTop: 8 }} />
      <Pressable onPress={() => router.push("/auth/forgot")} style={{ marginTop: 14, alignItems: "center" }}>
        <Text style={{ color: t.text2, fontSize: 13 }}>忘记密码？</Text>
      </Pressable>
      <View style={styles.divider}>
        <View style={[styles.line, { backgroundColor: t.border }]} />
        <Text style={{ color: t.text3, fontSize: 12 }}>还没有账号</Text>
        <View style={[styles.line, { backgroundColor: t.border }]} />
      </View>
      <Link href="/auth/signup" asChild>
        <Button title="注册新账号" variant="outline" />
      </Link>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 13, marginBottom: 6 },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 18,
  },
  line: { flex: 1, height: 0.5 },
});
