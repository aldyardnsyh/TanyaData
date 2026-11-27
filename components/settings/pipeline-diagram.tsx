/**
 * Diagram pipeline TanyaData untuk tab Tentang (tiket SET-03).
 *
 * Digambar tangan sebagai inline SVG (bukan hasil tool desain): enam tahap
 * berurutan dengan panah alur, bukan kartu identik berjajar. Isi jujur sesuai
 * `docs/SYSTEM_OVERVIEW.md` §2 dan klaim yang diizinkan §6:
 * unggah 6 format (PDF termasuk scan), ingest klasifikasi + layout-aware +
 * OCR on-demand opsional, chunking + embedding e5-small 384 dim, retrieval
 * hybrid FTS5/Qdrant dengan RRF dan circuit breaker, guardrail + sitasi,
 * composer template per kelompok dokumen + naturalness gate, keluaran
 * jawaban + sitasi + visualHint, dan sintesis multi-dokumen.
 *
 * Kemampuan yang BELUM ada tidak digambar (OCR KTP/identity, on-device).
 *
 * Teks memakai elemen <text> asli agar bisa di-select dan terbaca screen
 * reader; figure diberi role="img" dengan <title>/<desc>. Warna dan font
 * hanya dari token globals.css. Tanpa animasi (MOTION 1): diagram statis,
 * bergerak hanya saat hover di elemen HTML di sekitarnya.
 */

const FOREST = 'var(--color-forest)';
const FOREST_SOFT = 'var(--color-forest-08)';
const INK = 'var(--color-ink)';
const MUTED = 'var(--color-muted)';
const TERRA = 'var(--color-terracotta)';
const DISPLAY = 'var(--font-display)';
const BODY = 'var(--font-body)';
const MONO = 'var(--font-mono)';

function Marker({ id }: { id: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"
    >
      <path d="M0 0L10 5L0 10z" fill={FOREST} />
    </marker>
  );
}

function MarkerTerra({ id }: { id: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"
    >
      <path d="M0 0L10 5L0 10z" fill={TERRA} />
    </marker>
  );
}

/** Panel tahap: kotak dengan judul mono kecil di atasnya. */
function Stage({
  x,
  y,
  w,
  h,
  title,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <g>
      <text
        x={x}
        y={y - 10}
        fontFamily={MONO}
        fontSize="11"
        letterSpacing="1.2"
        fill={FOREST}
        fontWeight="600"
      >
        {title}
      </text>
      <rect x={x} y={y} width={w} height={h} rx="6" fill={FOREST_SOFT} stroke={FOREST} strokeWidth="1" />
      {children}
    </g>
  );
}

/** Sub-blok di dalam satu tahap. Dashed = opsional. */
function Block({
  x,
  y,
  w,
  h,
  dashed,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  dashed?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx="4"
      fill="var(--color-porcelain)"
      stroke={dashed ? MUTED : FOREST}
      strokeWidth="1"
      strokeDasharray={dashed ? '4 3' : undefined}
    >
      {children}
    </rect>
  );
}

function Label({
  x,
  y,
  size = 11,
  children,
  fill = INK,
  weight = 600,
  family = DISPLAY,
}: {
  x: number;
  y: number;
  size?: number;
  children: React.ReactNode;
  fill?: string;
  weight?: number;
  family?: string;
}) {
  return (
    <text x={x} y={y} fontFamily={family} fontSize={size} fontWeight={weight} fill={fill}>
      {children}
    </text>
  );
}

function Sub({
  x,
  y,
  size = 9,
  children,
  fill = MUTED,
}: {
  x: number;
  y: number;
  size?: number;
  children: React.ReactNode;
  fill?: string;
}) {
  return (
    <text x={x} y={y} fontFamily={MONO} fontSize={size} fill={fill}>
      {children}
    </text>
  );
}

