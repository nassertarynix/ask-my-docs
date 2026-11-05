/** A handful of hand-drawn 24x24 stroke icons; no icon library, no extra requests. */
const PATHS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  sales: 'M3 4h2.2l2.1 10.2a1.6 1.6 0 0 0 1.6 1.3h8a1.6 1.6 0 0 0 1.6-1.2L20 8H6M9.5 20a.9.9 0 1 0 0-.01M17 20a.9.9 0 1 0 0-.01',
  stock: 'M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5 12 12l8.5-4.5M12 12v9',
  invoice: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  truck: 'M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7M7 18.5a1.5 1.5 0 1 0 0-.01M17 18.5a1.5 1.5 0 1 0 0-.01',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.5a3.3 3.3 0 0 1 0 6M18 14.8c1.8.7 3 2.4 3.4 5.2',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  data: 'M12 4c4.4 0 8 1.1 8 2.5S16.4 9 12 9 4 7.9 4 6.5 7.6 4 12 4zM4 6.5v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5M4 11.5v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5',
  plus: 'M12 5v14M5 12h14',
  chevron: 'm9 6 6 6-6 6',
  back: 'm15 6-6 6 6 6',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  x: 'm6 6 12 12M18 6 6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  upload: 'M12 16V5m0 0-4 4m4-4 4 4M5 20h14',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7M10.5 11v5M13.5 11v5',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.01',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 12h17M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  box: 'M4 8h16v12H4zM3 4h18v4H3zM10 12h4',
  cash: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6.5 12h.01M17.5 12h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="icon">
      <path d={PATHS[name]} />
    </svg>
  );
}
