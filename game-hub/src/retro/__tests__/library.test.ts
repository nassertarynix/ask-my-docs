import { describe, expect, it } from 'vitest';
import { SYSTEMS, SYSTEM_ORDER, systemForFile, titleFromFileName } from '../systems';
import { isSafeRelativePath, parseBundled, parseLocal, sortShelf } from '../library';
import bundled from '../../../public/retro/library.json';
import { existsSync, readFileSync, statSync } from 'node:fs';

describe('which console a file is for', () => {
  it.each([
    ['Super Mario Bros.nes', 'nes'],
    ['GAME.NES', 'nes'],
    ['world.sfc', 'snes'],
    ['world.smc', 'snes'],
    ['sonic.md', 'genesis'],
    ['sonic.gen', 'genesis'],
    ['sonic.smd', 'genesis'],
    ['land.gb', 'gb'],
    ['land.gbc', 'gbc'],
    ['sands.gba', 'gba'],
    ['folder/sub/land.gb', 'gb'],
  ])('%s is %s', (name, system) => {
    expect(systemForFile(name)).toBe(system);
  });

  it.each(['notes.txt', 'game.iso', 'game.zip', 'game', 'README.md', 'roms/readme.md', 'movie.mp4', '.nes.txt'])('%s is not a ROM', (name) => {
    expect(systemForFile(name)).toBeNull();
  });

  it('every console has a core, a colour, a sensible screen shape and at least A and B', () => {
    for (const id of SYSTEM_ORDER) {
      const s = SYSTEMS[id];
      expect(s.id).toBe(id);
      expect(s.extensions.length).toBeGreaterThan(0);
      expect(s.aspect).toBeGreaterThan(1);
      expect(s.buttons).toContain('a');
      expect(s.buttons).toContain('b');
      expect(existsSync(`public/retro/cores/${s.core}_libretro.js`)).toBe(true); // the core really is in the repo
      expect(statSync(`public/retro/cores/${s.core}_libretro.wasm`).size).toBeGreaterThan(500_000);
      expect(statSync(`public/retro/cores/${s.core}_libretro.wasm`).size).toBeLessThan(25 * 1024 * 1024); // Cloudflare Pages' per-file limit
    }
  });
});

describe('titles from file names', () => {
  it.each([
    ['Sonic_The_Hedgehog_2 (World) (Rev A).md', 'Sonic The Hedgehog 2'],
    ['roms/snes/Super Mario World (USA) [!].sfc', 'Super Mario World'],
    ['kirby.gb', 'kirby'],
    ['C:\\games\\Tetris (JU) [b1].gb', 'Tetris'],
    ['(only tags).nes', '(only tags).nes'],
  ])('%s -> %s', (file, title) => {
    expect(titleFromFileName(file)).toBe(title);
  });
});

describe('the bundled homebrew list', () => {
  const shelf = parseBundled(bundled);

  it('lists four games, each with an author, an open licence and a link to its source', () => {
    expect(shelf).toHaveLength(4);
    for (const entry of shelf) {
      expect(entry.source).toBe('bundled');
      expect(entry.author).toBeTruthy();
      expect(entry.license).toMatch(/^GPL-3\.0/);
      expect(entry.sourceUrl).toMatch(/^https:\/\/github\.com\//);
      expect(entry.blurb).toBeTruthy();
    }
    expect(new Set(shelf.map((e) => e.id)).size).toBe(4);
  });

  it('every listed file is really there and really is a ROM for that console', () => {
    for (const entry of shelf) {
      const path = `public/${entry.url!.replace('./', '')}`;
      const bytes = readFileSync(path);
      expect(bytes.length).toBeGreaterThan(8000);
      if (entry.system === 'nes') expect(bytes.subarray(0, 4).toString('latin1')).toBe('NES\x1a'); // iNES header
      if (entry.system === 'gbc') expect(bytes[0x143]! & 0x80).toBe(0x80); // the Game Boy Color flag
    }
  });
});

describe('lists are data, and are not trusted', () => {
  it.each([null, undefined, 'x', 42, {}, [[]], [null], [{ file: 5 }], [{ file: 'a.txt', system: 'ps5' }]])('garbage %j gives an empty shelf', (data) => {
    expect(parseBundled(data)).toEqual([]);
    expect(parseLocal(data)).toEqual([]);
  });

  it.each(['../secret.nes', 'a/../../b.nes', '/etc/x.nes', 'https://evil.example/x.nes', 'javascript:alert(1).nes', '\\\\server\\x.nes', ''])('a path that leaves the folder is refused: %s', (file) => {
    expect(isSafeRelativePath(file)).toBe(false);
    expect(parseBundled([{ file, system: 'nes' }])).toEqual([]);
    expect(parseLocal([{ file }])).toEqual([]);
  });

  it('a source link must be https, and overlong text is cut', () => {
    const [entry] = parseBundled([{ file: 'a.nes', title: 'T'.repeat(999), source: 'javascript:alert(1)' }]);
    expect(entry!.sourceUrl).toBeUndefined();
    expect(entry!.title.length).toBe(200);
  });

  it('local files: the console comes from the extension, the title from the name, the address is escaped', () => {
    const shelf = parseLocal([{ file: 'snes/Super Mario World (USA).sfc', size: 1 }, 'gb/Tetris #1.gb', { file: 'notes.txt' }]);
    expect(shelf).toEqual([
      { id: 'local:snes/Super Mario World (USA).sfc', title: 'Super Mario World', system: 'snes', source: 'local', url: './roms/snes/Super%20Mario%20World%20(USA).sfc' },
      { id: 'local:gb/Tetris #1.gb', title: 'Tetris #1', system: 'gb', source: 'local', url: './roms/gb/Tetris%20%231.gb' },
    ]);
  });
});

describe('shelf order', () => {
  it('by console, then by title, numbers in order', () => {
    const shelf = sortShelf(parseLocal(['b.gba', 'Sonic 10.md', 'Sonic 2.md', 'z.nes', 'a.nes']));
    expect(shelf.map((e) => e.title)).toEqual(['a', 'z', 'Sonic 2', 'Sonic 10', 'b']);
  });
});
