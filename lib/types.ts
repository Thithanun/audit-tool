export type Framework = 'ISO27001' | 'NIST_CSF';

export type FindingStatus =
  | 'Not Assessed'
  | 'Conformity'
  | 'OBS'
  | 'OFI'
  | 'NC-Minor'
  | 'NC-Major';

export type SessionStatus = 'Planned' | 'In Progress' | 'Completed';

export type CorrectiveActionStatus = 'Open' | 'In Progress' | 'Closed' | 'Overdue';

export interface AuditSession {
  id: string;
  name: string;
  framework: Framework;
  scope: string;
  auditor: string;
  startDate: string;
  endDate: string;
  status: SessionStatus;
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  sessionId: string;
  framework: Framework;
  clauseRef: string;
  clauseTitle: string;
  requirement: string;
  status: FindingStatus;
  notes: string;
  evidence: string;
  createdAt: string;
  updatedAt: string;
}

export interface CorrectiveAction {
  id: string;
  checklistItemId: string;
  sessionId: string;
  clauseRef: string;
  description: string;
  rootCause: string;
  owner: string;
  dueDate: string;
  status: CorrectiveActionStatus;
  closureNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClauseTemplate {
  clauseRef: string;
  clauseTitle: string;
  framework: Framework;
  requirement: string;
}
