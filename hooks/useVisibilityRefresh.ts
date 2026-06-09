'use client';

import { useEffect } from 'react';
import { clearAllCaches } from '@/lib/store';

/**
 * When the browser tab regains visibility (user switches back from another tab),
 * clear the in-memory query cache and call the provided reload function.
 *
 * This ensures cross-tab edits are visible as soon as the user returns to this tab
 * without requiring a hard refresh (Ctrl+Shift+R).
 *
 * Usage:
 *   useVisibilityRefresh(reload);   // inside any page component
 */
export function useVisibilityRefresh(reload: () => void): void {
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        clearAllCaches();
        reload();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [reload]);
}
