'use client';

import React, { useState, useRef } from 'react';
import type { ChecklistItem, PlanSession } from '@/lib/types';
import { ALL_CLAUSES } from '@/lib/seed-data';
import { bulkSaveChecklistItems, uid } from '@/lib/store';
import Modal from '@/components/Modal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawRow {
  session: string;
  clause: string;
  checklist: string;
  remark: string;
}

interface PreviewRow extends RawRow {
  rowIndex: number;
  sessionId: string | null;
  clauseRef: string;   // may differ from row.clause after user edits
  sessionValid: boolean;
  clauseValid: boolean;
}

// ── Session helpers ───────────────────────────────────────────────────────────

function sessionFullLabel(s: PlanSession): string {
  return `Day ${s.day}${s.time ? ` · ${s.time}` : ''} · ${s.areaOfAudit}`;
}

function sessionShortLabel(s: PlanSession): string {
  return `Day ${s.day}${s.time ? ` · ${s.time}` : ''}`;
}

/** Normalise for fuzzy matching: lowercase, collapse whitespace, unify separators.
 *  Handles Excel special chars vs plain ASCII stored in the database:
 *  - Middle-dot variants  · • ‧ ⋅ ∙  → ·
 *  - Dash variants        – — ‒ ―    → - (hyphen)
 *  - Strips whitespace around both separators so
 *    "14:00 – 15:00" and "14:00-15:00" both become "14:00-15:00"
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[·•‧⋅∙]/g, '·')       // unify middle-dot variants
    .replace(/\s*·\s*/g, '·')        // strip spaces around ·
    .replace(/[–—‒―]/g, '-')         // unify en-dash / em-dash → hyphen
    .replace(/\s*-\s*/g, '-')        // strip spaces around hyphen ("14:00 - 15:00" → "14:00-15:00")
    .replace(/\s+/g, ' ')
    .trim();
}

function matchSession(raw: string, sessions: PlanSession[]): PlanSession | undefined {
  if (!raw.trim()) return undefined;
  const n = norm(raw);
  // 1. Full label:  Day X · time · area
  let m = sessions.find(s => norm(sessionFullLabel(s)) === n);
  if (m) return m;
  // 2. Short label: Day X · time
  m = sessions.find(s => norm(sessionShortLabel(s)) === n);
  if (m) return m;
  // 3. Excel value starts with short label (extra text after)
  m = sessions.find(s => n.startsWith(norm(sessionShortLabel(s)) + '·'));
  return m;
}

// ── Excel parser ──────────────────────────────────────────────────────────────
// xlsx is loaded on-demand so it never bloats the initial JS bundle.

async function parseExcelFile(file: File): Promise<RawRow[]> {
  // Dynamic import — resolved once, then V8 caches the module.
  const XLSX = await import('xlsx');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        resolve(
          json.map(row => ({
            session:   String(row['session']   ?? row['Session']   ?? '').trim(),
            clause:    String(row['clause']    ?? row['Clause']    ?? '').trim(),
            checklist: String(row['checklist'] ?? row['Checklist'] ?? '').trim(),
            remark:    String(row['remark']    ?? row['Remark']    ?? '').trim(),
          })),
        );
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsArrayBuffer(file);
  });
}

