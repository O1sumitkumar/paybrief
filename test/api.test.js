// End-to-end over HTTP in mock mode: brief -> quote -> pay link -> mock pay / reminder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config.js';
import { JsonStore } from '../src/store.js';
import { MockPayPalClient } from '../src/paypal.js';
import { createAI } from '../src/ai.js';
import { ReminderAgent } from '../src/reminders.js';

let server, base;
before(async () => {
  const config = getConfig({});
  const store = new JsonStore(null);
  const paypal = new MockPayPalClient({ publicUrl: 'http://x' });
  const ai = createAI({ mode: 'mock' });
  const agent = new ReminderAgent({ store, paypal, ai, delayMs: 60_000 });
  server = createApp({ config, store, paypal, ai, agent }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('full brief -> quote -> invoice -> reminder -> paid path', async () => {
  const h = await (await fetch(base + '/api/health')).json();
  assert.equal(h.paypal, 'sandbox-mock');
  const q = await (await post('/api/quote', { brief: 'Need a landing page and SEO for my bakery, sam@bakery.com' })).json();
  assert.ok(q.quote.total > 0);
  const payRes = await post('/api/pay', { quote: q.quote, kind: 'invoice' });
  assert.equal(payRes.status, 201);
  const rec = await payRes.json();
  assert.match(rec.payLink, /mock-paypal\/MOCK-INV-/);
  const r1 = await (await post('/api/reminders/run', { fastForwardSeconds: 120 })).json();
  assert.deepEqual(r1.nudged, [rec.id]);
  await post(`/mock-paypal/${rec.paypalId}/pay`, {});
  const r2 = await (await post('/api/reminders/run', {})).json();
  assert.deepEqual(r2.newlyPaid, [rec.id]);
});

test('guardrails reject tampered quotes server-side', async () => {
  const res = await post('/api/pay', { quote: { title: 'x', scope: ['x'], currency: 'USD', total: 1, line_items: [{ name: 'x', quantity: 1, unit_amount: 999999 }] } });
  assert.equal(res.status, 422);
  assert.equal((await post('/api/quote', { brief: 'hi' })).status, 400);
});