/** Panah horizontal antar tahap (desktop). */
function ArrowH({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <line
      x1={x1}
      y1={y}
      x2={x2 - 2}
      y2={y}
      stroke={FOREST}
      strokeWidth="1.5"
      markerEnd="url(#pd-arrow-d)"
    />
  );
}

/** Panah vertikal antar tahap (mobile). */
function ArrowV({ y1, y2, x = 180 }: { y1: number; y2: number; x?: number }) {
  return (
    <line
      x1={x}
      y1={y1}
      x2={x}
      y2={y2 - 2}
      stroke={FOREST}
      strokeWidth="1.5"
      markerEnd="url(#pd-arrow-m)"
    />
  );
}

const STAGE_TITLES = [
  'Unggah',
  'Ingest',
  'Indeks',
  'Retrieval hybrid',
  'Compose',
  'Keluaran',
] as const;

function DesktopSvg() {
  return (
    <svg
      data-variant="desktop"
      viewBox="0 0 1160 340"
      role="img"
      aria-labelledby="pd-title-d pd-desc-d"
      shapeRendering="geometricPrecision"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <title id="pd-title-d">Pipeline TanyaData</title>
      <desc id="pd-desc-d">
        Enam tahap: Unggah (PDF, DOCX, TXT, MD, CSV, XLSX, maksimal 25 MB), Ingest (klasifikasi
        tipe dokumen, ekstraksi layout-aware, OCR on-demand opsional), Indeks (chunking, embedding
        e5-small 384 dim, FTS5), Retrieval hybrid (FTS5 BM25 dan Qdrant dense bergabung di RRF
        fusion dengan circuit breaker fallback ke FTS5), Compose (guardrail anti-halusinasi dengan
        sitasi, template respons per kelompok dokumen, naturalness gate), Keluaran (jawaban dengan
        sitasi, visualHint tabel atau bar, sintesis multi-dokumen).
      </desc>
      <defs>
        <Marker id="pd-arrow-d" />
      </defs>

      {/* 1. Unggah */}
      <Stage x={0} y={36} w={140} h={250} title={STAGE_TITLES[0]}>
        <Block x={12} y={50} w={116} h={38}></Block>
        <Label x={20} y={73}>PDF</Label>
        <Block x={12} y={96} w={116} h={38}></Block>
        <Label x={20} y={119}>DOCX</Label>
        <Block x={12} y={142} w={116} h={38}></Block>
        <Label x={20} y={165}>TXT · MD</Label>
        <Block x={12} y={188} w={116} h={38}></Block>
        <Label x={20} y={211}>CSV · XLSX</Label>
        <Sub x={12} y={248} size={9}>PDF termasuk hasil scan</Sub>
        <Sub x={12} y={264} size={9}>maks 25 MB per file</Sub>
      </Stage>
      <ArrowH x1={142} x2={162} y={160} />

      {/* 2. Ingest */}
      <Stage x={164} y={36} w={180} h={270} title={STAGE_TITLES[1]}>
        <Block x={176} y={50} w={156} h={62}></Block>
        <Label x={184} y={66}>Klasifikasi tipe</Label>
        <Sub x={184} y={80}>finance · sop · technical</Sub>
        <Sub x={184} y={92}>identity · general</Sub>
        <Block x={176} y={120} w={156} h={48}></Block>
        <Label x={184} y={138}>Ekstraksi</Label>
        <Sub x={184} y={152}>layout-aware: 2 kolom,</Sub>
        <Sub x={184} y={163}>header / footer</Sub>
        <Block x={176} y={176} w={156} h={54} dashed></Block>
        <Label x={184} y={192} fill={INK}>OCR on-demand</Label>
        <Sub x={184} y={205}>PP-OCRv6 · halaman</Sub>
        <Sub x={184} y={216} fill={TERRA}>image-only · opsional</Sub>
      </Stage>
      <ArrowH x1={346} x2={366} y={160} />

      {/* 3. Indeks */}
      <Stage x={368} y={36} w={160} h={200} title={STAGE_TITLES[2]}>
        <Block x={380} y={50} w={136} h={46}></Block>
        <Label x={388} y={67}>Chunking</Label>
        <Sub x={388} y={82}>900 char · overlap 150</Sub>
        <Block x={380} y={104} w={136} h={46}></Block>
        <Label x={388} y={121}>Embedding</Label>
        <Sub x={388} y={136}>e5-small · 384 dim</Sub>
        <Block x={380} y={158} w={136} h={46}></Block>
        <Label x={388} y={175}>Indeks FTS5</Label>
        <Sub x={388} y={190}>BM25 · selalu terisi</Sub>
      </Stage>
      <ArrowH x1={530} x2={550} y={160} />

      {/* 4. Retrieval hybrid */}
      <Stage x={532} y={36} w={180} h={260} title={STAGE_TITLES[3]}>
        <Block x={546} y={62} w={152} h={34}></Block>
        <Label x={556} y={83}>FTS5 (BM25)</Label>
        <Block x={546} y={110} w={152} h={34} dashed></Block>
        <Label x={556} y={131}>Qdrant (dense)</Label>
        <Sub x={646} y={131} size={8}>opsional</Sub>
        <path
          d="M698 79C712 79 712 96 712 110"
          fill="none"
          stroke={FOREST}
          strokeWidth="1"
        />
        <path d="M622 144L622 176" fill="none" stroke={FOREST} strokeWidth="1" markerEnd="url(#pd-arrow-d)" />
        <Block x={546} y={178} w={152} h={34}></Block>
        <Label x={556} y={199}>RRF fusion</Label>
        <path
          d="M698 127C726 127 726 195 700 195"
          fill="none"
          stroke={TERRA}
          strokeWidth="1"
          strokeDasharray="4 3"
          markerEnd="url(#pd-arrow-terra-d)"
        />
        <Sub x={546} y={232} size={9} fill={TERRA}>circuit breaker: gagal</Sub>
        <Sub x={546} y={244} size={9} fill={TERRA}>fallback ke FTS5</Sub>
        <defs>
          <MarkerTerra id="pd-arrow-terra-d" />
        </defs>
      </Stage>
      <ArrowH x1={714} x2={734} y={160} />

      {/* 5. Compose */}
      <Stage x={736} y={36} w={200} h={260} title={STAGE_TITLES[4]}>
        <Block x={750} y={50} w={172} h={50}></Block>
        <Label x={758} y={67}>Guardrail anti-halusinasi</Label>
        <Sub x={758} y={82}>sitasi [n] per klaim</Sub>
        <Label x={750} y={122} size={10}>Template per kelompok:</Label>
        <Sub x={750} y={138} size={10} fill={INK}>finance_narrative</Sub>
        <Sub x={750} y={152} size={10} fill={INK}>sop_prose</Sub>
        <Sub x={750} y={166} size={10} fill={INK}>technical_digest</Sub>
        <Sub x={750} y={180} size={10} fill={INK}>identity_fields</Sub>
        <Sub x={750} y={194} size={10} fill={INK}>general_text</Sub>
        <Block x={750} y={208} w={172} h={46}></Block>
        <Label x={758} y={225}>Naturalness gate</Label>
        <Sub x={758} y={240}>anti salinan verbatim</Sub>
      </Stage>
      <ArrowH x1={938} x2={958} y={160} />

      {/* 6. Keluaran */}
      <Stage x={960} y={36} w={180} h={250} title={STAGE_TITLES[5]}>
        <Block x={974} y={50} w={152} h={40}></Block>
        <Label x={982} y={67}>Jawaban + sitasi</Label>
        <Sub x={982} y={81}>[n] per klaim</Sub>
        <Block x={974} y={98} w={152} h={52}></Block>
        <Label x={982} y={115}>visualHint</Label>
        <Sub x={982} y={129}>tabel / bar</Sub>
        <Sub x={982} y={141}>dari data eksekusi</Sub>
        <Block x={974} y={158} w={152} h={52}></Block>
        <Label x={982} y={175}>Sintesis</Label>
        <Sub x={982} y={189}>multi-dokumen:</Sub>
        <Sub x={982} y={201}>gabungan lintas sumber</Sub>
      </Stage>
    </svg>
  );
}

