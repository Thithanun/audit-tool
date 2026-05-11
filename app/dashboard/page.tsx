'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { CorrectiveAction, CorrectiveActionStatus } from '@/lib/types';
import {
  getAuditPlans,
  getChecklistItems,
  getCorrectiveActions,
  saveCorrectiveAction,
  computeSessionProgress,
} from '@/lib/store';
import type { AuditPlan, ChecklistItem, FindingStatus } from '@/lib/types';
import StatusBadge, { FINDING_STATUSES, CA_STATUSES } from '@/components/StatusBadge';
import Modal from '@/components/Modal';
import { useAuth } from '@/contexts/AuthContext';

const STATUS_COLORS: Record<FindingStatus, string> = {
  'Not Assessed': 'bg-slate-200',
  'Conformity':   'bg-green-500',
  'OBS':          'bg-blue-400',
  'OFI':          'bg-amber-400',
  'NC-Minor':     'bg-orange-500',
  'NC-Major':     'bg-red-600',
};

const STATUS_TEXT: Record<FindingStatus, string> = {
  'Not Assessed': 'text-slate-600',
  'Conformity':   'text-green-700',
  'OBS':          'text-blue-700',
  'OFI':          'text-amber-700',
  'NC-Minor':     'text-orange-700',
  'NC-Major':     'text-red-700',
};

