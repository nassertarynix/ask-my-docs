/** The little picture on CRATER // LAB's hub card: two tanks, a hill, and a shot in the air. */
export function CardArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 240 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d="M0 92 C30 70 52 96 80 84 S118 40 150 62 S200 96 240 74 V120 H0 Z" fill="#FAF9F6" stroke="#18181B" strokeWidth="3" strokeLinejoin="round" />
      <path d="M44 74 C80 6 150 2 192 58" fill="none" stroke="#18181B" strokeWidth="3" strokeDasharray="1 9" strokeLinecap="round" />
      <circle cx="150" cy="22" r="6" fill="#18181B" />
      <g stroke="#18181B" strokeWidth="3" strokeLinejoin="round">
        <line x1="36" y1="78" x2="48" y2="64" strokeLinecap="round" />
        <rect x="22" y="78" width="28" height="12" rx="3" fill="#FF5A4E" />
        <line x1="204" y1="66" x2="192" y2="54" strokeLinecap="round" />
        <rect x="190" y="66" width="28" height="12" rx="3" fill="#3B6CF6" />
      </g>
    </svg>
  );
}
