// 找回密码：邮箱 → 验证码 + 新密码 → 重置成功
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button, TextField } from "@/components/ui/core";
import { requestPasswordReset, resetPassword } from "@/lib/auth";
import { humanError, toAppError } from "@/lib/errors";
import { useThemeStore } from "@/theme/ThemeProvider";
import { THEMES } from "@/theme/tokens";

export default function ForgotPasswordScreen() {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const requestCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("请输入有效的邮箱");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await requestPasswordReset(email);
      setStep(2);
    } catch (err) {
      setError(humanError(toAppError(err, "CODE_REQUEST_FAILED")));
    } finally {
      setLoading(false);
    }
  };

  const finish = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      setError("请输入 6 位验证码");
      return;
    }
    if (password.length < 8) {
      setError("新密码至少 8 位");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await resetPassword({ email, code, password });
      router.replace("/auth/login");
    } catch (err) {
      setError(humanError(toAppError(err, "RESET_FAILED")));
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="找回密码"
      subtitle={step === 1 ? "输入注册邮箱，我们将发送验证码" : `验证码已发送至 ${email}`}
    >
      {step === 1 ? (
        <>
          <TextField label="邮箱" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoFocus />
          {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
          <Button title="发送验证码" onPress={() => void requestCode()} loading={loading} style={{ marginTop: 8 }} />
        </>
      ) : (
        <>
          <TextField label="邮箱验证码" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} placeholder="6 位数字" keyboardType="number-pad" autoFocus />
          <TextField label="新密码" value={password} onChangeText={setPassword} placeholder="至少 8 位" secureTextEntry />
          {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
          <Button title="重置密码" onPress={() => void finish()} loading={loading} style={{ marginTop: 8 }} />
        </>
      )}
      <Pressable onPress={() => router.back()} style={{ marginTop: 14, alignItems: "center" }}>
        <Text style={{ color: t.text2, fontSize: 13 }}>返回登录</Text>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 13, marginBottom: 6 },
});
