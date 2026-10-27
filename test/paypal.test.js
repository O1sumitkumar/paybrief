import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PayPalClient, MockPayPalClient, PayPalError, toPayPalItems, buildOrderBody } from '../src/paypal.js';

const quote = {
  title: 'Landing page',
  client: { name: 'Priya Shah', email: 'priya@example.com' },
  scope: ['Landing page', 'Logo'],
  line_items: [
    { name: 'Build', description: 'd', quantity: 2, unit_amount: 100 },
    { name: 'Hours', description: '', quantity: 1.5, unit_amount: 40 },
  ],
  currency: 'USD',
  total: 260,
  assumptions: [],
};
const cfg = { clientId: 'cid', clientSecret: 'sec', baseUrl: 'https://api-m.sandbox.paypal.com', invoicerName: 'AonHive', returnUrl: 'http://r', cancelUrl: 'http://c' };

/** Fake PayPal HTTP: records calls and routes by method+path. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || 'GET'} ${u.pathname}`;
    calls.push({ key, init, body: init.body });
    const route = routes[key];
    if (!route) return { ok: false, status: 404, json: async () => ({}), text: async () => '{"name":"NOT_FOUND"}' };
    const [status, data] = typeof route === 'function' ? route(init) : route;
    return { ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) };
  };
  fn.calls = calls;
  return fn;
}
const OAUTH = { 'POST /v1/oauth2/token': [200, { access_token: 'tok', expires_in: 32400 }] };

test('fractional quantities are folded into integer PayPal items with matching total', () => {
  const items = toPayPalItems(quote);
  assert.equal(items[1].quantity, '1');
  assert.equal(items[1].unit_amount.value, '60.00');
  const body = buildOrderBody(quote, { referenceId: 'pb_1' });
  assert.equal(body.purchase_units[0].amount.value, '260.00');
  assert.equal(body.purchase_units[0].amount.breakdown.item_total.value, '260.00');
});

test('OAuth client-credentials uses Basic auth and caches the token', async () => {
  const f = fakeFetch({ ...OAUTH, 'POST /v2/checkout/orders': [201, { id: 'O1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=O1' }] }] });
  const pp = new PayPalClient(cfg, f);
  await pp.createOrder(quote, 'pb_1');
  await pp.createOrder(quote, 'pb_2');
  const oauth = f.calls.filter((c) => c.key === 'POST /v1/oauth2/token');
  assert.equal(oauth.length, 1);
  assert.equal(oauth[0].init.headers.Authorization, `Basic ${Buffer.from('cid:sec').toString('base64')}`);
  assert.equal(oauth[0].body, 'grant_type=client_credentials');
});

test('createOrder posts Orders v2 and returns approve link', async () => {
  const f = fakeFetch({ ...OAUTH, 'POST /v2/checkout/orders': [201, { id: 'O1', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=O1' }] }] });
  const r = await new PayPalClient(cfg, f).createOrder(quote, 'pb_1');
  assert.equal(r.paypalId, 'O1');
  assert.match(r.payLink, /sandbox\.paypal\.com/);
  const call = f.calls.find((c) => c.key === 'POST /v2/checkout/orders');
  assert.equal(call.init.headers.Authorization, 'Bearer tok');
  assert.ok(call.init.headers['PayPal-Request-Id']);
  assert.equal(JSON.parse(call.body).intent, 'CAPTURE');
});

test('createInvoice creates, sends without emailing, and returns payer-view link', async () => {
  const f = fakeFetch({
    ...OAUTH,
    'POST /v2/invoicing/invoices': [201, { id: 'INV2-AAA', status: 'DRAFT' }],
    'POST /v2/invoicing/invoices/INV2-AAA/send': [200, { href: 'https://www.sandbox.paypal.com/invoice/p/#INV2-AAA', rel: 'payer-view', method: 'GET' }],
  });
  const r = await new PayPalClient(cfg, f).createInvoice(quote);
  assert.equal(r.paypalId, 'INV2-AAA');
  assert.match(r.payLink, /invoice\/p/);
  const create = JSON.parse(f.calls.find((c) => c.key === 'POST /v2/invoicing/invoices').body);
  assert.equal(create.primary_recipients[0].billing_info.email_address, 'priya@example.com');
  assert.equal(create.items.length, 2);
  const send = JSON.parse(f.calls.find((c) => c.key.endsWith('/send')).body);
  assert.equal(send.send_to_recipient, false);
});

test('approved orders are auto-captured on status refresh', async () => {
  const f = fakeFetch({ ...OAUTH, 'GET /v2/checkout/orders/O1': [200, { id: 'O1', status: 'APPROVED' }], 'POST /v2/checkout/orders/O1/capture': [201, { id: 'O1', status: 'COMPLETED' }] });
  const st = await new PayPalClient(cfg, f).refreshStatus({ kind: 'order', paypalId: 'O1' });
  assert.deepEqual(st, { status: 'COMPLETED', paid: true });
});

test('invoice status maps PAID to paid', async () => {
  const f = fakeFetch({ ...OAUTH, 'GET /v2/invoicing/invoices/I1': [200, { id: 'I1', status: 'PAID' }] });
  assert.equal((await new PayPalClient(cfg, f).refreshStatus({ kind: 'invoice', paypalId: 'I1' })).paid, true);
});

test('PayPal errors surface as PayPalError (bad creds / API errors)', async () => {
  await assert.rejects(new PayPalClient(cfg, fakeFetch({ 'POST /v1/oauth2/token': [401, { error: 'invalid_client' }] })).createOrder(quote, 'x'), PayPalError);
  await assert.rejects(new PayPalClient(cfg, fakeFetch({ ...OAUTH, 'POST /v2/checkout/orders': [422, { name: 'UNPROCESSABLE_ENTITY' }] })).createOrder(quote, 'x'), /422/);
});

test('mock client mimics the interface and flips to paid', async () => {
  const m = new MockPayPalClient({ publicUrl: 'http://localhost:1' });
  const r = await m.createInvoice(quote);
  assert.match(r.paypalId, /^MOCK-INV-/);
  assert.equal(r.payLink, `http://localhost:1/mock-paypal/${r.paypalId}`);
  assert.equal((await m.refreshStatus(r)).paid, false);
  m.markPaid(r.paypalId);
  assert.deepEqual(await m.refreshStatus(r), { status: 'PAID', paid: true });
});
