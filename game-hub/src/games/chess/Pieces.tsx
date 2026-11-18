import type { Colour, PieceType } from './engine';

/**
 * Hand-drawn chess pieces as inline SVG (no font and no image files, so they look the same everywhere and a phone never
 * swaps a black pawn for an emoji). Each is drawn once in a 45 x 45 box with an ink outline; white pieces are filled
 * paper-white and black pieces ink-black with paper-coloured detail lines.
 */
const SHAPES: Record<PieceType, (detail: string) => React.ReactNode> = {
  p: () => (
    <>
      <circle cx="22.5" cy="13" r="5.5" />
      <path d="M17.5 21.5c0 4-5 5-5 13h20c0-8-5-9-5-13z" />
      <path d="M10.5 36.5h24v3h-24z" />
    </>
  ),
  r: (detail) => (
    <>
      <path d="M11 9h4v3h4V9h7v3h4V9h4v8l-3 3v12l3 3v3H11v-3l3-3V20l-3-3z" />
      <path d="M14 20h17M14 32h17" stroke={detail} fill="none" />
    </>
  ),
  n: (detail) => (
    <>
      <path d="M12 38c0-10 3-14 8-19l-5-1 2-5 8-5c8 0 14 6 14 16v14z" />
      <circle cx="21" cy="14" r="1.4" fill={detail} stroke="none" />
      <path d="M14.5 21c2-1 3-3 4-5" stroke={detail} fill="none" />
    </>
  ),
  b: (detail) => (
    <>
      <circle cx="22.5" cy="9" r="3" />
      <path d="M22.5 12c-7 4-9 9-7 14 1 3 2 5-1 8h17c-3-3-2-5-1-8 2-5 0-10-8-14z" />
      <path d="M22.5 17v6M19.5 20h6" stroke={detail} fill="none" />
      <path d="M10.5 36.5h24v3h-24z" />
    </>
  ),
  q: (detail) => (
    <>
      <circle cx="8" cy="14" r="2.6" />
      <circle cx="15" cy="9" r="2.6" />
      <circle cx="22.5" cy="7.5" r="2.6" />
      <circle cx="30" cy="9" r="2.6" />
      <circle cx="37" cy="14" r="2.6" />
      <path d="M9 16l4 16h19l4-16-7 8-3-11-3 11-3-11-3 11z" />
      <path d="M12 32h21M11 37h23v3H11z" stroke={detail} fill="none" />
    </>
  ),
  k: (detail) => (
    <>
      <path d="M22.5 4v8M18.5 8h8" fill="none" />
      <path d="M22.5 14c-3-5-12-4-12 3 0 5 4 7 5 10v5h14v-5c1-3 5-5 5-10 0-7-9-8-12-3z" />
      <path d="M15 33h15M11 37h23v3H11z" stroke={detail} fill="none" />
    </>
  ),
};

export function Piece({ type, colour, size }: { type: PieceType; colour: Colour; size?: number | string }) {
  const white = colour === 'w';
  return (
    <svg viewBox="0 0 45 45" width={size} height={size} className={`ch-svg ch-svg-${colour}`} aria-hidden="true" focusable="false">
      <g fill={white ? '#ffffff' : '#18181b'} stroke="#18181b" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        {SHAPES[type](white ? '#18181b' : '#faf9f6')}
      </g>
    </svg>
  );
}

export const PIECE_NAMES: Record<PieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
