/** Hand a file to the person's browser as a download. */
export function download(name: string, parts: BlobPart[], type: string): void {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV gets a byte-order mark so Excel opens Arabic text correctly. */
export const downloadCsv = (name: string, csv: string) => download(name, ['﻿', csv], 'text/csv;charset=utf-8');
