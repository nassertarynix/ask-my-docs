/** Money is whole cents. Parsing accepts "1,250.50" or "1250.5"; anything else is rejected rather than guessed. */
export function parseMoney(text: string): number | null {
  const t = text.trim().replace(/,/g, '').replace(/^\$/, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  const negative = t.startsWith('-');
  const [whole = '0', frac = ''] = t.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function formatMoney(cents: number, opts: { sign?: boolean; whole?: boolean } = {}): string {
  const abs = opts.whole ? Math.round(Math.abs(cents) / 100) * 100 : Math.abs(cents);
  const text = `$${Math.floor(abs / 100).toLocaleString('en-US')}${opts.whole ? '' : `.${String(abs % 100).padStart(2, '0')}`}`;
  if (abs === 0) return text;
  if (cents < 0) return `−${text}`;
  return opts.sign ? `+${text}` : text;
}

export function centsToInput(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
