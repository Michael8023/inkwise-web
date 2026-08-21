import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { THEMES, type FontSizeName, type ThemeName } from "./tokens";

const STORAGE_KEY = "shidea.mobile.prefs";

interface ThemePrefs {
  theme: ThemeName;
  fontSize: FontSizeName;
  notifOn: boolean;
}

interface ThemeState extends ThemePrefs {
  setTheme: (theme: ThemeName) => void;
  setFontSize: (size: FontSizeName) => void;
  toggleNotif: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "light",
      fontSize: "medium",
      notifOn: true,
      setTheme: (theme) => set({ theme }),
      setFontSize: (fontSize) => set({ fontSize }),
      toggleNotif: () => set((s) => ({ notifOn: !s.notifOn })),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

/** 组件内取主题 tokens 的便捷 hook */
export function useTheme() {
  const theme = useThemeStore((s) => s.theme);
  const fontSize = useThemeStore((s) => s.fontSize);
  return { tokens: THEMES[theme], theme, fontSize };
}
