import type { ReactNode } from 'react';

const paths: Record<'cable' | 'refresh' | 'layers' | 'chevron' | 'check' | 'alert' | 'key', ReactNode> = {
  cable: <><path d="M4 9v4a3 3 0 0 0 6 0V8a3 3 0 0 1 6 0v5"/><path d="M2 5h4v4H2zM3 2v3m2-3v3m9 8h4v4h-4zM15 17v3m2-3v3"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 8a7 7 0 0 1 11.75-2.25L20 12M4 12l2.75 6.25A7 7 0 0 0 18.5 16"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
  chevron: <path d="m6 9 6 6 6-6"/>,
  check: <><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.25 2.25 4.75-4.75"/></>,
  alert: <><circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/></>,
  key: <><circle cx="16" cy="8" r="4"/><path d="m13 11-8 8H3v-3l2-2h3v-3l2-2"/></>,
};

export function ManagementIcon({ name, size = 16 }: { name: keyof typeof paths; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    {paths[name]}
  </svg>;
}
