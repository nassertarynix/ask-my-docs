import { BookOpen, ChevronsRight, Flame, Hand, Heart, Shield, Sword } from 'lucide-react';
import type { ComponentType } from 'react';
import { defOf, heroById, heroOfCard, type EffectKind } from './cards';

const ICONS: Record<EffectKind, ComponentType<{ size?: number; 'aria-hidden'?: boolean }>> = { atk: Sword, sweep: Flame, shield: Shield, heal: Heart, draw: BookOpen, extra: ChevronsRight, steal: Hand };
export const EFFECT_NAMES: Record<EffectKind, string> = { atk: 'Hit', sweep: 'Hit everyone', shield: 'Shield', heal: 'Heal', draw: 'Draw', extra: 'Play more', steal: 'Steal' };

/** The effects of a card as small icons with numbers. */
export function Effects({ id, size = 16 }: { id: number; size?: number }) {
  return (
    <span className="pb-effects">
      {defOf(id).effects.map((e, i) => {
        const Icon = ICONS[e.kind];
        return (
          <span key={i} className={`pb-fx pb-fx-${e.kind}`} title={EFFECT_NAMES[e.kind]}>
            <Icon size={size} aria-hidden />
            <b>{e.n}</b>
          </span>
        );
      })}
    </span>
  );
}

interface CardProps {
  id: number;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export function BrawlCard({ id, selected, onClick, disabled }: CardProps) {
  const def = defOf(id);
  const hero = heroById(heroOfCard(id));
  const text = def.effects.map((e) => `${EFFECT_NAMES[e.kind]} ${e.n}`).join(', ');
  return (
    <button type="button" className={`pb-card${selected ? ' pb-selected' : ''}`} style={{ ['--hero' as string]: hero.colour }} onClick={onClick} disabled={disabled || !onClick} aria-pressed={selected} aria-label={`${def.name}: ${text}`} data-card={id} data-name={def.name}>
      <span className="pb-card-name">{def.name}</span>
      <Effects id={id} />
    </button>
  );
}
