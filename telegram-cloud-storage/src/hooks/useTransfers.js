import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadUrl, uploadFile, watchProgress } from '../lib/api.js';

const MAX_PARALLEL_UPLOADS = 2;
const FINISHED = ['done', 'error', 'cancelled'];
const newJobId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Tracks every upload and download: a queue of files waiting to be sent, plus the live progress events the backend
 * publishes on its WebSocket (hashing -> uploading chunk n of m -> committing -> done). Each transfer has a job id that
 * the backend echoes back in its events, which is how an event finds its row.
 *
 * The queue itself lives in refs (it is not something to render); `transfers` is only what the screen shows.
 */
export function useTransfers({ onUploaded, onError }) {
  const [transfers, setTransfers] = useState([]);
  const [live, setLive] = useState(false);
  const jobs = useRef(new Map()); // job id -> { file, folderId, controller }
  const queue = useRef([]); // job ids waiting for a free slot, oldest first
  const running = useRef(0);
  const pumpRef = useRef(() => {});
  const callbacks = useRef({ onUploaded, onError });
  useEffect(() => {
    callbacks.current = { onUploaded, onError };
  });

  const patch = useCallback((id, changes) => setTransfers((list) => list.map((t) => (t.id === id ? { ...t, ...changes } : t))), []);

  useEffect(
    () =>
      watchProgress((event) => {
        setTransfers((list) =>
          list.map((t) => {
            if (t.id !== event.job_id || FINISHED.includes(t.status)) return t;
            const next = {
              ...t,
              phase: event.phase,
              done: event.done ?? t.done,
              total: event.total || t.total,
              chunk: event.chunk ?? t.chunk,
              chunks: event.chunks_total ?? t.chunks,
              note: event.note ?? '',
              status: 'working',
            };
            if (event.phase === 'done') next.status = 'done';
            if (event.phase === 'error') Object.assign(next, { status: 'error', error: event.error || 'Failed' });
            return next;
          }),
        );
      }, setLive),
    [],
  );

  const start = useCallback(
    async (id) => {
      const job = jobs.current.get(id);
      if (!job) return;
      running.current += 1;
      patch(id, { status: 'sending' });
      try {
        await uploadFile(job.file, {
          folderId: job.folderId,
          jobId: id,
          signal: job.controller.signal,
          onSent: (sent, total) => setTransfers((list) => list.map((t) => (t.id === id && t.status === 'sending' ? { ...t, sent, total: total || t.total } : t))),
        });
        patch(id, { status: 'done', phase: 'done' });
        callbacks.current.onUploaded?.();
      } catch (error) {
        if (error?.name === 'AbortError') patch(id, { status: 'cancelled' });
        else {
          patch(id, { status: 'error', error: error.message });
          callbacks.current.onError?.(error.message);
        }
      } finally {
        jobs.current.delete(id);
        running.current -= 1;
        pumpRef.current();
      }
    },
    [patch],
  );

  const pump = useCallback(() => {
    while (running.current < MAX_PARALLEL_UPLOADS && queue.current.length > 0) {
      const id = queue.current.shift();
      if (jobs.current.has(id)) start(id);
    }
  }, [start]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const enqueue = useCallback(
    (fileList, folderId) => {
      const added = [...fileList].map((file) => {
        const id = newJobId();
        jobs.current.set(id, { file, folderId, controller: new AbortController() });
        queue.current.push(id);
        return { id, kind: 'upload', name: file.name, total: file.size, done: 0, sent: 0, status: 'queued', phase: 'queued', chunk: 0, chunks: 0, note: '', error: '' };
      });
      setTransfers((list) => [...added, ...list]);
      pump();
      return added.length;
    },
    [pump],
  );

  const download = useCallback(async (file) => {
    const id = newJobId();
    setTransfers((list) => [
      { id, kind: 'download', name: file.file_name, total: file.file_size, done: 0, sent: 0, status: 'working', phase: 'downloading', chunk: 0, chunks: file.total_chunks, note: '', error: '' },
      ...list,
    ]);
    const link = document.createElement('a');
    link.href = await downloadUrl(file.id, id);
    link.download = file.file_name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, []);

  /** Queued files are simply dropped; a file still being handed to the backend is aborted. Once the backend is sending
   *  chunks to Telegram it runs to completion (or fails and cleans up after itself), so the button is not offered then. */
  const cancel = useCallback((id) => {
    const job = jobs.current.get(id);
    if (!job) return;
    queue.current = queue.current.filter((q) => q !== id);
    job.controller.abort();
    jobs.current.delete(id);
    setTransfers((list) => list.map((t) => (t.id === id && t.status === 'queued' ? { ...t, status: 'cancelled' } : t)));
  }, []);

  const clearFinished = useCallback(() => setTransfers((list) => list.filter((t) => !FINISHED.includes(t.status))), []);

  return { transfers, live, enqueue, download, cancel, clearFinished };
}
