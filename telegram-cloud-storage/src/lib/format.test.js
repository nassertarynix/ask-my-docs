import { describe, expect, it } from 'vitest';
import { fileKind, formatBytes, formatDate, formatPercent, shortType, sortItems } from './format.js';

describe('formatBytes', () => {
  it('uses binary units and trims trailing zeros', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
    expect(formatBytes(150 * 1024 ** 2)).toBe('150 MB');
    expect(formatBytes(1024 ** 4 * 3)).toBe('3 TB');
    expect(formatBytes(1024 ** 5)).toBe('1024 TB'); // there is no larger unit; it must not become "undefined"
  });
  it('shows a dash for nonsense', () => {
    for (const bad of [-1, NaN, undefined, null, Infinity]) expect(formatBytes(bad)).toBe('—');
  });
});

describe('formatDate', () => {
  it('shows a dash for missing or invalid dates', () => {
    expect(formatDate('')).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });
  it('omits the year only for the current year', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    expect(formatDate('2026-03-01T10:00:00Z', now)).not.toMatch(/2026/);
    expect(formatDate('2024-03-01T10:00:00Z', now)).toMatch(/2024/);
  });
});

describe('formatPercent', () => {
  it('is clamped, whole, and safe for an empty total', () => {
    expect(formatPercent(0, 0)).toBe(0);
    expect(formatPercent(50, 200)).toBe(25);
    expect(formatPercent(999, 1000)).toBe(99);
    expect(formatPercent(1000, 1000)).toBe(100);
    expect(formatPercent(5000, 1000)).toBe(100);
  });
});

describe('fileKind and shortType', () => {
  it('prefers the MIME type, then the extension', () => {
    expect(fileKind('image/png', 'x')).toBe('image');
    expect(fileKind('application/octet-stream', 'clip.MKV')).toBe('video');
    expect(fileKind('application/zip', 'a')).toBe('archive');
    expect(fileKind('application/octet-stream', 'main.rs')).toBe('code');
    expect(fileKind('application/pdf', 'cv.pdf')).toBe('text');
    expect(fileKind('', 'README')).toBe('file');
  });
  it('gives a readable type', () => {
    expect(shortType('application/pdf', 'cv.pdf')).toBe('PDF file');
    expect(shortType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')).toBe('DOCX file');
    expect(shortType('text/plain', 'LICENSE')).toBe('PLAIN');
    expect(shortType('', '')).toBe('File');
  });
});

describe('sortItems', () => {
  const rows = [
    { isFolder: false, file_name: 'b.txt', file_size: 5, mime_type: 'text/plain', uploaded_at: '2026-01-02' },
    { isFolder: true, name: 'Zeta', created_at: '2026-01-01' },
    { isFolder: false, file_name: 'a10.txt', file_size: 50, mime_type: 'text/plain', uploaded_at: '2026-01-03' },
    { isFolder: false, file_name: 'a2.txt', file_size: 500, mime_type: 'text/plain', uploaded_at: '2026-01-01' },
    { isFolder: true, name: 'alpha', created_at: '2026-01-05' },
  ];
  const names = (list) => list.map((r) => r.name ?? r.file_name);
  it('always lists folders first, naturally ordered (a2 before a10)', () => {
    expect(names(sortItems(rows, 'name'))).toEqual(['alpha', 'Zeta', 'a2.txt', 'a10.txt', 'b.txt']);
    expect(names(sortItems(rows, 'name', -1))).toEqual(['Zeta', 'alpha', 'b.txt', 'a10.txt', 'a2.txt']);
  });
  it('sorts by size and date within files', () => {
    expect(names(sortItems(rows, 'size', -1)).slice(2)).toEqual(['a2.txt', 'a10.txt', 'b.txt']);
    expect(names(sortItems(rows, 'date')).slice(2)).toEqual(['a2.txt', 'b.txt', 'a10.txt']);
  });
  it('does not change the input', () => {
    const copy = [...rows];
    sortItems(rows, 'size');
    expect(rows).toEqual(copy);
  });
});
