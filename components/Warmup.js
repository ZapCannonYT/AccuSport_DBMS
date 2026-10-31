'use client';
// Quietly requests the slow novelty reports in the background so they are cached
// (see app/api/reports/[name]/route.js) by the time someone opens the Early warning tab.
import { useEffect } from 'react';
import { SLOW_REPORTS } from '@/lib/reports';

export default function Warmup() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const name of SLOW_REPORTS) {
        if (cancelled) return;
        try { await fetch(`/api/reports/${name}`); } catch { /* best effort */ }
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return null;
}
