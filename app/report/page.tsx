'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { AuditPlan, CorrectiveAction, ReportSignature, ReportSignatures } from '@/lib/types';
import {
  getAuditPlans,
  getCorrectiveActions,
  saveReportSignatures,
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
  const year = plan.createdAt
    ? new Date(plan.createdAt).getFullYear()
    : new Date().getFullYear();
  return `RPT-${year}-${String(idx + 1).padStart(3, '0')}`;
}

const NCR_TYPE_ORDER: Record<ReportNcrType, number> = {
  'NC-Major': 0,
  'NC-Minor': 1,
  'OBS': 2,
};

const BADGE_CLASS: Record<ReportNcrType, string> = {
  'NC-Major': 'bg-red-100 text-red-700 border border-red-200',
  'NC-Minor': 'bg-amber-100 text-amber-800 border border-amber-200',
  'OBS':      'bg-blue-100 text-blue-700 border border-blue-200',
};

const NCR_LABEL: Record<ReportNcrType, string> = {
  'NC-Major': 'NC Major',
  'NC-Minor': 'NC Minor',
  'OBS':      'OBS',
};

// ── Signature Canvas Modal ────────────────────────────────────────────────────

interface SigModalProps {
  open: boolean;
  title: string;
  onConfirm: (dataUrl: string) => void;
  onClose: () => void;
}

function SigModal({ open, title, onConfirm, onClose }: SigModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  // Attach / detach drawing listeners every time the modal opens
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function pos(clientX: number, clientY: number) {
      const r = canvas!.getBoundingClientRect();
      return {
        x: (clientX - r.left) * (canvas!.width / r.width),
        y: (clientY - r.top)  * (canvas!.height / r.height),
      };
    }

    const onDown = (e: MouseEvent) => {
      drawing.current = true;
      const p = pos(e.clientX, e.clientY);
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
    };
    const onMove = (e: MouseEvent) => {
      if (!drawing.current) return;
      const p = pos(e.clientX, e.clientY);
      ctx.lineTo(p.x, p.y); ctx.stroke();
    };
    const onUp = () => { drawing.current = false; };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault(); drawing.current = true;
      const p = pos(e.touches[0].clientX, e.touches[0].clientY);
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!drawing.current) return;
      const p = pos(e.touches[0].clientX, e.touches[0].clientY);
      ctx.lineTo(p.x, p.y); ctx.stroke();
    };

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', onUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('mouseleave', onUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onUp);
    };
  }, [open]);

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
  }

  function confirm() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const isEmpty = ctx.getImageData(0, 0, canvas.width, canvas.height).data.every(v => v === 0);
    if (isEmpty) { alert('กรุณาวาดลายเซ็นก่อนยืนยัน'); return; }
    onConfirm(canvas.toDataURL('image/png'));
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
        <p className="text-sm text-slate-500 mb-4">{title}</p>
        <canvas
          ref={canvasRef}
          width={340} height={140}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 cursor-crosshair block"
          style={{ touchAction: 'none' }}
        />
        <div className="flex items-center gap-2 mt-4 justify-end">
          <button
            onClick={clearCanvas}
            className="text-sm text-slate-500 border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors"
          >
            ล้าง
          </button>
          <button
            onClick={() => { clearCanvas(); onClose(); }}
            className="text-sm text-slate-600 border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={confirm}
            className="text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            ✓ ยืนยันลายเซ็น
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Signature Box ─────────────────────────────────────────────────────────────

interface SigBoxProps {
  name: string;
  role: string;
  sig: ReportSignature | undefined;
  canSign: boolean;
  onSign: () => void;
  onClear: () => void;
}

