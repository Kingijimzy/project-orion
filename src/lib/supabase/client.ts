import { createBrowserClient } from '@supabase/ssr';

type PublicEnv = { supabaseUrl?: string; supabaseAnonKey?: string };

// The server injects the public Supabase values at request time (see app/layout.tsx)
// so the browser works even when the host did not inline NEXT_PUBLIC_* at build time.
function runtimePublicEnv(): PublicEnv {
  return (globalThis as unknown as { __ORION_PUBLIC__?: PublicEnv }).__ORION_PUBLIC__ ?? {};
}

export function supabaseBrowserConfiguration() {
  const runtime = runtimePublicEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || runtime.supabaseUrl;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || runtime.supabaseAnonKey;
  return url && anonKey ? { url, anonKey } : null;
}

let client: ReturnType<typeof createBrowserClient> | null = null;
export function getSupabaseBrowserClient() {
  const config = supabaseBrowserConfiguration();
  if (!config) return null;
  client ??= createBrowserClient(config.url, config.anonKey);
  return client;
}
