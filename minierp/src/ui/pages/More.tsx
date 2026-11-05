import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { contactsCsv, getSetting, invoicesCsv, productsCsv, setSetting } from '../../domain';
import { Card, Chips, PageHeader, TextField, useConfirm } from '../components';
import { download, downloadCsv } from '../download';
import { useErp } from '../erp';
import { Icon, IconName } from '../icons';
import { Lang, MessageKey, useI18n } from '../i18n';
import { ThemeChoice, useTheme } from '../theme';

export function Preferences() {
  const { t, lang, setLang } = useI18n();
  const [theme, setTheme] = useTheme();
  return (
    <Card title={t('more.preferences')}>
      <div className="pref">
        <span id="lang-label">{t('more.language')}</span>
        <Chips<Lang> value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }]} />
      </div>
      <div className="pref">
        <span>{t('more.theme')}</span>
        <Chips<ThemeChoice> value={theme} onChange={setTheme} options={(['system', 'light', 'dark'] as ThemeChoice[]).map((v) => ({ value: v, label: t(`theme.${v}` as MessageKey) }))} />
      </div>
    </Card>
  );
}

export function MorePage() {
  const { t } = useI18n();
  const items: { to: string; icon: IconName; label: MessageKey; text: MessageKey }[] = [
    { to: '/purchases', icon: 'truck', label: 'nav.purchases', text: 'more.purchasesText' },
    { to: '/contacts', icon: 'users', label: 'nav.contacts', text: 'more.contactsText' },
    { to: '/reports', icon: 'chart', label: 'nav.reports', text: 'more.reportsText' },
    { to: '/data', icon: 'data', label: 'nav.data', text: 'more.dataText' },
  ];
  return (
    <>
      <PageHeader title={t('nav.more')} />
      <div className="list card flush">
        {items.map((item) => (
          <Link key={item.to} to={item.to} className="row-link">
            <span className="row-icon"><Icon name={item.icon} /></span>
            <div className="row-body"><strong>{t(item.label)}</strong><br /><small className="muted">{t(item.text)}</small></div>
            <span className="row-chevron" aria-hidden="true"><Icon name="chevron" size={18} /></span>
          </Link>
        ))}
      </div>
      <Preferences />
      <p className="muted about">{t('more.about')}</p>
    </>
  );
}

export function DataPage() {
  const { ctx, rev, act, saveState, loadDemo, importFile, exportFile, resetAll, notify } = useErp();
  const { t } = useI18n();
  const { confirm, dialog } = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(() => getSetting(ctx, 'business_name', ''));
  const [terms, setTerms] = useState(() => getSetting(ctx, 'payment_terms_days', '30'));
  const [termsError, setTermsError] = useState('');
  void rev;

  const saveBusiness = () => {
    if (!/^\d{1,3}$/.test(terms.trim())) return setTermsError(t('error.invalid_quantity'));
    setTermsError('');
    act((c) => { setSetting(c, 'business_name', name.trim()); setSetting(c, 'payment_terms_days', terms.trim()); }, t('data.saved'));
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const onImport = async (file: File | undefined) => {
    if (!file) return;
    if (!(await confirm({ title: t('data.importTitle'), text: t('data.importText'), confirmLabel: t('data.import'), danger: true }))) return;
    if (importFile(new Uint8Array(await file.arrayBuffer()))) notify(t('data.imported'));
  };

  return (
    <>
      <PageHeader title={t('nav.data')} back="/more" />
      <Card title={t('data.business')}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); saveBusiness(); }}>
          <TextField label={t('data.businessName')} value={name} onChange={setName} autoComplete="off" />
          <TextField label={t('data.terms')} value={terms} onChange={setTerms} inputMode="numeric" error={termsError} hint={t('data.termsHint')} autoComplete="off" />
          <button className="btn primary" type="submit">{t('common.save')}</button>
        </form>
      </Card>
      <Preferences />
      <Card title={t('data.storage')}>
        <p className="muted">{saveState === 'unavailable' ? t('data.storageUnavailable') : t('data.storageText')}</p>
        <div className="actions">
          <button className="btn" onClick={() => download(`minierp-${stamp}.sqlite`, [exportFile() as BlobPart], 'application/vnd.sqlite3')}><Icon name="download" size={18} />{t('data.downloadDb')}</button>
          <button className="btn" onClick={() => fileInput.current?.click()}><Icon name="upload" size={18} />{t('data.import')}</button>
          <input ref={fileInput} type="file" accept=".sqlite,.db,.sqlite3,application/vnd.sqlite3,application/octet-stream" hidden onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ''; }} aria-label={t('data.import')} />
        </div>
        <p className="muted hint">{t('data.dbHint')}</p>
      </Card>
      <Card title={t('data.csv')}>
        <div className="actions">
          <button className="btn" onClick={() => downloadCsv(`invoices-${stamp}.csv`, invoicesCsv(ctx))}>{t('data.csvInvoices')}</button>
          <button className="btn" onClick={() => downloadCsv(`products-${stamp}.csv`, productsCsv(ctx))}>{t('data.csvProducts')}</button>
          <button className="btn" onClick={() => downloadCsv(`contacts-${stamp}.csv`, contactsCsv(ctx))}>{t('data.csvContacts')}</button>
        </div>
      </Card>
      <Card title={t('data.danger')}>
        <div className="actions">
          <button className="btn" onClick={async () => { if (await confirm({ title: t('data.demoTitle'), text: t('data.demoText'), confirmLabel: t('data.demo'), danger: true })) { loadDemo(); notify(t('data.demoLoaded')); } }}>{t('data.demo')}</button>
          <button className="btn danger-outline" onClick={async () => { if (await confirm({ title: t('data.resetTitle'), text: t('data.resetText'), confirmLabel: t('data.reset'), danger: true })) { await resetAll(); notify(t('data.resetDone')); } }}><Icon name="trash" size={18} />{t('data.reset')}</button>
        </div>
      </Card>
      {dialog}
    </>
  );
}
