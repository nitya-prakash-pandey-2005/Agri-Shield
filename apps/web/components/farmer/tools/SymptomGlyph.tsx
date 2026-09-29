/**
 * Illustrated symptom icons for the Crop Doctor picker — simple, high-contrast
 * drawings (leaf / stem / panicle / field) that read at 48 px on a phone.
 */
const LEAF = "M6 42 C 14 26, 26 12, 42 6 C 38 22, 26 36, 6 42 Z";
const leafFill = "#3f7d3a";
const leafStroke = "#86efac";

function Leaf({ fill = leafFill, children }: { fill?: string; children?: React.ReactNode }) {
  return (
    <>
      <path d={LEAF} fill={fill} stroke={leafStroke} strokeWidth="1.2" />
      <path d="M8 40 L40 8" stroke="#bbf7d0" strokeOpacity=".45" strokeWidth="0.8" />
      {children}
    </>
  );
}

function Stem({ children, color = "#4d7c0f" }: { children?: React.ReactNode; color?: string }) {
  return (
    <>
      <rect x="21" y="4" width="6" height="40" rx="3" fill={color} stroke="#a3e635" strokeWidth="1" />
      {children}
    </>
  );
}

function Panicle({ color = "#facc15" }: { color?: string }) {
  return (
    <>
      <path d="M24 44 L24 18" stroke="#65a30d" strokeWidth="2" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <ellipse cx={18 - i * 0.5} cy={20 - i * 3.2} rx="3" ry="1.6" fill={color} transform={`rotate(-30 ${18 - i * 0.5} ${20 - i * 3.2})`} />
          <ellipse cx={30 + i * 0.5} cy={20 - i * 3.2} rx="3" ry="1.6" fill={color} transform={`rotate(30 ${30 + i * 0.5} ${20 - i * 3.2})`} />
        </g>
      ))}
    </>
  );
}

