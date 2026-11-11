import { KeyRound, LifeBuoy, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { Dialog, buttonClass } from './Dialog.jsx';

const inputClass = 'h-9 w-full rounded-md border border-line bg-canvas px-2.5 text-sm text-ink placeholder:text-ink-3';

function Field({ id, label, hint, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

/** Connect Telegram: API credentials, a bot token or a user login, and the channel that holds the files. */
export function SettingsModal({ status, onClose, onChanged, notify }) {
  const config = status?.config ?? {};
  const local = status?.backend === 'local';
  const [mode, setMode] = useState(config.bot_token_set ? 'bot' : 'user');
  const [apiId, setApiId] = useState(config.api_id ? String(config.api_id) : '');
  const [apiHash, setApiHash] = useState('');
  const [botToken, setBotToken] = useState('');
  const [channel, setChannel] = useState(config.channel ?? '');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [needPassword, setNeedPassword] = useState(false);
  const [busy, setBusy] = useState('');

  const run = async (label, work, success) => {
    setBusy(label);
    try {
      const result = await work();
      if (success) notify(success, 'good');
      await onChanged();
      return result;
    } catch (error) {
      if (error.code === 'password_required') {
        setNeedPassword(true);
        notify('This account uses two-step verification. Enter the password too.', 'warn');
      } else notify(error.message, 'bad');
      return null;
    } finally {
      setBusy('');
    }
  };

  const save = (event) => {
    event.preventDefault();
    const values = { channel: channel.trim() || null, bot_token: mode === 'bot' ? botToken.trim() || null : '' };
    if (apiId.trim()) values.api_id = Number(apiId);
    if (apiHash.trim()) values.api_hash = apiHash.trim();
    return run('save', () => api.configure(values), 'Settings saved');
  };

  const authorized = status?.authorized;
  return (
    <Dialog title="Connect Telegram" onClose={onClose} width="max-w-lg">
      {local ? (
        <p className="rounded-lg bg-sunken p-3 text-ink-2">This copy is running with a local folder standing in for the Telegram channel (development and demo mode). Nothing is sent to Telegram.</p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4">
          {status?.connect_error && (
            <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-bad">
              {status.connect_error}
            </p>
          )}
          <p className="text-ink-2">
            Files are stored as messages in a private Telegram channel that only you can see. Get an API id and hash at <span className="font-medium text-ink">my.telegram.org</span> under “API development tools”.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field id="api-id" label="API id">
              <input id="api-id" className={inputClass} inputMode="numeric" value={apiId} onChange={(e) => setApiId(e.target.value)} autoComplete="off" />
            </Field>
            <Field id="api-hash" label="API hash">
              <input id="api-hash" className={inputClass} type="password" value={apiHash} onChange={(e) => setApiHash(e.target.value)} placeholder={config.api_hash_set ? 'Saved (leave empty to keep)' : ''} autoComplete="off" />
            </Field>
          </div>
          <div role="radiogroup" aria-label="Sign in with" className="grid grid-cols-2 gap-1 rounded-lg bg-sunken p-1">
            {[['user', 'My Telegram account'], ['bot', 'A bot token']].map(([value, label]) => (
              <label key={value} className={`relative grid h-8 cursor-pointer place-items-center rounded-md text-sm ${mode === value ? 'bg-panel font-medium shadow-sm' : 'text-ink-2'}`}>
                <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="absolute inset-0 cursor-pointer opacity-0" />
                {label}
              </label>
            ))}
          </div>
          {mode === 'bot' && (
            <Field id="bot-token" label="Bot token" hint="The bot must be an administrator of the channel, with permission to post and delete messages.">
              <input id="bot-token" className={inputClass} type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder={config.bot_token_set ? 'Saved (leave empty to keep)' : '123456:ABC…'} autoComplete="off" />
            </Field>
          )}
          <Field id="channel" label="Channel" hint="@username, or the numeric id of a private channel (starts with -100).">
            <input id="channel" className={inputClass} value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="@my_private_storage" autoComplete="off" />
          </Field>
          <div className="flex justify-end">
            <button type="submit" className={buttonClass('primary')} disabled={!!busy}>
              {busy === 'save' && <Loader2 size={15} className="animate-spin" />} Save and connect
            </button>
          </div>

          {mode === 'user' && (
            <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3" disabled={!!busy}>
              <legend className="px-1 text-xs font-medium text-ink-2">{authorized ? 'Signed in' : 'Sign in'}</legend>
              {authorized ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-2">Your account is connected.</span>
                  {!channel && (
                    <button type="button" className={buttonClass()} onClick={() => run('channel', () => api.createChannel('Cloud storage'), 'Private channel created')}>
                      <Plus size={15} /> Create private channel
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <Field id="phone" label="Phone number">
                        <input id="phone" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" inputMode="tel" autoComplete="off" />
                      </Field>
                    </div>
                    <button type="button" className={buttonClass()} disabled={!phone.trim()} onClick={async () => (await run('code', () => api.sendCode(phone.trim()), 'Code sent. Check Telegram.')) && setCodeSent(true)}>
                      Send code
                    </button>
                  </div>
                  {codeSent && (
                    <div className="grid grid-cols-2 gap-3">
                      <Field id="code" label="Login code">
                        <input id="code" className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
                      </Field>
                      {needPassword && (
                        <Field id="password" label="Two-step password">
                          <input id="password" className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
                        </Field>
                      )}
                      <div className="col-span-2 flex justify-end">
                        <button type="button" className={buttonClass('primary')} disabled={!code.trim()} onClick={() => run('signin', () => api.signIn(code.trim(), password), 'Signed in')}>
                          <KeyRound size={15} /> Sign in
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </fieldset>
          )}
        </form>
      )}

      <div className="mt-5 flex items-start gap-3 rounded-lg border border-line p-3">
        <LifeBuoy size={18} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
        <div className="flex-1">
          <div className="font-medium">Rebuild the index</div>
          <p className="text-xs text-ink-2">If the local database is lost, every file can be recovered from the channel: each message carries the details needed. Recovered files appear in a folder called “Recovered”.</p>
          <button type="button" className={`${buttonClass()} mt-2`} disabled={!status?.ready || !!busy} onClick={() => run('recover', async () => { const r = await api.recover(); notify(`Recovered ${r.recovered}, already known ${r.already_indexed}, incomplete ${r.incomplete}`, r.incomplete ? 'warn' : 'good'); })}>
            {busy === 'recover' && <Loader2 size={15} className="animate-spin" />} Rebuild from channel
          </button>
        </div>
      </div>
    </Dialog>
  );
}
