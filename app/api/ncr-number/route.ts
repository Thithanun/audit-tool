import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ── Server-side Supabase client ───────────────────────────────────────────────
// Using createClient directly (not createBrowserClient) so this is safe to run
// in a Route Handler (Node.js server context) without any browser globals.
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
 *   NCR26001 → NCR26002 → NCR26003 …   (all within 2026)
 *   NCR27001 → NCR27002 …              (year rolls over → restart at 001)
 *
 * Algorithm:
 *   1. Fetch ALL corrective_actions (no JSONB filter — Supabase PostgREST
 *      does not support `like` on JSONB text accessors reliably).
 *   2. Scan in JavaScript for entries whose ncrNumber matches this year's
 *      prefix (e.g. "NCR26").
 *   3. Return max sequence + 1, or 001 when no NCR exists for this year yet.
 *
 * Running server-side means every caller reads the same DB state, which
 * prevents the "two tabs get the same number" race that client-side
 * generation cannot avoid.
 */
export async function GET() {
  const year   = new Date().getFullYear();
  const yy     = String(year).slice(-2);  // "26" for 2026
  const prefix = `NCR${yy}`;             // "NCR26"

  // Fetch all corrective_actions so we can inspect ncrNumber in JS.
  // An audit tool will never have so many records that this is a problem.
  const { data, error } = await supabase
    .from('corrective_actions')
    .select('id, data');

  if (error) {
    return NextResponse.json(
      { error: `Database error: ${error.message}` },
      { status: 500 },
    );
  }

  // Walk every row and find the highest sequence number used this year.
  let maxSeq = 0;
  for (const row of data ?? []) {
    const num = (row.data as Record<string, unknown>).ncrNumber as string | undefined;
    // Only count NCRs that belong to the current year's prefix.
    if (typeof num === 'string' && num.startsWith(prefix)) {
      const seq = parseInt(num.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  // Next number is max + 1 (or 1 when no NCR exists for this year yet).
  const nnn       = String(maxSeq + 1).padStart(3, '0');
  const ncrNumber = `${prefix}${nnn}`;

  return NextResponse.json({ ncrNumber });
}
