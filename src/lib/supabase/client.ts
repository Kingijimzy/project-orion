import { createBrowserClient } from '@supabase/ssr';

export function supabaseBrowserConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

let client: ReturnType<typeof createBrowserClient> | null = null;
export function getSupabaseBrowserClient() {
  const config = supabaseBrowserConfiguration();
  if (!config) return null;
  client ??= createBrowserClient(config.url, config.anonKey);
  return client;
}
