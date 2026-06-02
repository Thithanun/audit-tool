'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { AuditPlan, CorrectiveAction, ReportSignature, ReportSignatures } from '@/lib/types';
import {
  getAuditPlans,
  getCorrectiveActions,
  saveReportIssuedAt,
  saveReportSignatures,
  deleteReport,
} from '@/lib/store';
import PageLoader, { DbError } from '@/components/PageLoader';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type ReportNcrType = 'NC-Major' | 'NC-Minor' | 'OBS';

// ── Helpers ───────────────────────────────────────────────────────────────────

const THAI_MONTHS = [
  'ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
  'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.',
];

function formatThai(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function formatThaiTs(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function reportNumber(plan: AuditPlan, idx: number): string {
  const year = plan.reportIssuedAt
    ? new Date(plan.reportIssuedAt).getFullYear()
    : plan.createdAt
      ? new Date(plan.createdAt).getFullYear()
      : new Date().getFullYear();
  return `RPT-${year}-${String(idx + 1).padStart(3, '0')}`;
}

const NCR_TYPE_ORDER: Record<ReportNcrType, number> = { 'NC-Major': 0, 'NC-Minor': 1, 'OBS': 2 };

const BADGE_CLASS: Record<ReportNcrType, string> = {
  'NC-Major': 'bg-red-100 text-red-700 border border-red-200',
  'NC-Minor': 'bg-amber-100 text-amber-800 border border-amber-200',
  'OBS':      'bg-blue-100 text-blue-700 border border-blue-200',
};

const NCR_LABEL: Record<ReportNcrType, string> = {
  'NC-Major': 'NC Major',
  'NC-Minor': 'NC Minor',
  'OBS':      'Observation',
};

// Card left-border accent + subtle background tint per type
const CARD_STYLE: Record<ReportNcrType, { border: string; bg: string }> = {
  'NC-Major': { border: 'border-l-red-500',    bg: 'bg-red-50/40' },
  'NC-Minor': { border: 'border-l-orange-400', bg: 'bg-amber-50/50' },
  'OBS':      { border: 'border-l-blue-400',   bg: 'bg-blue-50/40' },
};

// ── Signature Canvas Modal ────────────────────────────────────────────────────

interface SigModalProps {
  open: boolean;
  onConfirm: (dataUrl: string) => void;
  onClose: () => void;
}

function SigModal({ open, onConfirm, onClose }: SigModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function getPos(cx: number, cy: number) {
      const r = canvas!.getBoundingClientRect();
      return {
        x: (cx - r.left) * (canvas!.width  / r.width),
        y: (cy - r.top)  * (canvas!.height / r.height),
      };
    }

    const onDown  = (e: MouseEvent)  => { drawing.current = true; const p = getPos(e.clientX, e.clientY); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const onMove  = (e: MouseEvent)  => { if (!drawing.current) return; const p = getPos(e.clientX, e.clientY); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const onUp    = ()               => { drawing.current = false; };
    const onTouchStart = (e: TouchEvent) => { e.preventDefault(); drawing.current = true;  const p = getPos(e.touches[0].clientX, e.touches[0].clientY); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const onTouchMove  = (e: TouchEvent) => { e.preventDefault(); if (!drawing.current) return; const p = getPos(e.touches[0].clientX, e.touches[0].clientY); ctx.lineTo(p.x, p.y); ctx.stroke(); };

    canvas.addEventListener('mousedown',  onDown);
    canvas.addEventListener('mousemove',  onMove);
    canvas.addEventListener('mouseup',    onUp);
    canvas.addEventListener('mouseleave', onUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   onUp);
    return () => {
      canvas.removeEventListener('mousedown',  onDown);
      canvas.removeEventListener('mousemove',  onMove);
      canvas.removeEventListener('mouseup',    onUp);
      canvas.removeEventListener('mouseleave', onUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove',  onTouchMove);
      canvas.removeEventListener('touchend',   onUp);
    };
  }, [open]);

  function clearCanvas() {
    const c = canvasRef.current;
    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
  }

  function confirm() {
    const c = canvasRef.current;
    if (!c) return;
    const empty = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.every(v => v === 0);
    if (empty) { alert('กรุณาวาดลายเซ็นก่อนยืนยัน'); return; }
    onConfirm(c.toDataURL('image/png'));
    clearCanvas();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) { clearCanvas(); onClose(); } }}
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-6 w-full max-w-sm">
        <h3 className="text-base font-semibold text-slate-900 mb-1">ลงนามดิจิทัล</h3>
        <p className="text-sm text-slate-500 mb-4">Management Committee — คณะกรรมการบริหาร</p>
        <canvas
          ref={canvasRef}
          width={340} height={140}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 cursor-crosshair block"
          style={{ touchAction: 'none' }}
        />
        <div className="flex gap-2 mt-4 justify-end">
          <button onClick={clearCanvas} className="text-sm text-slate-500 border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors">ล้าง</button>
          <button onClick={() => { clearCanvas(); onClose(); }} className="text-sm text-slate-600 border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors">ยกเลิก</button>
          <button onClick={confirm} className="text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">✓ ยืนยันลายเซ็น</button>
        </div>
      </div>
    </div>
  );
}

// ── Signature Box ─────────────────────────────────────────────────────────────

interface SigBoxProps {
  sig: ReportSignature | undefined;
  canSign: boolean;
  onSign: () => void;
  onClear: () => void;
}

function SigBox({ sig, canSign, onSign, onClear }: SigBoxProps) {
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sig) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = sig.sigData;
  }, [sig]);

  const signed = !!sig;

  return (
    <div className={`rounded-xl border p-5 flex flex-col items-center gap-4 transition-colors ${signed ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200'}`}>
      <canvas
        ref={previewRef}
        width={340} height={80}
        className={`w-full max-w-sm rounded-lg border ${signed ? 'border-green-200 bg-green-50/60' : 'border-dashed border-slate-300 bg-slate-50'}`}
      />
      {canSign && (
        <div className="flex gap-2">
          <button onClick={onSign} className="text-sm border border-slate-300 rounded-lg px-4 py-2 hover:bg-slate-50 transition-colors text-slate-700 font-medium">✏️ ลงนาม</button>
          {signed && <button onClick={onClear} className="text-sm text-slate-400 hover:text-red-500 transition-colors px-2">ล้าง</button>}
        </div>
      )}
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-800">Management Committee</p>
        <p className="text-xs text-slate-500 mt-0.5">คณะกรรมการบริหาร</p>
        <div className={`inline-flex items-center gap-1 text-xs px-3 py-1 rounded-full mt-2 ${
          signed
            ? 'bg-green-100 text-green-800 border border-green-300'
            : 'bg-slate-100 text-slate-400 border border-dashed border-slate-300'
        }`}>
          {signed ? `✓ ${formatThaiTs(sig!.signedAt)}` : '⏱ ยังไม่ได้ลงนาม'}
        </div>
      </div>
    </div>
  );
}

