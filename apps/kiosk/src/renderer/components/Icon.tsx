import type { ReactElement, SVGProps } from 'react';

/** Inline stroke icons (24×24, currentColor) — no external icon assets needed offline. */
const paths: Record<string, ReactElement> = {
  run: (
    <>
      <circle cx="15.5" cy="4.5" r="2" />
      <path d="M8 21l3-6 3 2v5M6.5 12.5L9 9l4-1 3 3 3 1M11 15l-2-3M4 9h3M3 12h3" />
    </>
  ),
  apple: (
    <>
      <path d="M12 7c-1.5-1.3-4-1.6-5.6 0C4.5 9 5 13.5 7.4 17c1.2 1.8 2.6 3 4 2.3.4-.2.9-.2 1.3 0 1.4.7 2.8-.5 4-2.3C19 13.5 19.5 9 17.6 7c-1.6-1.6-4.1-1.3-5.6 0z" />
      <path d="M12 7c0-2 1-3.5 3-4" />
    </>
  ),
  brain: (
    <>
      <path d="M9 21v-3.5A6.5 6.5 0 1 1 18 11c0 1.2.5 2.2 1.2 3.1L18 15v2a2 2 0 0 1-2 2h-1v2" />
      <circle cx="12.5" cy="10" r="2.2" />
      <path d="M12.5 6.8v1M12.5 12.2v1M9.3 10h1M14.7 10h1M10.2 7.7l.7.7M14.1 11.6l.7.7M14.8 7.7l-.7.7M10.9 11.6l-.7.7" />
    </>
  ),
  pulse: <path d="M2 12h4l2-5 4 10 3-7 2 2h5" />,
  cart: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h3l2.4 11.2a2 2 0 0 0 2 1.6h8a2 2 0 0 0 2-1.5L21 7H6" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M17 20h4v-3M14 20v.01" />
    </>
  ),
  card: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2.5" />
      <rect x="8" y="5" width="8" height="5" rx="1" />
      <path d="M8.5 14h.01M12 14h.01M15.5 14h.01M8.5 17.5h.01M12 17.5h.01M15.5 17.5h.01" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  alert: (
    <>
      <path d="M12 3l9.5 16.5h-19z" />
      <path d="M12 10v4M12 17v.01" />
    </>
  ),
  /** forward in RTL (points left) */
  chevron: <path d="M15 5l-7 7 7 7" />,
  /** back in RTL (points right) */
  back: <path d="M5 12h14M13 6l6 6-6 6" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  wifiOff: <path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.7M19 13a10 10 0 0 0-3-2M2 8.8A15 15 0 0 1 6.7 6M22 8.8A15 15 0 0 0 11 5.1M12 20h.01" />,
  printer: (
    <>
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M6 14h12v7H6z" />
    </>
  ),
  crown: <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />,
  phone: (
    <>
      <rect x="6.5" y="2" width="11" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4" />,
  receipt: <path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4" />,
  backspace: (
    <>
      <path d="M21 5H8l-6 7 6 7h13z" />
      <path d="M12 9l6 6M18 9l-6 6" />
    </>
  ),
  close: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  home: <path d="M3 11l9-8 9 8M5 9.5V21h14V9.5" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {paths[name]}
    </svg>
  );
}

export const CATEGORY_ICON: Record<string, IconName> = { blue: 'run', red: 'apple', purple: 'brain', cyan: 'pulse' };
