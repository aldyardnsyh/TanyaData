import type { DictionaryKey } from '@/lib/i18n/dictionary';

export type NavItem = {
  key: DictionaryKey;
  href: string;
  /** Nama ikon Material Symbols (blueprint §3, dari screenshot Stitch). */
  icon: string;
  docKey: DictionaryKey;
};

export const NAV_ITEMS: NavItem[] = [
  { key: 'nav.overview', href: '/overview', icon: 'dashboard', docKey: 'shell.docsOverview' },
  { key: 'nav.assistant', href: '/assistant', icon: 'forum', docKey: 'shell.docsAssistant' },
  { key: 'nav.dataSources', href: '/data-sources', icon: 'database', docKey: 'shell.docsSources' },
  { key: 'nav.investigations', href: '/investigations', icon: 'biotech', docKey: 'shell.docsInvestigations' },
  { key: 'nav.reports', href: '/reports', icon: 'description', docKey: 'shell.docsReports' },
  { key: 'nav.settings', href: '/settings', icon: 'settings', docKey: 'shell.docsSettings' },
];

export function currentNavKey(pathname: string): DictionaryKey {
  if (pathname.startsWith('/assistant')) return 'nav.assistant';
  if (pathname.startsWith('/data-sources')) return 'nav.dataSources';
  if (pathname.startsWith('/investigations')) return 'nav.investigations';
  if (pathname.startsWith('/reports')) return 'nav.reports';
  if (pathname.startsWith('/settings')) return 'nav.settings';
  return 'nav.overview';
}