export default function DashboardPage() {
  const { canEditDashboard: canEdit } = useAuth();
  const [sessions, setSessions] = useState<AuditPlan[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [cas, setCas] = useState<CorrectiveAction[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>('all');
  const [caEditTarget, setCaEditTarget] = useState<CorrectiveAction | null>(null);
  const [caForm, setCaForm] = useState<Partial<CorrectiveAction>>({});
  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setDbError(null);
    try {
      const [plans, is, actions] = await Promise.all([
        getAuditPlans(),
        getChecklistItems(),
        getCorrectiveActions(),
      ]);
      setSessions(plans);
      setItems(is);
      setCas(actions);
    } catch (e) {
      setDbError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filteredItems = useMemo(() => {
    if (selectedSession === 'all') return items;
    return items.filter(i => i.sessionId === selectedSession);
  }, [items, selectedSession]);

  const filteredCas = useMemo(() => {
    if (selectedSession === 'all') return cas;
    return cas.filter(ca => ca.sessionId === selectedSession);
  }, [cas, selectedSession]);

  // Status breakdown
  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(FINDING_STATUSES.map(s => [s, 0])) as Record<FindingStatus, number>;
    for (const i of filteredItems) counts[i.status] = (counts[i.status] ?? 0) + 1;
    return counts;
  }, [filteredItems]);

  const total = filteredItems.length;
  const ncCount = statusCounts['NC-Minor'] + statusCounts['NC-Major'];
  const conformityPct = total === 0 ? 0 : Math.round((statusCounts['Conformity'] / total) * 100);

  // Clause-level breakdown
  const clauseBreakdown = useMemo(() => {
    const groups: Record<string, { total: number; counts: Record<string, number> }> = {};
    for (const item of filteredItems) {
      const group = item.clauseRef.split('.').slice(0, 2).join('.');
      if (!groups[group]) groups[group] = { total: 0, counts: {} };
      groups[group].total++;
      groups[group].counts[item.status] = (groups[group].counts[item.status] ?? 0) + 1;
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredItems]);

  // CA status counts
  const caCounts = useMemo(() => {
    const counts = Object.fromEntries(CA_STATUSES.map(s => [s, 0])) as Record<CorrectiveActionStatus, number>;
    for (const ca of filteredCas) counts[ca.status] = (counts[ca.status] ?? 0) + 1;
    return counts;
  }, [filteredCas]);

  const openCas = useMemo(() =>
    filteredCas.filter(ca => ca.status !== 'Closed').sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }), [filteredCas]);

  function openEditCA(ca: CorrectiveAction) {
    setCaEditTarget(ca);
    setCaForm({ status: ca.status, owner: ca.owner, dueDate: ca.dueDate, closureNotes: ca.closureNotes });
  }

  async function handleCASave(e: React.FormEvent) {
    e.preventDefault();
    if (!caEditTarget) return;
    try {
      await saveCorrectiveAction({ ...caEditTarget, ...caForm, updatedAt: new Date().toISOString() });
      setCaEditTarget(null);
      await reload();
    } catch (err) {
      alert('Save failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  const isOverdue = (ca: CorrectiveAction) =>
    ca.dueDate && ca.status !== 'Closed' && new Date(ca.dueDate) < new Date();

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (dbError) return (
    <div className="text-center py-16 bg-red-50 rounded-xl border border-red-200 mx-4 mt-8">
      <p className="text-red-600 font-medium mb-1">Unable to connect to database</p>
      <p className="text-sm text-red-500 mb-4">{dbError}</p>
      <button onClick={reload} className="text-sm text-blue-600 hover:underline">Try again</button>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Findings summary and corrective action tracker</p>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mr-2">Session</label>
          <select
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedSession}
            onChange={e => setSelectedSession(e.target.value)}
          >
            <option value="all">All Sessions</option>
            {sessions.map(s => <option key={s.id} value={s.id}>{s.objective}</option>)}
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500 mb-1">Total Controls</p>
          <p className="text-3xl font-bold text-slate-900">{total}</p>
          <p className="text-xs text-slate-400 mt-1">{statusCounts['Not Assessed']} not assessed</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-4">
          <p className="text-xs font-medium text-green-600 mb-1">Conformity</p>
          <p className="text-3xl font-bold text-green-700">{statusCounts['Conformity']}</p>
          <p className="text-xs text-green-500 mt-1">{conformityPct}% of total</p>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
          <p className="text-xs font-medium text-amber-600 mb-1">OBS + OFI</p>
          <p className="text-3xl font-bold text-amber-700">{statusCounts['OBS'] + statusCounts['OFI']}</p>
          <p className="text-xs text-amber-500 mt-1">{statusCounts['OBS']} OBS · {statusCounts['OFI']} OFI</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <p className="text-xs font-medium text-red-600 mb-1">Non-Conformities</p>
          <p className="text-3xl font-bold text-red-700">{ncCount}</p>
          <p className="text-xs text-red-500 mt-1">{statusCounts['NC-Minor']} Minor · {statusCounts['NC-Major']} Major</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        {/* Status Distribution Chart */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Status Distribution</h2>
          {total === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">No data</p>
          ) : (
            <div className="space-y-3">
              {FINDING_STATUSES.filter(s => s !== 'Not Assessed').map(s => {
                const count = statusCounts[s];
                const pct = total === 0 ? 0 : Math.round((count / total) * 100);
                return (
                  <div key={s}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className={`font-medium ${STATUS_TEXT[s]}`}>{s}</span>
                      <span className="text-slate-500">{count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${STATUS_COLORS[s]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 border-t border-slate-100">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Not Assessed</span>
                  <span className="text-slate-500">{statusCounts['Not Assessed']}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Session Progress */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Session Progress</h2>
          {sessions.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">No sessions</p>
          ) : (
            <div className="space-y-3">
              {sessions.map(s => {
                const prog = computeSessionProgress(items, s.id);
                return (
                  <div key={s.id}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-700 truncate max-w-[140px]">{s.objective}</span>
                      <span className="text-slate-500 flex-shrink-0">{prog.pct}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${prog.pct}%` }} />
                    </div>
                    <div className="flex gap-2 mt-1">
                      <StatusBadge status={s.status} type="session" size="sm" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* CA Summary */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Corrective Actions</h2>
          {filteredCas.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">No corrective actions</p>
          ) : (
            <div className="space-y-3">
              {CA_STATUSES.map(s => {
                const count = caCounts[s];
                const pct = filteredCas.length === 0 ? 0 : Math.round((count / filteredCas.length) * 100);
                return (
                  <div key={s}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-700">{s}</span>
                      <span className="text-slate-500">{count}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          s === 'Closed' ? 'bg-green-500' :
                          s === 'Open' ? 'bg-blue-400' :
                          s === 'In Progress' ? 'bg-amber-400' : 'bg-red-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Clause-level breakdown */}
      {clauseBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Findings by Clause Group</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-medium text-slate-500 pb-2 w-24">Clause</th>
                  <th className="text-right text-xs font-medium text-slate-500 pb-2">Total</th>
                  {FINDING_STATUSES.map(s => (
                    <th key={s} className="text-right text-xs font-medium pb-2 px-2">
                      <StatusBadge status={s} size="sm" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clauseBreakdown.map(([group, data]) => (
                  <tr key={group} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 font-mono text-xs text-slate-700">{group}</td>
                    <td className="text-right py-2 text-slate-600 font-medium">{data.total}</td>
                    {FINDING_STATUSES.map(s => (
                      <td key={s} className="text-right py-2 px-2">
                        {data.counts[s] ? (
                          <span className={`font-medium ${STATUS_TEXT[s]}`}>{data.counts[s]}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Open Corrective Actions tracker */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">
          Open Corrective Action Tracker
          {openCas.length > 0 && (
            <span className="ml-2 bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full">{openCas.length}</span>
          )}
        </h2>
        {openCas.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-8">
            {filteredCas.length === 0 ? 'No corrective actions yet' : 'All corrective actions are closed'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-medium text-slate-500 pb-2">Clause</th>
                  <th className="text-left text-xs font-medium text-slate-500 pb-2">Description</th>
                  <th className="text-left text-xs font-medium text-slate-500 pb-2">Owner</th>
                  <th className="text-left text-xs font-medium text-slate-500 pb-2">Due</th>
                  <th className="text-left text-xs font-medium text-slate-500 pb-2">Status</th>
                  <th className="text-left text-xs font-medium text-slate-500 pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {openCas.map(ca => {
                  const overdue = isOverdue(ca);
                  return (
                    <tr key={ca.id} className={`border-b border-slate-50 hover:bg-slate-50 ${overdue ? 'bg-red-50' : ''}`}>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                          {ca.clauseRef}
                        </span>
                      </td>
                      <td className="py-2 pr-3 max-w-xs">
                        <p className="text-slate-800 line-clamp-2">{ca.description}</p>
                        {ca.rootCause && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">RC: {ca.rootCause}</p>}
                      </td>
                      <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{ca.owner || '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {ca.dueDate ? (
                          <span className={overdue ? 'text-red-600 font-medium' : 'text-slate-600'}>
                            {overdue && '⚠ '}{ca.dueDate}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={ca.status} type="ca" size="sm" />
                      </td>
                      <td className="py-2">
                        {canEdit && (
                          <button
                            onClick={() => openEditCA(ca)}
                            className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                          >
                            Update
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CA Edit Modal */}
      <Modal
        open={!!caEditTarget}
        onClose={() => setCaEditTarget(null)}
        title={`Update CA — ${caEditTarget?.clauseRef}`}
        size="md"
      >
        {caEditTarget && (
          <form onSubmit={handleCASave} className="space-y-4">
            <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700">
              {caEditTarget.description}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Owner</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={caForm.owner ?? ''}
                  onChange={e => setCaForm(f => ({ ...f, owner: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
                <input
                  type="date"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={caForm.dueDate ?? ''}
                  onChange={e => setCaForm(f => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={caForm.status ?? caEditTarget.status}
                onChange={e => setCaForm(f => ({ ...f, status: e.target.value as CorrectiveActionStatus }))}
              >
                {CA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {(caForm.status === 'Closed' || caEditTarget.status === 'Closed') && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Closure Notes</label>
                <textarea
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={2}
                  value={caForm.closureNotes ?? ''}
                  onChange={e => setCaForm(f => ({ ...f, closureNotes: e.target.value }))}
                />
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setCaEditTarget(null)} className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors">
                Save
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
