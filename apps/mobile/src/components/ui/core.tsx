// 基础 UI 原语：Icon / Text / Button / TextField / Spinner / Tag / Card / Chip / Segmented / Switch
import { MaterialIcons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Radius, Spacing, THEMES } from "@/theme/tokens";
import { useThemeStore } from "@/theme/ThemeProvider";

type Theme = ReturnType<typeof useThemeStore.getState>["theme"];

function tokens(theme: Theme) {
  return THEMES[theme];
}

/* ---------- Icon ---------- */
export type IconName = ComponentProps<typeof MaterialIcons>["name"];

export function Icon({
  name,
  size = 20,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: TextStyle;
}) {
  return <MaterialIcons name={name} size={size} color={color} style={style} />;
}

/* ---------- Text ---------- */
export function AppText({
  children,
  variant = "body",
  color,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: "title" | "subtitle" | "body" | "small" | "caption" | "label";
  color?: string;
  style?: TextStyle;
  numberOfLines?: number;
}) {
  const theme = useThemeStore((s) => s.theme);
  const fontSize = useThemeStore((s) => s.fontSize);
  const t = tokens(theme);
  const scale = fontSize === "small" ? 0.875 : fontSize === "large" ? 1.125 : 1;
  const map: Record<string, TextStyle> = {
    title: { fontSize: 20 * scale, fontWeight: "600", color: t.primary },
    subtitle: { fontSize: 13, color: t.text2 },
    body: { fontSize: 14 * scale, color: t.text, lineHeight: 21 * scale },
    small: { fontSize: 12, color: t.text2 },
    caption: { fontSize: 11, color: t.text3 },
    label: { fontSize: 12, color: t.text2 },
  };
  return (
    <Text
      style={[map[variant], { color: color ?? map[variant].color }, style]}
      numberOfLines={numberOfLines}
    >
      {children}
    </Text>
  );
}

/* ---------- Button ---------- */
export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  style,
  textStyle,
}: {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "outline" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  style?: ViewStyle;
  textStyle?: TextStyle;
}) {
  const theme = useThemeStore((s) => s.theme);
  const t = tokens(theme);
  const bg =
    variant === "primary"
      ? t.primary
      : variant === "danger"
        ? t.danger
        : "transparent";
  const border = variant === "outline" ? t.border : "transparent";
  const fg = variant === "primary" || variant === "danger" ? "#fff" : variant === "outline" ? t.primary : t.text2;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={17} color={fg} /> : null}
          <Text style={[styles.btnText, { color: fg }, textStyle]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

/* ---------- TextField ---------- */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  multiline,
  autoFocus,
  maxLength,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: ComponentProps<typeof TextInput>["keyboardType"];
  multiline?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
}) {
  const theme = useThemeStore((s) => s.theme);
  const t = tokens(theme);
  return (
    <View style={{ marginBottom: Spacing.md }}>
      {label ? (
        <Text style={[styles.fieldLabel, { color: t.text2 }]}>{label}</Text>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.text3}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        multiline={multiline}
        autoFocus={autoFocus}
        maxLength={maxLength}
        autoCapitalize="none"
        style={[
          styles.input,
          {
            backgroundColor: t.bg,
            borderColor: t.border,
            color: t.text,
          },
        ]}
      />
    </View>
  );
}

/* ---------- Spinner ---------- */
export function Spinner({ size = "small", color }: { size?: "small" | "large"; color?: string }) {
  const theme = useThemeStore((s) => s.theme);
  return <ActivityIndicator size={size} color={color ?? tokens(theme).accent} />;
}

/* ---------- Tag ---------- */
export function Tag({ children, color, style }: { children: ReactNode; color?: string; style?: ViewStyle }) {
  const theme = useThemeStore((s) => s.theme);
  const t = tokens(theme);
  return (
    <View
      style={[
        styles.tag,
        { backgroundColor: t.chip, borderColor: t.border },
        style,
      ]}
    >
      <Text style={{ fontSize: 11, color: color ?? t.text2 }}>{children}</Text>
    </View>
  );
}

/* ---------- Card ---------- */
export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const theme = useThemeStore((s) => s.theme);
  const t = tokens(theme);
  const content = (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.paper,
          borderColor: t.border,
          shadowColor: t.primary,
          shadowOpacity: t.shadowOpacity,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}>
        {content}
      </Pressable>
    );
  }
  return content;
}

/* ---------- Chip（筛选 / 快捷追问 / 上下文） ---------- */
export function Chip({
  label,
  active,
  onPress,
  accent,
  style,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  accent?: boolean;
  style?: ViewStyle;
}) {
  const theme = useThemeStore((s) => s.theme);
  const t = tokens(theme);
  const bg = active ? t.primary : accent ? t.bg : t.chip;
  const fg = active ? "#fff" : accent ? t.accent : t.text2;
  const border = accent && !active ? t.accent : t.border;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: bg, borderColor: border, opacity: pressed ? 0.8 : 1 },
        style,
      ]}
    >
      <Text style={{ fontSize: 12, color: fg, fontWeight: active ? "500" : "400" }}>{label}</Text>
    </Pressable>
  );
}

/* ---------- Segmented ---------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const t = tokens(theme);
  return (
    <View style={[styles.seg, { borderColor: t.border }]}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[
              styles.segOpt,
              active && { backgroundColor: t.primary, borderColor: t.primary },
            ]}
          >
            <Text style={{ fontSize: 12, color: active ? "#fff" : t.text2 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- Switch ---------- */
export function Switch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const theme = useThemeStore((s) => s.theme);
  const t = tokens(theme);
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={[styles.switch, { backgroundColor: value ? t.accent : t.border }]}
    >
      <View style={[styles.knob, value && { left: 18 }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: Radius.md,
    borderWidth: 0.5,
  },
  btnText: { fontSize: 14, fontWeight: "500" },
  fieldLabel: { fontSize: 12, marginBottom: 5 },
  input: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    borderWidth: 0.5,
    fontSize: 14,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    borderWidth: 0.5,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 0.5,
    padding: 14,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 0.5,
  },
  seg: {
    flexDirection: "row",
    gap: 6,
    padding: 4,
    borderRadius: Radius.md,
    borderWidth: 0.5,
  },
  segOpt: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 0.5,
    borderColor: "transparent",
  },
  switch: {
    width: 38,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  knob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