// ── Finding Card ──────────────────────────────────────────────────────────────

interface FindingCardProps {
  finding: CorrectiveAction;
  findingId: string;
}

function FindingCard({ finding: f, findingId }: FindingCardProps) {
  const t = f.ncrType as ReportNcrType;
  const { border, bg } = CARD_STYLE[t];

  const rows: { label: string; content: string | undefined }[] = [
    { label: 'ประเด็นที่ตรวจพบ', content: f.description },
    { label: 'ผลกระทบ',          content: f.impact },
    { label: 'ข้อเสนอแนะ',       content: f.recommendation },
  ];

  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 overflow-hidden ${border} ${bg}`}>

      {/* ── Row 1: ID · type badge · clause badge ─────────────────────────── */}
      <div className="px-5 py-3 flex items-center gap-2 flex-wrap border-b border-black/5">
        <span className="font-mono text-xs font-bold text-slate-600 tracking-tight">{findingId}</span>
        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${BADGE_CLASS[t]}`}>
          {NCR_LABEL[t]}
        </span>
        {f.clauseRef && (
          <span className="font-mono text-xs text-slate-500 bg-white/80 border border-slate-200 px-2 py-0.5 rounded-md">
            {f.clauseRef}
          </span>
        )}
      </div>

      {/* ── Rows 2–4: label + content, each separated by a divider ────────── */}
      <div className="divide-y divide-black/5">
        {rows.map(({ label, content }) => (
          <div key={label} className="px-5 py-3.5">
            <p className="text-xs font-semibold text-slate-500 mb-1.5">{label}</p>
            <p className="text-sm text-slate-800 leading-relaxed">{content || '—'}</p>
          </div>
        ))}
      </div>

    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReportPage() {
  const { canEditDashboard: canEdit, isAdmin } = useAuth();
  const router = useRouter();

  const [plans, setPlans]                   = useState<AuditPlan[]>([]);
  const [allCas, setAllCas]                 = useState<CorrectiveAction[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [loading, setLoading]               = useState(false);
  const [dbError, setDbError]               = useState<string | null>(null);

  const [signatures, setSignatures]         = useState<ReportSignatures>({});
  const [sigSaving, setSigSaving]           = useState(false);
  const [sigModalOpen, setSigModalOpen]     = useState(false);
  const [creating, setCreating]             = useState(false);
  const [deleteConfirm, setDeleteConfirm]   = useState(false);
  const [deleting, setDeleting]             = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    try {
      const [ps, cas] = await Promise.all([getAuditPlans(), getCorrectiveActions()]);
      setPlans(ps);
      setAllCas(cas);
      if (!selectedPlanId && ps.length > 0) setSelectedPlanId(ps[0].id);
    } catch (e) {
      setDbError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }, [selectedPlanId]);

  useEffect(() => { reload(); }, [reload]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const selectedPlan    = useMemo(() => plans.find(p => p.id === selectedPlanId) ?? null, [plans, selectedPlanId]);
  const selectedPlanIdx = useMemo(() => plans.findIndex(p => p.id === selectedPlanId),    [plans, selectedPlanId]);

  // Sync signatures and issuedAt from the selected plan
  useEffect(() => {
    setSignatures(selectedPlan?.reportSignatures ?? {});
  }, [selectedPlan]);

  const issuedAt = selectedPlan?.reportIssuedAt ?? null; // null = report not yet created

  // Findings: NCRs for this plan, OFI excluded, sorted by severity
  const findings = useMemo(() => {
    if (!selectedPlanId) return [];
    return allCas
      .filter(ca => ca.ncrType !== undefined && ca.ncrType !== 'OFI' && ca.sessionId === selectedPlanId)
      .sort((a, b) => NCR_TYPE_ORDER[a.ncrType as ReportNcrType] - NCR_TYPE_ORDER[b.ncrType as ReportNcrType]);
  }, [allCas, selectedPlanId]);

  const typeCounts = useMemo(() => {
    const c: Record<ReportNcrType, number> = { 'NC-Major': 0, 'NC-Minor': 0, 'OBS': 0 };
    for (const f of findings) c[f.ncrType as ReportNcrType]++;
    return c;
  }, [findings]);

  // Sequential IDs per type: NCR-YYYY-001 for NC-Major/NC-Minor, OBS-YYYY-001 for OBS
  const findingIds = useMemo(() => {
    const year = issuedAt
      ? new Date(issuedAt).getFullYear()
      : selectedPlan?.createdAt
        ? new Date(selectedPlan.createdAt).getFullYear()
        : new Date().getFullYear();
    const ctr: Record<ReportNcrType, number> = { 'NC-Major': 0, 'NC-Minor': 0, 'OBS': 0 };
    return findings.map(f => {
      const t = f.ncrType as ReportNcrType;
      ctr[t]++;
      return `${t === 'OBS' ? 'OBS' : 'NCR'}-${year}-${String(ctr[t]).padStart(3, '0')}`;
    });
  }, [findings, issuedAt, selectedPlan]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleCreateReport() {
    if (!selectedPlanId) return;
    setCreating(true);
    try {
      const now = new Date().toISOString();
      await saveReportIssuedAt(selectedPlanId, now);
      // Refresh plans so selectedPlan reflects the new issuedAt
      const updated = await (await import('@/lib/store')).getAuditPlans();
      setPlans(updated);
    } catch (err) {
      alert('ไม่สามารถสร้างรายงานได้: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCreating(false);
    }
  }

  async function handleSigConfirm(dataUrl: string) {
    setSigModalOpen(false);
    const updated: ReportSignatures = {
      ...signatures,
      management: { sigData: dataUrl, signedAt: new Date().toISOString() },
    };
    setSignatures(updated);
    if (!selectedPlanId) return;
    setSigSaving(true);
    try {
      await saveReportSignatures(selectedPlanId, updated);
    } catch (err) {
      alert('บันทึกลายเซ็นไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSigSaving(false);
    }
  }

  async function handleSigClear() {
    const updated: ReportSignatures = { ...signatures, management: undefined };
    setSignatures(updated);
    if (!selectedPlanId) return;
    setSigSaving(true);
    try {
      await saveReportSignatures(selectedPlanId, updated);
    } catch (err) {
      alert('ลบลายเซ็นไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSigSaving(false);
    }
  }

  async function handleDeleteReport() {
    if (!selectedPlanId) return;
    setDeleting(true);
    try {
      await deleteReport(selectedPlanId);
      setDeleteConfirm(false);
      router.push('/audit-plan');
    } catch (err) {
      alert('ลบรายงานไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
      setDeleting(false);
    }
  }

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (loading) return <PageLoader message="กำลังโหลด Management Report…" />;
  if (dbError)  return <DbError message={dbError} onRetry={reload} />;

  // ── Render ─────────────────────────────────────────────────────────────────

  const reportCreated = !!issuedAt;

  return (
    <>
      <SigModal open={sigModalOpen} onConfirm={handleSigConfirm} onClose={() => setSigModalOpen(false)} />

      {/* ── Delete Report confirmation dialog ──────────────────────────────── */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget && !deleting) setDeleteConfirm(false); }}
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-6 w-full max-w-sm">
            <div className="w-11 h-11 bg-red-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-900 text-center mb-1">ลบรายงานนี้ใช่หรือไม่?</h3>
            <p className="text-sm text-slate-500 text-center mb-5">
              การดำเนินการนี้จะลบวันที่ออกรายงานและลายเซ็นดิจิทัลทั้งหมด
              <br />ข้อมูล NCR / Checklist จะยังคงอยู่
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleDeleteReport}
                disabled={deleting}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {deleting ? 'กำลังลบ…' : 'ยืนยัน ลบรายงาน'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Top bar ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          {/* Left: plan dropdown */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-slate-500">Audit Plan</label>
            <select
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedPlanId}
              onChange={e => setSelectedPlanId(e.target.value)}
            >
              {plans.length === 0 && <option value="">ไม่มีแผนการตรวจ</option>}
              {plans.map(p => <option key={p.id} value={p.id}>{p.objective}</option>)}
            </select>
          </div>

          {/* Right: Create Report → Export PDF */}
          <div className="flex items-center gap-3">
            {sigSaving && <span className="text-xs text-slate-400 animate-pulse">กำลังบันทึก…</span>}

            {reportCreated ? (
              <>
                {/* Admin-only: Delete Report */}
                {isAdmin && (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="flex items-center gap-1.5 border border-red-300 text-red-600 text-sm px-4 py-2 rounded-lg hover:bg-red-50 transition-colors font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                    Delete Report
                  </button>
                )}
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 border border-slate-300 text-slate-700 text-sm px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors font-medium"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M6.75 15.75H5.25A2.25 2.25 0 013 13.5V9a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 9v4.5a2.25 2.25 0 01-2.25 2.25H17.25m-10.5 0v4.5h10.5v-4.5m-10.5 0h10.5M6.75 7.5V3.75h10.5V7.5" />
                  </svg>
                  Export PDF
                </button>
              </>
            ) : (
              canEdit && selectedPlanId && (
                <button
                  onClick={handleCreateReport}
                  disabled={creating}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm px-4 py-2 rounded-lg transition-colors font-medium"
                >
                  {creating ? (
                    <span className="animate-pulse">กำลังสร้าง…</span>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      Create Report
                    </>
                  )}
                </button>
              )
            )}
          </div>
        </div>

        {/* ── Empty state (before Create Report) ───────────────────────────── */}
        {!reportCreated ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-16 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p className="text-base font-medium text-slate-700 mb-1">ยังไม่มีรายงาน</p>
            <p className="text-sm text-slate-400 mb-6 max-w-xs mx-auto">
              กด <span className="font-medium text-slate-600">Create Report</span> เพื่อออกรายงานและ stamp วันที่ออกรายงาน
            </p>
            {canEdit && selectedPlanId && (
              <button
                onClick={handleCreateReport}
                disabled={creating}
                className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm px-5 py-2.5 rounded-lg transition-colors font-medium"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                {creating ? 'กำลังสร้าง…' : 'Create Report'}
              </button>
            )}
            {!canEdit && (
              <p className="text-xs text-slate-400 mt-2">Auditor จะต้องสร้างรายงานก่อน</p>
            )}
          </div>
        ) : (

        /* ── Report body (after Create Report) ────────────────────────────── */
          <div id="report-printable" className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-8 print:shadow-none print:border-none print:rounded-none">

            {/* ── Report header ─────────────────────────────────────────────── */}
            <div className="flex justify-between items-start pb-5 border-b border-slate-200">
              <div>
                <h1 className="text-2xl font-medium text-slate-900">Management Report</h1>
                <p className="text-sm text-slate-500 mt-1">
                  {selectedPlan!.objective} · {selectedPlan!.standard}
                </p>
                {selectedPlan!.scope && (
                  <p className="text-xs text-slate-400 mt-0.5">Scope: {selectedPlan!.scope}</p>
                )}
              </div>
              <div className="text-right text-xs text-slate-500 space-y-0.5 shrink-0 ml-6">
                <p className="font-semibold text-slate-800 text-sm">{reportNumber(selectedPlan!, selectedPlanIdx)}</p>
                <p>วันที่ออกรายงาน: <span className="text-slate-700 font-medium">{formatThai(issuedAt!)}</span></p>
                <p>ผู้ตรวจ: {selectedPlan!.leadAuditor || '—'}</p>
                <p>ช่วงเวลา: {formatThai(selectedPlan!.startDate)} – {formatThai(selectedPlan!.endDate)}</p>
              </div>
            </div>

            {/* ── Summary stat cards ────────────────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">สรุปผลการตรวจ</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-xl p-4 border-l-4 border-l-red-400">
                  <p className="text-xs text-slate-500 mb-1">NC Major</p>
                  <p className="text-3xl font-medium text-red-700">{typeCounts['NC-Major']}</p>
                  <p className="text-xs text-slate-400 mt-1">{typeCounts['NC-Major'] === 0 ? 'ไม่พบประเด็นร้ายแรง' : 'ต้องแก้ไขเร่งด่วน'}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border-l-4 border-l-orange-400">
                  <p className="text-xs text-slate-500 mb-1">NC Minor</p>
                  <p className="text-3xl font-medium text-amber-700">{typeCounts['NC-Minor']}</p>
                  <p className="text-xs text-slate-400 mt-1">{typeCounts['NC-Minor'] === 0 ? 'ไม่พบประเด็น' : 'ต้องดำเนินการแก้ไข'}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 border-l-4 border-l-blue-400">
                  <p className="text-xs text-slate-500 mb-1">Observation</p>
                  <p className="text-3xl font-medium text-blue-700">{typeCounts['OBS']}</p>
                  <p className="text-xs text-slate-400 mt-1">{typeCounts['OBS'] === 0 ? 'ไม่มีข้อสังเกต' : 'ข้อสังเกตเพื่อปรับปรุง'}</p>
                </div>
              </div>
            </div>

            {/* ── Finding cards ─────────────────────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">รายละเอียดประเด็นที่พบ</p>
              {findings.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm bg-slate-50 rounded-xl">
                  ยังไม่มี NCR / OBS ใน Audit Plan นี้
                </div>
              ) : (
                <div className="space-y-3">
                  {findings.map((f, idx) => (
                    <FindingCard key={f.id} finding={f} findingId={findingIds[idx]} />
                  ))}
                </div>
              )}
            </div>

            {/* ── Signature — Management Committee only ─────────────────────── */}
            <div className="border border-slate-200 rounded-xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">การรับทราบและอนุมัติ</p>
                  <p className="text-xs text-slate-500 mt-0.5">คณะกรรมการบริหารประทับลายเซ็นดิจิทัลเพื่อรับทราบรายงาน</p>
                </div>
                <div className="text-xs">
                  {signatures.management ? (
                    <span className="text-green-700 font-medium flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                      รายงานได้รับการรับรองแล้ว
                    </span>
                  ) : (
                    <span className="text-slate-400">รอลายเซ็น</span>
                  )}
                </div>
              </div>

              <div className="max-w-sm mx-auto">
                <SigBox
                  sig={signatures.management}
                  canSign={canEdit}
                  onSign={() => setSigModalOpen(true)}
                  onClear={handleSigClear}
                />
              </div>

              <p className="text-center text-xs text-slate-400 mt-4">
                🔒 ลายเซ็นดิจิทัลพร้อม timestamp ถูกบันทึกในระบบโดยอัตโนมัติเมื่อกดยืนยัน
              </p>
            </div>

          </div>
        )}
      </div>
    </>
  );
}
