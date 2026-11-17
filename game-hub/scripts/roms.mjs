// Lists the ROM files in public/roms/ into public/roms/manifest.json, which the Retro Deck reads.
// Runs automatically before `npm run dev` and `npm run build`. With no ROMs it writes an empty list.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/roms/', import.meta.url));
const EXTENSIONS = ['.nes', '.sfc', '.smc', '.md', '.gen', '.smd', '.gb', '.gbc', '.gba'];

function walk(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name.toLowerCase() === 'readme.md') continue; // .md is also a Mega Drive ROM extension
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) found.push(...walk(path));
    else if (EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) found.push({ file: relative(root, path).split(sep).join('/'), size: info.size });
  }
  return found;
}

const files = walk(root).sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(join(root, 'manifest.json'), JSON.stringify(files, null, 2) + '\n');
console.log(`roms: ${files.length} file${files.length === 1 ? '' : 's'} listed in public/roms/manifest.json`);
