// Almacén para el servidor Node: un archivo SQLite (módulo node:sqlite, Node 22+).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function sqliteStore(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS entries (
      code         TEXT PRIMARY KEY,
      lead_id      INTEGER NOT NULL,
      name         TEXT NOT NULL,
      stage_before TEXT,
      at           INTEGER NOT NULL,
      person       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS entries_at ON entries (at);
    CREATE TABLE IF NOT EXISTS pin_fails (ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS scans (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      at      INTEGER NOT NULL,
      code    TEXT NOT NULL,
      result  TEXT NOT NULL,
      name    TEXT,
      lead_id INTEGER,
      person  TEXT
    );
    CREATE INDEX IF NOT EXISTS scans_at ON scans (at);
  `);

  const q = {
    get: db.prepare('SELECT * FROM entries WHERE code = ?'),
    claim: db.prepare(
      'INSERT OR IGNORE INTO entries (code, lead_id, name, stage_before, at, person) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    release: db.prepare('DELETE FROM entries WHERE code = ?'),
    list: db.prepare('SELECT * FROM entries WHERE at >= ? ORDER BY at DESC LIMIT ?'),
    addFail: db.prepare('INSERT INTO pin_fails (ts) VALUES (?)'),
    cleanFails: db.prepare('DELETE FROM pin_fails WHERE ts < ?'),
    countFails: db.prepare('SELECT COUNT(*) AS n FROM pin_fails WHERE ts >= ?'),
    logScan: db.prepare('INSERT INTO scans (at, code, result, name, lead_id, person) VALUES (?, ?, ?, ?, ?, ?)'),
    listScans: db.prepare('SELECT * FROM scans WHERE at >= ? ORDER BY at DESC, id DESC LIMIT ?'),
  };

  const toScan = (r) => ({
    at: r.at,
    code: r.code,
    result: r.result,
    name: r.name,
    leadId: r.lead_id,
    person: r.person ? JSON.parse(r.person) : null,
  });

  const toEntry = (r) =>
    r && {
      code: r.code,
      leadId: r.lead_id,
      name: r.name,
      stageBefore: r.stage_before,
      at: r.at,
      person: JSON.parse(r.person),
    };

  return {
    // Referenciar `db` aquí evita que Node la libere (y cierre los statements) por inactividad.
    close: () => db.close(),
    async get(code) {
      return toEntry(q.get.get(code));
    },
    async claim(e) {
      const r = q.claim.run(e.code, e.leadId, e.name, e.stageBefore, e.at, JSON.stringify(e.person));
      return Number(r.changes) === 1;
    },
    async release(code) {
      q.release.run(code);
    },
    async list(since, limit) {
      return q.list.all(since, limit).map(toEntry);
    },
    async logScan(s) {
      q.logScan.run(s.at, s.code, s.result, s.name ?? null, s.leadId ?? null, s.person ? JSON.stringify(s.person) : null);
    },
    async listScans(since, limit) {
      return q.listScans.all(since, limit).map(toScan);
    },
    async addPinFail(ts) {
      q.addFail.run(ts);
      q.cleanFails.run(ts - 24 * 3600 * 1000);
    },
    async countPinFails(since) {
      return q.countFails.get(since).n;
    },
  };
}
