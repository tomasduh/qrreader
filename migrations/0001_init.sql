-- Entradas validadas en taquilla y intentos fallidos de PIN.
CREATE TABLE entries (
  code         TEXT PRIMARY KEY,
  lead_id      INTEGER NOT NULL,
  name         TEXT NOT NULL,
  stage_before TEXT,
  at           INTEGER NOT NULL,
  person       TEXT NOT NULL
);
CREATE INDEX entries_at ON entries (at);

CREATE TABLE pin_fails (ts INTEGER NOT NULL);
