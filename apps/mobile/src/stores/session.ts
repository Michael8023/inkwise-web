// 会话状态：由 supabase.auth 驱动（onAuthStateChange），供路由守卫与全局 UI 使用。
import { create } from "zustand";
import { supabase } from "../lib/supabase";

export type SessionStatus = "loading" | "signedOut" | "signedIn";

interface SessionState {
  status: SessionStatus;
  userId: string | null;
  email: string | null;
  displayName: string | null;
  boot: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: "loading",
  userId: null,
  email: null,
  displayName: null,

  boot: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user) {
      set({
        status: "signedIn",
        userId: session.user.id,
        email: session.user.email ?? null,
        displayName: session.user.user_metadata?.display_name ?? null,
      });
    } else {
      set({ status: "signedOut", userId: null, email: null, displayName: null });
    }
    supabase.auth.onAuthStateChange((event, next) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        set({
          status: "signedIn",
          userId: next?.user.id ?? null,
          email: next?.user.email ?? null,
          displayName: next?.user.user_metadata?.display_name ?? null,
        });
      } else if (event === "SIGNED_OUT") {
        get().reset();
      }
    });
  },

  refresh: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      set({
        status: "signedIn",
        userId: user.id,
        email: user.email ?? null,
        displayName: user.user_metadata?.display_name ?? null,
      });
    }
  },

  reset: () =>
    set({ status: "signedOut", userId: null, email: null, displayName: null }),
}));
