import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Force dynamic so Next.js / CDN never serves a stale cached response.
export const dynamic = 'force-dynamic';

/**
 * GET /api/ncr-number
 *
 * Returns the next available NCR number for the current CE year.
 * Format: NCRyyNNN  (yy = 2-digit CE year, NNN = 3-digit sequence)
 *
 * Uses createServerClient (not createBrowserClient) so that the user's
 * session cookies are forwarded to Supabase — this lets the query pass
 * RLS policies that require auth.uid() to be set.
 *
 * The previous approach used createClient (anonymous) which returned
 * totalRows: 0 because RLS blocked all rows for unauthenticated requests.
 */
export async function GET(request: NextRequest) {
  const year   = new Date().getFullYear();
  const yy     = String(year).slice(-2);  // "26" for 2026
  const prefix = `NCR${yy}`;             // "NCR26"

  // ── Build an authenticated Supabase client ──────────────────────────────
  // Forward every cookie from the browser request so Supabase can validate
  // the user's session and apply RLS correctly.
  const cookieHeader = request.headers.get('cookie') ?? '';

  // Parse "name=value; name2=value2" into the array shape @supabase/ssr expects.
  const parsedCookies = cookieHeader
    .split(';')
    .map(c => c.trim())
    .filter(Boolean)
    .map(c => {
      const eqIdx = c.indexOf('=');
      return eqIdx === -1
        ? { name: c, value: '' }
        : { name: c.slice(0, eqIdx), value: c.slice(eqIdx + 1) };
    });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: () => parsedCookies,
        setAll: () => {}, // read-only — we never need to refresh tokens here
      },
    },
  );

  // ── Query ────────────────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('corrective_actions')
    .select('id, data');

  if (error) {
    console.error('[ncr-number] DB error:', error);
    return NextResponse.json(
      { error: `Database error: ${error.message}` },
      { status: 500 },
    );
  }

  const total = data?.length ?? 0;

  // Walk every row and find the highest sequence used this year.
  let maxSeq = 0;
  const thisYearNcrs: string[] = [];

  for (const row of data ?? []) {
    const num = (row.data as Record<string, unknown>).ncrNumber as string | undefined;
    if (typeof num === 'string' && num.startsWith(prefix)) {
      thisYearNcrs.push(num);
      const seq = parseInt(num.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  const nnn       = String(maxSeq + 1).padStart(3, '0');
  const ncrNumber = `${prefix}${nnn}`;

  const debug = { year, prefix, totalRows: total, thisYearNcrs, maxSeq, next: ncrNumber };
  console.log('[ncr-number]', JSON.stringify(debug));

  return NextResponse.json(
    { ncrNumber, debug },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    },
  );
}
