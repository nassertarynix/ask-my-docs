import { EyeOff } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The pass-and-play privacy curtain. When a game has hidden information (a secret code, a hidden fleet),
 * put the secret-bearing screen behind this between turns, so a hand-off never shows it by accident:
 *
 *   <Curtain hidden={handingOver} player="Player 2" onReveal={() => setHandingOver(false)}>
 *     ...the screen with the secret on it...
 *   </Curtain>
 *
 * While `hidden`, the children are not rendered at all (not just covered), so the secret is not in the page.
 */
export function Curtain({ hidden, player, message, onReveal, children }: { hidden: boolean; player: string; message?: string; onReveal: () => void; children: ReactNode }) {
  if (!hidden) return <>{children}</>;
  return (
    <div className="curtain" role="dialog" aria-label={`Pass the device to ${player}`} data-curtain="up">
      <EyeOff size={36} aria-hidden="true" />
      <h2>Pass the device to {player}</h2>
      <p>{message ?? 'Make sure nobody else is looking.'}</p>
      <button type="button" className="btn btn-primary btn-big" onClick={onReveal} autoFocus data-action="reveal">
        Tap to reveal
      </button>
    </div>
  );
}
