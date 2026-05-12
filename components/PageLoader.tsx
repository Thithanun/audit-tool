'use client';

import { useEffect, useState } from 'react';

interface PageLoaderProps {
  message?: string;
}

/** Full-page loading indicator shown while fetching data from Supabase.
 *  Shows elapsed seconds after 3 s so users know the app is still working. */
export default function PageLoader({ message = 'กำลังโหลดข้อมูล…' }: PageLoaderProps) {
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-slate-400">{message}</p>
      {secs >= 3 && (
        <p className="text-xs text-slate-300">
          {secs < 10 ? `${secs}s…` : 'ใช้เวลานานกว่าปกติ — กรุณารอสักครู่'}
        </p>
      )}
    </div>
  );
}

/** Inline error state with retry button. */
export function DbError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-16 bg-red-50 rounded-xl border border-red-200 mx-4 mt-8">
      <p className="text-red-600 font-medium mb-1">ไม่สามารถเชื่อมต่อฐานข้อมูลได้</p>
      <p className="text-sm text-red-400 mb-4">{message}</p>
      <button
        onClick={onRetry}
        className="text-sm text-blue-600 hover:underline font-medium"
      >
        ลองใหม่อีกครั้ง
      </button>
    </div>
  );
}
