import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return noCache(NextResponse.redirect(url));
}

// Force the browser / CDN to always re-request HTML documents and RSC payloads
// instead of serving a stale copy from disk or bfcache. Static assets are
// already excluded by the matcher below, so their long-lived cache is untouched.
function noCache(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate',
  );
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ── Env-var guard ──────────────────────────────────────────────────────────
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      '[proxy] Missing env vars: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Add them in the Vercel dashboard → Settings → Environment Variables.',
    );
    return pathname === '/login'
      ? noCache(NextResponse.next({ request }))
      : redirectTo(request, '/login');
  }

  // ── Session check (optimistic — cookie only, no network call) ─────────────
  // getSession() reads the JWT from the request cookies and parses it locally.
  // It does NOT make a round-trip to Supabase Auth, so it never times out and
  // cannot cause false "not logged in" redirects due to network latency.
  // Full JWT validation happens in AuthContext on the client after page load.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  let hasSession = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    hasSession = session !== null;
  } catch (err) {
    // Malformed cookie or unexpected error — fail open so a real user isn't
    // locked out; AuthContext will re-validate and redirect if truly unauthed.
    console.error('[proxy] getSession error:', err);
    hasSession = true;
  }

  // ── Route guards ───────────────────────────────────────────────────────────
  // /auth/* handles token exchange and password setup — must stay public.
  const isPublic = pathname === '/login' || pathname.startsWith('/auth/');

  if (!hasSession && !isPublic) {
    return redirectTo(request, '/login');
  }

  if (hasSession && pathname === '/login') {
    return redirectTo(request, '/');
  }

  return noCache(supabaseResponse);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
