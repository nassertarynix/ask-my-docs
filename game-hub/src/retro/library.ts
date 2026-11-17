/**
 * What is on the shelf. Games come from three places:
 *   - bundled:  openly licensed homebrew shipped with the hub (public/retro/library.json)
 *   - local:    files the owner put in public/roms/ (listed by scripts/roms.mjs, never committed)
 *   - imported: files dropped onto the page, kept in this browser's IndexedDB
 * The two lists fetched here are data, so they are checked field by field before use.
 */
import { SYSTEM_ORDER, isSystemId, systemForFile, titleFromFileName, type SystemId } from './systems';

export type RomSource = 'bundled' | 'local' | 'imported';

export interface RomEntry {
  /** Unique across the shelf; also the key its saves are stored under. */
  id: string;
  title: string;
  system: SystemId;
  source: RomSource;
  /** Where to fetch it (bundled and local), relative to the site. Imported games are read from IndexedDB by id. */
  url?: string;
  author?: string;
  license?: string;
  sourceUrl?: string;
  blurb?: string;
}

function text(value: unknown, max = 200): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** A relative path with no way out of its folder: no scheme, no leading slash, no "..". */
export function isSafeRelativePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length < 400 && !/^[a-z][a-z0-9+.-]*:/i.test(path) && !path.startsWith('/') && !path.startsWith('\\') && !path.split(/[\\/]/).includes('..');
}

function httpsUrl(value: unknown): string | undefined {
  const s = text(value, 300);
  return s && /^https:\/\//.test(s) ? s : undefined;
}

/** The bundled homebrew list (public/retro/library.json). */
export function parseBundled(data: unknown): RomEntry[] {
  if (!Array.isArray(data)) return [];
  const out: RomEntry[] = [];
  for (const item of data as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const v = item as Record<string, unknown>;
    if (!isSafeRelativePath(v.file)) continue;
    const system = isSystemId(v.system) ? v.system : systemForFile(v.file);
    if (!system) continue;
    out.push({
      id: `bundled:${v.file}`,
      title: text(v.title) ?? titleFromFileName(v.file),
      system,
      source: 'bundled',
      url: `./retro/${v.file}`,
      author: text(v.author),
      license: text(v.license, 60),
      sourceUrl: httpsUrl(v.source),
      blurb: text(v.blurb, 240),
    });
  }
  return out;
}

/** The owner's own files (public/roms/manifest.json, written by scripts/roms.mjs). */
export function parseLocal(data: unknown): RomEntry[] {
  if (!Array.isArray(data)) return [];
  const out: RomEntry[] = [];
  for (const item of data as unknown[]) {
    const file = typeof item === 'string' ? item : typeof item === 'object' && item !== null ? (item as Record<string, unknown>).file : undefined;
    if (!isSafeRelativePath(file)) continue;
    const system = systemForFile(file);
    if (!system) continue;
    out.push({ id: `local:${file}`, title: titleFromFileName(file), system, source: 'local', url: `./roms/${file.split('/').map(encodeURIComponent).join('/')}` });
  }
  return out;
}

/** Shelf order: by console, then by title. */
export function sortShelf(entries: readonly RomEntry[]): RomEntry[] {
  return [...entries].sort((a, b) => SYSTEM_ORDER.indexOf(a.system) - SYSTEM_ORDER.indexOf(b.system) || a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null; // a missing list just means an emptier shelf
  }
}

export async function loadShelf(): Promise<RomEntry[]> {
  const [bundled, local] = await Promise.all([fetchJson('./retro/library.json'), fetchJson('./roms/manifest.json')]);
  return [...parseLocal(local), ...parseBundled(bundled)];
}
