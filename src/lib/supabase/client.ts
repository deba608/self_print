import { createBrowserClient } from '@supabase/ssr';

// Browser client for use in Client Components (forms, hooks, etc.).
// Safe to import client-side: uses the anon key, which is RLS-protected.
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
