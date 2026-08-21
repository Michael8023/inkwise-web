// 速览 Tab —— MVP 占位（第二版实现：AI 摘要速览流）
import { EmptyState, TopBar } from "@/components/ui/overlay";
import { useThemeStore } from "@/theme/ThemeProvider";
import { THEMES } from "@/theme/tokens";
import { View, StyleSheet } from "react-native";

export default function SkimScreen() {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <TopBar title="今日速览" subtitle="AI 摘要速览即将上线" />
      <EmptyState
        icon="bolt"
        title="速览即将上线"
        subtitle="第二版将为你的文献生成 30 秒速览与完整摘要，敬请期待"
        style={{ flex: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
