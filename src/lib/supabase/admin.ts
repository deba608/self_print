import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

// SERVER-ONLY — never import this from a Client Component or any code that
// ships to the browser. This client uses the service-role key, which
// bypasses Row Level Security entirely. Use only in trusted server contexts
// (Route Handlers, Server Actions, admin API routes, scripts).

// Typed explicitly as SupabaseClient<any, any, any> rather than
// `ReturnType<typeof createSupabaseClient>`: TS does not apply a generic
// function's default type parameters when only referencing its type via
// `typeof`, so that pattern left the Database generic unresolved and made
// `.from(table).insert(...)` calls fail to typecheck (row type collapsed to
// `never`). Calling `createSupabaseClient<any>(...)` below keeps that
// resolved consistently.
let cachedClient: SupabaseClient<any, any, any> | null = null;

export function createAdminClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables');
  }

  cachedClient = createSupabaseClient<any>(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return cachedClient;
}
