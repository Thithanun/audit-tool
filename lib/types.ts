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

/** NCR 5-step workflow status */
export type NcrWorkflowStatus =
  | 'เปิด'        // NCR created, waiting for Auditee to fill plan (step 2)
  | 'รอ Auditee'  // Plan was rejected, waiting for Auditee to re-fill (step 2)
  | 'รอ Auditor'  // Auditee submitted plan, waiting for Auditor review (step 3)
  | 'กำลังแก้ไข'  // Plan approved, Auditee implementing & reporting results (step 4)
  | 'รอปิด NCR'   // Results submitted, waiting for Auditor to close (step 5)
  | 'ปิดแล้ว';    // NCR closed

/** Section 2 data — filled by Auditee (root cause + corrective plan) */
export interface NcrSection2Data {
  rootCause: string;
  correctiveAction: string;
  preventiveAction: string;
  dueDate: string;
  owner: string;
  submittedAt?: string;
}

/** Section 3 data — filled by Auditor (review plan) */
export interface NcrSection3Data {
  approved: boolean;
  reviewNotes: string;
  reviewedAt?: string;
}

/** One file attachment stored in Supabase Storage, referenced from NcrSection4Data */
export interface NcrAttachment {
  id: string;          // UUID assigned at upload time
  name: string;        // original filename shown to the user
  type: string;        // MIME type, e.g. "image/jpeg" or "application/pdf"
  size: number;        // size in bytes
  storagePath: string; // path inside the "ncr-attachments" Storage bucket
  url: string;         // public URL for view / download
  uploadedAt: string;  // ISO timestamp
}

/** Section 4 data — filled by Auditee (implementation results + evidence) */
export interface NcrSection4Data {
  results: string;
  evidence: string;
  completedDate?: string;
  submittedAt?: string;
  attachments?: NcrAttachment[]; // file evidence uploaded to Supabase Storage
}

/** Section 5 data — filled by Auditor (final closure) */
export interface NcrSection5Data {
  closureNotes: string;
  closedAt?: string;
}

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
  ncrNumber?: string;         // เลขที่ NCR เช่น NCR69001 (NCRyyYYY: yy=ปีพุทธ 2 หลัก, YYY=ลำดับ)
  ncrType?: 'NC-Major' | 'NC-Minor' | 'OBS' | 'OFI'; // ประเภท NCR
  impact?: string;            // ผลกระทบ (Auditor fills)
  recommendation?: string;    // ข้อเสนอแนะ (Auditor fills)
  correctiveAction?: string;  // แนวทางแก้ไข (Auditee fills) — legacy field, see ncrSection2
  preventiveAction?: string;  // แนวทางป้องกัน (Auditee fills) — legacy field, see ncrSection2
  // 5-step NCR workflow
  ncrWorkflowStatus?: NcrWorkflowStatus;  // current workflow status
  ncrCurrentStep?: number;                // 1–5, which step the NCR is currently on
  ncrSection2?: NcrSection2Data;          // Auditee corrective plan
  ncrSection3?: NcrSection3Data;          // Auditor plan review
  ncrSection4?: NcrSection4Data;          // Auditee implementation results
  ncrSection5?: NcrSection5Data;          // Auditor final closure
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
