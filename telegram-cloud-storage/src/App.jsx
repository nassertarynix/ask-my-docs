import { CloudOff, UploadCloud } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, buttonClass } from './components/Dialog.jsx';
import { FileTable, itemKey } from './components/FileTable.jsx';
import { SettingsModal } from './components/SettingsModal.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { Toolbar } from './components/Toolbar.jsx';
import { UploadModal } from './components/UploadModal.jsx';
import { useTransfers } from './hooks/useTransfers.js';
import { ApiError, api } from './lib/api.js';
import { sortItems } from './lib/format.js';
import { ancestorIds, buildTree } from './lib/tree.js';

const TONES = { good: 'border-good', bad: 'border-bad', warn: 'border-warn', info: 'border-line' };
const isFileDrag = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

export default function App() {
  const [folderId, setFolderId] = useState(null);
  const [listing, setListing] = useState(null);
  const [folders, setFolders] = useState([]);
  const [status, setStatus] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState(null); // 'transfers' | 'settings' | 'newFolder' | 'delete'
  const [toasts, setToasts] = useState([]);
  const [dragDepth, setDragDepth] = useState(0);
  const [folderName, setFolderName] = useState('');
  const [folderError, setFolderError] = useState('');
  const anchor = useRef(null);
  const fileInput = useRef(null);

  const notify = useCallback((text, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 6000);
  }, []);

  // `refresh` just asks the effect below to load again (after an upload, a delete, a settings change...).
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false; // a slow answer for a folder the user has already left must not overwrite the current one
    (async () => {
      try {
        const [list, tree, state] = await Promise.all([api.list(folderId), api.tree(), api.status()]);
        if (cancelled) return;
        setListing(list);
        setFolders(tree.folders);
        setStatus(state);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.code === 'not_found' && folderId != null) setFolderId(null); // the folder was removed
        else notify(error.message, 'bad');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, reload, notify]);

  // While Telegram is still connecting (or not set up), keep the status fresh so the window updates by itself.
  const settled = status?.ready || status?.backend === 'local';
  useEffect(() => {
    if (settled) return undefined;
    const timer = setInterval(() => api.status().then(setStatus).catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [settled]);

  const { transfers, live, enqueue, download, cancel, clearFinished } = useTransfers({ onUploaded: refresh, onError: (m) => notify(m, 'bad') });
  const active = transfers.filter((t) => ['queued', 'sending', 'working'].includes(t.status)).length;

  const open = useCallback((id) => {
    setFolderId(id);
    setSelected(new Set());
    setFilter('');
    anchor.current = null;
  }, []);

  const loading = !listing || listing.folder_id !== folderId;
  const crumbs = listing?.breadcrumbs ?? [];
  const items = useMemo(() => {
    const merged = [...(listing?.folders ?? []).map((f) => ({ ...f, isFolder: true })), ...(listing?.files ?? []).map((f) => ({ ...f, isFolder: false }))];
    const needle = filter.trim().toLowerCase();
    return sortItems(merged, sort.key, sort.dir).filter((i) => !needle || (i.isFolder ? i.name : i.file_name).toLowerCase().includes(needle));
  }, [listing, sort, filter]);
  const tree = useMemo(() => buildTree(folders), [folders]);
  const openPath = useMemo(() => ancestorIds(folders, folderId), [folders, folderId]);
  const selectedItems = items.filter((i) => selected.has(itemKey(i)));
  const selectedFiles = selectedItems.filter((i) => !i.isFolder);

  const onSelect = (key, { toggle, range } = {}) => {
    setSelected((current) => {
      const next = new Set(range ? [] : toggle ? current : []);
      const keys = items.map(itemKey);
      if (range && anchor.current && keys.includes(anchor.current)) {
        const [a, b] = [keys.indexOf(anchor.current), keys.indexOf(key)].sort((x, y) => x - y);
        keys.slice(a, b + 1).forEach((k) => next.add(k));
      } else if (toggle && current.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!range) anchor.current = key;
  };

  const connected = () => {
    if (status && !status.ready) {
      notify(status.connecting ? 'Still connecting to Telegram. Try again in a moment.' : 'Connect Telegram first.', 'warn');
      if (!status.connecting) setDialog('settings');
      return false;
    }
    return true;
  };

  const startUploads = (fileList) => {
    const files = [...fileList];
    if (files.length === 0 || !connected()) return;
    enqueue(files, folderId);
    setDialog('transfers');
  };

  const downloadSelected = () => {
    if (!connected()) return;
    selectedFiles.forEach((f) => download(f));
    if (selectedFiles.length) setDialog('transfers');
  };

  const createFolder = async (event) => {
    event.preventDefault();
    try {
      await api.createFolder(folderName, folderId);
      setDialog(null);
      setFolderName('');
      setFolderError('');
      refresh();
    } catch (error) {
      setFolderError(error.message);
    }
  };

  const confirmDelete = async () => {
    const fileIds = selectedItems.filter((i) => !i.isFolder).map((i) => i.id);
    const folderIds = selectedItems.filter((i) => i.isFolder).map((i) => i.id);
    setDialog(null);
    try {
      const result = await api.deleteItems(fileIds, folderIds);
      setSelected(new Set());
      notify(result.orphaned ? `Deleted, but ${result.orphaned} message(s) could not be removed from Telegram.` : `Deleted ${fileIds.length + folderIds.length} item(s)`, result.orphaned ? 'warn' : 'good');
      refresh();
    } catch (error) {
      notify(error.message, 'bad');
    }
  };

  // keyboard: Delete, Ctrl+A, Escape, Enter
  useEffect(() => {
    const onKey = (e) => {
      if (dialog || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Delete' && selected.size) setDialog('delete');
      else if (e.key === 'Escape') setSelected(new Set());
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(items.map(itemKey)));
      } else if (e.key === 'Enter' && selectedItems.length === 1 && selectedItems[0].isFolder) open(selectedItems[0].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, selected, items, selectedItems, open]);

  // drag and drop anywhere in the window
  const dropHandlers = {
    onDragEnter: (e) => isFileDrag(e) && (e.preventDefault(), setDragDepth((d) => d + 1)),
    onDragOver: (e) => isFileDrag(e) && e.preventDefault(),
    onDragLeave: (e) => isFileDrag(e) && setDragDepth((d) => Math.max(0, d - 1)),
    onDrop: (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setDragDepth(0);
      const entries = [...(e.dataTransfer.items ?? [])].map((i) => i.webkitGetAsEntry?.());
      const files = [...e.dataTransfer.files].filter((_, i) => !entries[i]?.isDirectory);
      if (files.length < e.dataTransfer.files.length) notify('Folders cannot be dropped yet. Drop the files inside them instead.', 'warn');
      startUploads(files);
    },
  };

  const filtered = filter.trim() !== '';
  const folderLabel = crumbs.length ? crumbs[crumbs.length - 1].name : 'My files';

  return (
    <div className="flex h-full" {...dropHandlers}>
      <Sidebar tree={tree} currentId={folderId} openPath={openPath} onOpen={open} status={status} onSettings={() => setDialog('settings')} />
      <main className="flex min-w-0 flex-1 flex-col">
        <Toolbar
          crumbs={crumbs}
          onOpen={open}
          onUp={() => open(crumbs.length > 1 ? crumbs[crumbs.length - 2].id : null)}
          filter={filter}
          onFilter={setFilter}
          selectedCount={selected.size}
          canDownload={selectedFiles.length > 0}
          onNewFolder={() => { setFolderName(''); setFolderError(''); setDialog('newFolder'); }}
          onUpload={() => fileInput.current?.click()}
          onDownload={downloadSelected}
          onDelete={() => setDialog('delete')}
          activeTransfers={active}
          onTransfers={() => setDialog('transfers')}
        />
        {status && !status.ready && status.backend !== 'local' && (
          <div role="status" className="flex items-center gap-3 border-b border-line bg-sunken px-4 py-2 text-sm">
            <CloudOff size={16} className="shrink-0 text-warn" aria-hidden="true" />
            <span className="flex-1 text-ink-2">{status.connecting ? 'Connecting to Telegram…' : status.connect_error ?? 'Telegram is not connected yet. You can browse folders, but uploads and downloads need a connection.'}</span>
            {!status.connecting && (
              <button type="button" className={buttonClass()} onClick={() => setDialog('settings')}>
                Connect
              </button>
            )}
          </div>
        )}
        <div className={`min-h-0 flex-1 overflow-y-auto ${loading ? 'opacity-60' : ''}`} onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}>
          <FileTable items={items} selected={selected} onSelect={onSelect} onOpenFolder={open} onDownload={(f) => { if (connected()) { download(f); setDialog('transfers'); } }} sort={sort} onSort={(key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))} loading={loading} filtered={filtered} onUpload={() => fileInput.current?.click()} />
        </div>
        <footer className="flex items-center justify-between border-t border-line bg-panel px-4 py-1.5 text-xs text-ink-2">
          <span className="tabular">{loading ? 'Loading…' : `${items.length} item${items.length === 1 ? '' : 's'}`}{selected.size > 0 && ` · ${selected.size} selected`}</span>
          <span className="truncate">{folderLabel}</span>
        </footer>
      </main>

      <input ref={fileInput} type="file" multiple hidden aria-label="Choose files to upload" onChange={(e) => { startUploads(e.target.files); e.target.value = ''; }} />

      {dragDepth > 0 && (
        <div className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent-wash/85" aria-hidden="true">
          <div className="text-center">
            <UploadCloud size={44} className="mx-auto text-accent" />
            <p className="mt-2 text-lg font-semibold text-accent-strong">Drop files to upload</p>
            <p className="text-ink-2">to {folderLabel}</p>
          </div>
        </div>
      )}

      {dialog === 'transfers' && <UploadModal transfers={transfers} live={live} onClose={() => setDialog(null)} onCancel={cancel} onClear={clearFinished} />}
      {dialog === 'settings' && <SettingsModal status={status} onClose={() => setDialog(null)} onChanged={refresh} notify={notify} />}
      {dialog === 'newFolder' && (
        <Dialog title="New folder" onClose={() => setDialog(null)} footer={<><button type="button" className={buttonClass()} onClick={() => setDialog(null)}>Cancel</button><button type="submit" form="new-folder" className={buttonClass('primary')} disabled={!folderName.trim()}>Create</button></>}>
          <form id="new-folder" onSubmit={createFolder} className="flex flex-col gap-1.5">
            <label htmlFor="folder-name" className="text-xs font-medium text-ink-2">Folder name</label>
            <input id="folder-name" autoFocus value={folderName} onChange={(e) => setFolderName(e.target.value)} autoComplete="off" aria-invalid={!!folderError} className="h-9 rounded-md border border-line bg-canvas px-2.5 text-sm" />
            {folderError && <p role="alert" className="text-xs text-bad">{folderError}</p>}
          </form>
        </Dialog>
      )}
      {dialog === 'delete' && (
        <Dialog title={`Delete ${selected.size} item${selected.size === 1 ? '' : 's'}?`} onClose={() => setDialog(null)} footer={<><button type="button" className={buttonClass()} onClick={() => setDialog(null)}>Cancel</button><button type="button" className={buttonClass('danger')} onClick={confirmDelete}>Delete</button></>}>
          <p className="text-ink-2">
            {selectedItems.filter((i) => i.isFolder).length > 0 ? 'Folders are deleted with everything inside them. ' : ''}
            The files are also removed from your Telegram channel. This cannot be undone.
          </p>
          <ul className="mt-3 max-h-40 list-disc overflow-y-auto ps-5 text-sm">
            {selectedItems.slice(0, 8).map((i) => <li key={itemKey(i)} className="truncate">{i.isFolder ? i.name : i.file_name}</li>)}
            {selectedItems.length > 8 && <li className="list-none text-ink-3">and {selectedItems.length - 8} more</li>}
          </ul>
        </Dialog>
      )}

      <div className="pointer-events-none fixed bottom-10 start-72 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto max-w-sm rounded-lg border-s-4 bg-panel px-3.5 py-2.5 text-sm shadow-lg ring-1 ring-line ${TONES[t.tone]}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
