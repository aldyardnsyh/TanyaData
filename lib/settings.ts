import type { DB } from '@/lib/db/client';
import { getWorkspaceDb } from '@/lib/db/client';
import { resolveScope, datasetChoices } from '@/lib/analytics/scope';
import type { Lang, SettingsResponse } from '@/lib/contracts/http';
import { isIsoDate, nowJakartaIso } from '@/lib/date';
import { notFound, validationError } from '@/lib/errors';

const SETTINGS_KEY = 'app';
const CHART_DEFAULTS = new Set(['bar', 'line', 'pie']);
const PRESETS = new Set(['this_month', 'last_month', 'last_7_days', 'last_30_days', 'this_quarter', 'all', 'custom']);

export type SettingsState = {
  profile: { name: string; role: string };
  lang: Lang;
  dateRange: { start: string; end: string; preset: string };
  activeDatasetId: string;
  /**
   * @deprecated DECISION-036 (P6-UI-HONESTY): tersimpan tetapi TIDAK dikonsumsi
   * perilaku apa pun — tidak ada pembaca di `lib/core`, `lib/ai`, dashboard,
   * chart, maupun tabel (lihat `docs/SYSTEM_OVERVIEW.md` §7). Field dipertahankan
   * agar payload/settings lama tetap valid; UI berhenti mengirimnya. Pembersihan
   * menyeluruh (skema + seed) dilacak di tiket SET-03.
   */
  preferences: { chartDefault: string; denseTables: boolean };
  updatedAt: string;
};

type Row = { value: string; updated_at: string };

export function readSettingsState(db: DB = getWorkspaceDb()): SettingsState {
  const row = db.prepare('SELECT value, updated_at FROM settings WHERE key = ?').get(SETTINGS_KEY) as Row | undefined;
  if (!row) throw notFound('Settings belum diinisialisasi');
  try {
    const parsed = JSON.parse(row.value) as SettingsState;
    return { ...parsed, updatedAt: parsed.updatedAt ?? row.updated_at };
  } catch {
    throw validationError('Settings tersimpan rusak. Jalankan `npm run db:init`.');
  }
}

export function getSettings(db: DB = getWorkspaceDb()): SettingsResponse {
  const state = readSettingsState(db);
  const scope = resolveScope(state.activeDatasetId, db);
  const datasets = datasetChoices(db);
  return {
    profile: state.profile,
    lang: state.lang,
    dateRange: state.dateRange,
    activeDatasetId: state.activeDatasetId,
    preferences: state.preferences,
    datasets: datasets.length ? datasets : [{ id: scope.id, name: scope.ref.name, rowCount: scope.ref.rowCount }],
    updatedAt: state.updatedAt,
  };
}

export type SettingsPatch = {
  lang?: Lang;
  dateRange?: { start: string; end: string; preset?: string };
  activeDatasetId?: string;
  profile?: { name?: string; role?: string };
  /**
   * @deprecated DECISION-036 (P6-UI-HONESTY): dipertahankan hanya untuk
   * kompatibilitas payload lama. Tidak ada konsumen perilaku; UI tidak lagi
   * mengirim field ini. Jangan tambah pembaca baru — lihat tiket SET-03.
   */
  preferences?: { chartDefault?: string; denseTables?: boolean };
};

export function updateSettings(db: DB, patch: SettingsPatch): SettingsResponse {
  if (!patch || Object.keys(patch).length === 0) {
    throw validationError('Minimal satu field harus diubah');
  }
  const state = readSettingsState(db);

  if (patch.lang && patch.lang !== 'id' && patch.lang !== 'en') {
    throw validationError('lang harus "id" atau "en"');
  }
  const nextLang = patch.lang ?? state.lang;

  let nextDatasetId = state.activeDatasetId;
  if (patch.activeDatasetId) {
    try {
      const scope = resolveScope(patch.activeDatasetId, db);
      nextDatasetId = scope.id;
    } catch {
      throw validationError('activeDatasetId harus dataset READY');
    }
  }
  const scope = resolveScope(nextDatasetId, db);

  let nextRange = state.dateRange;
  if (patch.dateRange) {
    const { start, end } = patch.dateRange;
    if (!isIsoDate(start) || !isIsoDate(end)) {
      throw validationError('Format tanggal harus YYYY-MM-DD');
    }
    if (start > end) throw validationError('start tidak boleh setelah end');
    if (start < scope.ref.minDate || end > scope.ref.maxDate) {
      throw validationError(`Rentang tanggal harus di dalam ${scope.ref.minDate} s/d ${scope.ref.maxDate}`);
    }
    const preset = patch.dateRange.preset ?? 'custom';
    if (!PRESETS.has(preset)) throw validationError('preset tidak dikenal');
    nextRange = { start, end, preset };
  } else if (patch.activeDatasetId && nextDatasetId !== state.activeDatasetId) {
    // Pastikan rentang tetap valid pada dataset baru.
    nextRange = {
      start: scope.ref.minDate,
      end: scope.ref.maxDate,
      preset: 'all',
    };
  }

  const nextProfile = {
    name: patch.profile?.name?.trim() || state.profile.name,
    role: patch.profile?.role?.trim() || state.profile.role,
  };
  if (nextProfile.name.length > 80 || nextProfile.role.length > 80) {
    throw validationError('Nama/role maksimal 80 karakter');
  }

  const nextPreferences = {
    chartDefault: patch.preferences?.chartDefault ?? state.preferences.chartDefault,
    denseTables: patch.preferences?.denseTables ?? state.preferences.denseTables,
  };
  if (!CHART_DEFAULTS.has(nextPreferences.chartDefault)) {
    throw validationError('chartDefault harus bar, line, atau pie');
  }

  const updated: SettingsState = {
    profile: nextProfile,
    lang: nextLang,
    dateRange: nextRange,
    activeDatasetId: nextDatasetId,
    preferences: nextPreferences,
    updatedAt: nowJakartaIso(),
  };

  db.prepare(
    'INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(SETTINGS_KEY, JSON.stringify(updated), updated.updatedAt);

  return getSettings(db);
}
