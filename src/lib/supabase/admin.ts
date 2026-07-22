import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// SERVER-ONLY — never import this from a Client Component or any code that
// ships to the browser. This client uses the service-role key, which
// bypasses Row Level Security entirely. Use only in trusted server contexts
// (Route Handlers, Server Actions, admin API routes, scripts).

let cachedClient: ReturnType<typeof createSupabaseClient> | null = null;

export function createAdminClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables');
  }

  cachedClient = createSupabaseClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return cachedClient;
}
