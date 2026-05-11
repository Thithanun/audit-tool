import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function redirectTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // ── Env-var guard ──────────────────────────────────────────────────────────
  // If Supabase env vars are missing (e.g. not set in Vercel dashboard),
  // createServerClient receives undefined and getUser() will throw.
  // Catch this early and fail-secure instead of crashing the edge function.
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      '[middleware] Missing env vars: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Add them in the Vercel dashboard → Settings → Environment Variables.',
    );
    // Fail-secure: block every route except /login.
    return pathname === '/login'
      ? NextResponse.next({ request })
      : redirectTo(request, '/login');
  }

  // ── Session check ──────────────────────────────────────────────────────────
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

  // Must use getUser() (not getSession()) — validates the JWT server-side.
  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      // AuthSessionMissingError is normal for unauthenticated requests — not a bug.
      if (error.name !== 'AuthSessionMissingError') {
        console.error('[middleware] getUser error:', error.name, error.message);
      }
    } else {
      user = data.user;
    }
  } catch (err) {
    // Network error, malformed response, etc. — fail-secure.
    console.error('[middleware] getUser threw:', err);
  }

  // ── Route guards ───────────────────────────────────────────────────────────
  // /auth/* handles token exchange and password setup — must stay public.
  const isPublic = pathname === '/login' || pathname.startsWith('/auth/');

  if (!user && !isPublic) {
    return redirectTo(request, '/login');
  }

  if (user && pathname === '/login') {
    return redirectTo(request, '/');
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
