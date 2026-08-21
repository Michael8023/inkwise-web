// 覆盖层组件：底部弹层 Sheet / 全局 Toast / 空态 EmptyState / 导入进度 ProgressSteps / 顶栏 TopBar
import { type ReactNode } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, Spinner, type IconName } from "./core";
import { useThemeStore } from "@/theme/ThemeProvider";
import { useToastStore } from "@/stores/toast";
import { Radius, THEMES } from "@/theme/tokens";

/* ---------- Sheet（底部弹层，原型 .sheet 样式） ---------- */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  height,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  height?: number | `${number}%`;
}) {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  const inset = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlayRoot}>
        <Pressable style={styles.overlayDim} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: t.paper,
              paddingBottom: inset.bottom + 14,
              height,
            },
          ]}
        >
          <View style={[styles.sheetHandle, { backgroundColor: t.border }]} />
          {title ? (
            <Text style={[styles.sheetTitle, { color: t.text }]}>{title}</Text>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

/* ---------- 全局 Toast（原型 .toast） ---------- */
export function ToastHost() {
  const message = useToastStore((s) => s.message);
  const visible = useToastStore((s) => s.visible);
  if (!visible) return null;
  return (
    <View pointerEvents="none" style={styles.toastHost}>
      <View style={styles.toast}>
        <Text numberOfLines={1} style={styles.toastText}>
          {message}
        </Text>
      </View>
    </View>
  );
}

/* ---------- 空态 ---------- */
export function EmptyState({
  icon,
  title,
  subtitle,
  action,
  actionLabel,
  onAction,
  style,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}) {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  return (
    <View style={[styles.empty, style]}>
      <Icon name={icon} size={40} color={t.accent} />
      <Text style={[styles.emptyTitle, { color: t.text2 }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.emptySub, { color: t.text3 }]}>{subtitle}</Text>
      ) : null}
      {action}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={[styles.emptyAction, { borderColor: t.accent }]}
        >
          <Icon name="add" size={16} color={t.accent} />
          <Text style={{ color: t.accent, fontSize: 13 }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ---------- 导入进度步骤（原型 .progress-list） ---------- */
export function ProgressSteps({ steps, activeIndex }: { steps: string[]; activeIndex: number }) {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  return (
    <View style={{ gap: 12, paddingVertical: 6 }}>
      {steps.map((label, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <View key={label} style={styles.progressRow}>
            <View
              style={[
                styles.progressDot,
                {
                  borderColor: done || active ? t.accent : t.border,
                  backgroundColor: done ? t.accent : "transparent",
                },
              ]}
            >
              {done ? (
                <Icon name="check" size={13} color="#fff" />
              ) : active ? (
                <Spinner size="small" color={t.accent} />
              ) : null}
            </View>
            <Text
              style={{
                fontSize: 13,
                color: active || done ? t.text : t.text2,
              }}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/* ---------- 顶栏（原型 .topbar） ---------- */
export function TopBar({
  title,
  subtitle,
  actions,
  onBack,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onBack?: () => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const t = THEMES[theme];
  return (
    <View style={[styles.topbar, { backgroundColor: t.bg }]}>
      <View style={styles.topbarRow}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={8} style={{ marginRight: 4 }}>
            <Icon name="arrow-back" size={22} color={t.primary} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={[styles.pageTitle, { color: t.primary }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.pageSub, { color: t.text2 }]}>{subtitle}</Text>
          ) : null}
        </View>
        {actions ? <View style={styles.topbarActions}>{actions}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: { flex: 1, justifyContent: "flex-end" },
  overlayDim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(6,20,32,0.45)",
  },
  sheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: "85%",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 14,
  },
  sheetTitle: { fontSize: 16, fontWeight: "500", marginBottom: 14 },
  toastHost: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 100,
    alignItems: "center",
    zIndex: 100,
  },
  toast: {
    backgroundColor: "#20323f",
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 16,
    maxWidth: "85%",
  },
  toastText: { color: "#fff", fontSize: 12.5 },
  empty: {
    alignItems: "center",
    paddingVertical: 44,
    paddingHorizontal: 16,
    gap: 8,
  },
  emptyTitle: { fontSize: 15, fontWeight: "500", marginTop: 6 },
  emptySub: { fontSize: 12, textAlign: "center", lineHeight: 18 },
  emptyAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 0.5,
    borderRadius: Radius.md,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 10,
  },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  progressDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  topbar: { paddingVertical: 6, paddingHorizontal: 16 },
  topbarRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pageTitle: { fontSize: 20, fontWeight: "600" },
  pageSub: { fontSize: 12, marginTop: 2 },
  topbarActions: { flexDirection: "row", alignItems: "center", gap: 14 },
});
