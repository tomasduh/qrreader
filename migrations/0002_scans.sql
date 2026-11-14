-- Historial de todos los escaneos de taquilla (entró, ya entró, rechazado, no encontrado...),
-- no solo de los ingresos exitosos que guarda `entries`.
CREATE TABLE scans (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  code    TEXT NOT NULL,
  result  TEXT NOT NULL,
  name    TEXT,
  lead_id INTEGER,
  person  TEXT
);
CREATE INDEX scans_at ON scans (at);