function SigBox({ name, role, sig, canSign, onSign, onClear }: SigBoxProps) {
  const previewRef = useRef<HTMLCanvasElement>(null);

  // Render sig image into preview canvas when sig changes
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
    <div className={`rounded-xl border p-4 flex flex-col gap-3 transition-colors ${
      signed ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200'
    }`}>
      {/* Preview canvas */}
      <canvas
        ref={previewRef}
        width={300} height={70}
        className={`w-full rounded-lg border ${
          signed ? 'border-green-200 bg-green-50' : 'border-dashed border-slate-300 bg-slate-50'
        }`}
      />

      {/* Actions */}
      {canSign && (
        <div className="flex gap-2 justify-center">
          <button
            onClick={onSign}
            className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors text-slate-700"
          >
            ✏️ ลงนาม
          </button>
          {signed && (
            <button
              onClick={onClear}
              className="text-xs text-slate-400 hover:text-red-500 transition-colors"
            >
              ล้าง
            </button>
          )}
        </div>
      )}

      {/* Name + role + stamp */}
      <div className="text-center">
        <p className="text-sm font-medium text-slate-800">{name}</p>
        <p className="text-xs text-slate-500">{role}</p>
        <div className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full mt-1.5 ${
          signed
            ? 'bg-green-100 text-green-800 border border-green-300'
            : 'bg-slate-100 text-slate-500 border border-dashed border-slate-300'
        }`}>
          {signed ? `✓ ${formatThaiTs(sig!.signedAt)}` : '⏱ ยังไม่ได้ลงนาม'}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReportPage() {
  const { canEditDashboard: canEdit } = useAuth();

  const [plans, setPlans]               = useState<AuditPlan[]>([]);
  const [allCas, setAllCas]             = useState<CorrectiveAction[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [loading, setLoading]           = useState(false);
  const [dbError, setDbError]           = useState<string | null>(null);

  // Signature state — initialised from the plan's saved data
  const [signatures, setSignatures]     = useState<ReportSignatures>({});
  const [sigSaving, setSigSaving]       = useState(false);

  // Modal
  const [modalOpen, setModalOpen]       = useState(false);
  const [modalTarget, setModalTarget]   = useState<'leadAuditor' | 'management'>('leadAuditor');

  // ── Load ────────────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    try {
      const [ps, cas] = await Promise.all([getAuditPlans(), getCorrectiveActions()]);
      setPlans(ps);
      setAllCas(cas);
      // Pre-select first plan if none chosen yet
      if (!selectedPlanId && ps.length > 0) {
        setSelectedPlanId(ps[0].id);
      }
    } catch (e) {
      setDbError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }, [selectedPlanId]);

  useEffect(() => { reload(); }, [reload]);

  // ── Derived: selected plan ─────────────────────────────────────────────────

  const selectedPlan = useMemo(
    () => plans.find(p => p.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );

  const selectedPlanIdx = useMemo(
    () => plans.findIndex(p => p.id === selectedPlanId),
    [plans, selectedPlanId],
  );

  // Load plan's saved signatures whenever selected plan changes
  useEffect(() => {
    setSignatures(selectedPlan?.reportSignatures ?? {});
  }, [selectedPlan]);

  // ── Derived: findings ──────────────────────────────────────────────────────

  // NCRs for this plan (ncrType set, sessionId matches, OFI excluded)
  const findings = useMemo(() => {
    if (!selectedPlanId) return [];
    return allCas
      .filter(ca =>
        ca.ncrType !== undefined &&
        ca.ncrType !== 'OFI' &&
        ca.sessionId === selectedPlanId,
      )
      .sort((a, b) =>
        NCR_TYPE_ORDER[a.ncrType as ReportNcrType] -
        NCR_TYPE_ORDER[b.ncrType as ReportNcrType],
      );
  }, [allCas, selectedPlanId]);

  const typeCounts = useMemo(() => {
    const c: Record<ReportNcrType, number> = { 'NC-Major': 0, 'NC-Minor': 0, 'OBS': 0 };
    for (const f of findings) if (f.ncrType && f.ncrType !== 'OFI') c[f.ncrType as ReportNcrType]++;
    return c;
  }, [findings]);

  // Generate sequential IDs per type within this report
  const findingIds = useMemo(() => {
    const year = selectedPlan?.createdAt
      ? new Date(selectedPlan.createdAt).getFullYear()
      : new Date().getFullYear();
    const counters: Record<ReportNcrType, number> = { 'NC-Major': 0, 'NC-Minor': 0, 'OBS': 0 };
    return findings.map(f => {
      const t = f.ncrType as ReportNcrType;
      counters[t]++;
      const prefix = t === 'OBS' ? 'OBS' : 'NCR';
      return `${prefix}-${year}-${String(counters[t]).padStart(3, '0')}`;
    });
  }, [findings, selectedPlan]);

  const bothSigned = !!(signatures.leadAuditor && signatures.management);

  // ── Signature handlers ─────────────────────────────────────────────────────

  function openSigModal(target: 'leadAuditor' | 'management') {
    setModalTarget(target);
    setModalOpen(true);
  }

  async function handleSigConfirm(dataUrl: string) {
    setModalOpen(false);
    const now = new Date().toISOString();
    const newSig: ReportSignature = { sigData: dataUrl, signedAt: now };
    const updated: ReportSignatures = { ...signatures, [modalTarget]: newSig };
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

  async function handleSigClear(target: 'leadAuditor' | 'management') {
    const updated: ReportSignatures = { ...signatures, [target]: undefined };
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

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (loading) return <PageLoader message="กำลังโหลด Management Report…" />;
  if (dbError)  return <DbError message={dbError} onRetry={reload} />;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Signature modal ─────────────────────────────────────────────── */}
      <SigModal
        open={modalOpen}
        title={
          modalTarget === 'leadAuditor'
            ? 'Lead Auditor — ผู้ตรวจสอบหลัก'
            : 'Management Representative — ผู้บริหาร'
        }
        onConfirm={handleSigConfirm}
        onClose={() => setModalOpen(false)}
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* ── Toolbar ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-slate-500">Audit Plan</label>
            <select
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedPlanId}
              onChange={e => setSelectedPlanId(e.target.value)}
            >
              {plans.length === 0 && <option value="">ไม่มีแผนการตรวจ</option>}
              {plans.map(p => (
                <option key={p.id} value={p.id}>{p.objective}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            {sigSaving && (
              <span className="text-xs text-slate-400 animate-pulse">กำลังบันทึก…</span>
            )}
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 border border-slate-300 text-slate-700 text-sm px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors font-medium"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M6.75 15.75H5.25A2.25 2.25 0 013 13.5V9a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 9v4.5a2.25 2.25 0 01-2.25 2.25H17.25m-10.5 0v4.5h10.5v-4.5m-10.5 0h10.5M6.75 7.5V3.75h10.5V7.5" />
              </svg>
              พิมพ์ / Export PDF
            </button>
          </div>
        </div>

        {/* ── Report card ───────────────────────────────────────────────────── */}
        {!selectedPlan ? (
          <div className="text-center py-24 text-slate-400 text-sm">เลือก Audit Plan เพื่อดูรายงาน</div>
        ) : (
          <div
            id="report-printable"
            className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-8 print:shadow-none print:border-none print:rounded-none"
          >

            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="flex justify-between items-start pb-5 border-b border-slate-200">
              <div>
                <h1 className="text-2xl font-medium text-slate-900">Management Report</h1>
                <p className="text-sm text-slate-500 mt-1">
                  {selectedPlan.objective} · {selectedPlan.standard} · {selectedPlan.scope || 'ไม่ระบุ scope'}
                </p>
              </div>
              <div className="text-right text-xs text-slate-500 space-y-0.5">
                <p className="font-semibold text-slate-800 text-sm">
                  {reportNumber(selectedPlan, selectedPlanIdx)}
                </p>
                <p>วันที่ออกรายงาน: {formatThai(new Date().toISOString())}</p>
                <p>ผู้ตรวจ: {selectedPlan.leadAuditor || '—'}</p>
                <p>ช่วงเวลา: {formatThai(selectedPlan.startDate)} – {formatThai(selectedPlan.endDate)}</p>
              </div>
            </div>

            {/* ── Summary cards ──────────────────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                สรุปผลการตรวจ
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">NC Major</p>
                  <p className="text-3xl font-medium text-red-700">{typeCounts['NC-Major']}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {typeCounts['NC-Major'] === 0 ? 'ไม่พบประเด็นร้ายแรง' : 'ต้องแก้ไขเร่งด่วน'}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">NC Minor</p>
                  <p className="text-3xl font-medium text-amber-700">{typeCounts['NC-Minor']}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {typeCounts['NC-Minor'] === 0 ? 'ไม่พบประเด็น' : 'ต้องดำเนินการแก้ไข'}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">Observation</p>
                  <p className="text-3xl font-medium text-blue-700">{typeCounts['OBS']}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {typeCounts['OBS'] === 0 ? 'ไม่มีข้อสังเกต' : 'ข้อสังเกตเพื่อปรับปรุง'}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Findings table ─────────────────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                รายละเอียดประเด็นที่พบ
              </p>
              {findings.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm bg-slate-50 rounded-xl">
                  ยังไม่มี NCR / OBS ใน Audit Plan นี้
                </div>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5 rounded-tl-lg w-28">รหัส / ประเภท</th>
                      <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">รายละเอียดประเด็น</th>
                      <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5 rounded-tr-lg w-32">ข้อกำหนด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {findings.map((f, idx) => {
                      const t = f.ncrType as ReportNcrType;
                      return (
                        <tr key={f.id} className="border-t border-slate-100">
                          <td className="px-3 py-3 align-top">
                            <p className="font-mono text-xs text-slate-400">{findingIds[idx]}</p>
                            <span className={`inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${BADGE_CLASS[t]}`}>
                              {NCR_LABEL[t]}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-top">
                            <p className="text-slate-800 leading-relaxed">{f.description}</p>
                            {f.impact && (
                              <p className="text-xs text-slate-500 mt-1">ผลกระทบ: {f.impact}</p>
                            )}
                            {f.recommendation && (
                              <p className="text-xs text-slate-500 mt-0.5">ข้อเสนอแนะ: {f.recommendation}</p>
                            )}
                            {(f.rootCause || f.correctiveAction) && (
                              <div className="mt-2 pt-2 border-t border-slate-100 space-y-0.5">
                                {f.rootCause && (
                                  <p className="text-xs text-slate-500">สาเหตุ: {f.rootCause}</p>
                                )}
                                {f.correctiveAction && (
                                  <p className="text-xs text-slate-500">แนวทางแก้ไข: {f.correctiveAction}</p>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top text-xs text-slate-500 font-mono">
                            {f.clauseRef || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Signature section ──────────────────────────────────────── */}
            <div className="border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                    การรับทราบและอนุมัติ
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Management ประทับลายเซ็นดิจิทัลเพื่อรับทราบรายงาน
                  </p>
                </div>
                <div className="text-xs">
                  {bothSigned ? (
                    <span className="text-green-700 font-medium flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                      </svg>
                      รายงานได้รับการรับรองครบถ้วน
                    </span>
                  ) : (
                    <span className="text-slate-400">รอลายเซ็น</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <SigBox
                  name="Lead Auditor"
                  role="ผู้ตรวจสอบหลัก"
                  sig={signatures.leadAuditor}
                  canSign={canEdit}
                  onSign={() => openSigModal('leadAuditor')}
                  onClear={() => handleSigClear('leadAuditor')}
                />
                <SigBox
                  name="Management Representative"
                  role="ผู้บริหาร / ผู้แทน"
                  sig={signatures.management}
                  canSign={canEdit}
                  onSign={() => openSigModal('management')}
                  onClear={() => handleSigClear('management')}
                />
              </div>

              <p className="text-center text-xs text-slate-400 mt-3">
                🔒 ลายเซ็นดิจิทัลพร้อม timestamp ถูกบันทึกในระบบโดยอัตโนมัติเมื่อกดยืนยัน
              </p>
            </div>

          </div>
        )}
      </div>
    </>
  );
}
