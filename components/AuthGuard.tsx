'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { mustChangePassword, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && mustChangePassword && pathname !== '/auth/change-password') {
      router.push('/auth/change-password');
    }
  }, [mustChangePassword, loading, pathname, router]);

  return <>{children}</>;
}
