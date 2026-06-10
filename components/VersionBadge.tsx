'use client';

import type { Framework, StandardVersion } from '@/lib/types';
import { getVersionLabel } from '@/lib/store';

interface Props {
  framework: Framework;
  standardVersionId?: string;
  versionsMap?: Map<string, StandardVersion>;
  /** Extra Tailwind classes for the wrapping span */
  className?: string;
}

/**
 * Inline badge that shows the standard + version, e.g. "ISO 27001 · 2022".
 *
 * Resolves the label from the DB-backed versionsMap when standardVersionId is
 * provided; falls back to a static label derived from the framework field for
 * legacy checklist items created before the standard_versions table existed.
 */
export default function VersionBadge({ framework, standardVersionId, versionsMap, className = '' }: Props) {
  const label = getVersionLabel(framework, standardVersionId, versionsMap);

  const colorClass =
    framework === 'ISO27001'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : 'bg-purple-50 text-purple-700 border-purple-200';

  return (
    <span
      className={`inline-flex items-center text-xs font-medium border rounded-full px-2 py-0.5 ${colorClass} ${className}`}
    >
      {label}
    </span>
  );
}
