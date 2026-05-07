import { ALL_CLAUSES } from './seed-data';

/**
 * Convert a free-text relatedClauses string (legacy format) into a concrete
 * array of clauseRef strings by running the two-pass regex parser.
 *
 * Supported patterns (comma or "and" separated):
 *   "Clause 5,7,9"     → all sub-clauses of 5, 7, 9
 *   "Annex A.5.4"      → ["A.5.4"]
 *   "A.5.2, A.5.3"     → ["A.5.2", "A.5.3"]
 */
export function parseClauseText(text: string): string[] {
  if (!text.trim()) return [];
  const normalised = text.replace(/\band\b/gi, ',');
  const result: string[] = [];

  // Pass 1 — Annex A controls
  const annexRe = /\bA\.\d+(?:\.\d+)*\b/g;
  for (const ref of normalised.match(annexRe) ?? []) {
    if (ALL_CLAUSES.some(c => c.clauseRef === ref)) result.push(ref);
  }

  // Pass 2 — ISMS clause numbers after the keyword "Clause"
  const withoutAnnex = normalised
    .replace(/\bAnnex\b/gi, '')
    .replace(/\bA\.\d+(?:\.\d+)*\b/g, '');
  const clauseRe = /\bClause\b\s*([\d][\d\s,]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = clauseRe.exec(withoutAnnex)) !== null) {
    const nums = m[1].split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
    for (const num of nums) {
      ALL_CLAUSES
        .filter(c => c.clauseRef === num || c.clauseRef.startsWith(num + '.'))
        .forEach(c => result.push(c.clauseRef));
    }
  }

  return [...new Set(result)];
}
