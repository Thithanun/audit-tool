export type Framework = 'ISO27001' | 'NIST_CSF';

export type StandardUsed = 'ISO27001' | 'NIST_CSF' | 'BOTH';

export type FindingStatus =
  | 'Not Assessed'
  | 'Conformity'
  | 'OBS'
  | 'OFI'
  | 'NC-Minor'
  | 'NC-Major';

export type SessionStatus = 'Planned' | 'In Progress' | 'Completed';

export type CorrectiveActionStatus = 'Open' | 'In Progress' | 'Closed' | 'Overdue';

export interface AuditPlan {
  id: string;
  objective: string;
  standard: StandardUsed;
  scope: string;
  auditAreas: string;
  leadAuditor: string;
  startDate: string;
  endDate: string;
  status: SessionStatus;
  createdAt: string;
}

// Backward-compat alias used by Checklist and Dashboard
export type AuditSession = AuditPlan;

export interface PlanSession {
  id: string;
  planId: string;
  day: number;
  date: string;
  time: string;
  areaOfAudit: string;
  relatedClauses: string;
  auditee: string;
  mainAuditor: string;
  iaTeam: string[];
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