function MobileSvg() {
  return (
    <svg
      data-variant="mobile"
      viewBox="0 0 360 1640"
      role="img"
      aria-labelledby="pd-title-m pd-desc-m"
      shapeRendering="geometricPrecision"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <title id="pd-title-m">Pipeline TanyaData</title>
      <desc id="pd-desc-m">
        Enam tahap dari unggah sampai keluaran: PDF, DOCX, TXT, MD, CSV, XLSX; klasifikasi dan
        ekstraksi layout-aware dengan OCR opsional; chunking dan embedding e5-small; retrieval
        hybrid FTS5 dan Qdrant dengan RRF dan circuit breaker; guardrail, template respons, dan
        naturalness gate; jawaban bersitasi dengan visualHint dan sintesis multi-dokumen.
      </desc>
      <defs>
        <Marker id="pd-arrow-m" />
      </defs>

      {/* 1. Unggah */}
      <Stage x={12} y={36} w={336} h={210} title={STAGE_TITLES[0]}>
        <Block x={24} y={50} w={148} h={44}></Block>
        <Label x={32} y={76}>PDF</Label>
        <Block x={188} y={50} w={148} h={44}></Block>
        <Label x={196} y={76}>DOCX</Label>
        <Block x={24} y={102} w={148} h={44}></Block>
        <Label x={32} y={128}>TXT · MD</Label>
        <Block x={188} y={102} w={148} h={44}></Block>
        <Label x={196} y={128}>CSV · XLSX</Label>
        <Sub x={24} y={172} size={9}>PDF termasuk hasil scan / image-only</Sub>
        <Sub x={24} y={190} size={9}>maks 25 MB per file</Sub>
      </Stage>
      <ArrowV y1={246} y2={266} />

      {/* 2. Ingest */}
      <Stage x={12} y={294} w={336} h={200} title={STAGE_TITLES[1]}>
        <Block x={24} y={308} w={312} h={48}></Block>
        <Label x={32} y={326}>Klasifikasi tipe dokumen</Label>
        <Sub x={32} y={344}>finance · sop · technical · identity · general</Sub>
        <Block x={24} y={364} w={312} h={48}></Block>
        <Label x={32} y={382}>Ekstraksi layout-aware</Label>
        <Sub x={32} y={400}>dua kolom · header / footer</Sub>
        <Block x={24} y={420} w={312} h={56} dashed></Block>
        <Label x={32} y={438}>OCR on-demand · PP-OCRv6</Label>
        <Sub x={32} y={456}>halaman image-only · </Sub>
        <Sub x={196} y={456} fill={TERRA}>opsional, default mati</Sub>
      </Stage>
      <ArrowV y1={494} y2={514} />

      {/* 3. Indeks */}
      <Stage x={12} y={542} w={336} h={170} title={STAGE_TITLES[2]}>
        <Block x={24} y={556} w={312} h={44}></Block>
        <Label x={32} y={574}>Chunking</Label>
        <Sub x={32} y={590}>900 karakter · overlap 150</Sub>
        <Block x={24} y={608} w={312} h={44}></Block>
        <Label x={32} y={626}>Embedding e5-small</Label>
        <Sub x={32} y={642}>384 dim</Sub>
        <Block x={24} y={660} w={312} h={40}></Block>
        <Label x={32} y={677}>Indeks FTS5</Label>
        <Sub x={196} y={686}>BM25 · selalu terisi</Sub>
      </Stage>
      <ArrowV y1={712} y2={732} />

      {/* 4. Retrieval hybrid */}
      <Stage x={12} y={760} w={336} h={250} title={STAGE_TITLES[3]}>
        <Block x={24} y={774} w={312} h={36}></Block>
        <Label x={32} y={796}>FTS5 (BM25)</Label>
        <Block x={24} y={818} w={312} h={36} dashed></Block>
        <Label x={32} y={840}>Qdrant (dense)</Label>
        <Sub x={244} y={840}>opsional</Sub>
        <path d="M180 854L180 884" fill="none" stroke={FOREST} strokeWidth="1" markerEnd="url(#pd-arrow-m)" />
        <Block x={24} y={886} w={312} h={36}></Block>
        <Label x={32} y={908}>RRF fusion</Label>
        <Sub x={24} y={952} size={9} fill={TERRA}>circuit breaker: Qdrant gagal</Sub>
        <Sub x={24} y={966} size={9} fill={TERRA}>fallback ke FTS5</Sub>
      </Stage>
      <ArrowV y1={1010} y2={1030} />

      {/* 5. Compose */}
      <Stage x={12} y={1058} w={336} h={310} title={STAGE_TITLES[4]}>
        <Block x={24} y={1072} w={312} h={48}></Block>
        <Label x={32} y={1090}>Guardrail anti-halusinasi</Label>
        <Sub x={32} y={1108}>sitasi [n] per klaim</Sub>
        <Label x={24} y={1144} size={10}>Template respons per kelompok dokumen:</Label>
        <Sub x={24} y={1162} size={10} fill={INK}>finance_narrative · sop_prose</Sub>
        <Sub x={24} y={1178} size={10} fill={INK}>technical_digest · identity_fields</Sub>
        <Sub x={24} y={1194} size={10} fill={INK}>general_text</Sub>
        <Block x={24} y={1210} w={312} h={46}></Block>
        <Label x={32} y={1228}>Naturalness gate</Label>
        <Sub x={32} y={1244}>anti salinan verbatim</Sub>
      </Stage>
      <ArrowV y1={1368} y2={1388} />

      {/* 6. Keluaran */}
      <Stage x={12} y={1416} w={336} h={190} title={STAGE_TITLES[5]}>
        <Block x={24} y={1430} w={312} h={40}></Block>
        <Label x={32} y={1454}>Jawaban + sitasi [n]</Label>
        <Block x={24} y={1478} w={312} h={48}></Block>
        <Label x={32} y={1496}>visualHint</Label>
        <Sub x={32} y={1512}>tabel / bar dari data eksekusi</Sub>
        <Block x={24} y={1534} w={312} h={48}></Block>
        <Label x={32} y={1552}>Sintesis multi-dokumen</Label>
        <Sub x={32} y={1568}>gabungan lintas sumber</Sub>
      </Stage>
    </svg>
  );
}

