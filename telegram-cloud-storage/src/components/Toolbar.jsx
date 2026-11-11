import { ArrowUp, ChevronRight, Download, FolderPlus, Search, Trash2, UploadCloud, ArrowDownUp } from 'lucide-react';
import { buttonClass } from './Dialog.jsx';

export function Breadcrumbs({ crumbs, onOpen }) {
  return (
    <nav aria-label="Location" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
      <button type="button" onClick={() => onOpen(null)} className="rounded px-1.5 py-1 font-medium hover:bg-sunken">
        My files
      </button>
      {crumbs.map((c, i) => (
        <span key={c.id} className="flex min-w-0 items-center gap-0.5">
          <ChevronRight size={14} className="shrink-0 text-ink-3" aria-hidden="true" />
          <button type="button" onClick={() => onOpen(c.id)} aria-current={i === crumbs.length - 1 ? 'page' : undefined} className={`truncate rounded px-1.5 py-1 hover:bg-sunken ${i === crumbs.length - 1 ? 'font-semibold' : 'text-ink-2'}`}>
            {c.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

export function Toolbar({ crumbs, onOpen, onUp, filter, onFilter, selectedCount, canDownload, onNewFolder, onUpload, onDownload, onDelete, activeTransfers, onTransfers }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-4 py-2.5">
      <button type="button" onClick={onUp} disabled={crumbs.length === 0} className="grid h-9 w-9 place-items-center rounded-md border border-line hover:bg-sunken disabled:opacity-40" aria-label="Up one level" title="Up one level">
        <ArrowUp size={16} />
      </button>
      <div className="min-w-0 flex-1 basis-48">
        <Breadcrumbs crumbs={crumbs} onOpen={onOpen} />
      </div>
      <label className="relative">
        <span className="sr-only">Search this folder</span>
        <Search size={15} className="pointer-events-none absolute start-2.5 top-2.5 text-ink-3" aria-hidden="true" />
        <input type="search" value={filter} onChange={(e) => onFilter(e.target.value)} placeholder="Search this folder" className="h-9 w-48 rounded-md border border-line bg-canvas ps-8 pe-2 text-sm" />
      </label>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onNewFolder} className={buttonClass()}>
          <FolderPlus size={16} /> <span className="hidden lg:inline">New folder</span>
        </button>
        <button type="button" onClick={onUpload} className={buttonClass('primary')}>
          <UploadCloud size={16} /> Upload
        </button>
        <button type="button" onClick={onDownload} disabled={!canDownload} className={buttonClass()} aria-label="Download selected files">
          <Download size={16} />
        </button>
        <button type="button" onClick={onDelete} disabled={selectedCount === 0} className={buttonClass()} aria-label="Delete selected items">
          <Trash2 size={16} />
        </button>
        <button type="button" onClick={onTransfers} className={`${buttonClass()} relative`} aria-label={`Transfers${activeTransfers ? `, ${activeTransfers} active` : ''}`}>
          <ArrowDownUp size={16} />
          {activeTransfers > 0 && <span className="tabular absolute -end-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-xs font-semibold text-white dark:text-canvas">{activeTransfers}</span>}
        </button>
      </div>
    </header>
  );
}
