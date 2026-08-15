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
  const { data, error: sessionError } = await supabase.auth.getSession();

  const headers = new Headers(init.headers);
  headers.set("apikey", supabaseAnonKey);
  headers.set(
    "Authorization",
    `Bearer ${data.session?.access_token || supabaseAnonKey}`,
  );

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      ...init,
      headers,
    });

    // If we get 401, try refreshing the session and retry once
    if (response.status === 401 && data.session) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();

      if (!refreshError && refreshed.session) {
        headers.set("Authorization", `Bearer ${refreshed.session.access_token}`);
        return await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
          ...init,
          headers,
        });
      }
    }

    return response;
  } catch (error) {
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
      throw new Error("NETWORK_REQUEST_FAILED");
    }
    throw error;
  }
}
