// 注册：邮箱+用户名+密码 → 请求验证码 → 输入 6 位验证码 → 完成注册并自动登录
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button, TextField } from "@/components/ui/core";
import { completeSignup, loginWithPassword, requestSignupCode } from "@/lib/auth";
import { humanError, toAppError } from "@/lib/errors";
import { useThemeStore } from "@/theme/ThemeProvider";
import { THEMES } from "@/theme/tokens";

export default function SignupScreen() {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const validate = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "请输入有效的邮箱";
    if (username.trim().length < 3) return "用户名至少 3 个字符";
    if (password.length < 8) return "密码至少 8 位";
    return "";
  };

  const requestCode = async () => {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await requestSignupCode({ email, username, inviteCode });
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
    setLoading(true);
    setError("");
    try {
      await completeSignup({ email, code, password });
      await loginWithPassword(email, password);
      router.replace("/");
    } catch (err) {
      setError(humanError(toAppError(err, "SIGNUP_FAILED")));
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={step === 1 ? "注册识谛" : "验证邮箱"}
      subtitle={
        step === 1
          ? "创建账号，开始你的个人文献空间"
          : `验证码已发送至 ${email}，10 分钟内有效`
      }
    >
      {step === 1 ? (
        <>
          <TextField label="邮箱" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoFocus />
          <TextField label="用户名" value={username} onChangeText={setUsername} placeholder="3-32 位字母、数字或下划线" />
          <TextField label="邀请码（可选）" value={inviteCode} onChangeText={setInviteCode} placeholder="有邀请码可填写" />
          <TextField label="密码" value={password} onChangeText={setPassword} placeholder="至少 8 位" secureTextEntry />
          {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
          <Button title="发送验证码" onPress={() => void requestCode()} loading={loading} style={{ marginTop: 8 }} />
          <Pressable onPress={() => router.back()} style={{ marginTop: 14, alignItems: "center" }}>
            <Text style={{ color: t.text2, fontSize: 13 }}>已有账号？返回登录</Text>
          </Pressable>
        </>
      ) : (
        <>
          <TextField
            label="邮箱验证码"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
            placeholder="6 位数字"
            keyboardType="number-pad"
            autoFocus
          />
          {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
          <Button title="完成注册" onPress={() => void finish()} loading={loading} style={{ marginTop: 8 }} />
          <Pressable onPress={() => setStep(1)} style={{ marginTop: 14, alignItems: "center" }}>
            <Text style={{ color: t.text2, fontSize: 13 }}>返回修改信息</Text>
          </Pressable>
        </>
      )}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: 13, marginBottom: 6 },
});
