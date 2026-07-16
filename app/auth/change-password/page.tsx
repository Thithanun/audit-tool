'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { markPasswordChanged } from './actions';

export default function ChangePasswordPage() {
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const router = useRouter();
  const { user, refreshProfile } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('รหัสผ่านไม่ตรงกัน'); return; }
    if (password.length < 8)  { setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'); return; }

    setError(null);
    setLoading(true);
    try {
      const { error: dbErr } = await markPasswordChanged(user?.id ?? '');
      if (dbErr) throw new Error(dbErr);

      const { error: authErr } = await supabase.auth.updateUser({ password });
      if (authErr) throw authErr;

      await refreshProfile();
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-md">

        <div className="flex items-center gap-3 mb-7">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold text-white">
            A
          </div>
          <div>
            <p className="font-bold text-slate-900 leading-tight">Audit Tool</p>
            <p className="text-xs text-slate-500">ISO 27001 · NIST CSF</p>
          </div>
        </div>

        <h1 className="text-xl font-semibold text-slate-900 mb-1">ตั้งรหัสผ่านใหม่</h1>
        <p className="text-sm text-slate-500 mb-6">
          กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งานระบบ
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">รหัสผ่านใหม่</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ยืนยันรหัสผ่าน</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่าน'}
          </button>
        </form>
      </div>
    </div>
  );
}
