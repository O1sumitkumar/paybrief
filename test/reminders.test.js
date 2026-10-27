import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsNudge, ReminderAgent } from '../src/reminders.js';
import { JsonStore } from '../src/store.js';
import { MockPayPalClient } from '../src/paypal.js';
import { createAI } from '../src/ai.js';

const T0 = Date.parse('2026-10-27T00:00:00Z');
const quote = { title: 'Site', client: { name: 'Priya', email: '' }, scope: ['x'], line_items: [{ name: 'a', quantity: 1, unit_amount: 100 }], currency: 'USD', total: 100, assumptions: [] };
const rec = (over = {}) => ({ id: 'pb_1', kind: 'invoice', paypalId: 'MOCK-INV-1', payLink: 'http://pay/1', status: 'SENT', paid: false, quote, nudges: [], createdAt: new Date(T0).toISOString(), ...over });

test('needsNudge respects delay, paid state, and max nudges', () => {
  const o = { delayMs: 60_000, maxNudges: 2 };
  assert.equal(needsNudge(rec(), T0 + 59_000, o), false);
  assert.equal(needsNudge(rec(), T0 + 60_000, o), true);
  assert.equal(needsNudge(rec({ paid: true }), T0 + 1e9, o), false);
  const one = rec({ nudges: [{ createdAt: new Date(T0 + 60_000).toISOString() }] });
  assert.equal(needsNudge(one, T0 + 100_000, o), false, 'delay counts from last nudge');
  assert.equal(needsNudge(one, T0 + 120_000, o), true);
  const two = rec({ nudges: [{ createdAt: new Date(T0).toISOString() }, { createdAt: new Date(T0).toISOString() }] });
  assert.equal(needsNudge(two, T0 + 1e9, o), false);
});

function setup() {
  const store = new JsonStore(null);
  const paypal = new MockPayPalClient();
  const agent = new ReminderAgent({ store, paypal, ai: createAI({ mode: 'mock' }), delayMs: 60_000, maxNudges: 3 });
  store.insert(rec());
  return { store, paypal, agent };
}

test('agent drafts a polite nudge (with pay link) only after the delay, never sends', async () => {
  const { store, agent } = setup();
  let s = await agent.tick(T0 + 10_000);
  assert.deepEqual(s.nudged, []);
  s = await agent.tick(T0 + 61_000);
  assert.deepEqual(s.nudged, ['pb_1']);
  const n = store.get('pb_1').nudges[0];
  assert.match(n.body, /http:\/\/pay\/1/);
  assert.match(n.body, /USD 100\.00/);
  assert.equal(n.delivered, false);
  s = await agent.tick(T0 + 62_000);
  assert.deepEqual(s.nudged, [], 'no duplicate nudge inside the delay window');
});

test('agent detects payment and stops nudging', async () => {
  const { store, paypal, agent } = setup();
  paypal.markPaid('MOCK-INV-1');
  const s = await agent.tick(T0 + 1e9);
  assert.deepEqual(s.newlyPaid, ['pb_1']);
  assert.deepEqual(s.nudged, []);
  assert.equal(store.get('pb_1').paid, true);
  assert.equal(store.get('pb_1').status, 'PAID');
  assert.equal((await agent.tick(T0 + 2e9)).checked, 0);
});

test('agent records PayPal errors without crashing', async () => {
  const { agent } = setup();
  agent.paypal = { refreshStatus: async () => { throw new Error('PayPal down'); } };
  const s = await agent.tick(T0 + 1e9);
  assert.equal(s.errors[0].error, 'PayPal down');
});
