import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || "";

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = createClient(
  supabaseUrl || "https://invalid.supabase.co",
  supabaseAnonKey || "missing-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export async function functionRequest(
  functionName: string,
  init: RequestInit = {},
) {
  if (!supabaseConfigured) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  headers.set("apikey", supabaseAnonKey);
  headers.set(
    "Authorization",
    `Bearer ${data.session?.access_token || supabaseAnonKey}`,
  );
  return fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    ...init,
    headers,
  });
}
