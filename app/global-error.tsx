'use client';

/** B-02: kegagalan root layout — html/body sendiri, token inline minimal, tanpa stack trace. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f5fbf6',
          color: '#171d1a',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }} role="alert">
          <h1 style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600, margin: '0 0 8px' }}>
            TanyaData gagal dimuat.
          </h1>
          <p style={{ fontSize: 14, lineHeight: '22px', color: '#404944', margin: '0 0 20px' }}>
            Terjadi kesalahan saat menyiapkan aplikasi. Muat ulang halaman untuk mencoba lagi.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              height: 44,
              padding: '0 20px',
              borderRadius: 8,
              border: 'none',
              background: '#0b4433',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Muat ulang halaman
          </button>
        </div>
      </body>
    </html>
  );
}
