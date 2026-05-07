import type { FindingStatus, CorrectiveActionStatus, SessionStatus } from '@/lib/types';

const FINDING_STYLES: Record<FindingStatus, string> = {
  'Not Assessed': 'bg-slate-100 text-slate-600 border-slate-200',
  'Conformity':   'bg-green-100 text-green-700 border-green-200',
  'OBS':          'bg-blue-100 text-blue-700 border-blue-200',
  'OFI':          'bg-amber-100 text-amber-700 border-amber-200',
  'NC-Minor':     'bg-orange-100 text-orange-700 border-orange-200',
  'NC-Major':     'bg-red-100 text-red-700 border-red-200',
};

const CA_STYLES: Record<CorrectiveActionStatus, string> = {
  'Open':        'bg-blue-100 text-blue-700 border-blue-200',
  'In Progress': 'bg-amber-100 text-amber-700 border-amber-200',
  'Closed':      'bg-green-100 text-green-700 border-green-200',
  'Overdue':     'bg-red-100 text-red-700 border-red-200',
};

const SESSION_STYLES: Record<SessionStatus, string> = {
  'Planned':     'bg-slate-100 text-slate-600 border-slate-200',
  'In Progress': 'bg-blue-100 text-blue-700 border-blue-200',
  'Completed':   'bg-green-100 text-green-700 border-green-200',
};

interface Props {
  status: FindingStatus | CorrectiveActionStatus | SessionStatus;
  type?: 'finding' | 'ca' | 'session';
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, type = 'finding', size = 'md' }: Props) {
  let cls = '';
  if (type === 'ca') cls = CA_STYLES[status as CorrectiveActionStatus] ?? '';
  else if (type === 'session') cls = SESSION_STYLES[status as SessionStatus] ?? '';
  else cls = FINDING_STYLES[status as FindingStatus] ?? '';

  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1';

  return (
    <span className={`inline-flex items-center font-medium rounded-full border ${sizeClass} ${cls}`}>
      {status}
    </span>
  );
}

export const FINDING_STATUSES: FindingStatus[] = [
  'Not Assessed', 'Conformity', 'OBS', 'OFI', 'NC-Minor', 'NC-Major',
];

export const CA_STATUSES: CorrectiveActionStatus[] = [
  'Open', 'In Progress', 'Closed', 'Overdue',
];

export const SESSION_STATUSES: SessionStatus[] = [
  'Planned', 'In Progress', 'Completed',
];
