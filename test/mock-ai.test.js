import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockQuote, mockNudge } from '../src/ai.js';
import { validateQuote } from '../src/quote.js';

test('mock AI: full website replaces landing page, picks client name and currency', () => {
  const q = mockQuote('Hello, Marco Rossi here (marco@rossi.example). We want a new website with SEO, EUR please.');
  const names = q.line_items.map((i) => i.name);
  assert.ok(names.includes('Website design + build'));
  assert.ok(!names.includes('Landing page design + build'));
  assert.equal(q.client.name, 'Marco Rossi');
  assert.equal(q.currency, 'EUR');
  assert.doesNotThrow(() => validateQuote(q, { strictTotal: true }));
});

test('mock AI: word-boundary keywords do not false-trigger (email/happy/rapid)', () => {
  const q = mockQuote("I'm happy to get a rapid landing page, email me at a@b.co");
  const names = q.line_items.map((i) => i.name);
  assert.ok(!names.includes('AI assistant integration'));
  assert.ok(!names.includes('Mobile app MVP screens'));
  assert.ok(!names.includes('Backend / integration work'));
});

test('mock nudge greets by first name and carries the pay link verbatim', () => {
  const n = mockNudge({ payLink: 'https://www.sandbox.paypal.com/invoice/p/#INV2-X', quote: { title: 'Logo', currency: 'USD', total: 650, client: { name: 'Priya Shah' } } });
  assert.match(n.body, /^Hi Priya,/);
  assert.ok(n.body.includes('https://www.sandbox.paypal.com/invoice/p/#INV2-X'));
});
