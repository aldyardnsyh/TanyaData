/**
 * Guard deploy publik (P6-FIX / SEC-001 / B3 / ADR-P4-02).
 *
 * Aplikasi ini single-user tanpa autentikasi in-app. Bila `PUBLIC_DEPLOY`
 * dinyalakan tanpa mekanisme auth yang dikonfigurasi, seluruh request API
 * ditolak (fail-closed) dengan 503 — aplikasi tidak boleh berjalan diam-diam
 * di publik. Auth penuh (bearer + tenancy) tetap utang terpisah di VPS user.
 */

import { AppError } from '@/lib/errors';

let bannerShown = false;

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function publicDeployEnabled(): boolean {
  return isTruthy(process.env.PUBLIC_DEPLOY);
}

export function authConfigured(): boolean {
  return Boolean(process.env.API_ACCESS_TOKEN?.trim());
}

export function assertPublicDeployAllowed(): void {
  if (!publicDeployEnabled()) return;

  if (!authConfigured()) {
    if (!bannerShown) {
      bannerShown = true;
      console.error(
        '\n[SEC-001][FATAL] PUBLIC_DEPLOY aktif tetapi API_ACCESS_TOKEN kosong. ' +
          'Seluruh endpoint API ditolak (503). Konfigurasi auth/tenancy atau reverse proxy ' +
          'wajib tersedia sebelum aplikasi diekspos ke publik.\n',
      );
    }
    throw new AppError(
      503,
      'PUBLIC_DEPLOY_BLOCKED',
      'Aplikasi tidak dapat dijalankan dalam mode publik tanpa autentikasi. Hubungi operator.',
    );
  }

  if (!bannerShown) {
    bannerShown = true;
    console.warn(
      '[SEC-001][WARN] PUBLIC_DEPLOY aktif. Pastikan reverse proxy memverifikasi ' +
        'API_ACCESS_TOKEN pada setiap request dan share link tetap menjadi satu-satunya endpoint publik.',
    );
  }
}
