'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  CorrectiveAction,
  NcrWorkflowStatus,
  NcrSection2Data,
  NcrSection3Data,
  NcrSection4Data,
  NcrSection5Data,
} from '@/lib/types';
import { getCorrectiveActionById, saveCorrectiveAction } from '@/lib/store';
import PageLoader, { DbError } from '@/components/PageLoader';

// ── Types ─────────────────────────────────────────────────────────────────────

type Role = 'Auditor' | 'Auditee';
type SectionState = 'locked' | 'active' | 'done';

// ── Display constants ─────────────────────────────────────────────────────────

const NCR_TYPE_LABEL: Record<string, string> = {
  'NC-Major': 'Major NC',
  'NC-Minor': 'Minor NC',
  'OBS':      'Observation',
  'OFI':      'OFI',
};

const NCR_TYPE_BADGE: Record<string, string> = {
  'NC-Major': 'bg-red-100 text-red-700 border border-red-200',
  'NC-Minor': 'bg-orange-100 text-orange-700 border border-orange-200',
  'OBS':      'bg-blue-100 text-blue-700 border border-blue-200',
  'OFI':      'bg-amber-100 text-amber-700 border border-amber-200',
};

const WF_STATUS_LABEL: Record<NcrWorkflowStatus, string> = {
  'เปิด':       'เปิด',
  'รอ Auditee': 'รอ Auditee',
  'รอ Auditor': 'รอ Auditor',
  'กำลังแก้ไข': 'กำลังแก้ไข',
  'รอปิด NCR':  'รอปิด NCR',
  'ปิดแล้ว':   'ปิดแล้ว',
};

const WF_STATUS_BADGE: Record<NcrWorkflowStatus, string> = {
  'เปิด':       'bg-amber-50 text-amber-800 border border-amber-200',
  'รอ Auditee': 'bg-amber-50 text-amber-800 border border-amber-200',
  'รอ Auditor': 'bg-blue-50 text-blue-800 border border-blue-200',
  'กำลังแก้ไข': 'bg-indigo-50 text-indigo-800 border border-indigo-200',
  'รอปิด NCR':  'bg-purple-50 text-purple-800 border border-purple-200',
  'ปิดแล้ว':   'bg-green-50 text-green-800 border border-green-200',
};

// Step labels for the progress indicator
const STEPS = [
  { label: 'สร้าง NCR',       role: 'Auditor'  as Role },
  { label: 'แผนแก้ไข',        role: 'Auditee'  as Role },
  { label: 'ตรวจสอบแผน',      role: 'Auditor'  as Role },
  { label: 'ดำเนินการแก้ไข',   role: 'Auditee'  as Role },
  { label: 'ปิด NCR',         role: 'Auditor'  as Role },
];

// Colors
const AUDITOR_COLOR = '#3C3489';
const AUDITEE_COLOR = '#0F6E56';

// ── Utility components ────────────────────────────────────────────────────────

function ReadOnlyField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-0.5">{label}</p>
      <p className="text-sm text-slate-800 bg-white/70 rounded-lg px-3 py-2 border border-white/80 min-h-[36px]">
        {value || '—'}
      </p>
    </div>
  );
}

