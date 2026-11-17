/**
 * Plays one ROM. The emulator is a RetroArch core compiled to WebAssembly, driven by Nostalgist.js.
 * The core's files come from this site (public/retro/cores), so playing makes no request to anyone else.
 * Battery saves are written back to IndexedDB while you play and when you leave.
 */
import { ArrowLeft, Download, Maximize, Pause, Play, RotateCcw, Save } from 'lucide-react';
import { Nostalgist } from 'nostalgist';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { SYSTEMS } from './systems';
import type { RomEntry } from './library';
import { readImported, readSave, writeSave } from './romStore';

type Status = 'loading' | 'running' | 'paused' | 'error';
type PadButton = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'l' | 'r' | 'start' | 'select';

async function loadRom(entry: RomEntry): Promise<Blob> {
  if (entry.url) {
    const response = await fetch(entry.url);
    if (!response.ok) throw new Error(`The game file could not be loaded (${response.status}).`);
    return response.blob();
  }
  const blob = await readImported(entry.id);
  if (!blob) throw new Error('This game is no longer stored in this browser. Import it again.');
  return blob;
}

/** One on-screen button: held while a finger is on it. */
function PadKey({ name, label, press }: { name: PadButton; label: string; press: (button: PadButton, down: boolean) => void }) {
  return (
    <button
      type="button"
      className={`pad-key pad-${name}`}
      aria-label={name}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        press(name, true);
      }}
      onPointerUp={() => press(name, false)}
      onPointerCancel={() => press(name, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

export function Player({ entry, onClose }: { entry: RomEntry; onClose: () => void }) {
  const system = SYSTEMS[entry.system];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const emulator = useRef<Nostalgist | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [hasState, setHasState] = useState(false);

  const flash = useCallback((text: string) => {
    setNote(text);
    window.setTimeout(() => setNote((current) => (current === text ? '' : current)), 1800);
  }, []);

  /** Copy the cartridge's battery save out of the emulator into IndexedDB. Games without one simply have nothing to copy. */
  const keepBatterySave = useCallback(async () => {
    const running = emulator.current;
    if (!running) return;
    try {
      await writeSave(entry.id, 'sram', await running.saveSRAM());
    } catch {
      /* no battery save for this game */
    }
  }, [entry.id]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;

    (async () => {
      try {
        const [rom, sram, state] = await Promise.all([loadRom(entry), readSave(entry.id, 'sram'), readSave(entry.id, 'state')]);
        if (cancelled) return;
        setHasState(state !== null);
        const launched = await Nostalgist.launch({
          core: system.core,
          // the core picks its behaviour from the extension, so give the file its console's own
          rom: { fileName: `game${system.extensions[0]}`, fileContent: rom },
          ...(sram ? { sram: { fileName: 'game.srm', fileContent: sram } } : {}),
          element: canvas,
          respondToGlobalEvents: true,
          resolveCoreJs: (core) => `./retro/cores/${String(core)}_libretro.js`,
          resolveCoreWasm: (core) => `./retro/cores/${String(core)}_libretro.wasm`,
          style: { position: 'static', width: '100%', height: '100%', backgroundColor: '#000', imageRendering: 'pixelated' },
        });
        if (cancelled) {
          launched.exit({ removeCanvas: false });
          return;
        }
        emulator.current = launched;
        setStatus('running');
        timer = window.setInterval(() => void keepBatterySave(), 15_000);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'The emulator could not start.');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      const running = emulator.current;
      emulator.current = null;
      if (running) {
        // save first, then stop; neither may throw into React's cleanup
        void running
          .saveSRAM()
          .then((data) => writeSave(entry.id, 'sram', data))
          .catch(() => undefined)
          .finally(() => {
            try {
              running.exit({ removeCanvas: false });
            } catch {
              /* already stopped */
            }
          });
      }
    };
  }, [entry, system, keepBatterySave]);

  const press = useCallback((button: PadButton, down: boolean) => {
    const running = emulator.current;
    if (!running) return;
    if (down) running.pressDown(button);
    else running.pressUp(button);
  }, []);

  const togglePause = () => {
    const running = emulator.current;
    if (!running) return;
    if (status === 'running') {
      running.pause();
      setStatus('paused');
      void keepBatterySave();
    } else if (status === 'paused') {
      running.resume();
      setStatus('running');
    }
  };

  const saveState = async () => {
    const running = emulator.current;
    if (!running) return;
    try {
      const { state } = await running.saveState();
      if (await writeSave(entry.id, 'state', state)) {
        setHasState(true);
        flash('Saved');
      } else {
        flash('Could not save in this browser');
      }
    } catch {
      flash('This game cannot be saved right now');
    }
  };

  const loadState = async () => {
    const running = emulator.current;
    const state = await readSave(entry.id, 'state');
    if (!running || !state) return;
    try {
      await running.loadState(state);
      flash('Loaded');
    } catch {
      flash('That save could not be loaded');
    }
  };

  const ready = status === 'running' || status === 'paused';

  return (
    <div className="emu" data-screen="player" data-status={status} style={{ '--system': system.color, '--aspect': String(system.aspect) } as CSSProperties}>
      <div className="emu-bar">
        <button type="button" className="btn" onClick={onClose}>
          <ArrowLeft size={18} aria-hidden="true" />
          <span>Shelf</span>
        </button>
        <h2 className="emu-title">
          {entry.title} <small>{system.name}</small>
        </h2>
        <div className="emu-actions">
          <button type="button" className="btn btn-icon" onClick={togglePause} disabled={!ready} aria-label={status === 'paused' ? 'Resume' : 'Pause'} title={status === 'paused' ? 'Resume' : 'Pause'}>
            {status === 'paused' ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
          </button>
          <button type="button" className="btn btn-icon" onClick={() => void saveState()} disabled={!ready} aria-label="Save here" title="Save here">
            <Save size={18} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-icon" onClick={() => void loadState()} disabled={!ready || !hasState} aria-label="Load the save" title="Load the save">
            <Download size={18} aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-icon" onClick={() => emulator.current?.restart()} disabled={!ready} aria-label="Restart the game" title="Restart the game">
            <RotateCcw size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => void screenRef.current?.requestFullscreen?.().catch(() => undefined)}
            disabled={!ready}
            aria-label="Full screen"
            title="Full screen"
          >
            <Maximize size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="emu-screen" ref={screenRef}>
        <canvas ref={canvasRef} className="emu-canvas" aria-label={`${entry.title}, running in the emulator`} />
        {status === 'loading' && <p className="emu-overlay">Starting the {system.name}…</p>}
        {status === 'paused' && <p className="emu-overlay">Paused</p>}
        {status === 'error' && (
          <p className="emu-overlay emu-error" role="alert">
            {error}
          </p>
        )}
        {note && (
          <p className="emu-note" role="status">
            {note}
          </p>
        )}
      </div>

      <div className="pad" aria-label="Touch controls">
        <div className="pad-cross">
          <PadKey name="up" label="▲" press={press} />
          <PadKey name="left" label="◀" press={press} />
          <PadKey name="right" label="▶" press={press} />
          <PadKey name="down" label="▼" press={press} />
        </div>
        <div className="pad-middle">
          <PadKey name="select" label="Select" press={press} />
          <PadKey name="start" label="Start" press={press} />
        </div>
        <div className={`pad-face pad-face-${system.buttons.filter((b) => b !== 'l' && b !== 'r').length}`}>
          {system.buttons.map((b) => (
            <PadKey key={b} name={b} label={b.toUpperCase()} press={press} />
          ))}
        </div>
      </div>

      <p className="emu-keys">
        Keyboard: arrows move, <kbd>X</kbd> is A, <kbd>Z</kbd> is B{system.buttons.includes('x') ? ', ' : ''}
        {system.buttons.includes('x') && (
          <>
            <kbd>S</kbd> is X, <kbd>A</kbd> is Y
          </>
        )}
        {system.buttons.includes('l') && (
          <>
            , <kbd>Q</kbd> and <kbd>W</kbd> are L and R
          </>
        )}
        , <kbd>Enter</kbd> is Start, <kbd>Shift</kbd> is Select. A gamepad works too.
      </p>
    </div>
  );
}
