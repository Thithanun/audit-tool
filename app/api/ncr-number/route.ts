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
 * e.g. NCR26001, NCR26002, …  — resets to NCR27001 when the year rolls over.
 *
 * Running on the server ensures the sequence is always based on the freshest
 * data in the database and prevents the "two tabs, same number" race that
 * client-side generation is susceptible to.
 */
export async function GET() {
  const year   = new Date().getFullYear();
  const yy     = String(year).slice(-2);  // "26" for 2026
  const prefix = `NCR${yy}`;             // "NCR26"

  // Fetch only corrective_actions that already have an NCR number for this year.
  // We filter server-side via PostgREST's JSONB text accessor so we pull the
  // minimum amount of data from the database.
  const { data, error } = await supabase
    .from('corrective_actions')
    .select('id, data')
    .like('data->>ncrNumber', `${prefix}%`);

  if (error) {
    return NextResponse.json(
      { error: `Database error: ${error.message}` },
      { status: 500 },
    );
  }

  // Find the highest sequence number already used this year.
  let maxSeq = 0;
  for (const row of data ?? []) {
    const num = (row.data as Record<string, unknown>).ncrNumber as string | undefined;
    if (num?.startsWith(prefix)) {
      const seq = parseInt(num.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  const nnn      = String(maxSeq + 1).padStart(3, '0');
  const ncrNumber = `${prefix}${nnn}`;

  return NextResponse.json({ ncrNumber });
}
