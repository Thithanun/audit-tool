import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Handles the magic-link / invite / recovery redirect from Supabase.
 *
 * Supabase sends the user to:
 *   {SITE_URL}/auth/confirm?token_hash=xxx&type=invite
 *
 * This route exchanges the token for a session (writing auth cookies onto the
 * response), then redirects to an appropriate page:
 *   - invite / recovery → /auth/set-password  (user must choose a password)
 *   - email confirmation → /                  (straight to the app)
 *   - invalid / missing  → /login?error=invalid_token
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type       = searchParams.get('type') as EmailOtpType | null;

  if (token_hash && type) {
    // Choose where to redirect after a successful token exchange
    const destination =
      type === 'invite' || type === 'recovery'
        ? `${origin}/auth/set-password`
        : `${origin}/`;

    const response = NextResponse.redirect(destination);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      '';

    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        // Read from the incoming request
        getAll: () => request.cookies.getAll(),
        // Write onto the outgoing response so the browser gets the session cookies
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as CookieOptions),
          );
        },
      },
    });

    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) return response;
  }

  // Fallback: bad / missing token
  return NextResponse.redirect(`${origin}/login?error=invalid_token`);
}
