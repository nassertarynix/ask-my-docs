import { GEMS, GEM_NAMES, cardById, patronById, type Gem, type Token } from './cards';

/**
 * The look of GEM // MERCHANTS. Every gem has its own colour and its own shape (circle, diamond, hexagon, triangle,
 * square, star for gold), so the game can be played without telling colours apart.
 */
export const GEM_COLOURS: Record<Token, string> = { amber: '#F59E0B', azure: '#3B82F6', jade: '#16A06B', pearl: '#F4EFE6', jet: '#2B2B31', gold: '#FACC15' };
const ON: Record<Token, string> = { amber: '#18181b', azure: '#ffffff', jade: '#ffffff', pearl: '#18181b', jet: '#ffffff', gold: '#18181b' };

const SHAPES: Record<Token, string> = {
  amber: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z',
  azure: 'M12 2L22 12L12 22L2 12z',
  jade: 'M7 3h10l5 9l-5 9H7l-5-9z',
  pearl: 'M12 3L22 20H2z',
  jet: 'M4 4h16v16H4z',
  gold: 'M12 2l2.9 6.3l6.8.7l-5.1 4.6l1.5 6.7L12 16.8L5.9 20.3l1.5-6.7L2.3 9l6.8-.7z',
};

/** A gem, optionally with a number in the middle. */
export function GemIcon({ gem, size = 22, label }: { gem: Token; size?: number; label?: number | string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="gm-gem" aria-hidden="true" focusable="false">
      <path d={SHAPES[gem]} fill={GEM_COLOURS[gem]} stroke="#18181b" strokeWidth="1.8" strokeLinejoin="round" />
      {label !== undefined && (
        <text x="12" y={gem === 'pearl' ? 17 : 16.2} textAnchor="middle" fontSize="11" fontWeight="800" fill={ON[gem]} fontFamily="inherit">
          {label}
        </text>
      )}
    </svg>
  );
}

interface CardProps {
  id: number;
  onClick?: () => void;
  selected?: boolean;
  affordable?: boolean;
  disabled?: boolean;
  large?: boolean;
  data?: Record<string, string | number>;
}

/** A stall: points top left, the discount it gives top right, what it costs along the bottom. */
export function CardView({ id, onClick, selected, affordable, disabled, large, data }: CardProps) {
  const c = cardById(id);
  const costs = GEMS.filter((g) => c.cost[g] > 0);
  const classes = ['gm-card', `gm-card-${c.bonus}`];
  if (selected) classes.push('gm-selected');
  if (affordable) classes.push('gm-affordable');
  if (large) classes.push('gm-card-large');
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, String(v)]));
  const label = `Level ${c.level} ${GEM_NAMES[c.bonus]} stall${c.points ? `, ${c.points} points` : ''}, costs ${costs.map((g) => `${c.cost[g]} ${GEM_NAMES[g]}`).join(', ')}`;
  return (
    <button type="button" className={classes.join(' ')} onClick={onClick} disabled={disabled || !onClick} aria-label={label} aria-pressed={selected} data-card={id} data-level={c.level} {...dataAttrs}>
      <span className="gm-card-top">
        <span className="gm-points">{c.points > 0 ? c.points : ''}</span>
        <GemIcon gem={c.bonus} size={large ? 34 : 20} />
      </span>
      <span className="gm-costs">
        {costs.map((g) => (
          <GemIcon key={g} gem={g} size={large ? 28 : 16} label={c.cost[g]} />
        ))}
      </span>
    </button>
  );
}

/** The back of a card, for a deck or somebody else's secret reservation. */
export function CardBack({ level, count, onClick, disabled, selected, data }: { level: 1 | 2 | 3; count?: number; onClick?: () => void; disabled?: boolean; selected?: boolean; data?: Record<string, string | number> }) {
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, String(v)]));
  return (
    <button type="button" className={`gm-card gm-back gm-back-${level}${selected ? ' gm-selected' : ''}`} onClick={onClick} disabled={disabled || !onClick} aria-label={`Level ${level} deck${count !== undefined ? `, ${count} cards left` : ''}`} {...dataAttrs}>
      <span className="gm-back-dots">{'●'.repeat(level)}</span>
      {count !== undefined && <span className="gm-back-count">{count}</span>}
    </button>
  );
}

export function PatronView({ id, onClick, eligible }: { id: number; onClick?: () => void; eligible?: boolean }) {
  const p = patronById(id);
  const needs = GEMS.filter((g) => (p.requires[g] ?? 0) > 0);
  return (
    <button type="button" className={`gm-patron${eligible ? ' gm-affordable' : ''}`} onClick={onClick} disabled={!onClick} data-patron={id} aria-label={`${p.name}, 3 points, wants ${needs.map((g) => `${p.requires[g]} ${GEM_NAMES[g]}`).join(', ')}`}>
      <span className="gm-patron-pts">3</span>
      <span className="gm-patron-needs">
        {needs.map((g) => (
          <GemIcon key={g} gem={g} size={15} label={p.requires[g]} />
        ))}
      </span>
    </button>
  );
}

export { GEM_NAMES };
export type { Gem };