async function downloadTemplate(sessions: PlanSession[]) {
  const XLSX = await import('xlsx');
  const exampleSession = sessions.length > 0 ? sessionShortLabel(sessions[0]) : 'Day 1 · 09:00-10:00';
  const data = [
    ['session', 'clause', 'checklist', 'remark'],
    [exampleSession, 'A.7.4', 'มีการกำหนดนโยบายสื่อสารกับบุคคลภายนอกหรือไม่?', ''],
    [exampleSession, '5.2',   'มีการกำหนด information security policy หรือไม่?', 'ตรวจสอบเอกสาร'],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 60 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Checklist');
  XLSX.writeFile(wb, 'checklist_import_template.xlsx');
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  /** All sessions for the currently selected audit plan. */
  sessions: PlanSession[];
  onImported: () => void;
}

export default function ImportModal({ open, onClose, sessions, onImported }: ImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload');
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function reset() {
    setStep('upload');
    setRows([]);
    setParseError(null);
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    reset();
    onClose();
  }

  function buildPreviewRow(raw: RawRow, index: number): PreviewRow {
    const matched = matchSession(raw.session, sessions);
    const clauseRef = raw.clause;
    return {
      ...raw,
      rowIndex: index,
      sessionId: matched?.id ?? null,
      clauseRef,
      sessionValid: !!matched,
      clauseValid: ALL_CLAUSES.some(c => c.clauseRef === clauseRef),
    };
  }

  function patchRow(index: number, patch: Partial<PreviewRow>) {
    setRows(prev =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, ...patch };
        if ('clauseRef' in patch) {
          next.clauseValid = ALL_CLAUSES.some(c => c.clauseRef === next.clauseRef);
        }
        if ('sessionId' in patch) {
          next.sessionValid = !!next.sessionId;
        }
        return next;
      }),
    );
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    try {
      const raw = await parseExcelFile(file);
      if (raw.length === 0) {
        setParseError('ไม่พบข้อมูลในไฟล์ หรือไม่มี header row ที่ถูกต้อง');
        return;
      }
      setRows(raw.map((r, i) => buildPreviewRow(r, i)));
      setStep('preview');
    } catch (err) {
      setParseError('อ่านไฟล์ไม่ได้: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleConfirm() {
    const validRows = rows.filter(r => r.sessionValid && r.clauseValid && r.checklist.trim());
    if (validRows.length === 0) {
      setImportError('ไม่มีแถวที่ถูกต้องสำหรับ import');
      return;
    }
    setStep('importing');
    setImportError(null);
    try {
      const now = new Date().toISOString();
      const items: ChecklistItem[] = validRows.map(row => {
        const clauseInfo = ALL_CLAUSES.find(c => c.clauseRef === row.clauseRef)!;
        return {
          id: uid(),
          sessionId: row.sessionId!,
          framework: clauseInfo.framework,
          clauseRef: clauseInfo.clauseRef,
          clauseTitle: clauseInfo.clauseTitle,
          requirement: clauseInfo.requirement,
          question: row.checklist.trim(),
          status: 'Not Assessed',
          notes: row.remark || '',
          evidence: '',
          createdAt: now,
          updatedAt: now,
        };
      });
      await bulkSaveChecklistItems(items);
      onImported();
      handleClose();
    } catch (err) {
      setImportError('Import ล้มเหลว: ' + (err instanceof Error ? err.message : String(err)));
      setStep('preview');
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const validCount = rows.filter(r => r.sessionValid && r.clauseValid && r.checklist.trim()).length;
  const errorCount = rows.length - validCount;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Modal open={open} onClose={handleClose} title="Import Checklist จาก Excel" size="xl">

      {/* ── Step: Upload ─────────────────────────────────────────────────── */}
      {step === 'upload' && (
        <div className="space-y-5">

          {/* Format guide */}
          <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-600 space-y-3">
            <p className="font-medium text-slate-700">รูปแบบไฟล์ Excel (.xlsx / .xls)</p>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs items-center">
              <code className="bg-white border border-slate-200 rounded px-2 py-0.5 font-mono">session</code>
              <span className="text-slate-500">ชื่อ session ตรงกับ Audit Plan เช่น <code className="bg-slate-100 px-1 rounded">Day 1 · 09:30-10:00</code></span>
              <code className="bg-white border border-slate-200 rounded px-2 py-0.5 font-mono">clause</code>
              <span className="text-slate-500">รหัส clause เช่น <code className="bg-slate-100 px-1 rounded">A.7.4</code></span>
              <code className="bg-white border border-slate-200 rounded px-2 py-0.5 font-mono">checklist</code>
              <span className="text-slate-500">ข้อความคำถาม (จำเป็น)</span>
              <code className="bg-white border border-slate-200 rounded px-2 py-0.5 font-mono">remark</code>
              <span className="text-slate-500">หมายเหตุ / หลักฐาน (optional)</span>
            </div>
            <button
              onClick={() => downloadTemplate(sessions)}
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium underline underline-offset-2"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              ดาวน์โหลด Template
            </button>
          </div>

          {/* Sessions in this plan */}
          {sessions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-2">
                Sessions ที่มีใน Audit Plan นี้ ({sessions.length} sessions):
              </p>
              <div className="max-h-28 overflow-y-auto space-y-0.5 rounded border border-slate-200 p-2 bg-slate-50">
                {sessions.map(s => (
                  <p key={s.id} className="text-xs text-slate-600 font-mono">
                    {sessionShortLabel(s)}{s.areaOfAudit ? ` · ${s.areaOfAudit}` : ''}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Drop zone */}
          <div
            className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg className="w-10 h-10 mx-auto text-slate-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm font-medium text-slate-700">คลิกเพื่อเลือกไฟล์ Excel</p>
            <p className="text-xs text-slate-400 mt-1">รองรับ .xlsx และ .xls</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />

          {parseError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {parseError}
            </div>
          )}
        </div>
      )}

      {/* ── Step: Preview ────────────────────────────────────────────────── */}
      {step === 'preview' && (
        <div className="space-y-4">

          {/* Summary bar */}
          <div className="flex items-center justify-between">
            <div className="flex gap-4 text-sm">
              <span className="text-slate-500">{rows.length} แถวทั้งหมด</span>
              {validCount > 0 && (
                <span className="text-green-600 font-medium">✓ {validCount} พร้อม import</span>
              )}
              {errorCount > 0 && (
                <span className="text-red-600 font-medium">✗ {errorCount} มีข้อผิดพลาด</span>
              )}
            </div>
            <button
              onClick={reset}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              เลือกไฟล์ใหม่
            </button>
          </div>

          {errorCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700">
              แถวสีแดงมีข้อผิดพลาด — แก้ไข Session หรือ Clause ได้ในตารางด้านล่างก่อน Confirm
            </div>
          )}

          {/* Preview table */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-[55vh] overflow-y-auto">
            <table className="w-full text-xs min-w-[700px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <th className="px-3 py-2 font-semibold text-slate-500 w-8">#</th>
                  <th className="px-3 py-2 font-semibold text-slate-500 min-w-[190px]">Session</th>
                  <th className="px-3 py-2 font-semibold text-slate-500 w-32">Clause</th>
                  <th className="px-3 py-2 font-semibold text-slate-500 min-w-[200px]">Checklist</th>
                  <th className="px-3 py-2 font-semibold text-slate-500 min-w-[110px]">Remark</th>
                  <th className="px-3 py-2 font-semibold text-slate-500 w-20 text-center">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isError = !row.sessionValid || !row.clauseValid || !row.checklist.trim();
                  const sessionObj = sessions.find(s => s.id === row.sessionId);
                  return (
                    <tr
                      key={i}
                      className={`border-b border-slate-100 align-top ${isError ? 'bg-red-50' : 'bg-white hover:bg-slate-50'}`}
                    >
                      {/* # */}
                      <td className="px-3 py-2.5 text-slate-400">{i + 1}</td>

                      {/* Session */}
                      <td className="px-3 py-2.5">
                        {row.sessionValid && sessionObj ? (
                          <span className="text-slate-700">
                            {sessionShortLabel(sessionObj)}
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-red-500 truncate max-w-[180px]" title={row.session || '(ว่าง)'}>
                              ❌ {row.session || <em>(ว่าง)</em>}
                            </p>
                            <select
                              className="w-full text-xs border border-red-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                              value={row.sessionId ?? ''}
                              onChange={e => {
                                const sid = e.target.value;
                                patchRow(i, { sessionId: sid || null, sessionValid: !!sid });
                              }}
                            >
                              <option value="">— เลือก Session —</option>
                              {sessions.map(s => (
                                <option key={s.id} value={s.id}>
                                  {sessionFullLabel(s)}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </td>

                      {/* Clause */}
                      <td className="px-3 py-2.5">
                        {row.clauseValid ? (
                          <span className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                            {row.clauseRef}
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-red-500">
                              ❌ {row.clauseRef || <em>(ว่าง)</em>}
                            </p>
                            <select
                              className="w-full text-xs border border-red-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                              value={row.clauseRef}
                              onChange={e => patchRow(i, { clauseRef: e.target.value })}
                            >
                              <option value="">— เลือก Clause —</option>
                              {ALL_CLAUSES.map(c => (
                                <option key={c.clauseRef} value={c.clauseRef}>
                                  {c.clauseRef} — {c.clauseTitle}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </td>

                      {/* Checklist */}
                      <td className="px-3 py-2.5">
                        {row.checklist.trim() ? (
                          <p className="text-slate-700 leading-snug">{row.checklist}</p>
                        ) : (
                          <p className="text-red-500 italic">❌ (ว่าง — จำเป็น)</p>
                        )}
                      </td>

                      {/* Remark */}
                      <td className="px-3 py-2.5 text-slate-500">{row.remark}</td>

                      {/* Status */}
                      <td className="px-3 py-2.5 text-center">
                        {isError ? (
                          <span className="inline-block bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-medium">
                            Error
                          </span>
                        ) : (
                          <span className="inline-block bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {importError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {importError}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 justify-end pt-1 border-t border-slate-100">
            <button
              onClick={handleClose}
              className="border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleConfirm}
              disabled={validCount === 0}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Confirm Import ({validCount} รายการ)
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Importing ──────────────────────────────────────────────── */}
      {step === 'importing' && (
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          <p className="text-sm text-slate-600">กำลัง import {validCount} รายการ...</p>
        </div>
      )}

    </Modal>
  );
}
