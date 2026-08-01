import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase auth session cookie on every matched request.
// This middleware performs cookie refresh ONLY — no redirect or auth-gating
// logic lives here. Auth gating (if any) happens per-route in later tasks.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  // Guests (no Supabase session cookie at all) have nothing to refresh or
  // verify. Skipping the network round-trip to Supabase Auth for them matters
  // because most traffic on the busiest customer routes (/, /track) is
  // guests — this app explicitly allows uploading without an account — so
  // every tab switch was paying for an auth check that could never do
  // anything. Logged-in users (any route, any role) are unaffected: their
  // session cookie is present, so this check passes through to the real
  // verification below exactly as before.
  const hasSessionCookie = request.cookies.getAll().some((c) => /^sb-.*-auth-token/.test(c.name));
  if (!hasSessionCookie) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({
          request
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  });

  // Do not run code between createServerClient and this call.
  // Verify the access token before downstream Server Components and Route
  // Handlers read the refreshed cookies. getSession() alone is not suitable
  // for authorization because its cookie payload is not independently checked.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (Route Handlers verify auth themselves via requireStaff/getUser,
     *   and can refresh + set session cookies on their own responses; running
     *   getClaims here doubled the Supabase round-trips on every dashboard
     *   poll)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static image extensions
     */
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
  ]
};