function LegendSwatch({ dashed, terra }: { dashed?: boolean; terra?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block"
      style={{
        width: 'var(--spacing-s4)',
        borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${terra ? 'var(--color-terracotta)' : 'var(--color-forest)'}`,
      }}
    />
  );
}

export function PipelineDiagram() {
  return (
    <figure className="tp-figure m-0 flex flex-col gap-s3">
      <div className="hidden md:block">
        <DesktopSvg />
      </div>
      <div className="md:hidden">
        <MobileSvg />
      </div>
      <div className="flex flex-wrap items-center gap-x-s4 gap-y-s1 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-72">
        <span className="inline-flex items-center gap-s2"><LegendSwatch /> alur utama</span>
        <span className="inline-flex items-center gap-s2"><LegendSwatch dashed /> opsional</span>
        <span className="inline-flex items-center gap-s2"><LegendSwatch dashed terra /> fallback</span>
      </div>
      <figcaption className="font-body text-caption text-ink-72">
        Enam tahap dari unggah sampai keluaran. Retrieval hybrid memfusikan FTS5 (BM25) dan Qdrant
        (dense) dengan RRF; bila Qdrant atau embedding gagal, circuit breaker menjatuhkan alur ke
        FTS5 tanpa menggagalkan jawaban.
      </figcaption>
    </figure>
  );
}
