import { ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useErp } from './erp';
import { Icon, IconName } from './icons';
import { MessageKey, useI18n } from './i18n';

/* ---------------------------------------------------------------- layout */

export function PageHeader({ title, subtitle, back, actions }: { title: string; subtitle?: string; back?: string; actions?: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <header className="page-head">
      {back !== undefined && (
        <button className="icon-btn back" onClick={() => navigate(back)} aria-label={t('common.back')}>
          <Icon name="back" />
        </button>
      )}
      <div className="page-title">
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Empty({ icon = 'box', title, text, action }: { icon?: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={28} /></span>
      <h2>{title}</h2>
      {text && <p className="muted">{text}</p>}
      {action}
    </div>
  );
}

export function Card({ title, children, actions, className = '' }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`pill pill-${status}`}>{t(`status.${status}` as MessageKey)}</span>;
}

export function Row({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="row-link">
      <div className="row-body">{children}</div>
      <span className="row-chevron" aria-hidden="true"><Icon name="chevron" size={18} /></span>
    </Link>
  );
}

/* ---------------------------------------------------------------- forms */

export function Field({ label, children, hint, error, htmlFor }: { label: string; children: ReactNode; hint?: string; error?: string; htmlFor?: string }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <small className="muted">{hint}</small>}
      {error && <small className="error-text" role="alert">{error}</small>}
    </div>
  );
}

export function TextField({ label, value, onChange, error, hint, ...rest }: {
  label: string; value: string; onChange: (value: string) => void; error?: string; hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function MoneyField(props: { label: string; value: string; onChange: (value: string) => void; error?: string; hint?: string }) {
  return <TextField {...props} inputMode="decimal" autoComplete="off" placeholder="0.00" />;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <Icon name="search" size={18} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="chips" role="group">
      {options.map((option) => (
        <button key={option.value} className={`chip ${value === option.value ? 'on' : ''}`} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
          {option.count !== undefined && <span className="chip-count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- dialogs */

/** A bottom sheet on phones and a centred dialog on larger screens, built on the native <dialog> (focus trap + Esc for free). */
export function Sheet({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <div className="sheet-body">
          <div className="sheet-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}><Icon name="x" /></button>
          </div>
          <div className="sheet-content">{children}</div>
          {footer && <div className="sheet-foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  text?: string;
  confirmLabel: string;
  danger?: boolean;
}

export function useConfirm() {
  const { t } = useI18n();
  const [state, setState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...options, resolve })), []);
  const finish = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const dialog = (
    <Sheet
      open={state !== null}
      title={state?.title ?? ''}
      onClose={() => finish(false)}
      footer={
        <>
          <button className="btn" onClick={() => finish(false)}>{t('common.cancel')}</button>
          <button className={`btn ${state?.danger ? 'danger' : 'primary'}`} onClick={() => finish(true)}>{state?.confirmLabel}</button>
        </>
      }
    >
      {state?.text && <p>{state.text}</p>}
    </Sheet>
  );
  return { confirm, dialog };
}

export function Toasts() {
  const { toasts, dismissToast } = useErp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} onClick={() => dismissToast(toast.id)}>
          <Icon name={toast.kind === 'error' ? 'alert' : 'check'} size={18} />
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Today as the page sees it, for default dates in forms. */
export function useToday(): string {
  return useErp().ctx.today();
}
