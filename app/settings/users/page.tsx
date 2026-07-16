'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, type UserProfile, type UserRole } from '@/contexts/AuthContext';
import { getUsers, createUser, updateUserRole, removeUser, resetUserPassword } from './actions';
import Modal from '@/components/Modal';
import PageLoader from '@/components/PageLoader';

const ROLES: UserRole[] = ['admin', 'auditor', 'viewer'];

const ROLE_BADGE: Record<UserRole, string> = {
  admin:   'bg-purple-100 text-purple-700 border-purple-200',
  auditor: 'bg-blue-100 text-blue-700 border-blue-200',
  viewer:  'bg-slate-100 text-slate-600 border-slate-200',
};

export default function UsersPage() {
  const router = useRouter();
  const { isAdmin, loading: authLoading, profile: currentProfile } = useAuth();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createModal, setCreateModal] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createName, setCreateName] = useState('');
  const [createRole, setCreateRole] = useState<UserRole>('auditor');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [resetting, setResetting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { users: data, error: err } = await getUsers();
    if (err) setError(err);
    else setUsers(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { router.replace('/'); return; }
    reload();
  }, [authLoading, isAdmin, router, reload]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateSuccess(false);
    const { error } = await createUser(createEmail, createPassword, createName, createRole);
    if (error) {
      setCreateError(error);
    } else {
      setCreateSuccess(true);
      setCreateEmail('');
      setCreatePassword('');
      setCreateName('');
      setCreateRole('auditor');
      await reload();
    }
    setCreating(false);
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    const { error } = await updateUserRole(userId, role);
    if (error) {
      alert('Role update failed: ' + error);
    } else {
      setUsers(us => us.map(u => u.id === userId ? { ...u, role } : u));
    }
  }

  async function handleRemove() {
    if (!deleteId) return;
    setDeleting(true);
    const { error } = await removeUser(deleteId);
    if (error) {
      alert('Remove failed: ' + error);
    } else {
      setDeleteId(null);
      await reload();
    }
    setDeleting(false);
  }

  async function handleReset() {
    if (!resetTarget) return;
    setResetting(true);
    const { error } = await resetUserPassword(resetTarget.id);
    if (error) {
      alert('Reset failed: ' + error);
    } else {
      setToast(`Password has been reset for ${resetTarget.name || resetTarget.email}`);
      setResetTarget(null);
    }
    setResetting(false);
  }

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (authLoading || loading) return <PageLoader message="กำลังโหลดรายชื่อ Users…" />;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="text-slate-500 text-sm mt-1">Invite team members and manage roles</p>
        </div>
        <button
          onClick={() => { setCreateModal(true); setCreateSuccess(false); setCreateError(null); }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create User
        </button>
      </div>

      {/* Success toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg animate-fade-in">
          <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {toast}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 mb-6">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left text-xs font-semibold text-slate-500 px-5 py-3">User</th>
              <th className="text-left text-xs font-semibold text-slate-500 px-5 py-3 w-36">Role</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-5 py-12 text-center text-slate-400 text-sm">
                  No users yet — invite someone to get started
                </td>
              </tr>
            ) : (
              users.map(u => (
                <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-xs font-semibold text-slate-600 shrink-0">
                        {(u.name || u.email).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">
                          {u.name || <span className="text-slate-400 italic">No name</span>}
                        </p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <select
                      value={u.role}
                      onChange={e => handleRoleChange(u.id, e.target.value as UserRole)}
                      className="text-xs border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Reset password — hidden for own account */}
                      {u.id !== currentProfile?.id && (
                        <button
                          onClick={() => setResetTarget(u)}
                          className="text-slate-400 hover:text-amber-500 transition-colors"
                          title="Reset password"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                              d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteId(u.id)}
                        className="text-slate-400 hover:text-red-500 text-xs transition-colors"
                        title="Remove user"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Role legend */}
      <div className="mt-4 flex gap-3 text-xs text-slate-500">
        {ROLES.map(r => (
          <span key={r} className={`px-2 py-0.5 rounded-full border capitalize ${ROLE_BADGE[r]}`}>
            {r}
          </span>
        ))}
        <span className="text-slate-400">— Admin: full access · Auditor: create/edit · Viewer: read-only</span>
      </div>

      {/* Create User Modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)} title="Create User" size="md">
        {createSuccess ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-3">✅</div>
            <p className="text-green-600 font-medium mb-1">User created!</p>
            <p className="text-sm text-slate-500 mb-4">
              Share the email and temporary password with the user directly.
              They will be prompted to set a new password on first login.
            </p>
            <button
              onClick={() => setCreateModal(false)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={createEmail}
                onChange={e => setCreateEmail(e.target.value)}
                placeholder="user@company.com"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Temporary Password <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                minLength={8}
                value={createPassword}
                onChange={e => setCreatePassword(e.target.value)}
                placeholder="Min 8 characters — tell the user directly"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select
                value={createRole}
                onChange={e => setCreateRole(e.target.value as UserRole)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </div>

            {createError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {createError}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setCreateModal(false)}
                className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {creating ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Reset Password Confirm */}
      <Modal open={!!resetTarget} onClose={() => setResetTarget(null)} title="Reset Password" size="md">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-4.5 h-4.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-slate-700 leading-relaxed">
              Reset password for{' '}
              <span className="font-semibold text-slate-900">
                {resetTarget?.name || resetTarget?.email}
              </span>
              ?
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Their password will be set to the default:{' '}
              <code className="font-mono text-xs bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                P@ssw0rd
              </code>
            </p>
            <p className="text-xs text-slate-400 mt-2">
              Ask them to change it immediately after logging in.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setResetTarget(null)}
            className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {resetting ? 'Resetting…' : 'Confirm Reset'}
          </button>
        </div>
      </Modal>

      {/* Remove Confirm */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Remove User" size="md">
        <p className="text-slate-600 text-sm mb-4">
          Permanently remove this user? They will lose all access immediately.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeleteId(null)}
            className="flex-1 border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleRemove}
            disabled={deleting}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {deleting ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
