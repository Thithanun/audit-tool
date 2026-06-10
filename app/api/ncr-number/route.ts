import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Force this route to always run dynamically — never let Next.js cache it.
export const dynamic = 'force-dynamic';

// ── Server-side Supabase client ───────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);

/**
 * GET /api/ncr-number
 *
 * Returns the next available NCR number for the current CE year.
 * Format: NCRyyNNN  (yy = 2-digit CE year, NNN = 3-digit sequence)
 *
 *   NCR26001 → NCR26002 → NCR26003 …   (within 2026)
 *   NCR27001 → NCR27002 …              (year rolls over → restart at 001)
 */
export async function GET() {
  const year   = new Date().getFullYear();
  const yy     = String(year).slice(-2);  // "26" for 2026
  const prefix = `NCR${yy}`;             // "NCR26"

  // Fetch ALL corrective_actions — no JSONB filter (Supabase PostgREST does
  // not support `like` on data->>field reliably).  An audit tool's record
  // count is small enough that this is never a bottleneck.
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

  // ── Debug info (included in every response so the client can log it) ──────
  const debug = {
    year,
    prefix,
    totalRows: total,
    thisYearNcrs,   // all NCR numbers found for this year
    maxSeq,
    next: ncrNumber,
  };

  console.log('[ncr-number]', JSON.stringify(debug));

  return NextResponse.json(
    { ncrNumber, debug },
    {
      headers: {
        // Tell every cache layer (CDN, browser, Next.js) not to store this.
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    },
  );
}
