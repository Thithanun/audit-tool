export type Framework = 'ISO27001' | 'NIST_CSF';

/** UUID of a row in the `standards` table (or legacy string for old plans). */
export type StandardUsed = string;

export interface Standard {
  id: string;
  name: string;
  version: string | null;
  is_active: boolean;
  created_at: string;
}

export type FindingStatus =
  | 'Not Assessed'
  | 'Conformity'
  | 'OBS'
  | 'OFI'
  | 'NC-Minor'
  | 'NC-Major';

export type SessionStatus = 'Planned' | 'In Progress' | 'Completed';

export type CorrectiveActionStatus = 'Open' | 'In Progress' | 'Closed' | 'Overdue';

export type ReportStatus = 'draft' | 'in_review' | 'approved';

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
  reportIssuedAt?: string;             // ISO timestamp stamped when "Create Report" is clicked
  reportSignatures?: ReportSignatures; // stored in data JSONB — no DB migration needed
  reportStatus?: ReportStatus;         // draft | in_review | approved — default "draft" when absent
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
  relatedClauses: string[];
  auditee: string;
  mainAuditor: string;
  iaTeam: string[];
  createdAt: string;
  /** FK → standard_versions.id — set when the session was created with the new clause picker */
  standardVersionId?: string;
}

// ── Standard Versions (multi-version clause registry) ─────────────────────────

/** One row per published version of a standard (e.g. "ISO 27001" · "2022"). */
export interface StandardVersion {
  id: string;
  standard_name: string;   // "ISO 27001"
  version: string;         // "2022"
  is_active: boolean;
  effective_date: string | null;
  created_at: string;
}

/** One clause / control stored in Supabase, linked to a StandardVersion. */
export interface DbClause {
  id: string;
  standard_version_id: string;
  clause_ref: string;    // "4.1"  "A.5.26"  "GV.OC-01"
  clause_title: string;
  framework: Framework;
  requirement: string;
  display_order: number;
  created_at: string;
}

export interface ChecklistItem {
  id: string;
  sessionId: string;
  framework: Framework;
  clauseRef: string;
  clauseTitle: string;
  requirement: string;
  question?: string;
  status: FindingStatus;
  notes: string;
  evidence: string;
  recommendation?: string;
  dueDate?: string;
  itemNumber?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistTemplate {
  id: string;
  question: string;
  clauseRef: string;
  createdAt: string;
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
  // NCR Management fields — optional, only present on standalone NCRs
  ncrNumber?: string;         // เลขที่ NCR เช่น NCR26001 (NCRXXYYY: XX=ปี, YYY=ลำดับ)
  ncrType?: 'NC-Major' | 'NC-Minor' | 'OBS' | 'OFI'; // ประเภท NCR
  impact?: string;            // ผลกระทบ (Auditor fills)
  recommendation?: string;    // ข้อเสนอแนะ (Auditor fills)
  correctiveAction?: string;  // แนวทางแก้ไข (Auditee fills)
  preventiveAction?: string;  // แนวทางป้องกัน (Auditee fills)
}

export interface ClauseTemplate {
  clauseRef: string;
  clauseTitle: string;
  framework: Framework;
  requirement: string;
}

// ── Management Report ─────────────────────────────────────────────────────────

export interface ReportSignature {
  sigData: string;   // base64 PNG data URL of the drawn signature
  signedAt: string;  // ISO timestamp
}

export interface ReportSignatures {
  leadAuditor?: ReportSignature;
  management?: ReportSignature;
}