const GLYPHS: Record<string, React.ReactNode> = {
  diamond: (
    <Leaf>
      {[
        [18, 28],
        [28, 18],
      ].map(([x, y]) => (
        <g key={x}>
          <path d={`M${x - 5} ${y + 3} L${x} ${y - 3} L${x + 5} ${y - 3} L${x} ${y + 3} Z`} fill="#94a3b8" stroke="#7c2d12" strokeWidth="1.4" />
        </g>
      ))}
    </Leaf>
  ),
  dots: (
    <Leaf>
      {[
        [14, 32],
        [20, 26],
        [26, 22],
        [31, 15],
        [22, 31],
        [30, 21],
      ].map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx="2" ry="1.3" fill="#78350f" stroke="#fde047" strokeWidth=".6" />
      ))}
    </Leaf>
  ),
  edge: (
    <Leaf>
      <path d="M26 20 C 30 14, 36 10, 42 6 C 40 14, 34 22, 30 24 C 29 22, 27 22, 26 20 Z" fill="#fef3c7" />
      <path d="M26 20 C 27 22, 29 22, 30 24" stroke="#ca8a04" strokeWidth="1.2" fill="none" />
    </Leaf>
  ),
  tipburn: (
    <Leaf>
      <path d="M32 12 C 36 9, 39 7, 42 6 C 41 10, 38 14, 35 17 Z" fill="#f8fafc" stroke="#a16207" strokeWidth="1" />
    </Leaf>
  ),
  crust: (
    <>
      <rect x="2" y="30" width="44" height="14" rx="2" fill="#57534e" />
      {[6, 14, 22, 30, 38].map((x) => (
        <path key={x} d={`M${x} 31 l3 -2 l3 2 l2 -1`} stroke="#f8fafc" strokeWidth="2" fill="none" />
      ))}
      <path d="M12 30 L12 18 M12 22 L8 16 M12 22 L16 17" stroke="#a3e635" strokeWidth="1.6" />
      <path d="M34 30 L34 24 M34 26 L31 22" stroke="#a3e635" strokeWidth="1.4" />
    </>
  ),
  flood: (
    <>
      <path d="M10 44 L14 20 M20 44 L22 14 M30 44 L32 22" stroke="#65a30d" strokeWidth="2" />
      <path d="M22 14 C 26 16, 30 22, 36 26" stroke="#78716c" strokeWidth="2" fill="none" />
      <rect x="0" y="26" width="48" height="18" fill="#0ea5e9" fillOpacity=".55" />
      <path d="M2 26 q5 -3 10 0 t10 0 t10 0 t10 0 t10 0" stroke="#bae6fd" strokeWidth="1.5" fill="none" />
    </>
  ),
  yellow: <Leaf fill="#ca8a04" />,
  margin: (
    <Leaf>
      <path d={LEAF} fill="none" stroke="#ea580c" strokeWidth="3" />
    </Leaf>
  ),
  dust: (
    <Leaf fill="#4d7c0f">
      {[
        [16, 30],
        [19, 27],
        [23, 25],
        [27, 20],
        [30, 17],
        [25, 28],
        [21, 22],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.3" fill="#92400e" />
      ))}
    </Leaf>
  ),
  purple: <Leaf fill="#6b21a8" />,
  deadheart: (
    <>
      <path d="M16 44 C 14 30, 10 22, 6 14 M32 44 C 34 30, 38 22, 42 14" stroke="#65a30d" strokeWidth="2.4" fill="none" />
      <path d="M24 44 L24 8" stroke="#d6d3d1" strokeWidth="3" />
      <path d="M24 8 l-3 5 M24 8 l3 5" stroke="#a8a29e" strokeWidth="2" />
      <circle cx="24" cy="36" r="2" fill="#1c1917" />
    </>
  ),
  whitehead: <Panicle color="#f8fafc" />,
  fold: (
    <>
      <path d="M8 40 C 16 28, 26 16, 40 8 L42 12 C 30 20, 20 30, 12 42 Z" fill={leafFill} stroke={leafStroke} />
      <path d="M14 36 L20 30 M22 28 L28 22 M30 20 L35 15" stroke="#f8fafc" strokeWidth="2" />
    </>
  ),
  patch: (
    <>
      <rect x="2" y="6" width="44" height="36" rx="4" fill="#3f6212" />
      <circle cx="24" cy="24" r="11" fill="#a16207" stroke="#78350f" strokeWidth="1.5" />
      {[
        [20, 22],
        [26, 27],
        [27, 20],
      ].map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx="1.8" ry="1" fill="#451a03" />
      ))}
    </>
  ),
  sheath: (
    <Stem>
      <rect x="0" y="34" width="48" height="10" fill="#0ea5e9" fillOpacity=".4" />
      <ellipse cx="24" cy="26" rx="3.5" ry="6" fill="#94a3b8" stroke="#78350f" strokeWidth="1.2" />
      <ellipse cx="24" cy="14" rx="3" ry="4.5" fill="#94a3b8" stroke="#78350f" strokeWidth="1.2" />
    </Stem>
  ),
  pustule: (
    <Leaf>
      {[
        [15, 31],
        [19, 27],
        [23, 24],
        [27, 20],
        [31, 16],
        [22, 29],
        [28, 23],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.8" fill="#f97316" />
      ))}
    </Leaf>
  ),
  holes: (
    <Leaf>
      <circle cx="20" cy="27" r="3" fill="#0b1224" />
      <path d="M27 18 l4 -2 l1 4 l-3 1 z" fill="#0b1224" />
      <circle cx="16" cy="34" r="1" fill="#d6d3d1" />
      <circle cx="18" cy="35" r="0.8" fill="#d6d3d1" />
    </Leaf>
  ),
  fruithole: (
    <>
      <path d="M24 6 L24 12" stroke="#65a30d" strokeWidth="3" />
      <ellipse cx="24" cy="28" rx="11" ry="15" fill="#6d28d9" stroke="#c4b5fd" strokeWidth="1" />
      <circle cx="28" cy="30" r="2.6" fill="#1c1917" />
      <path d="M28 30 q6 4 10 2" stroke="#fde68a" strokeWidth="2" fill="none" />
    </>
  ),
  wilt: (
    <>
      <path d="M24 44 L24 20" stroke="#1c1917" strokeWidth="4" />
      <path d="M24 30 L24 14" stroke="#65a30d" strokeWidth="3" />
      <path d="M24 16 C 16 14, 10 22, 8 32 M24 20 C 32 18, 38 26, 40 34" stroke="#84cc16" strokeWidth="3" fill="none" />
      <rect x="18" y="38" width="12" height="6" rx="2" fill="#44403c" />
    </>
  ),
  purplespot: (
    <>
      <rect x="18" y="4" width="12" height="40" rx="6" fill="#4d7c0f" stroke="#a3e635" />
      <ellipse cx="24" cy="18" rx="4" ry="6" fill="#86198f" stroke="#fde047" strokeWidth="1.2" />
      <ellipse cx="24" cy="33" rx="3" ry="4" fill="#86198f" stroke="#fde047" strokeWidth="1" />
    </>
  ),
  blackstem: (
    <Stem color="#65a30d">
      <ellipse cx="24" cy="24" rx="4" ry="7" fill="#0c0a09" />
      <path d="M20 30 L28 34" stroke="#0c0a09" strokeWidth="2" />
    </Stem>
  ),
  roll: (
    <>
      <rect x="2" y="36" width="44" height="8" fill="#a16207" />
      <path d="M6 38 l6 4 M16 37 l4 6 M28 38 l5 4 M38 37 l3 5" stroke="#451a03" strokeWidth="1.2" />
      <path d="M24 36 L24 16" stroke="#65a30d" strokeWidth="2" />
      <path d="M24 18 C 18 16, 14 20, 12 28 M24 22 C 30 20, 34 24, 36 30" stroke="#84cc16" strokeWidth="4" strokeLinecap="round" fill="none" />
    </>
  ),
  mosaic: (
    <Leaf>
      {[
        [16, 30],
        [22, 24],
        [28, 18],
        [20, 31],
        [26, 26],
        [32, 14],
      ].map(([x, y], i) => (
        <rect key={i} x={x - 2.5} y={y - 2.5} width="5" height="5" fill="#fde047" fillOpacity=".75" transform={`rotate(20 ${x} ${y})`} />
      ))}
    </Leaf>
  ),
};

export function SymptomGlyph({ glyph, size = 48 }: { glyph: string; size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden className="shrink-0">
      <rect width="48" height="48" rx="10" fill="#0f172a" />
      {GLYPHS[glyph] ?? <Leaf />}
    </svg>
  );
}

export const PART_GLYPH: Record<string, string> = { leaf: "yellow", stem: "blackstem", root: "wilt", grain: "whitehead", whole: "patch" };
