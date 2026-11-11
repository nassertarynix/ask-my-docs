import { File, FileArchive, FileAudio, FileCode, FileImage, FileText, FileVideo, Folder } from 'lucide-react';
import { fileKind } from '../lib/format.js';

const ICONS = { image: FileImage, video: FileVideo, audio: FileAudio, archive: FileArchive, code: FileCode, text: FileText, file: File };
const TINTS = {
  image: 'text-emerald-600 dark:text-emerald-400',
  video: 'text-violet-600 dark:text-violet-400',
  audio: 'text-pink-600 dark:text-pink-400',
  archive: 'text-amber-600 dark:text-amber-400',
  code: 'text-sky-600 dark:text-sky-400',
  text: 'text-ink-2',
  file: 'text-ink-3',
};

export function FileIcon({ mime, name, folder = false, size = 18 }) {
  if (folder) return <Folder size={size} className="shrink-0 fill-amber-300/70 text-amber-500 dark:fill-amber-400/25 dark:text-amber-400" aria-hidden="true" />;
  const kind = fileKind(mime, name);
  const Icon = ICONS[kind];
  return <Icon size={size} className={`shrink-0 ${TINTS[kind]}`} aria-hidden="true" />;
}
