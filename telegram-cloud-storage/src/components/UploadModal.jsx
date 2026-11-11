import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Check, Loader2, X } from 'lucide-react';
import { formatBytes, formatPercent } from '../lib/format.js';
import { Dialog, buttonClass } from './Dialog.jsx';

const LABEL = {
  queued: 'Waiting',
  sending: 'Reading file',
  hashing: 'Checking file',
  uploading: 'Sending to Telegram',
  committing: 'Saving',
  downloading: 'Fetching from Telegram',
  verifying: 'Verifying checksum',
  done: 'Done',
};

function statusText(t) {
  if (t.status === 'error') return t.error;
  if (t.status === 'cancelled') return 'Cancelled';
  if (t.status === 'done') return t.kind === 'upload' ? 'Uploaded' : 'Downloaded';
  if (t.note) return t.note;
  const base = LABEL[t.status === 'sending' ? 'sending' : t.phase] ?? 'Working';
  return t.chunks && ['uploading', 'downloading'].includes(t.phase) ? `${base} · part ${Math.max(1, t.chunk)} of ${t.chunks}` : base;
}

function progress(t) {
  if (t.status === 'done') return 100;
  if (t.status === 'sending') return formatPercent(t.sent, t.total);
  if (t.status === 'queued') return 0;
  return formatPercent(t.done, t.total);
}

/** Every upload and download, with a live progress bar. Closing this window does not stop anything. */
export function UploadModal({ transfers, onClose, onCancel, onClear, live }) {
  const finished = transfers.filter((t) => ['done', 'error', 'cancelled'].includes(t.status)).length;
  return (
    <Dialog
      title="Transfers"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          {!live && <span className="me-auto text-xs text-warn">Live progress is reconnecting…</span>}
          <button type="button" className={buttonClass()} onClick={onClear} disabled={finished === 0}>
            Clear finished
          </button>
          <button type="button" className={buttonClass('primary')} onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {transfers.length === 0 ? (
        <p className="py-6 text-center text-ink-2">No transfers yet. Uploads and downloads show up here with their progress.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {transfers.map((t) => {
            const pct = progress(t);
            const failed = t.status === 'error';
            const done = t.status === 'done';
            return (
              <li key={t.id} className="rounded-lg border border-line p-3" data-status={t.status}>
                <div className="flex items-center gap-2.5">
                  {t.kind === 'upload' ? <ArrowUpFromLine size={16} className="shrink-0 text-ink-3" aria-label="Upload" /> : <ArrowDownToLine size={16} className="shrink-0 text-ink-3" aria-label="Download" />}
                  <span className="min-w-0 flex-1 truncate font-medium" title={t.name}>
                    {t.name}
                  </span>
                  <span className="tabular shrink-0 text-xs text-ink-3">{formatBytes(t.total)}</span>
                  {done ? <Check size={16} className="shrink-0 text-good" aria-label="Done" /> : failed ? <AlertTriangle size={16} className="shrink-0 text-bad" aria-label="Failed" /> : ['queued', 'sending'].includes(t.status) && t.kind === 'upload' ? (
                    <button type="button" onClick={() => onCancel(t.id)} className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-sunken" aria-label={`Cancel ${t.name}`}>
                      <X size={14} />
                    </button>
                  ) : t.status === 'cancelled' ? null : (
                    <Loader2 size={16} className="shrink-0 animate-spin text-accent" aria-label="In progress" />
                  )}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${t.name} progress`}>
                  <div className={`h-full rounded-full transition-[width] duration-200 ${failed ? 'bg-bad' : done ? 'bg-good' : 'bg-accent'}`} style={{ width: `${failed ? 100 : pct}%` }} />
                </div>
                <div className={`mt-1.5 flex justify-between text-xs ${failed ? 'text-bad' : 'text-ink-2'}`}>
                  <span>{statusText(t)}</span>
                  {!failed && t.status !== 'cancelled' && <span className="tabular">{pct}%</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
