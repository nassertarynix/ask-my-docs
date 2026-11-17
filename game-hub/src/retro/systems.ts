/**
 * The consoles the Retro Deck can play, and which emulator core runs each one.
 * The cores are RetroArch cores compiled to WebAssembly, served from this site (public/retro/cores).
 */
export type SystemId = 'nes' | 'snes' | 'genesis' | 'gb' | 'gbc' | 'gba';

export interface SystemDef {
  id: SystemId;
  name: string;
  /** The libretro core that emulates it. */
  core: 'fceumm' | 'snes9x' | 'genesis_plus_gx' | 'gambatte' | 'mgba';
  /** File extensions, lowercase, with the dot. */
  extensions: readonly string[];
  /** Screen shape, width / height. */
  aspect: number;
  /** The face buttons this console has, for the touch controls. */
  buttons: readonly ('a' | 'b' | 'x' | 'y' | 'l' | 'r')[];
  color: string;
}

export const SYSTEMS: Record<SystemId, SystemDef> = {
  nes: { id: 'nes', name: 'NES', core: 'fceumm', extensions: ['.nes'], aspect: 4 / 3, buttons: ['b', 'a'], color: '#E4572E' },
  snes: { id: 'snes', name: 'Super NES', core: 'snes9x', extensions: ['.sfc', '.smc'], aspect: 4 / 3, buttons: ['y', 'x', 'b', 'a', 'l', 'r'], color: '#8A6FDF' },
  genesis: { id: 'genesis', name: 'Mega Drive / Genesis', core: 'genesis_plus_gx', extensions: ['.md', '.gen', '.smd'], aspect: 4 / 3, buttons: ['y', 'b', 'a'], color: '#2D7DD2' },
  gb: { id: 'gb', name: 'Game Boy', core: 'gambatte', extensions: ['.gb'], aspect: 10 / 9, buttons: ['b', 'a'], color: '#7FB069' },
  gbc: { id: 'gbc', name: 'Game Boy Color', core: 'gambatte', extensions: ['.gbc'], aspect: 10 / 9, buttons: ['b', 'a'], color: '#F5B700' },
  gba: { id: 'gba', name: 'Game Boy Advance', core: 'mgba', extensions: ['.gba'], aspect: 3 / 2, buttons: ['b', 'a', 'l', 'r'], color: '#3BB273' },
};

export const SYSTEM_ORDER: readonly SystemId[] = ['nes', 'snes', 'genesis', 'gb', 'gbc', 'gba'];

export function isSystemId(value: unknown): value is SystemId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SYSTEMS, value);
}

/** Which console a file is for, judged by its extension. Null if it is not a ROM this deck can play. */
export function systemForFile(fileName: string): SystemId | null {
  const lower = fileName.toLowerCase();
  if (lower === 'readme.md' || lower.endsWith('/readme.md')) return null; // .md is also the Mega Drive extension
  for (const id of SYSTEM_ORDER) {
    if (SYSTEMS[id].extensions.some((ext) => lower.endsWith(ext))) return id;
  }
  return null;
}

/** Every extension the deck accepts, for a file picker's `accept`. */
export const ACCEPTED_EXTENSIONS: string = SYSTEM_ORDER.flatMap((id) => SYSTEMS[id].extensions).join(',');

/**
 * A readable title from a ROM file name: no folders, no extension, no dump tags such as "(USA)" or "[!]",
 * underscores as spaces. "Sonic_The_Hedgehog_2 (World) (Rev A).md" becomes "Sonic The Hedgehog 2".
 */
export function titleFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const title = base
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return title || base;
}
