// 我的 Tab：研究主线（只读）/ 账户与会员 / 设置 / 关于与反馈 / 退出登录
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AppText, Button, Icon, Segmented, Switch } from "@/components/ui/core";
import { Sheet, TopBar } from "@/components/ui/overlay";
import { fetchUsage } from "@/lib/ai";
import { signOut } from "@/lib/auth";
import { humanError, toAppError } from "@/lib/errors";
import { fetchResearchOverview, submitFeedback } from "@/lib/library";
import { currentUserId } from "@/lib/supabase";
import { toast } from "@/stores/toast";
import { useThemeStore } from "@/theme/ThemeProvider";
import { THEMES } from "@/theme/tokens";
import type { FontSizeName, ThemeName } from "@/theme/tokens";

export default function ProfileScreen() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const fontSize = useThemeStore((s) => s.fontSize);
  const setFontSize = useThemeStore((s) => s.setFontSize);
  const notifOn = useThemeStore((s) => s.notifOn);
  const toggleNotif = useThemeStore((s) => s.toggleNotif);
  const t = THEMES[theme];

  const [userId, setUserId] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState("suggestion");
  const [feedbackContent, setFeedbackContent] = useState("");

  const { data: overview = "" } = useQuery({
    queryKey: ["profile", "overview"],
    queryFn: async () => {
      const uid = await currentUserId();
      setUserId(uid);
      return fetchResearchOverview(uid);
    },
  });

  const { data: usage, error: usageError } = useQuery({
    queryKey: ["profile", "usage"],
    queryFn: fetchUsage,
  });

  const doSignOut = async () => {
    try {
      await signOut();
      toast("已退出登录");
    } catch (err) {
      toast(humanError(toAppError(err)));
    }
  };

  const sendFeedback = async () => {
    const content = feedbackContent.trim();
    if (!content || !userId) return;
    try {
      await submitFeedback(userId, feedbackCategory, content);
      setFeedbackContent("");
      setFeedbackOpen(false);
      toast("感谢反馈，我们会尽快处理");
    } catch (err) {
      toast(humanError(toAppError(err)));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <TopBar title="我的" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 研究主线 */}
        <View style={[styles.card, { backgroundColor: t.paper, borderColor: t.border }]}>
          <View style={styles.cardHead}>
            <Icon name="flag" size={17} color={t.primary} />
            <Text style={[styles.cardTitle, { color: t.primary }]}>研究主线</Text>
          </View>
          <Text style={[styles.overview, { color: overview ? t.text : t.text3 }]}>
            {overview || "尚未建立研究主线。第二版将支持编辑，并用于 AI 研究对话。"}
          </Text>
        </View>

        {/* 账户与会员 */}
        <View style={[styles.card, { backgroundColor: t.paper, borderColor: t.border }]}>
          <View style={styles.cardHead}>
            <Icon name="workspace-premium" size={17} color={t.primary} />
            <Text style={[styles.cardTitle, { color: t.primary }]}>账户与会员</Text>
          </View>
          {usageError ? (
            <AppText variant="small" color={t.danger}>额度信息加载失败，请稍后重试</AppText>
          ) : usage ? (
            <>
              <ProfileRow label="当前计划" value={usage.plan === "pro" ? "识谛 Pro" : "免费版"} />
              <ProfileRow label="本月剩余积分" value={`${usage.creditsRemaining} 积分`} />
              <View style={styles.quotaBar}>
                <View
                  style={[
                    styles.quotaFill,
                    { backgroundColor: t.accent, width: `${Math.min(100, Math.max(2, usage.creditsRemaining))}%` },
                  ]}
                />
              </View>
              <AppText variant="caption" style={{ marginTop: 8 }}>
                积分用于 AI 摘要与问答（第二版），通过卡密或会员权益补充
              </AppText>
            </>
          ) : (
            <AppText variant="small">加载中…</AppText>
          )}
        </View>

        {/* 设置 */}
        <View style={[styles.card, { backgroundColor: t.paper, borderColor: t.border }]}>
          <View style={styles.cardHead}>
            <Icon name="tune" size={17} color={t.primary} />
            <Text style={[styles.cardTitle, { color: t.primary }]}>设置</Text>
          </View>
          <AppText variant="label" style={{ marginBottom: 6 }}>主题</AppText>
          <Segmented<ThemeName>
            options={[
              { key: "light", label: "浅色" },
              { key: "dark", label: "深色" },
            ]}
            value={theme}
            onChange={setTheme}
          />
          <AppText variant="label" style={{ marginBottom: 6, marginTop: 16 }}>字号</AppText>
          <Segmented<FontSizeName>
            options={[
              { key: "small", label: "小" },
              { key: "medium", label: "中" },
              { key: "large", label: "大" },
            ]}
            value={fontSize}
            onChange={setFontSize}
          />
          <View style={styles.switchRow}>
            <AppText variant="body">通知</AppText>
            <Switch value={notifOn} onChange={() => toggleNotif()} />
          </View>
        </View>

        {/* 关于与反馈 */}
        <View style={[styles.card, { backgroundColor: t.paper, borderColor: t.border }]}>
          <View style={styles.cardHead}>
            <Icon name="info" size={17} color={t.primary} />
            <Text style={[styles.cardTitle, { color: t.primary }]}>关于与反馈</Text>
          </View>
          <Pressable style={styles.rowLink} onPress={() => toast("识谛 shidea · 随身科研工作台")}>
            <AppText variant="body">关于识谛</AppText>
            <Icon name="chevron-right" size={16} color={t.text3} />
          </Pressable>
          <Pressable style={styles.rowLink} onPress={() => setFeedbackOpen(true)}>
            <AppText variant="body">意见反馈</AppText>
            <Icon name="chevron-right" size={16} color={t.text3} />
          </Pressable>
        </View>

        <Button title="退出登录" variant="danger" style={{ marginTop: 8 }} onPress={() => void doSignOut()} />
      </ScrollView>

      {/* 反馈弹层 */}
      <Sheet visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} title="意见反馈">
        <View style={styles.feedbackChips}>
          {(["suggestion", "bug", "other"] as const).map((cat) => (
            <Pressable
              key={cat}
              onPress={() => setFeedbackCategory(cat)}
              style={[
                styles.feedbackChip,
                { borderColor: feedbackCategory === cat ? t.accent : t.border },
                feedbackCategory === cat && { backgroundColor: t.bg },
              ]}
            >
              <Text
                style={{
                  fontSize: 12,
                  color: feedbackCategory === cat ? t.primary : t.text2,
                  fontWeight: feedbackCategory === cat ? "500" : "400",
                }}
              >
                {cat === "suggestion" ? "建议" : cat === "bug" ? "问题反馈" : "其他"}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={feedbackContent}
          onChangeText={setFeedbackContent}
          placeholder="写下你的想法或遇到的问题…"
          placeholderTextColor={t.text3}
          multiline
          style={[styles.feedbackInput, { backgroundColor: t.bg, borderColor: t.border, color: t.text }]}
        />
        <Button title="提交" onPress={() => void sendFeedback()} style={{ marginTop: 10 }} />
      </Sheet>
    </View>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  const t = THEMES[useThemeStore.getState().theme];
  return (
    <View style={[styles.profileRow, { borderTopColor: t.border }]}>
      <Text style={{ color: t.text2, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 13 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 60 },
  card: {
    borderRadius: 12,
    borderWidth: 0.5,
    padding: 14,
    marginBottom: 14,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: "500" },
  overview: { fontSize: 13, lineHeight: 20 },
  profileRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 0.5,
  },
  quotaBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E4EDEC",
    overflow: "hidden",
    marginTop: 8,
  },
  quotaFill: { height: 6, borderRadius: 3 },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
  },
  rowLink: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  },
  feedbackChips: { flexDirection: "row", gap: 8, marginBottom: 12 },
  feedbackChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 0.5,
  },
  feedbackInput: {
    minHeight: 72,
    borderRadius: 8,
    borderWidth: 0.5,
    padding: 10,
    fontSize: 13,
    textAlignVertical: "top",
  },
});
