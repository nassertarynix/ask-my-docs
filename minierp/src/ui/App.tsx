import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useErp } from './erp';
import { Icon, IconName } from './icons';
import { MessageKey, useI18n } from './i18n';
import { Toasts } from './components';
import { Dashboard } from './pages/Dashboard';
import { SalesDetail, SalesEditor, SalesList } from './pages/Sales';
import { InvoiceDetail, InvoiceList } from './pages/Invoices';
import { ProductDetail, StockList } from './pages/Stock';
import { PurchaseDetail, PurchaseEditor, PurchaseList } from './pages/Purchases';
import { ContactDetail, ContactList } from './pages/Contacts';
import { Reports } from './pages/Reports';
import { DataPage, MorePage } from './pages/More';

const TABS: { to: string; icon: IconName; label: MessageKey; end?: boolean; match: string[] }[] = [
  { to: '/', icon: 'home', label: 'nav.home', end: true, match: ['/'] },
  { to: '/sales', icon: 'sales', label: 'nav.sales', match: ['/sales'] },
  { to: '/stock', icon: 'stock', label: 'nav.stock', match: ['/stock'] },
  { to: '/invoices', icon: 'invoice', label: 'nav.invoices', match: ['/invoices'] },
  { to: '/more', icon: 'more', label: 'nav.more', match: ['/more', '/purchases', '/contacts', '/reports', '/data'] },
];

const SIDE_EXTRA: { to: string; icon: IconName; label: MessageKey }[] = [
  { to: '/purchases', icon: 'truck', label: 'nav.purchases' },
  { to: '/contacts', icon: 'users', label: 'nav.contacts' },
  { to: '/reports', icon: 'chart', label: 'nav.reports' },
  { to: '/data', icon: 'data', label: 'nav.data' },
];

export function App() {
  const { t } = useI18n();
  const { saveState } = useErp();
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (match: string[]) =>
    match.some((m) => (m === '/' ? location.pathname === '/' : location.pathname === m || location.pathname.startsWith(`${m}/`)));

  return (
    <div className="shell">
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>{t('nav.skip')}</a>
      <aside className="sidebar" aria-label={t('nav.main')}>
        <button className="brand" onClick={() => navigate('/')} aria-label={t('app.name')}>
          <span className="brand-mark" aria-hidden="true">M</span>
          <span className="brand-name">MiniERP</span>
        </button>
        <nav>
          {[...TABS.filter((tab) => tab.to !== '/more'), ...SIDE_EXTRA.map((s) => ({ ...s, end: false, match: [s.to] }))].map((item) => (
            <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className={() => (isActive(item.match) ? 'nav-item active' : 'nav-item')}>
              <Icon name={item.icon} />
              <span>{t(item.label)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-foot" aria-live="polite">
          <span className={`dot ${saveState}`} aria-hidden="true" />
          {t(`save.${saveState}` as MessageKey)}
        </div>
      </aside>

      <main id="main" tabIndex={-1} className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/sales" element={<SalesList />} />
          <Route path="/sales/new" element={<SalesEditor />} />
          <Route path="/sales/:id" element={<SalesDetail />} />
          <Route path="/sales/:id/edit" element={<SalesEditor />} />
          <Route path="/invoices" element={<InvoiceList />} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
          <Route path="/stock" element={<StockList />} />
          <Route path="/stock/:id" element={<ProductDetail />} />
          <Route path="/purchases" element={<PurchaseList />} />
          <Route path="/purchases/new" element={<PurchaseEditor />} />
          <Route path="/purchases/:id" element={<PurchaseDetail />} />
          <Route path="/purchases/:id/edit" element={<PurchaseEditor />} />
          <Route path="/contacts" element={<ContactList />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>

      <nav className="tabbar" aria-label={t('nav.main')}>
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={() => (isActive(tab.match) ? 'tab active' : 'tab')} aria-current={isActive(tab.match) ? 'page' : undefined}>
            <Icon name={tab.icon} />
            <span>{t(tab.label)}</span>
          </NavLink>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}
