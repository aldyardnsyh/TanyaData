import type { Lang } from '@/lib/contracts/http';

const id = {
  appName: 'TanyaData',
  tagline: 'Tanyakan Datanya. Temukan Wawasannya.',

  /* Shell bersama (blueprint §3) — label di-port dari Stitch, diterjemahkan untuk mode ID. */
  'shell.engineOnline': 'Mesin Aktif',
  'shell.engineOffline': 'Mesin Tidak Aktif',
  'shell.documentation': 'Dokumentasi',
  'shell.askTanyaData': 'Tanya TanyaData',
  'shell.quickSearch': 'Pencarian cepat',
  'shell.searchPlaceholder': 'Cari halaman dan aksi',
  'shell.commandPalette': 'Palet perintah',
  'shell.platform': 'Platform',
  'shell.telemetry': 'Telemetri',
  'shell.notifications': 'Notifikasi',
  'shell.noNotifications': 'Tidak ada notifikasi baru',
  'shell.profile': 'Profil',
  'shell.switchLanguage': 'Ganti bahasa',
  'shell.openMenu': 'Buka menu navigasi',
  'shell.closeMenu': 'Tutup menu navigasi',
  'shell.skipToContent': 'Lewati ke konten utama',
  'shell.workspace': 'Workspace',
  'shell.viewSettings': 'Lihat pengaturan',
  'shell.goTo': 'Buka',
  'shell.close': 'Tutup',
  'shell.docsIntro': 'Panduan singkat workspace TanyaData.',
  'shell.docsOverview': 'Pantau metrik operasional dan temukan perubahan yang bermakna.',
  'shell.docsAssistant': 'Ajukan pertanyaan memakai bahasa alami dan dapatkan jawaban bersumber.',
  'shell.docsSources': 'Kelola dataset dan dokumen yang menjadi sumber jawaban.',
  'shell.docsInvestigations': 'Selidiki anomali dan korelasikan bukti lintas sumber.',
  'shell.docsReports': 'Tinjau dan ekspor laporan yang tersimpan.',
  'shell.docsSettings': 'Atur bahasa, dataset aktif, dan preferensi workspace.',

  'nav.overview': 'Overview',
  'nav.assistant': 'AI Assistant',
  'nav.dataSources': 'Data Sources',
  'nav.investigations': 'Investigasi',
  'nav.reports': 'Laporan',
  'nav.settings': 'Pengaturan',

  'kpi.total': 'Total Transaksi',
  'kpi.successful': 'Transaksi Sukses',
  'kpi.failed': 'Transaksi Gagal',
  'kpi.successRate': 'Success Rate',
  'kpi.failureRate': 'Failure Rate',
  'kpi.successValue': 'Nilai Transaksi Sukses',

  'status.SUCCESS': 'Sukses',
  'status.FAILED': 'Gagal',
  'status.PENDING': 'Tertunda',
  'status.EXPIRED': 'Kedaluwarsa',
  'status.REFUNDED': 'Dikembalikan',

  'period.partial': 'bulan berjalan belum lengkap',
  'period.partialNote': 'Periode {label} adalah bulan berjalan ({days} hari).',
  'period.compareLike': 'Pembanding memakai rentang setara {label} (like-for-like).',
  'period.noData': 'Tidak ada data pada filter ini.',

  'channel.volume': 'Volume',
  'channel.failure_rate': 'Failure rate',
  'metric.total': 'Total',
  'metric.successful': 'Sukses',
  'metric.failed': 'Gagal',
  'metric.successRate': 'Success rate',
  'metric.failureRate': 'Failure rate',
  'metric.successValue': 'Nilai sukses',
  'metric.avgTicket': 'Rata-rata nominal',
  'metric.share': 'Pangsa',
  'metric.change': 'Perubahan',

  'guardrail.out_of_range':
    'Rentang data yang tersedia adalah {min} s.d. {max}. Periode di luar rentang itu tidak dapat dihitung.',
  'guardrail.not_in_sources':
    'Informasi tersebut tidak ada pada dataset maupun dokumen yang tersedia.',
  'guardrail.destructive':
    'TanyaData hanya memiliki akses baca (read-only). Perintah yang mengubah atau menghapus data tidak dijalankan.',
  'guardrail.pii':
    'Dataset ini tidak memuat data pribadi pelanggan (email, telepon, NIK), sehingga pertanyaan tersebut tidak dapat dijawab.',
  'guardrail.ambiguous':
    'Metrik yang dimaksud belum jelas. Pilih salah satu: volume transaksi, success rate, atau nilai transaksi.',
  'guardrail.unsupported': 'Permintaan ini di luar cakupan TanyaData.',

  'assistant.pendingEngine':
    'Mesin analitik percakapan belum tersedia pada build ini. Dashboard, Data Sources, Investigasi, dan Laporan tetap berfungsi.',
  'assistant.pendingEngineTitle': 'Asisten belum aktif',
  'assistant.followUp1': 'Berapa total transaksi bulan ini?',
  'assistant.followUp2': 'Bagaimana distribusi status transaksi?',
  'assistant.followUp3': 'Kanal mana dengan volume tertinggi?',

  'empty.conversations': 'Belum ada percakapan. Mulai pertanyaan pertama Anda.',
  'empty.reports': 'Belum ada laporan. Simpan jawaban dari AI Assistant untuk membuat laporan.',
  'empty.investigations': 'Belum ada investigasi tersimpan.',
  'empty.sources': 'Belum ada sumber data.',
  'empty.noData': 'Tidak ada data untuk filter ini.',

  'button.save': 'Simpan',
  'button.exportCsv': 'Ekspor CSV',
  'button.exportPdf': 'Ekspor PDF',
  'button.delete': 'Hapus',
  'button.reindex': 'Reindex',
  'button.upload': 'Unggah',
  'button.newChat': 'Percakapan baru',
  'button.send': 'Kirim',
  'button.cancel': 'Batal',
  'button.confirm': 'Konfirmasi',

  'label.period': 'Periode',
  'label.dataset': 'Dataset',
  'label.source': 'Sumber',
  'label.channel': 'Kanal',
  'label.category': 'Kategori',
  'label.status': 'Status',
  'label.failureCode': 'Kode kegagalan',
  'label.metric': 'Metrik',
  'label.value': 'Nilai',
  'label.question': 'Pertanyaan',
  'label.createdAt': 'Dibuat',
  'label.summary': 'Ringkasan',
  'label.keyFindings': 'Temuan utama',
  'label.supportingData': 'Data pendukung',
  'label.sources': 'Sumber',
  'label.followUps': 'Pertanyaan lanjutan',
  'label.sql': 'SQL',
  'label.rows': 'baris',
  'label.page': 'hlm',
  'label.section': 'Bagian',
  'label.chunk': 'chunk',
  'label.notAvailable': 'n/a',
  'label.loading': 'Memuat…',
  'label.activeDataset': 'Dataset aktif',
  'label.language': 'Bahasa',
  'label.dateRange': 'Rentang tanggal',
  'label.profile': 'Profil',
  'label.name': 'Nama',
  'label.role': 'Peran',
  'label.preferences': 'Preferensi',
  'label.quality': 'Kualitas data',
  'label.duplicateRows': 'Baris duplikat',
  'label.missingValues': 'Nilai kosong',
  'label.noTextLayer': 'Dokumen tidak memiliki lapisan teks.',

  'error.VALIDATION_ERROR': 'Data yang dikirim tidak valid.',
  'error.NOT_FOUND': 'Data yang diminta tidak ditemukan.',
  'error.CONFLICT': 'Operasi tidak dapat dilakukan pada kondisi saat ini.',
  'error.FILE_TOO_LARGE': 'Ukuran file melebihi batas 25 MB.',
  'error.UNSUPPORTED_MEDIA_TYPE': 'Format file tidak didukung.',
  'error.UNPROCESSABLE_SOURCE': 'File tidak dapat diproses.',
  'error.INTERNAL_ERROR': 'Terjadi kesalahan internal. Silakan coba lagi.',

  'report.exportHint': 'Ekspor memakai snapshot laporan; angka tidak dihitung ulang.',
} as const;

