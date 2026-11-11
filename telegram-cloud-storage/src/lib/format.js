// Pure helpers for showing sizes, dates and file kinds. No React, so they are unit-tested in Node.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536 -> "1.5 KB". Binary units (1 KB = 1024 B) like Windows Explorer; whole numbers for bytes, one decimal above. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const text = value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '');
  return `${text} ${UNITS[unit]}`;
}

/** The server stores UTC ISO timestamps. Show them in the viewer's own time zone. */
export function formatDate(iso, now = new Date()) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatPercent(done, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.floor((done / total) * 100)));
}

const BY_EXTENSION = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif', 'tiff'],
  video: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v'],
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  code: ['js', 'jsx', 'ts', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'json', 'html', 'css', 'sh', 'sql', 'yml', 'yaml', 'toml'],
  text: ['txt', 'md', 'pdf', 'doc', 'docx', 'rtf', 'csv', 'xls', 'xlsx', 'ppt', 'pptx', 'odt'],
};

/** A coarse kind used to pick an icon: image | video | audio | archive | code | text | file. MIME first, extension second. */
export function fileKind(mime = '', name = '') {
  const major = mime.split('/')[0];
  if (['image', 'video', 'audio'].includes(major)) return major;
  if (/zip|compressed|tar|rar|7z/.test(mime)) return 'archive';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  for (const [kind, list] of Object.entries(BY_EXTENSION)) if (list.includes(ext)) return kind;
  if (major === 'text') return 'text';
  return 'file';
}

/** "application/vnd.openxmlformats-officedocument.wordprocessingml.document" is not a column anyone wants to read. */
export function shortType(mime = '', name = '') {
  const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : '';
  if (ext && ext.length <= 5) return `${ext} file`;
  const sub = mime.split('/')[1];
  return sub ? sub.split(/[.+-]/).pop().toUpperCase() : 'File';
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Sort rows like a file manager: folders always first, then by the chosen column. `dir` is 1 (ascending) or -1. */
export function sortItems(items, key, dir = 1) {
  const value = (item) => {
    if (key === 'size') return item.isFolder ? -1 : item.file_size;
    if (key === 'type') return item.isFolder ? '' : shortType(item.mime_type, item.file_name);
    if (key === 'date') return item.isFolder ? item.created_at : item.uploaded_at;
    return item.isFolder ? item.name : item.file_name;
  };
  return [...items].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    const x = value(a);
    const y = value(b);
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
    return order !== 0 ? order * dir : collator.compare(a.isFolder ? a.name : a.file_name, b.isFolder ? b.name : b.file_name);
  });
}
