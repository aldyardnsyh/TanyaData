/**
 * Delapan state wajib untuk setiap komponen khas (UI_REFACTOR_DESIGN §4).
 * n/a ditulis eksplisit oleh komponen yang tidak relevan, beserta alasannya.
 */
export type ComponentState =
  | 'default'
  | 'hover'
  | 'focus'
  | 'active'
  | 'loading'
  | 'empty'
  | 'error'
  | 'success';

export interface StateCopy {
  /** Empty menyebut penyebab + satu aksi (P5). Bukan "No data". */
  emptyTitle?: string;
  emptyAction?: { label: string; onClick: () => void };
  /** Error menyebut kegagalan + retry. Teks memakai --ink, dot --terracotta. */
  errorTitle?: string;
  onRetry?: () => void;
  /** Loading memakai skeleton, bukan spinner. */
  loadingLabel?: string;
  /** Success label sementara sebelum kembali ke default. */
  successLabel?: string;
}

/** Fallback copy jujur. Dipakai bila caller tidak menyediakan copy spesifik. */
export const DEFAULT_STATE_COPY: Required<Pick<StateCopy, 'emptyTitle' | 'errorTitle' | 'loadingLabel' | 'successLabel'>> = {
  emptyTitle: 'Belum ada data untuk ditampilkan.',
  errorTitle: 'Data gagal dimuat.',
  loadingLabel: 'Memproses',
  successLabel: 'Selesai',
};

/** Aksi kosong yang sengaja tidak melakukan apa pun, untuk state n/a. */
export const NOOP = () => {};