const en: Record<keyof typeof id, string> = {
  appName: 'TanyaData',
  tagline: 'Ask the Data. Find the Insight.',

  /* Shell bersama (blueprint §3) — bahasa label mengikuti Stitch persis. */
  'shell.engineOnline': 'Engine Online',
  'shell.engineOffline': 'Engine Offline',
  'shell.documentation': 'Documentation',
  'shell.askTanyaData': 'Ask TanyaData',
  'shell.quickSearch': 'Quick search',
  'shell.searchPlaceholder': 'Search pages and actions',
  'shell.commandPalette': 'Command palette',
  'shell.platform': 'Platform',
  'shell.telemetry': 'Telemetry',
  'shell.notifications': 'Notifications',
  'shell.noNotifications': 'No new notifications',
  'shell.profile': 'Profile',
  'shell.switchLanguage': 'Switch language',
  'shell.openMenu': 'Open navigation menu',
  'shell.closeMenu': 'Close navigation menu',
  'shell.skipToContent': 'Skip to main content',
  'shell.workspace': 'Workspace',
  'shell.viewSettings': 'View settings',
  'shell.goTo': 'Go to',
  'shell.close': 'Close',
  'shell.docsIntro': 'A short guide to the TanyaData workspace.',
  'shell.docsOverview': 'Monitor operational metrics and spot meaningful changes.',
  'shell.docsAssistant': 'Ask questions in natural language and get grounded answers.',
  'shell.docsSources': 'Manage the datasets and documents behind every answer.',
  'shell.docsInvestigations': 'Investigate anomalies and correlate evidence across sources.',
  'shell.docsReports': 'Review and export saved reports.',
  'shell.docsSettings': 'Set the language, active dataset, and workspace preferences.',

  'nav.overview': 'Overview',
  'nav.assistant': 'AI Assistant',
  'nav.dataSources': 'Data Sources',
  'nav.investigations': 'Investigations',
  'nav.reports': 'Reports',
  'nav.settings': 'Settings',

  'kpi.total': 'Total Transactions',
  'kpi.successful': 'Successful Transactions',
  'kpi.failed': 'Failed Transactions',
  'kpi.successRate': 'Success Rate',
  'kpi.failureRate': 'Failure Rate',
  'kpi.successValue': 'Successful Transaction Value',

  'status.SUCCESS': 'Success',
  'status.FAILED': 'Failed',
  'status.PENDING': 'Pending',
  'status.EXPIRED': 'Expired',
  'status.REFUNDED': 'Refunded',

  'period.partial': 'current month is incomplete',
  'period.partialNote': 'Period {label} is the current month ({days} days).',
  'period.compareLike': 'Comparison uses the equivalent range {label} (like-for-like).',
  'period.noData': 'No data for this filter.',

  'channel.volume': 'Volume',
  'channel.failure_rate': 'Failure rate',
  'metric.total': 'Total',
  'metric.successful': 'Successful',
  'metric.failed': 'Failed',
  'metric.successRate': 'Success rate',
  'metric.failureRate': 'Failure rate',
  'metric.successValue': 'Successful value',
  'metric.avgTicket': 'Average amount',
  'metric.share': 'Share',
  'metric.change': 'Change',

  'guardrail.out_of_range':
    'Available data covers {min} to {max}. Periods outside that range cannot be computed.',
  'guardrail.not_in_sources':
    'That information is not present in the available dataset or documents.',
  'guardrail.destructive':
    'TanyaData has read-only access. Commands that modify or delete data are not executed.',
  'guardrail.pii':
    'This dataset contains no customer personal data (email, phone, national ID), so that question cannot be answered.',
  'guardrail.ambiguous':
    'The metric is ambiguous. Choose one: transaction volume, success rate, or transaction value.',
  'guardrail.unsupported': 'This request is outside the scope of TanyaData.',

  'assistant.pendingEngine':
    'The conversational analytics engine is not available in this build. Dashboard, Data Sources, Investigations, and Reports remain functional.',
  'assistant.pendingEngineTitle': 'Assistant not active',
  'assistant.followUp1': 'What is the total number of transactions this month?',
  'assistant.followUp2': 'How are transactions distributed by status?',
  'assistant.followUp3': 'Which channel has the highest volume?',

  'empty.conversations': 'No conversations yet. Start with your first question.',
  'empty.reports': 'No reports yet. Save an answer from the AI Assistant to create one.',
  'empty.investigations': 'No saved investigations yet.',
  'empty.sources': 'No data sources yet.',
  'empty.noData': 'No data for this filter.',

  'button.save': 'Save',
  'button.exportCsv': 'Export CSV',
  'button.exportPdf': 'Export PDF',
  'button.delete': 'Delete',
  'button.reindex': 'Reindex',
  'button.upload': 'Upload',
  'button.newChat': 'New conversation',
  'button.send': 'Send',
  'button.cancel': 'Cancel',
  'button.confirm': 'Confirm',

  'label.period': 'Period',
  'label.dataset': 'Dataset',
  'label.source': 'Source',
  'label.channel': 'Channel',
  'label.category': 'Category',
  'label.status': 'Status',
  'label.failureCode': 'Failure code',
  'label.metric': 'Metric',
  'label.value': 'Value',
  'label.question': 'Question',
  'label.createdAt': 'Created',
  'label.summary': 'Summary',
  'label.keyFindings': 'Key findings',
  'label.supportingData': 'Supporting data',
  'label.sources': 'Sources',
  'label.followUps': 'Follow-up questions',
  'label.sql': 'SQL',
  'label.rows': 'rows',
  'label.page': 'p.',
  'label.section': 'Section',
  'label.chunk': 'chunk',
  'label.notAvailable': 'n/a',
  'label.loading': 'Loading…',
  'label.activeDataset': 'Active dataset',
  'label.language': 'Language',
  'label.dateRange': 'Date range',
  'label.profile': 'Profile',
  'label.name': 'Name',
  'label.role': 'Role',
  'label.preferences': 'Preferences',
  'label.quality': 'Data quality',
  'label.duplicateRows': 'Duplicate rows',
  'label.missingValues': 'Missing values',
  'label.noTextLayer': 'The document has no text layer.',

  'error.VALIDATION_ERROR': 'The submitted data is invalid.',
  'error.NOT_FOUND': 'The requested resource was not found.',
  'error.CONFLICT': 'The operation cannot be performed in the current state.',
  'error.FILE_TOO_LARGE': 'The file exceeds the 25 MB limit.',
  'error.UNSUPPORTED_MEDIA_TYPE': 'Unsupported file format.',
  'error.UNPROCESSABLE_SOURCE': 'The file could not be processed.',
  'error.INTERNAL_ERROR': 'An internal error occurred. Please try again.',

  'report.exportHint': 'Export uses the report snapshot; figures are not recalculated.',
};

export type DictionaryKey = keyof typeof id;
export type Dictionary = Record<DictionaryKey, string>;

export const dictionaries: Record<Lang, Dictionary> = { id, en };

export function t(lang: Lang, key: DictionaryKey, vars?: Record<string, string | number>): string {
  let text: string = dictionaries[lang][key] ?? dictionaries.id[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export const NAV_KEYS: DictionaryKey[] = [
  'nav.overview',
  'nav.assistant',
  'nav.dataSources',
  'nav.investigations',
  'nav.reports',
  'nav.settings',
];

export const STATUS_KEYS: Record<string, DictionaryKey> = {
  SUCCESS: 'status.SUCCESS',
  FAILED: 'status.FAILED',
  PENDING: 'status.PENDING',
  EXPIRED: 'status.EXPIRED',
  REFUNDED: 'status.REFUNDED',
};

export const KPI_KEYS: Record<string, DictionaryKey> = {
  total: 'kpi.total',
  successful: 'kpi.successful',
  failed: 'kpi.failed',
  successRate: 'kpi.successRate',
  failureRate: 'kpi.failureRate',
  successValue: 'kpi.successValue',
};
