// 识谛移动端设计令牌 —— 严格对齐 doc/shidea-mobile-prototype.html 的明暗两套配色
// 并在其基础上补充间距、圆角、字号等工程化 tokens。

export type ThemeName = "light" | "dark";
export type FontSizeName = "small" | "medium" | "large";

export interface ThemeTokens {
  name: ThemeName;
  primary: string;
  accent: string;
  bg: string;
  paper: string;
  text: string;
  text2: string;
  text3: string;
  cite: string;
  danger: string;
  border: string;
  chip: string;
  shadow: string;
  shadowOpacity: number;
  statusbar: string;
}

export const THEMES: Record<ThemeName, ThemeTokens> = {
  light: {
    name: "light",
    primary: "#063477",
    accent: "#078B8E",
    bg: "#F4FBFA",
    paper: "#FFFFFF",
    text: "#102F4B",
    text2: "#597083",
    text3: "#94A6B3",
    cite: "#B7791F",
    danger: "#C0392F",
    border: "#E4EDEC",
    chip: "#F4FBFA",
    shadow: "rgba(6,52,119,0.06)",
    shadowOpacity: 0.06,
    statusbar: "#102F4B",
  },
  dark: {
    name: "dark",
    primary: "#6FA8E0",
    accent: "#3FC9C2",
    bg: "#0C1B27",
    paper: "#132639",
    text: "#E7F0F5",
    text2: "#96ABBC",
    text3: "#5D7286",
    cite: "#E3AD58",
    danger: "#E68078",
    border: "#213A4C",
    chip: "#0F2536",
    shadow: "transparent",
    shadowOpacity: 0,
    statusbar: "#E7F0F5",
  },
};

// 原型 --fs: small=14px medium=16px large=18px
export const FONT_SCALES: Record<FontSizeName, number> = {
  small: 0.875,
  medium: 1,
  large: 1.125,
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const Radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  sheet: 20,
  pill: 999,
} as const;

export const Layout = {
  tabBarHeight: 62,
  topbarHeight: 54,
  contentMaxWidth: 720,
} as const;

export const STATUS_LABEL: Record<string, string> = {
  unread: "待读",
  reading: "阅读中",
  later: "待读",
  read: "已读",
};

// 与网页端一致的进度计算
export function paperProgress(currentPage: number | null | undefined, pageCount: number | null | undefined): number {
  if (!pageCount || !currentPage) return 0;
  return Math.min(100, Math.round((currentPage / pageCount) * 100));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(value: string): string {
  const d = new Date(value);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function relativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return formatDate(value);
}

export function sourceName(url: string | null): string {
  if (!url) return "本地 PDF";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "本地 PDF";
  }
}
