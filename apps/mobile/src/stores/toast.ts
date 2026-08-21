// 全局 Toast（原型底部黑底圆角提示）
import { create } from "zustand";

interface ToastState {
  message: string;
  visible: boolean;
  show: (message: string, durationMs?: number) => void;
  hide: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToastStore = create<ToastState>((set) => ({
  message: "",
  visible: false,
  show: (message, durationMs = 1900) => {
    if (timer) clearTimeout(timer);
    set({ message, visible: true });
    timer = setTimeout(() => set({ visible: false }), durationMs);
  },
  hide: () => {
    if (timer) clearTimeout(timer);
    set({ visible: false });
  },
}));

export function toast(message: string, durationMs?: number) {
  useToastStore.getState().show(message, durationMs);
}
