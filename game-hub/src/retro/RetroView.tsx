/**
 * The Retro Deck: a shelf of console games, and the emulator that plays them.
 * Click a card and it plays. Your own files can be dropped on the page (they stay in this browser)
 * or, on your own machine, put in public/roms/ so they are on the shelf every time.
 */
import { FolderOpen, Trash2, Upload } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import type { GameProps } from '../hub/types';
import { sfx } from '../shared/audio';
import { loadShelf, sortShelf, type RomEntry } from './library';
import { importRom, listImported, removeImported } from './romStore';
import { ACCEPTED_EXTENSIONS, SYSTEMS, SYSTEM_ORDER } from './systems';

// the emulator library is only downloaded when a game is actually started
const Player = lazy(() => import('./Player').then((m) => ({ default: m.Player })));

const SOURCE_LABEL = { bundled: 'Free homebrew', local: 'Your file', imported: 'In this browser' } as const;

export default function RetroView(_props: GameProps) {
  const [shelf, setShelf] = useState<RomEntry[] | null>(null);
  const [playing, setPlaying] = useState<RomEntry | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const [listed, imported] = await Promise.all([loadShelf(), listImported()]);
    setShelf(sortShelf([...listed, ...imported]));
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadShelf(), listImported()]).then(([listed, imported]) => {
      if (alive) setShelf(sortShelf([...listed, ...imported]));
    });
    return () => {
      alive = false;
    };
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const notes: string[] = [];
      let added = 0;
      for (const file of files) {
        const result = await importRom(file);
        if (result.ok) added++;
        else notes.push(`${result.fileName}: ${result.reason}.`);
      }
      if (added > 0) notes.unshift(`${added} game${added === 1 ? '' : 's'} added to the shelf.`);
      setMessages(notes);
      await refresh();
    },
    [refresh],
  );

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  };

  if (playing) {
    return (
      <Suspense fallback={<p className="frame-loading">Loading the emulator…</p>}>
        <Player key={playing.id} entry={playing} onClose={() => setPlaying(null)} />
      </Suspense>
    );
  }

  const hasOwn = shelf?.some((e) => e.source !== 'bundled') ?? false;

  return (
    <div
      className={`shelf${dragging ? ' shelf-dragging' : ''}`}
      data-screen="shelf"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="shelf-head">
        <p className="setup-lede">Console games, running in your browser. Pick one and it plays.</p>
        <div className="shelf-add">
          <button type="button" className="btn btn-primary" onClick={() => picker.current?.click()}>
            <Upload size={18} aria-hidden="true" /> Add a game file
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            className="visually-hidden"
            aria-label="Add game files"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <span className="shelf-hint">or drop files anywhere on this page. They stay in this browser and are not uploaded.</span>
        </div>
        {messages.length > 0 && (
          <ul className="shelf-messages" role="status">
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>

      {shelf === null ? (
        <p className="frame-loading">Looking at the shelf…</p>
      ) : (
        SYSTEM_ORDER.map((id) => {
          const games = shelf.filter((e) => e.system === id);
          if (games.length === 0) return null;
          return (
            <section key={id} className="shelf-row" aria-label={SYSTEMS[id].name}>
              <h2>
                <span className="shelf-dot" style={{ background: SYSTEMS[id].color }} /> {SYSTEMS[id].name}
              </h2>
              <ul className="cart-grid">
                {games.map((entry) => (
                  <li key={entry.id} className="cart-cell">
                    <button
                      type="button"
                      className="cart"
                      style={{ '--system': SYSTEMS[id].color } as CSSProperties}
                      data-rom={entry.id}
                      data-source={entry.source}
                      onClick={() => {
                        sfx.click();
                        setPlaying(entry);
                      }}
                    >
                      <span className="cart-label">{entry.title}</span>
                      {entry.blurb && <span className="cart-blurb">{entry.blurb}</span>}
                      <span className="cart-meta">
                        {SOURCE_LABEL[entry.source]}
                        {entry.author ? ` · ${entry.author}` : ''}
                        {entry.license ? ` · ${entry.license}` : ''}
                      </span>
                    </button>
                    {entry.source === 'imported' && (
                      <button
                        type="button"
                        className="cart-remove"
                        aria-label={`Remove ${entry.title} and its saves from this browser`}
                        title="Remove from this browser"
                        onClick={() => {
                          if (!window.confirm(`Remove "${entry.title}" and its saves from this browser?`)) return;
                          void removeImported(entry.id).then(refresh);
                        }}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    )}
                    {entry.sourceUrl && (
                      <a className="cart-source" href={entry.sourceUrl} target="_blank" rel="noreferrer noopener">
                        source
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {shelf !== null && !hasOwn && (
        <p className="shelf-own">
          <FolderOpen size={18} aria-hidden="true" />
          <span>
            To keep your own games on this shelf, put the files in <code>public/roms/</code> and start the app again. That folder is never committed. Only use games you own.
          </span>
        </p>
      )}
    </div>
  );
}
