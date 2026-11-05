import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DomainError, formatMoney } from '../domain';
import { ar } from './messages/ar';
import { en, MessageKey } from './messages/en';

export type Lang = 'en' | 'ar';
export type { MessageKey };

const STORAGE_KEY = 'minierp.lang';

function readStored(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'ar') return stored;
  } catch {
    /* storage can be blocked; fall through to the browser language */
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

type Params = Record<string, string | number>;

interface I18n {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, params?: Params) => string;
  money: (cents: number) => string;
  /** Short number (counts, quantities). */
  num: (value: number) => string;
  date: (iso: string) => string;
  monthLabel: (yyyymm: string, style?: 'short' | 'long') => string;
  percent: (bps: number) => string;
  errorText: (error: DomainError) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

/** Western digits for Arabic too: invoices and prices in the region are normally written that way. */
/** Amounts are written $1,234.50 in both languages: Arabic locales would print "US$" and flip the layout of the symbol. */
const MONEY_LOCALE = 'en-US';
const LOCALE: Record<Lang, string> = { en: 'en-US', ar: 'ar-u-nu-latn' };

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStored);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* not saving the language is fine */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const messages: Record<MessageKey, string> = lang === 'ar' ? ar : en;
    const locale = LOCALE[lang];
    const t = (key: MessageKey, params?: Params) => {
      let text = messages[key] ?? en[key] ?? key;
      // In Arabic, wrap each inserted value in Unicode isolates so an English name or an amount cannot reorder the sentence around it.
      const wrap = (v: string | number) => (lang === 'ar' ? `\u2068${v}\u2069` : String(v));
      if (params) for (const [name, v] of Object.entries(params)) text = text.split(`{${name}}`).join(wrap(v));
      return text;
    };
    const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const numberFormat = new Intl.NumberFormat(locale);
    const errorText = (error: DomainError) => {
      const key = `error.${error.code}` as MessageKey;
      const params = { ...error.params };
      // numbers inside messages (quantities, amounts) are formatted for the language
      for (const [k, v] of Object.entries(params)) {
        if (k === 'balance' || k === 'amount') params[k] = formatMoney(Number(v), MONEY_LOCALE);
        else if (typeof v === 'number') params[k] = numberFormat.format(v);
      }
      return key in en ? t(key, params) : t('error.unexpected');
    };
    return {
      lang,
      dir,
      setLang,
      t,
      money: (cents) => formatMoney(cents, MONEY_LOCALE),
      num: (n) => numberFormat.format(n),
      date: (iso) => dateFormat.format(new Date(`${iso}T00:00:00Z`)),
      monthLabel: (yyyymm, style = 'short') =>
        new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(new Date(`${yyyymm}-01T00:00:00Z`)),
      percent: (bps) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(bps / 10_000),
      errorText,
    };
  }, [lang, dir, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
