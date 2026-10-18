import test from 'node:test';
import assert from 'node:assert/strict';
import { supabaseBrowserConfiguration } from '../src/lib/supabase/client';

type GlobalWithEnv = typeof globalThis & { __ORION_PUBLIC__?: { supabaseUrl?: string; supabaseAnonKey?: string } };

test('browser Supabase config falls back to the server-injected runtime values', () => {
  const g = globalThis as GlobalWithEnv;
  const previousGlobal = g.__ORION_PUBLIC__;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    g.__ORION_PUBLIC__ = undefined;
    assert.equal(supabaseBrowserConfiguration(), null);

    g.__ORION_PUBLIC__ = { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public-anon-key' };
    assert.deepEqual(supabaseBrowserConfiguration(), { url: 'https://example.supabase.co', anonKey: 'public-anon-key' });

    g.__ORION_PUBLIC__ = { supabaseUrl: 'https://example.supabase.co' };
    assert.equal(supabaseBrowserConfiguration(), null);
  } finally {
    g.__ORION_PUBLIC__ = previousGlobal;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  }
});
