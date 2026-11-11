import { ArrowDown, ArrowUp, FolderOpen, UploadCloud } from 'lucide-react';
import { formatBytes, formatDate, shortType } from '../lib/format.js';
import { FileIcon } from './FileIcon.jsx';

const COLUMNS = [
  { key: 'name', label: 'Name', className: 'w-auto' },
  { key: 'size', label: 'Size', className: 'w-28 text-end' },
  { key: 'type', label: 'Type', className: 'w-36 hidden md:table-cell' },
  { key: 'date', label: 'Uploaded', className: 'w-44 hidden sm:table-cell' },
];

export const itemKey = (item) => `${item.isFolder ? 'd' : 'f'}:${item.id}`;

export function FileTable({ items, selected, onSelect, onOpenFolder, onDownload, sort, onSort, loading, filtered, onUpload }) {
  if (!loading && items.length === 0) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-sunken text-ink-3">{filtered ? <FolderOpen size={26} /> : <UploadCloud size={26} />}</div>
          <h2 className="text-base font-semibold">{filtered ? 'Nothing matches your search' : 'This folder is empty'}</h2>
          <p className="mt-1 text-ink-2">{filtered ? 'Try a different name.' : 'Drag files here, or choose Upload. Large files are split into 20 MB pieces automatically.'}</p>
          {!filtered && (
            <button type="button" onClick={onUpload} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong dark:text-canvas">
              <UploadCloud size={16} /> Upload files
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <table className="w-full table-fixed border-collapse text-sm" aria-label="Files and folders" aria-busy={loading}>
      <thead className="sticky top-0 z-10 bg-canvas text-xs text-ink-2">
        <tr className="border-b border-line">
          <th scope="col" className="w-10 px-3 py-2">
            <span className="sr-only">Select</span>
          </th>
          {COLUMNS.map((c) => (
            <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={`px-3 py-2 text-start font-medium ${c.className}`}>
              <button type="button" onClick={() => onSort(c.key)} className={`inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-sunken ${c.key === 'size' ? 'flex-row-reverse' : ''}`}>
                {c.label}
                {sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const key = itemKey(item);
          const isSelected = selected.has(key);
          const name = item.isFolder ? item.name : item.file_name;
          return (
            <tr
              key={key}
              aria-selected={isSelected}
              onClick={(e) => onSelect(key, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })}
              onDoubleClick={() => (item.isFolder ? onOpenFolder(item.id) : onDownload(item))}
              className={`cursor-default border-b border-line/60 ${isSelected ? 'bg-accent-wash' : 'hover:bg-sunken/70'}`}
            >
              <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={isSelected} onChange={() => onSelect(key, { toggle: true })} aria-label={`Select ${name}`} className="h-4 w-4 accent-[var(--color-accent)]" />
              </td>
              <td className="px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <FileIcon folder={item.isFolder} mime={item.mime_type} name={name} />
                  {item.isFolder ? (
                    <button type="button" onClick={(e) => { e.stopPropagation(); onOpenFolder(item.id); }} className="truncate font-medium hover:underline">
                      {name}
                    </button>
                  ) : (
                    <span className="truncate" title={name}>
                      {name}
                    </span>
                  )}
                </div>
              </td>
              <td className="tabular px-3 py-1.5 text-end text-ink-2">
                {item.isFolder ? `${item.file_count + item.subfolder_count} item${item.file_count + item.subfolder_count === 1 ? '' : 's'}` : formatBytes(item.file_size)}
              </td>
              <td className="hidden truncate px-3 py-1.5 text-ink-2 md:table-cell">{item.isFolder ? 'Folder' : shortType(item.mime_type, name)}</td>
              <td className="hidden truncate px-3 py-1.5 text-ink-2 sm:table-cell">{formatDate(item.isFolder ? item.created_at : item.uploaded_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
