/** Agri-SHIELD mark: shield + rice sprout over flood water (cyan) and salt front (amber). */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="96 60 320 404" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="lm-sh" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4ade80" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
        <clipPath id="lm-in">
          <path d="M256 92 L384 138 V250 C384 334 330 392 256 424 C182 392 128 334 128 250 V138 Z" />
        </clipPath>
      </defs>
      <path d="M256 72 L402 124 V252 C402 348 340 414 256 450 C172 414 110 348 110 252 V124 Z" fill="#081a1a" stroke="url(#lm-sh)" strokeWidth="22" strokeLinejoin="round" />
      <g clipPath="url(#lm-in)">
        <path d="M120 318 C160 296 196 296 236 318 S312 340 352 318 S392 300 400 304 V440 H120 Z" fill="#0ea5e9" />
        <path d="M120 352 C160 332 196 332 236 352 S312 372 352 352 S392 336 400 340 V440 H120 Z" fill="#f59e0b" />
      </g>
      <path d="M256 318 V186" stroke="#4ade80" strokeWidth="18" strokeLinecap="round" />
      <path d="M256 236 C256 196 284 170 324 166 C322 206 296 232 256 236 Z" fill="#4ade80" />
      <path d="M256 262 C256 226 230 204 194 200 C196 236 220 258 256 262 Z" fill="#22c55e" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="font-display text-[17px] font-semibold tracking-tight text-white">Agri</span>
      <span className="font-display text-[17px] font-semibold tracking-tight text-emerald-400">-SHIELD</span>
    </span>
  );
}
