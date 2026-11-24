-- Skema analytics.db (seed R&D) — DDL SAJA, tanpa satu pun baris data.
-- Dipakai oleh scripts/lib/seed-db.mjs saat SEED_PROFILE=none untuk membuat
-- analytics.db kosong dengan struktur lengkap. Data 46.952 transaksi R&D
-- TIDAK pernah ditulis di sini; sumbernya ada di data/seed/structured/*.csv
-- dan dipakai hanya oleh profil demo.
--
-- Reversible: file ini hanya dibaca. Tidak ada DROP/DELETE terhadap data
-- milik pengguna; pengosongan selalu melalui backup terlebih dahulu.

CREATE TABLE IF NOT EXISTS merchants (
  merchant_id     VARCHAR(10) PRIMARY KEY,
  merchant_name   VARCHAR(100) NOT NULL,
  category        VARCHAR(50) NOT NULL,
  tier            VARCHAR(20),
  city            VARCHAR(50),
  onboarding_date DATE
);

CREATE TABLE IF NOT EXISTS channels (
  channel_id   VARCHAR(10) PRIMARY KEY,
  channel_name VARCHAR(50) NOT NULL,
  channel_type VARCHAR(30) NOT NULL,
  provider     VARCHAR(60)
);

CREATE TABLE IF NOT EXISTS failure_codes (
  failure_code VARCHAR(5) PRIMARY KEY,
  failure_name VARCHAR(50) NOT NULL,
  description  VARCHAR(200),
  failure_type VARCHAR(40),
  owner_team   VARCHAR(50),
  sla_hours    INTEGER
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id     VARCHAR(20) PRIMARY KEY,
  created_at         TIMESTAMP NOT NULL,
  transaction_date   DATE NOT NULL,
  merchant_id        VARCHAR(10) REFERENCES merchants(merchant_id),
  channel_id         VARCHAR(10) REFERENCES channels(channel_id),
  channel_name       VARCHAR(50),
  category           VARCHAR(50),
  amount             BIGINT NOT NULL,
  fee                BIGINT NOT NULL,
  status             VARCHAR(10) NOT NULL,   -- SUCCESS | FAILED | PENDING | EXPIRED | REFUNDED
  failure_code       VARCHAR(5) REFERENCES failure_codes(failure_code),
  processing_time_ms INTEGER,
  device_type        VARCHAR(10),
  customer_region    VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS incident_log (
  incident_id          VARCHAR(20) PRIMARY KEY,
  started_at           TIMESTAMP NOT NULL,
  ended_at             TIMESTAMP,
  channel_id           VARCHAR(10) REFERENCES channels(channel_id),
  severity             VARCHAR(10),
  incident_type        VARCHAR(40),
  title                VARCHAR(200),
  root_cause           VARCHAR(300),
  status               VARCHAR(15),
  related_failure_code VARCHAR(5) REFERENCES failure_codes(failure_code)
);

CREATE INDEX IF NOT EXISTS idx_trx_date    ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_trx_status  ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_trx_channel ON transactions(channel_id);
CREATE INDEX IF NOT EXISTS idx_trx_cat     ON transactions(category);
