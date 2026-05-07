import type { AuditSession, ChecklistItem, CorrectiveAction } from './types';

const KEYS = {
  sessions: 'audit_sessions',
  checklist: 'audit_checklist',
  corrective: 'audit_corrective_actions',
} as const;

function load<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}

function save<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data));
}

export function uid(): string {
  return crypto.randomUUID();
}

// Sessions
export function getSessions(): AuditSession[] {
  return load<AuditSession>(KEYS.sessions);
}

export function saveSession(session: AuditSession): void {
  const all = getSessions();
  const idx = all.findIndex(s => s.id === session.id);
  if (idx >= 0) all[idx] = session;
  else all.push(session);
  save(KEYS.sessions, all);
}

export function deleteSession(id: string): void {
  save(KEYS.sessions, getSessions().filter(s => s.id !== id));
  save(KEYS.checklist, getChecklistItems().filter(c => c.sessionId !== id));
  save(KEYS.corrective, getCorrectiveActions().filter(ca => ca.sessionId !== id));
}

// Checklist
export function getChecklistItems(): ChecklistItem[] {
  return load<ChecklistItem>(KEYS.checklist);
}

export function getChecklistBySession(sessionId: string): ChecklistItem[] {
  return getChecklistItems().filter(c => c.sessionId === sessionId);
}

export function saveChecklistItem(item: ChecklistItem): void {
  const all = getChecklistItems();
  const idx = all.findIndex(c => c.id === item.id);
  if (idx >= 0) all[idx] = item;
  else all.push(item);
  save(KEYS.checklist, all);
}

export function deleteChecklistItem(id: string): void {
  save(KEYS.checklist, getChecklistItems().filter(c => c.id !== id));
  save(KEYS.corrective, getCorrectiveActions().filter(ca => ca.checklistItemId !== id));
}

// Corrective Actions
export function getCorrectiveActions(): CorrectiveAction[] {
  return load<CorrectiveAction>(KEYS.corrective);
}

export function getCorrectiveActionsBySession(sessionId: string): CorrectiveAction[] {
  return getCorrectiveActions().filter(ca => ca.sessionId === sessionId);
}

export function saveCorrectiveAction(ca: CorrectiveAction): void {
  const all = getCorrectiveActions();
  const idx = all.findIndex(c => c.id === ca.id);
  if (idx >= 0) all[idx] = ca;
  else all.push(ca);
  save(KEYS.corrective, all);
}

export function deleteCorrectiveAction(id: string): void {
  save(KEYS.corrective, getCorrectiveActions().filter(ca => ca.id !== id));
}

// Session progress calculation
export function getSessionProgress(sessionId: string): { total: number; assessed: number; pct: number } {
  const items = getChecklistBySession(sessionId);
  const assessed = items.filter(i => i.status !== 'Not Assessed').length;
  return {
    total: items.length,
    assessed,
    pct: items.length === 0 ? 0 : Math.round((assessed / items.length) * 100),
  };
}
