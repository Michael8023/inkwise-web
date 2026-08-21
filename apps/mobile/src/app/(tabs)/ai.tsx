// AI 研究 Tab —— MVP 占位（第二版实现：单篇/多篇/自由对话 + 会话历史）
import { EmptyState, TopBar } from "@/components/ui/overlay";
import { useThemeStore } from "@/theme/ThemeProvider";
import { THEMES } from "@/theme/tokens";
import { View, StyleSheet } from "react-native";

export default function AiScreen() {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <TopBar title="AI 研究" subtitle="围绕文献进行深入问答" />
      <EmptyState
        icon="forum"
        title="AI 研究即将上线"
        subtitle="第二版支持单篇问答、多篇对比与自由研究对话"
        style={{ flex: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
