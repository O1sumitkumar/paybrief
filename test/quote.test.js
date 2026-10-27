import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateQuote, GuardrailError } from '../src/quote.js';
import { createAI, mockQuote, extractJSON } from '../src/ai.js';

const good = {
  title: 'Landing page',
  client: { name: 'Priya', email: 'priya@example.com' },
  scope: ['Responsive landing page'],
  line_items: [{ name: 'Build', description: '', quantity: 2, unit_amount: 100.004 }],
  currency: 'USD',
  total: 200,
};

test('valid quote passes and money is rounded to cents', () => {
  const { quote, warnings } = validateQuote(good);
  assert.equal(quote.total, 200);
  assert.equal(quote.line_items[0].unit_amount, 100);
  assert.deepEqual(warnings, []);
});

test('total mismatch is corrected from line items with a warning', () => {
  const { quote, warnings } = validateQuote({ ...good, total: 999 });
  assert.equal(quote.total, 200);
  assert.match(warnings[0], /corrected/);
});

test('schema errors are rejected (missing scope, bad currency, bad email)', () => {
  assert.throws(() => validateQuote({ ...good, scope: [] }), GuardrailError);
  assert.throws(() => validateQuote({ ...good, currency: 'BTC' }), GuardrailError);
  assert.throws(() => validateQuote({ ...good, client: { name: 'x', email: 'nope' } }), GuardrailError);
});

test('absurd amounts are blocked by guardrails', () => {
  assert.throws(
    () => validateQuote({ ...good, line_items: [{ name: 'x', quantity: 1, unit_amount: 75_000 }], total: 75_000 }),
    (e) => e instanceof GuardrailError && /exceeds cap/.test(e.details[0]),
  );
});

test('mock generator is deterministic, labelled and schema-valid', async () => {
  const brief = 'I am Priya Shah (priya@bloom.in). Need a landing page and logo, EUR please';
  assert.deepEqual(mockQuote(brief), mockQuote(brief));
  const ai = createAI({ mode: 'mock' });
  const r = await ai.generateQuote(brief);
  assert.equal(r.source, 'mock');
  assert.equal(r.quote.currency, 'EUR');
  assert.equal(r.quote.client.email, 'priya@bloom.in');
  assert.ok(r.quote.assumptions[0].includes('[MOCK AI]'));
  assert.ok(r.quote.line_items.length >= 3);
});

test('live AI path parses OpenAI-compatible response and validates it', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '```json\n' + JSON.stringify({ ...good, total: 1 }) + '\n```' } }] }) };
  };
  const ai = createAI({ mode: 'live', apiKey: 'k', baseUrl: 'https://llm.test/v1', model: 'm' }, fetchImpl);
  const r = await ai.generateQuote('Need a landing page please');
  assert.equal(sent.url, 'https://llm.test/v1/chat/completions');
  assert.equal(sent.body.response_format.type, 'json_object');
  assert.equal(sent.auth, 'Bearer k');
  assert.equal(r.source, 'live');
  assert.equal(r.quote.total, 200);
  assert.equal(r.warnings.length, 1);
});

test('live AI failure falls back to labelled mock so the demo never dead-ends', async () => {
  const ai = createAI({ mode: 'live', apiKey: 'k', baseUrl: 'x', model: 'm' }, async () => ({ ok: false, status: 500, text: async () => 'boom' }));
  const r = await ai.generateQuote('Need a landing page please');
  assert.match(r.source, /^mock-fallback/);
});

test('short briefs are rejected; extractJSON handles fenced JSON', async () => {
  await assert.rejects(createAI({ mode: 'mock' }).generateQuote('hi'));
  assert.deepEqual(extractJSON('here: {"a":1} ok'), { a: 1 });
});
