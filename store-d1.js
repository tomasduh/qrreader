// Almacén para Cloudflare: base D1 (SQLite administrado). El esquema está en
// migrations/0001_init.sql.
export function d1Store(db) {
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
    async get(code) {
      return toEntry(await db.prepare('SELECT * FROM entries WHERE code = ?').bind(code).first());
    },
    async claim(e) {
      const r = await db
        .prepare(
          'INSERT OR IGNORE INTO entries (code, lead_id, name, stage_before, at, person) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(e.code, e.leadId, e.name, e.stageBefore, e.at, JSON.stringify(e.person))
        .run();
      return r.meta.changes === 1;
    },
    async release(code) {
      await db.prepare('DELETE FROM entries WHERE code = ?').bind(code).run();
    },
    async list(since, limit) {
      const r = await db
        .prepare('SELECT * FROM entries WHERE at >= ? ORDER BY at DESC LIMIT ?')
        .bind(since, limit)
        .all();
      return r.results.map(toEntry);
    },
    async logScan(s) {
      await db
        .prepare('INSERT INTO scans (at, code, result, name, lead_id, person) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(s.at, s.code, s.result, s.name ?? null, s.leadId ?? null, s.person ? JSON.stringify(s.person) : null)
        .run();
    },
    async listScans(since, limit) {
      const r = await db
        .prepare('SELECT * FROM scans WHERE at >= ? ORDER BY at DESC, id DESC LIMIT ?')
        .bind(since, limit)
        .all();
      return r.results.map((x) => ({
        at: x.at,
        code: x.code,
        result: x.result,
        name: x.name,
        leadId: x.lead_id,
        person: x.person ? JSON.parse(x.person) : null,
      }));
    },
    async addPinFail(ts) {
      await db.batch([
        db.prepare('INSERT INTO pin_fails (ts) VALUES (?)').bind(ts),
        db.prepare('DELETE FROM pin_fails WHERE ts < ?').bind(ts - 24 * 3600 * 1000),
      ]);
    },
    async countPinFails(since) {
      const r = await db.prepare('SELECT COUNT(*) AS n FROM pin_fails WHERE ts >= ?').bind(since).first();
      return r?.n ?? 0;
    },
  };
}
