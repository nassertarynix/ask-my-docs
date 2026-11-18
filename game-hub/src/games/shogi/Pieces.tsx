import { baseOf, isPromoted, kindOf, type Kind } from './engine';

/**
 * Shogi tiles: the traditional wedge-shaped pentagon, drawn as inline SVG so it looks the same everywhere. A tile points
 * toward the opponent (up the screen for the player at the bottom); the other player's tiles are turned upside down.
 * The label is the kanji, or letters for people who do not read them. Promoted pieces are written in red.
 */
const KANJI: Record<string, string> = { K: '王', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩', '+R': '龍', '+B': '馬', '+S': '全', '+N': '圭', '+L': '杏', '+P': 'と' };
export type Labels = 'kanji' | 'letters';

export const NAMES: Record<Kind, string> = { K: 'king', R: 'rook', B: 'bishop', G: 'gold', S: 'silver', N: 'knight', L: 'lance', P: 'pawn' };
export const nameOfCode = (code: number): string => `${isPromoted(Math.abs(code)) ? 'promoted ' : ''}${NAMES[kindOf(code)]}`;

/** `code` is a board piece code (negative for gote). `upright` is whether this tile faces up the screen. */
export function Tile({ code, labels, upright, size }: { code: number; labels: Labels; upright: boolean; size?: number | string }) {
  const abs = Math.abs(code);
  const kind = kindOf(code);
  const promoted = isPromoted(abs);
  // the king is written 王 for the first player and 玉 for the second
  const kanji = kind === 'K' && code < 0 ? '玉' : (KANJI[(promoted ? '+' : '') + kind] as string);
  const text = labels === 'kanji' ? kanji : (promoted ? '+' : '') + kind;
  const red = promoted && baseOf(abs) !== 4;
  return (
    <svg viewBox="0 0 40 44" width={size} height={size} className={`sg-svg${upright ? '' : ' sg-svg-down'}`} aria-hidden="true" focusable="false">
      <g transform={upright ? undefined : 'rotate(180 20 22)'}>
        <path d="M20 2 L34 10 L37 42 L3 42 L6 10 Z" className="sg-tile" />
        <text x="20" y={labels === 'kanji' ? 32 : 30} textAnchor="middle" className={`sg-glyph${red ? ' sg-red' : ''}${labels === 'letters' ? ' sg-letters' : ''}`}>
          {text}
        </text>
      </g>
    </svg>
  );
}
