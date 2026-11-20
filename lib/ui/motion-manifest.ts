/**
 * Purpose Gate — 9 motion signature (DESIGN_DIRECTION §6.2).
 * Setiap entri punya alasan satu baris. Tidak ada animasi tanpa alasan.
 * Runtime: CSS keyframes + WAAPI + Recharts. Tanpa dependensi animasi berat.
 */
export const MOTION_SIGNATURES = [
  { id: 1, name: 'Nav active indicator slide + spring settle', token: '180ms --ease-spring', purpose: 'Menunjukkan lokasi tanpa menggambar ulang daftar nav.', runtime: 'CSS transition', site: 'components/layout/nav-item.tsx' },
  { id: 2, name: 'KPI count-up sekali + hover replay halus', token: '320ms / 120ms', purpose: 'Angka terasa baru diukur; hover hanya memberi emphasis, bukan hitung ulang.', runtime: 'requestAnimationFrame + CSS', site: 'components/ui/kpi-card.tsx, lib/ui/count-up.ts' },
  { id: 3, name: 'Chart bar focus emphasis + tooltip fade', token: '120ms / 80ms', purpose: 'Tooltip hanya saat hover/fokus, tidak menutupi data saat halaman dibuka.', runtime: 'Recharts 320ms + CSS', site: 'components/charts/*, app/(workspace)/overview/page.tsx' },
  { id: 4, name: 'Command palette ⌘K scale + blur entrance', token: '180ms --ease-out-expo', purpose: 'Blur menandakan layer di atas konten; scale mengarahkan fokus ke input.', runtime: 'CSS keyframe', site: 'components/layout/quick-search.tsx' },
  { id: 5, name: 'Chat message stagger + typing 3-dot + answer reveal', token: '30ms × 8 / 180ms', purpose: 'Urutan baca percakapan; typing berhenti begitu jawaban tiba.', runtime: 'CSS keyframe', site: 'app/(workspace)/assistant/page.tsx, components/chat/answer-card.tsx' },
  { id: 6, name: 'Filter chip active slide', token: '120ms --ease-out-expo', purpose: 'Perubahan state terasa fisik dan langsung.', runtime: 'CSS transition', site: 'components/ui/filter-chips.tsx' },
  { id: 7, name: 'Button ripple WAAPI', token: '120ms', purpose: 'Konfirmasi tekan tanpa menggeser layout.', runtime: 'element.animate()', site: 'lib/ui/ripple.ts, components/ui/button.tsx' },
  { id: 8, name: 'Toast slide-in spring', token: '320ms --ease-spring', purpose: 'Umpan balik aksi yang singkat dan jelas.', runtime: 'CSS keyframe', site: 'components/ui/toast.tsx' },
  { id: 9, name: 'Dialog/drawer spring entrance + backdrop fade', token: '320ms / 120ms', purpose: 'Orientasi spasial saat overlay buka dan tutup.', runtime: 'CSS transition (Radix)', site: 'components/ui/dialog.tsx, components/ui/drawer.tsx' },
] as const;

/** Dua loop yang diizinkan, keduanya transient dan berhenti saat tab tersembunyi. */
export const ALLOWED_LOOPS = ['typing indicator (saat proses nyata)', 'dot mesin saat memproses'] as const;
