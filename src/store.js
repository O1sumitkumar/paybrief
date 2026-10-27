// Tiny JSON-file store for payment records (atomic write via rename).
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(file) {
    this.file = file;
    this.records = [];
    if (file && fs.existsSync(file)) {
      try { this.records = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.records = []; }
    }
  }
  _save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.records, null, 2));
    fs.renameSync(tmp, this.file);
  }
  all() { return [...this.records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id) { return this.records.find((r) => r.id === id); }
  findByPayPalId(pid) { return this.records.find((r) => r.paypalId === pid); }
  insert(rec) { this.records.push(rec); this._save(); return rec; }
  update(id, patch) {
    const r = this.get(id);
    if (!r) return null;
    Object.assign(r, patch, { updatedAt: new Date().toISOString() });
    this._save();
    return r;
  }
}
