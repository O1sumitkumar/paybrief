// Reminder agent: polls PayPal status for open records and drafts AI nudges for overdue unpaid ones.
// It NEVER sends email — drafts are stored and shown in the UI for a human to copy/send.

/** Pure decision: should we draft a nudge for this record at time `now`? */
export function needsNudge(record, now, { delayMs, maxNudges = 3 }) {
  if (record.paid) return false;
  const nudges = record.nudges || [];
  if (nudges.length >= maxNudges) return false;
  const last = nudges.length ? Date.parse(nudges[nudges.length - 1].createdAt) : Date.parse(record.createdAt);
  return now - last >= delayMs;
}

export class ReminderAgent {
  constructor({ store, paypal, ai, delayMs = 60_000, maxNudges = 3, intervalMs = 15_000, log = () => {} }) {
    Object.assign(this, { store, paypal, ai, delayMs, maxNudges, intervalMs, log });
    this.timer = null;
    this.lastRunAt = null;
  }

  async tick(now = Date.now()) {
    const summary = { checked: 0, newlyPaid: [], nudged: [], errors: [] };
    for (const rec of this.store.all()) {
      if (rec.paid) continue;
      summary.checked++;
      try {
        const st = await this.paypal.refreshStatus(rec);
        const patch = { status: st.status, lastCheckedAt: new Date(now).toISOString() };
        if (st.paid) {
          Object.assign(patch, { paid: true, paidAt: new Date(now).toISOString() });
          summary.newlyPaid.push(rec.id);
        }
        this.store.update(rec.id, patch);
        const fresh = this.store.get(rec.id);
        if (needsNudge(fresh, now, { delayMs: this.delayMs, maxNudges: this.maxNudges })) {
          const draft = await this.ai.draftNudge(fresh);
          const nudge = { ...draft, createdAt: new Date(now).toISOString(), delivered: false };
          this.store.update(rec.id, { nudges: [...(fresh.nudges || []), nudge] });
          summary.nudged.push(rec.id);
          this.log(`[reminder] drafted nudge #${(fresh.nudges || []).length + 1} for ${rec.id}`);
        }
      } catch (e) {
        summary.errors.push({ id: rec.id, error: e.message });
        this.log(`[reminder] ${rec.id}: ${e.message}`);
      }
    }
    this.lastRunAt = new Date(now).toISOString();
    return summary;
  }

  start() {
    if (this.timer || this.intervalMs <= 0) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), this.intervalMs);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}