function Field({
  label, value, onChange, rows = 3, placeholder = '', type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  type?: string;
}) {
  const baseClass =
    'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400';
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
      {rows === 1 || type === 'date' ? (
        <input
          type={type}
          className={baseClass}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <textarea
          className={`${baseClass} resize-none`}
          rows={rows}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

// ── SectionCard ───────────────────────────────────────────────────────────────

function SectionCard({
  step, title, subtitle, role, state, children,
}: {
  step: number;
  title: string;
  subtitle: string;
  role: Role;
  state: SectionState;
  children?: React.ReactNode;
}) {
  const color = role === 'Auditor' ? AUDITOR_COLOR : AUDITEE_COLOR;
  const isLocked = state === 'locked';
  const isDone   = state === 'done';

  return (
    <div
      className={`rounded-2xl border-2 overflow-hidden transition-all duration-200 ${
        isLocked ? 'opacity-40 grayscale' : ''
      }`}
      style={{ borderColor: isLocked ? '#e2e8f0' : isDone ? '#22c55e' : color }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-3.5"
        style={{
          background: isLocked
            ? '#f8fafc'
            : isDone
              ? 'linear-gradient(90deg,#f0fdf4,#dcfce7)'
              : `linear-gradient(90deg,${color}18,${color}08)`,
        }}
      >
        {/* Step circle */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
          style={{ background: isLocked ? '#cbd5e1' : isDone ? '#22c55e' : color }}
        >
          {isDone ? '✓' : step}
        </div>

        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-semibold"
            style={{ color: isLocked ? '#94a3b8' : isDone ? '#16a34a' : color }}
          >
            {title}
          </p>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>

        {/* State chip */}
        {isDone && (
          <span className="text-xs bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
            เสร็จแล้ว
          </span>
        )}
        {state === 'active' && (
          <span
            className="text-xs border px-2 py-0.5 rounded-full font-medium flex-shrink-0"
            style={{
              background: `${color}15`,
              color,
              borderColor: `${color}40`,
            }}
          >
            รอดำเนินการ
          </span>
        )}
        {isLocked && (
          <span className="text-xs bg-slate-100 text-slate-400 border border-slate-200 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
            🔒 ล็อค
          </span>
        )}
      </div>

      {/* Body */}
      {!isLocked && children && (
        <div className="px-5 py-4 bg-white">{children}</div>
      )}
    </div>
  );
}

// ── Blank section forms ───────────────────────────────────────────────────────

const BLANK_SEC2: NcrSection2Data = {
  rootCause: '', correctiveAction: '', preventiveAction: '', dueDate: '', owner: '',
};
const BLANK_SEC3: NcrSection3Data = { approved: true, reviewNotes: '' };
const BLANK_SEC4: NcrSection4Data = { results: '', evidence: '', completedDate: '' };
const BLANK_SEC5: NcrSection5Data = { closureNotes: '' };

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NcrDetailPage() {
  const params   = useParams();
  const router   = useRouter();
  const id       = params.id as string;

  const [ncr,      setNcr]      = useState<CorrectiveAction | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [dbError,  setDbError]  = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState<string | null>(null);

  const [role, setRole] = useState<Role>('Auditor');

  const [sec2, setSec2] = useState<NcrSection2Data>(BLANK_SEC2);
  const [sec3, setSec3] = useState<NcrSection3Data>(BLANK_SEC3);
  const [sec4, setSec4] = useState<NcrSection4Data>(BLANK_SEC4);
  const [sec5, setSec5] = useState<NcrSection5Data>(BLANK_SEC5);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    try {
      const record = await getCorrectiveActionById(id);
      if (!record) { setDbError('ไม่พบข้อมูล NCR'); return; }
      setNcr(record);
      if (record.ncrSection2) setSec2(record.ncrSection2);
      if (record.ncrSection3) setSec3(record.ncrSection3);
      if (record.ncrSection4) setSec4(record.ncrSection4);
      if (record.ncrSection5) setSec5(record.ncrSection5);
      // Restore role from sessionStorage
      try {
        const saved = sessionStorage.getItem(`ncr-role-${id}`);
        if (saved === 'Auditor' || saved === 'Auditee') setRole(saved);
      } catch { /* private browsing */ }
    } catch (e) {
      setDbError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function switchRole(r: Role) {
    setRole(r);
    try { sessionStorage.setItem(`ncr-role-${id}`, r); } catch { /* noop */ }
  }

  // ── Save helper ───────────────────────────────────────────────────────────

  async function persist(updated: CorrectiveAction) {
    setSaving(true);
    setSaveErr(null);
    try {
      await saveCorrectiveAction(updated);
      setNcr(updated);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  // ── Section submit handlers ───────────────────────────────────────────────

  async function submitSection2() {
    if (!ncr) return;
    const now = new Date().toISOString();
    await persist({
      ...ncr,
      rootCause:        sec2.rootCause,
      correctiveAction: sec2.correctiveAction,
      preventiveAction: sec2.preventiveAction,
      dueDate:          sec2.dueDate,
      owner:            sec2.owner,
      ncrCurrentStep:    3,
      ncrWorkflowStatus: 'รอ Auditor',
      ncrSection2: { ...sec2, submittedAt: now },
      status:    'In Progress',
      updatedAt: now,
    });
  }

  async function submitSection3(approve: boolean) {
    if (!ncr) return;
    const now = new Date().toISOString();
    await persist({
      ...ncr,
      ncrCurrentStep:    approve ? 4 : 2,
      ncrWorkflowStatus: approve ? 'กำลังแก้ไข' : 'รอ Auditee',
      ncrSection3: { approved: approve, reviewNotes: sec3.reviewNotes, reviewedAt: now },
      updatedAt: now,
    });
  }

  async function submitSection4() {
    if (!ncr) return;
    const now = new Date().toISOString();
    await persist({
      ...ncr,
      ncrCurrentStep:    5,
      ncrWorkflowStatus: 'รอปิด NCR',
      ncrSection4: { ...sec4, submittedAt: now },
      updatedAt: now,
    });
  }

  async function submitSection5() {
    if (!ncr) return;
    const now = new Date().toISOString();
    await persist({
      ...ncr,
      ncrWorkflowStatus: 'ปิดแล้ว',
      status:            'Closed',
      closureNotes:      sec5.closureNotes,
      ncrSection5: { ...sec5, closedAt: now },
      updatedAt: now,
    });
  }

  // ── Guard ─────────────────────────────────────────────────────────────────

  if (loading) return <PageLoader message="กำลังโหลดข้อมูล NCR…" />;
  if (dbError || !ncr) return <DbError message={dbError ?? 'ไม่พบข้อมูล NCR'} onRetry={load} />;

  // ── Derived ───────────────────────────────────────────────────────────────

  const step     = ncr.ncrCurrentStep ?? 1;
  const wfStatus = ncr.ncrWorkflowStatus;
  const isClosed = wfStatus === 'ปิดแล้ว';

  function sectionState(n: number): SectionState {
    if (n === 1) return 'done'; // Section 1 is always done after NCR creation
    if (isClosed) return 'done';
    if (n < step)  return 'done';
    if (n === step) return 'active';
    return 'locked';
  }

  const sec2Editable = role === 'Auditee' && step === 2 && !isClosed;
  const sec3Editable = role === 'Auditor' && step === 3 && !isClosed;
  const sec4Editable = role === 'Auditee' && step === 4 && !isClosed;
  const sec5Editable = role === 'Auditor' && step === 5 && !isClosed;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">

      {/* ── Back link ─────────────────────────────────────────────────────── */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors group"
      >
        <svg className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        กลับ Dashboard
      </button>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-2 mb-1">
            {ncr.ncrNumber && (
              <span className="font-mono text-sm font-bold bg-slate-800 text-white px-3 py-1 rounded-lg tracking-widest">
                {ncr.ncrNumber}
              </span>
            )}
            {ncr.ncrType && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${NCR_TYPE_BADGE[ncr.ncrType]}`}>
                {NCR_TYPE_LABEL[ncr.ncrType]}
              </span>
            )}
            {wfStatus && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${WF_STATUS_BADGE[wfStatus]}`}>
                {WF_STATUS_LABEL[wfStatus]}
              </span>
            )}
          </div>
          <p className="text-slate-600 text-sm mt-1 truncate">{ncr.clauseRef && (
            <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded mr-2">{ncr.clauseRef}</span>
          )}{ncr.description}</p>
        </div>

        {/* Role toggle */}
        <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1 flex-shrink-0">
          {(['Auditor', 'Auditee'] as Role[]).map(r => (
            <button
              key={r}
              onClick={() => switchRole(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                role === r
                  ? r === 'Auditor'
                    ? 'bg-[#3C3489] text-white shadow-sm'
                    : 'bg-[#0F6E56] text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {r === 'Auditor' ? '🔍 Auditor' : '📝 Auditee'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Progress steps ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0 mb-8 overflow-x-auto pb-1">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const st = sectionState(n);
          const color = s.role === 'Auditor' ? AUDITOR_COLOR : AUDITEE_COLOR;
          return (
            <div key={n} className="flex items-center flex-shrink-0">
              {/* Connector line */}
              {i > 0 && (
                <div
                  className="h-0.5 w-8 sm:w-12 transition-colors"
                  style={{ background: st === 'locked' ? '#e2e8f0' : '#22c55e' }}
                />
              )}
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-1">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white transition-all"
                  style={{
                    background: st === 'locked' ? '#cbd5e1' : st === 'done' ? '#22c55e' : color,
                  }}
                >
                  {st === 'done' ? '✓' : n}
                </div>
                <p
                  className="text-[10px] font-medium text-center max-w-[60px] leading-tight"
                  style={{ color: st === 'locked' ? '#94a3b8' : st === 'done' ? '#16a34a' : color }}
                >
                  {s.label}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Error banner ──────────────────────────────────────────────────── */}
      {saveErr && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {saveErr}
        </div>
      )}

      {/* ── Sections ──────────────────────────────────────────────────────── */}
      <div className="space-y-4">

        {/* ── Section 1: NCR Details (Auditor — always done) ─────────────── */}
        <SectionCard
          step={1}
          title="ส่วนที่ 1 — รายละเอียด NCR"
          subtitle="กรอกโดยผู้ตรวจสอบ (Auditor)"
          role="Auditor"
          state="done"
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <ReadOnlyField label="ประเภท NCR" value={ncr.ncrType ? NCR_TYPE_LABEL[ncr.ncrType] : undefined} />
            <ReadOnlyField label="ข้อกำหนด" value={ncr.clauseRef} />
          </div>
          <div className="mt-3 space-y-2">
            <ReadOnlyField label="รายละเอียด NCR" value={ncr.description} />
            {ncr.impact && <ReadOnlyField label="ผลกระทบ" value={ncr.impact} />}
            {ncr.recommendation && <ReadOnlyField label="ข้อเสนอแนะ" value={ncr.recommendation} />}
          </div>
        </SectionCard>

        {/* ── Section 2: Auditee Corrective Plan ─────────────────────────── */}
        <SectionCard
          step={2}
          title="ส่วนที่ 2 — แผนการแก้ไข"
          subtitle="กรอกโดยผู้รับการตรวจ (Auditee)"
          role="Auditee"
          state={sectionState(2)}
        >
          {sec2Editable ? (
            // Editable form
            <div className="space-y-3">
              <Field
                label="วิเคราะห์สาเหตุ (Root Cause Analysis)"
                value={sec2.rootCause}
                onChange={v => setSec2(s => ({ ...s, rootCause: v }))}
                rows={3}
                placeholder="ระบุสาเหตุที่แท้จริงของปัญหา..."
              />
              <Field
                label="แนวทางแก้ไข (Corrective Action)"
                value={sec2.correctiveAction}
                onChange={v => setSec2(s => ({ ...s, correctiveAction: v }))}
                rows={3}
                placeholder="มาตรการแก้ไขที่จะดำเนินการ..."
              />
              <Field
                label="แนวทางป้องกัน (Preventive Action)"
                value={sec2.preventiveAction}
                onChange={v => setSec2(s => ({ ...s, preventiveAction: v }))}
                rows={3}
                placeholder="มาตรการป้องกันไม่ให้เกิดซ้ำ..."
              />
              <div className="grid sm:grid-cols-2 gap-3">
                <Field
                  label="วันที่แล้วเสร็จ"
                  value={sec2.dueDate}
                  onChange={v => setSec2(s => ({ ...s, dueDate: v }))}
                  type="date"
                  rows={1}
                />
                <Field
                  label="ผู้รับผิดชอบ"
                  value={sec2.owner}
                  onChange={v => setSec2(s => ({ ...s, owner: v }))}
                  rows={1}
                  placeholder="ชื่อผู้รับผิดชอบ"
                />
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={saving || !sec2.rootCause.trim()}
                  onClick={submitSection2}
                  className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ background: AUDITEE_COLOR }}
                >
                  {saving ? 'กำลังส่ง…' : 'ส่งแผนแก้ไข →'}
                </button>
              </div>
            </div>
          ) : (
            // Read-only display
            <div className="space-y-3">
              {ncr.ncrSection2 ? (
                <>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <ReadOnlyField label="ผู้รับผิดชอบ" value={ncr.ncrSection2.owner} />
                    <ReadOnlyField label="วันที่แล้วเสร็จ" value={ncr.ncrSection2.dueDate} />
                  </div>
                  <ReadOnlyField label="วิเคราะห์สาเหตุ" value={ncr.ncrSection2.rootCause} />
                  <ReadOnlyField label="แนวทางแก้ไข" value={ncr.ncrSection2.correctiveAction} />
                  <ReadOnlyField label="แนวทางป้องกัน" value={ncr.ncrSection2.preventiveAction} />
                  {ncr.ncrSection2.submittedAt && (
                    <p className="text-xs text-slate-400">
                      ส่งเมื่อ {new Date(ncr.ncrSection2.submittedAt).toLocaleString('th-TH')}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-400 italic">ยังไม่ได้กรอกแผนแก้ไข</p>
              )}
              {/* If section is active but role is wrong, show a hint */}
              {sectionState(2) === 'active' && !sec2Editable && (
                <p className="text-xs text-[#0F6E56] font-medium mt-2">
                  ⚠️ สลับบทบาทเป็น Auditee เพื่อกรอกแผนแก้ไข
                </p>
              )}
            </div>
          )}
        </SectionCard>

        {/* ── Section 3: Auditor reviews plan ────────────────────────────── */}
        <SectionCard
          step={3}
          title="ส่วนที่ 3 — ตรวจสอบแผนแก้ไข"
          subtitle="กรอกโดยผู้ตรวจสอบ (Auditor)"
          role="Auditor"
          state={sectionState(3)}
        >
          {sec3Editable ? (
            <div className="space-y-3">
              <Field
                label="หมายเหตุการตรวจสอบ"
                value={sec3.reviewNotes}
                onChange={v => setSec3(s => ({ ...s, reviewNotes: v }))}
                rows={3}
                placeholder="ความเห็น / เงื่อนไขการอนุมัติ..."
              />
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => submitSection3(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold border border-red-300 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  {saving ? '…' : '✗ ส่งคืนแก้ไข'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => submitSection3(true)}
                  className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ background: AUDITOR_COLOR }}
                >
                  {saving ? 'กำลังบันทึก…' : '✓ อนุมัติแผน →'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {ncr.ncrSection3 ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                      ncr.ncrSection3.approved
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                    }`}>
                      {ncr.ncrSection3.approved ? '✓ อนุมัติแผน' : '✗ ส่งคืนแก้ไข'}
                    </span>
                  </div>
                  {ncr.ncrSection3.reviewNotes && (
                    <ReadOnlyField label="หมายเหตุ" value={ncr.ncrSection3.reviewNotes} />
                  )}
                  {ncr.ncrSection3.reviewedAt && (
                    <p className="text-xs text-slate-400">
                      ตรวจสอบเมื่อ {new Date(ncr.ncrSection3.reviewedAt).toLocaleString('th-TH')}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-400 italic">ยังไม่ได้ตรวจสอบแผน</p>
              )}
              {sectionState(3) === 'active' && !sec3Editable && (
                <p className="text-xs font-medium mt-2" style={{ color: AUDITOR_COLOR }}>
                  ⚠️ สลับบทบาทเป็น Auditor เพื่อตรวจสอบแผน
                </p>
              )}
            </div>
          )}
        </SectionCard>

        {/* ── Section 4: Auditee reports results ─────────────────────────── */}
        <SectionCard
          step={4}
          title="ส่วนที่ 4 — รายงานผลการดำเนินการ"
          subtitle="กรอกโดยผู้รับการตรวจ (Auditee)"
          role="Auditee"
          state={sectionState(4)}
        >
          {sec4Editable ? (
            <div className="space-y-3">
              <Field
                label="ผลการดำเนินการแก้ไข"
                value={sec4.results}
                onChange={v => setSec4(s => ({ ...s, results: v }))}
                rows={3}
                placeholder="อธิบายสิ่งที่ดำเนินการเพื่อแก้ไขปัญหา..."
              />
              <Field
                label="หลักฐาน / เอกสารอ้างอิง"
                value={sec4.evidence}
                onChange={v => setSec4(s => ({ ...s, evidence: v }))}
                rows={3}
                placeholder="ระบุหลักฐานหรือเอกสารที่แสดงว่าดำเนินการแล้ว..."
              />
              <Field
                label="วันที่ดำเนินการเสร็จจริง"
                value={sec4.completedDate ?? ''}
                onChange={v => setSec4(s => ({ ...s, completedDate: v }))}
                type="date"
                rows={1}
              />
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={saving || !sec4.results.trim()}
                  onClick={submitSection4}
                  className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ background: AUDITEE_COLOR }}
                >
                  {saving ? 'กำลังส่ง…' : 'ส่งรายงานผล →'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {ncr.ncrSection4 ? (
                <>
                  <ReadOnlyField label="ผลการดำเนินการ" value={ncr.ncrSection4.results} />
                  <ReadOnlyField label="หลักฐาน" value={ncr.ncrSection4.evidence} />
                  {ncr.ncrSection4.completedDate && (
                    <ReadOnlyField label="วันที่แล้วเสร็จจริง" value={ncr.ncrSection4.completedDate} />
                  )}
                  {ncr.ncrSection4.submittedAt && (
                    <p className="text-xs text-slate-400">
                      ส่งเมื่อ {new Date(ncr.ncrSection4.submittedAt).toLocaleString('th-TH')}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-400 italic">ยังไม่ได้รายงานผลการดำเนินการ</p>
              )}
              {sectionState(4) === 'active' && !sec4Editable && (
                <p className="text-xs text-[#0F6E56] font-medium mt-2">
                  ⚠️ สลับบทบาทเป็น Auditee เพื่อรายงานผล
                </p>
              )}
            </div>
          )}
        </SectionCard>

        {/* ── Section 5: Auditor closes NCR ──────────────────────────────── */}
        <SectionCard
          step={5}
          title="ส่วนที่ 5 — ปิด NCR"
          subtitle="กรอกโดยผู้ตรวจสอบ (Auditor)"
          role="Auditor"
          state={sectionState(5)}
        >
          {sec5Editable ? (
            <div className="space-y-3">
              <Field
                label="หมายเหตุการปิด NCR"
                value={sec5.closureNotes}
                onChange={v => setSec5(s => ({ ...s, closureNotes: v }))}
                rows={3}
                placeholder="บันทึกสรุปการปิด NCR..."
              />
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={submitSection5}
                  className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ background: AUDITOR_COLOR }}
                >
                  {saving ? 'กำลังบันทึก…' : '🔒 ปิด NCR'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {ncr.ncrSection5 ? (
                <>
                  {ncr.ncrSection5.closureNotes && (
                    <ReadOnlyField label="หมายเหตุ" value={ncr.ncrSection5.closureNotes} />
                  )}
                  {ncr.ncrSection5.closedAt && (
                    <p className="text-xs text-slate-400">
                      ปิดเมื่อ {new Date(ncr.ncrSection5.closedAt).toLocaleString('th-TH')}
                    </p>
                  )}
                </>
              ) : isClosed ? (
                <p className="text-sm text-green-700 font-medium">NCR ปิดแล้ว</p>
              ) : (
                <p className="text-sm text-slate-400 italic">ยังไม่ได้ปิด NCR</p>
              )}
              {sectionState(5) === 'active' && !sec5Editable && (
                <p className="text-xs font-medium mt-2" style={{ color: AUDITOR_COLOR }}>
                  ⚠️ สลับบทบาทเป็น Auditor เพื่อปิด NCR
                </p>
              )}
            </div>
          )}
        </SectionCard>

      </div>{/* end sections */}

    </div>
  );
}
