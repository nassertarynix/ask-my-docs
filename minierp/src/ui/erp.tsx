import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import initSqlJs, { SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Ctx, DomainError, openDatabase, seedDemoData, setSetting } from '../domain';
import { clearBytes, loadBytes, saveBytes } from './idb';
import { useI18n } from './i18n';

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'unavailable';

interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

interface ErpApi {
  ctx: Ctx;
  /** Increases after every change; pages list it as a dependency so they re-read the database. */
  rev: number;
  saveState: SaveState;
  /** Run a change. Domain rule violations are shown as a message and `undefined` is returned. */
  act: <T>(change: (ctx: Ctx) => T, doneMessage?: string) => T | undefined;
  loadDemo: () => void;
  startEmpty: () => void;
  importFile: (bytes: Uint8Array) => boolean;
  exportFile: () => Uint8Array;
  resetAll: () => Promise<void>;
  toasts: Toast[];
  notify: (text: string, kind?: 'ok' | 'error') => void;
  dismissToast: (id: number) => void;
}

const ErpContext = createContext<ErpApi | null>(null);

export function useErp(): ErpApi {
  const value = useContext(ErpContext);
  if (!value) throw new Error('useErp must be used inside ErpProvider');
  return value;
}

/** A single pending "save soon" timer. Held in state (not a ref) so it can be used from callbacks that the context hands out. */
class SaveTimer {
  private handle: number | undefined;
  pending(): boolean {
    return this.handle !== undefined;
  }
  cancel(): void {
    window.clearTimeout(this.handle);
    this.handle = undefined;
  }
  start(run: () => void, ms: number): void {
    this.cancel();
    this.handle = window.setTimeout(() => {
      this.handle = undefined;
      run();
    }, ms);
  }
}

let toastCounter = 1;

type Boot = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; SQL: SqlJsStatic };

export function ErpProvider({ children }: { children: ReactNode }) {
  const { t, errorText } = useI18n();
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [rev, setRev] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [timer] = useState(() => new SaveTimer());

  const notify = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = toastCounter++;
    setToasts((list) => [...list.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);

  const persistNow = useCallback(async (target: Ctx | null) => {
    if (!target) return;
    setSaveState('saving');
    const ok = await saveBytes(target.db.export());
    setSaveState(ok ? 'saved' : 'unavailable');
  }, []);

  const schedulePersist = useCallback(
    (target: Ctx) => {
      setSaveState('unsaved');
      timer.start(() => void persistNow(target), 250);
    },
    [persistNow, timer],
  );

  // start-up: load the WebAssembly SQLite, then the saved database (if any)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const SQL = await initSqlJs({ locateFile: () => wasmUrl });
        const saved = await loadBytes();
        let opened: Ctx;
        try {
          opened = openDatabase(SQL, saved);
        } catch {
          opened = openDatabase(SQL, null); // a damaged saved copy must not lock the person out
        }
        if (cancelled) return;
        setCtx(opened);
        setBoot({ phase: 'ready', SQL });
      } catch (error) {
        if (!cancelled) setBoot({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // flush a pending save when the tab is hidden or closed
  useEffect(() => {
    if (!ctx) return;
    const flush = () => {
      if (timer.pending()) {
        timer.cancel();
        void persistNow(ctx);
      }
    };
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ctx, persistNow, timer]);

  const act = useCallback(
    <T,>(change: (ctx: Ctx) => T, doneMessage?: string): T | undefined => {
      if (!ctx) return undefined;
      try {
        const result = change(ctx);
        setRev((n) => n + 1);
        schedulePersist(ctx);
        if (doneMessage) notify(doneMessage);
        return result;
      } catch (error) {
        if (error instanceof DomainError) {
          notify(errorText(error), 'error');
          return undefined;
        }
        notify(t('error.unexpected'), 'error');
        console.error(error);
        return undefined;
      }
    },
    [ctx, errorText, notify, schedulePersist, t],
  );

  const api = useMemo<ErpApi | null>(() => {
    if (boot.phase !== 'ready' || !ctx) return null;
    const { SQL } = boot;
    const replaceWith = (next: Ctx) => {
      ctx.db.close();
      setCtx(next);
      setRev((n) => n + 1);
      schedulePersist(next);
    };
    return {
      ctx,
      rev,
      saveState,
      act,
      notify,
      toasts,
      dismissToast,
      loadDemo: () => {
        const next = openDatabase(SQL, null);
        seedDemoData(next);
        replaceWith(next);
      },
      startEmpty: () => {
        const next = openDatabase(SQL, null);
        setSetting(next, 'onboarded', '1'); // remembers that the welcome screen has been answered
        replaceWith(next);
      },
      importFile: (bytes) => {
        try {
          replaceWith(openDatabase(SQL, bytes));
          return true;
        } catch (error) {
          notify(error instanceof DomainError ? errorText(error) : t('error.badFile'), 'error');
          return false;
        }
      },
      exportFile: () => ctx.db.export(),
      resetAll: async () => {
        timer.cancel();
        await clearBytes();
        const fresh = openDatabase(SQL, null);
        ctx.db.close();
        setCtx(fresh);
        setRev((n) => n + 1);
        await persistNow(fresh);
      },
    };
  }, [boot, ctx, rev, saveState, toasts, act, notify, dismissToast, schedulePersist, timer, persistNow, errorText, t]);

  if (boot.phase === 'loading') return <div className="boot" role="status">{t('boot.loading')}</div>;
  if (boot.phase === 'error' || !api) {
    return (
      <div className="boot" role="alert">
        <h1>{t('boot.failed')}</h1>
        <p>{boot.phase === 'error' ? boot.message : ''}</p>
      </div>
    );
  }
  return <ErpContext.Provider value={api}>{children}</ErpContext.Provider>;
}
