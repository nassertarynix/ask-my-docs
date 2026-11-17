/**
 * IndexedDB for the Retro Deck: imported ROM files, and every game's saves
 * (battery saves and one quick-save slot), all kept in this browser only.
 * Every function resolves to a harmless value when IndexedDB is missing or blocked.
 */
import { isSystemId, systemForFile, titleFromFileName, type SystemId } from './systems';
import type { RomEntry } from './library';

const DB_NAME = 'paper-arcade-retro';
const ROMS = 'roms';
const SAVES = 'saves';
/** Refuse absurd files: the largest cartridge these consoles had is 32 MB (GBA). */
export const MAX_ROM_BYTES = 48 * 1024 * 1024;

interface StoredRom {
  id: string;
  title: string;
  system: SystemId;
  fileName: string;
  addedAt: number;
  data: Blob;
}

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ROMS)) db.createObjectStore(ROMS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T, F = T>(store: string, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>, fallback: F): Promise<T | F> {
  const db = await open();
  if (!db) return fallback;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, mode);
      const request = work(tx.objectStore(store));
      let result: T | F = fallback;
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(fallback);
      };
    } catch {
      db.close();
      resolve(fallback);
    }
  });
}

async function sha1(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type ImportResult = { ok: true; entry: RomEntry } | { ok: false; fileName: string; reason: string };

/** Keep a dropped file. The id is a hash of the contents, so importing the same game twice keeps one copy. */
export async function importRom(file: File): Promise<ImportResult> {
  const system = systemForFile(file.name);
  if (!system) return { ok: false, fileName: file.name, reason: 'not a ROM this deck can play' };
  if (file.size === 0) return { ok: false, fileName: file.name, reason: 'the file is empty' };
  if (file.size > MAX_ROM_BYTES) return { ok: false, fileName: file.name, reason: 'the file is too big to be a cartridge' };
  const buffer = await file.arrayBuffer();
  const id = `imported:${await sha1(buffer)}`;
  const stored: StoredRom = { id, title: titleFromFileName(file.name), system, fileName: file.name, addedAt: Date.now(), data: new Blob([buffer]) };
  const saved = await run(ROMS, 'readwrite', (s) => s.put(stored), null);
  if (saved === null) return { ok: false, fileName: file.name, reason: 'this browser would not store it (private window, or storage is full)' };
  return { ok: true, entry: { id, title: stored.title, system, source: 'imported' } };
}

export async function listImported(): Promise<RomEntry[]> {
  const all = await run(ROMS, 'readonly', (s) => s.getAll() as IDBRequest<unknown[]>, [] as unknown[]);
  const out: RomEntry[] = [];
  for (const item of all) {
    const v = item as Partial<StoredRom> | null;
    if (!v || typeof v.id !== 'string' || !isSystemId(v.system) || !(v.data instanceof Blob)) continue;
    out.push({ id: v.id, title: typeof v.title === 'string' && v.title ? v.title : 'Untitled', system: v.system, source: 'imported' });
  }
  return out;
}

export async function readImported(id: string): Promise<Blob | null> {
  const item = await run(ROMS, 'readonly', (s) => s.get(id) as IDBRequest<unknown>, null);
  const data = (item as Partial<StoredRom> | null)?.data;
  return data instanceof Blob ? data : null;
}

/** Remove an imported game and its saves. */
export async function removeImported(id: string): Promise<void> {
  await run(ROMS, 'readwrite', (s) => s.delete(id), undefined);
  await run(SAVES, 'readwrite', (s) => s.delete(`${id}#sram`), undefined);
  await run(SAVES, 'readwrite', (s) => s.delete(`${id}#state`), undefined);
}

export type SaveKind = 'sram' | 'state';

export async function writeSave(romId: string, kind: SaveKind, data: Blob): Promise<boolean> {
  if (data.size === 0) return false;
  return (await run(SAVES, 'readwrite', (s) => s.put(data, `${romId}#${kind}`), null)) !== null;
}

export async function readSave(romId: string, kind: SaveKind): Promise<Blob | null> {
  const data = await run(SAVES, 'readonly', (s) => s.get(`${romId}#${kind}`) as IDBRequest<unknown>, null);
  return data instanceof Blob && data.size > 0 ? data : null;
}
