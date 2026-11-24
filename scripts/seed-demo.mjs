#!/usr/bin/env node
/**
 * Development shortcut — jalankan bootstrap dengan profil demo.
 *
 *   npm run seed:demo
 *
 * Cross-platform: `SEED_PROFILE=demo npm run ...` tidak bekerja di cmd.exe
 * Windows, jadi env ditetapkan di sini SEBELUM modul bootstrap diimpor.
 * Bootstrap tetap menjalankan db:seed:kb-sop karena profilnya demo.
 */
process.env.SEED_PROFILE = 'demo';
await import('./bootstrap-production.mjs');
