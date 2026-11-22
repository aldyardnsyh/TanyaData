import type { DictionaryKey } from '@/lib/i18n/dictionary';

export type NavItem = {
  key: DictionaryKey;
  href: string;
  /** Ikon fungsional Material Symbols (V-08: tanpa robot/kilau/otak). */
  icon: string;
  docKey: DictionaryKey;
};

// Chat-first: Asisten permukaan utama. Ringkasan hidup per dokumen
// (halaman detail sumber), bukan sebagai halaman global terpisah.
export const NAV_ITEMS: NavItem[] = [
  { key: 'nav.assistant', href: '/assistant', icon: 'forum', docKey: 'shell.docsAssistant' },
  { key: 'nav.dataSources', href: '/data-sources', icon: 'database', docKey: 'shell.docsSources' },
  { key: 'nav.investigations', href: '/investigations', icon: 'query_stats', docKey: 'shell.docsInvestigations' },
  { key: 'nav.reports', href: '/reports', icon: 'summarize', docKey: 'shell.docsReports' },
  { key: 'nav.settings', href: '/settings', icon: 'settings', docKey: 'shell.docsSettings' },
];

export function currentNavKey(pathname: string): DictionaryKey {
  if (pathname.startsWith('/assistant')) return 'nav.assistant';
  if (pathname.startsWith('/data-sources')) return 'nav.dataSources';
  if (pathname.startsWith('/investigations')) return 'nav.investigations';
  if (pathname.startsWith('/reports')) return 'nav.reports';
  if (pathname.startsWith('/settings')) return 'nav.settings';
  return 'nav.assistant';
}
