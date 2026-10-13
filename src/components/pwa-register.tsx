'use client';

import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Installation remains available when service-worker registration is blocked by the browser.
      });
    }
  }, []);

  return null;
}
