import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

/** A modal built on the native <dialog>: focus trapping, Escape to close and the backdrop come from the browser. */
export function Dialog({ title, onClose, children, width = 'max-w-md', footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      aria-labelledby="dialog-title"
      className={`m-auto w-[calc(100vw-2rem)] ${width} rounded-xl border border-line bg-panel p-0 text-ink shadow-2xl`}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id="dialog-title" className="text-base font-semibold">
          {title}
        </h2>
        <button type="button" onClick={() => ref.current?.close()} className="grid h-8 w-8 place-items-center rounded-md text-ink-2 hover:bg-sunken" aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
    </dialog>
  );
}

export const buttonClass = (kind = 'default') =>
  ({
    default: 'border border-line bg-panel text-ink hover:bg-sunken',
    primary: 'border border-accent bg-accent text-white hover:bg-accent-strong dark:text-canvas',
    danger: 'border border-bad bg-bad text-white hover:opacity-90 dark:text-canvas',
    ghost: 'border border-transparent text-ink-2 hover:bg-sunken',
  })[kind] + ' inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';
