import { Cloud, HardDrive, Settings } from 'lucide-react';
import { formatBytes } from '../lib/format.js';
import { FolderTree } from './FolderTree.jsx';

export function Sidebar({ tree, currentId, openPath, onOpen, status, onSettings }) {
  const stats = status?.stats;
  const state = !status ? { text: 'Starting…', tone: 'bg-ink-3' } : status.ready ? (status.backend === 'local' ? { text: 'Local test storage', tone: 'bg-warn' } : { text: 'Connected to Telegram', tone: 'bg-good' }) : status.connecting ? { text: 'Connecting…', tone: 'bg-warn' } : { text: 'Not connected', tone: 'bg-bad' };
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-e border-line bg-panel" aria-label="Sidebar">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white dark:text-canvas">
          <Cloud size={18} aria-hidden="true" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Cloud Storage</div>
          <div className="text-xs text-ink-3">on Telegram</div>
        </div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Folder navigation">
        <button
          type="button"
          onClick={() => onOpen(null)}
          aria-current={currentId == null ? 'page' : undefined}
          className={`mb-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-start font-medium ${currentId == null ? 'bg-accent-wash text-accent-strong' : 'hover:bg-sunken'}`}
        >
          <HardDrive size={16} aria-hidden="true" />
          My files
        </button>
        <FolderTree tree={tree} currentId={currentId} openPath={openPath} onOpen={onOpen} />
      </nav>
      <div className="border-t border-line p-3 text-xs">
        <div className="mb-2 flex items-center justify-between text-ink-2">
          <span className="tabular">{stats ? `${stats.files} file${stats.files === 1 ? '' : 's'}` : '—'}</span>
          <span className="tabular font-medium text-ink">{stats ? formatBytes(stats.bytes) : '—'}</span>
        </div>
        <button type="button" onClick={onSettings} className="flex h-9 w-full items-center gap-2 rounded-md border border-line px-2.5 text-start hover:bg-sunken" aria-label={`Connection settings. ${state.text}`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${state.tone}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-ink">{state.text}</span>
          <Settings size={15} className="shrink-0 text-ink-3" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
