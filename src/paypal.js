// PayPal REST v2 client (sandbox by default) + a clearly labelled mock with the same interface.
// Real path: OAuth2 client-credentials -> Orders v2 (approve link) or Invoicing v2 create+send (payer link).
import crypto from 'node:crypto';
import { money, lineTotalCents, fromCents } from './quote.js';

export class PayPalError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'PayPalError';
    this.status = status;
    this.body = body;
  }
}

/** PayPal wants integer quantities on Orders; fold fractional qty into a single line. */
export function toPayPalItems(quote) {
  return quote.line_items.map((it) => {
    const integerQty = Number.isInteger(it.quantity);
    const unit = integerQty ? it.unit_amount : fromCents(lineTotalCents(it));
    return {
      name: (integerQty ? it.name : `${it.name} (${it.quantity} × ${money(it.unit_amount)})`).slice(0, 127),
      description: (it.description || '').slice(0, 127),
      quantity: String(integerQty ? it.quantity : 1),
      unit_amount: { currency_code: quote.currency, value: money(unit) },
    };
  });
}

function itemTotal(items) {
  return money(items.reduce((a, it) => a + Number(it.unit_amount.value) * Number(it.quantity), 0));
}

export function buildOrderBody(quote, { returnUrl, cancelUrl, brandName, referenceId }) {
  const items = toPayPalItems(quote);
  const total = itemTotal(items);
  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: referenceId,
        description: quote.title.slice(0, 127),
        amount: { currency_code: quote.currency, value: total, breakdown: { item_total: { currency_code: quote.currency, value: total } } },
        items,
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: brandName,
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  };
}

export function buildInvoiceBody(quote, { invoicerName, note, dueDays = 7 }) {
  const items = toPayPalItems(quote).map((it) => ({ ...it, unit_of_measure: 'QUANTITY' }));
  const due = new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10);
  const body = {
    detail: {
      currency_code: quote.currency,
      note: (note || quote.scope.map((s) => `• ${s}`).join('\n')).slice(0, 4000),
      terms_and_conditions: 'Generated with PayBrief. Two revision rounds included.',
      payment_term: { due_date: due },
    },
    invoicer: { business_name: invoicerName },
    items,
  };
  if (quote.client?.email) {
    const [given, ...rest] = (quote.client.name || 'Client').split(' ');
    body.primary_recipients = [
      { billing_info: { email_address: quote.client.email, name: { given_name: given, surname: rest.join(' ') || undefined } } },
    ];
  }
  return body;
}

const linkOf = (obj, ...rels) => (obj?.links || []).find((l) => rels.includes(l.rel))?.href;

export class PayPalClient {
  constructor(cfg, fetchImpl = fetch) {
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.mode = 'sandbox-live';
    this._token = null;
    this._tokenExp = 0;
  }

  async token() {
    if (this._token && Date.now() < this._tokenExp - 60_000) return this._token;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64');
    const res = await this.fetch(`${this.cfg.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new PayPalError(`PayPal OAuth failed (${res.status})`, res.status, data);
    this._token = data.access_token;
    this._tokenExp = Date.now() + (data.expires_in || 3000) * 1000;
    return this._token;
  }

  async api(method, path, body, extraHeaders = {}) {
    const token = await this.token();
    const res = await this.fetch(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': crypto.randomUUID(),
        Prefer: 'return=representation',
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) throw new PayPalError(`PayPal ${method} ${path} -> ${res.status} ${data.name || ''} ${data.message || ''}`.trim(), res.status, data);
    return data;
  }

  async createOrder(quote, referenceId) {
    const order = await this.api('POST', '/v2/checkout/orders', buildOrderBody(quote, {
      returnUrl: this.cfg.returnUrl, cancelUrl: this.cfg.cancelUrl, brandName: this.cfg.invoicerName, referenceId,
    }));
    const payLink = linkOf(order, 'payer-action', 'approve');
    if (!payLink) throw new PayPalError('Order created but no approve link returned', 200, order);
    return { kind: 'order', paypalId: order.id, status: order.status, payLink, raw: order };
  }

  async createInvoice(quote) {
    const inv = await this.api('POST', '/v2/invoicing/invoices', buildInvoiceBody(quote, { invoicerName: this.cfg.invoicerName }));
    const id = inv.id || (linkOf(inv, 'self') || '').split('/').pop();
    if (!id) throw new PayPalError('Invoice created but no id returned', 200, inv);
    // send_to_recipient:false => PayPal does not email anyone; we still get the payer-view link.
    const sent = await this.api('POST', `/v2/invoicing/invoices/${id}/send`, {
      send_to_invoicer: false,
      send_to_recipient: Boolean(this.cfg.sendInvoiceEmail),
    });
    let payLink = sent.href || linkOf(sent, 'payer-view');
    if (!payLink) {
      const detail = await this.api('GET', `/v2/invoicing/invoices/${id}`);
      payLink = detail?.detail?.metadata?.recipient_view_url;
    }
    if (!payLink) throw new PayPalError('Invoice sent but no payer link returned', 200, sent);
    return { kind: 'invoice', paypalId: id, status: 'SENT', payLink, raw: { id, sent } };
  }

  /** Returns normalized { status, paid } and auto-captures approved orders. */
  async refreshStatus(record) {
    if (record.kind === 'order') {
      let order = await this.api('GET', `/v2/checkout/orders/${record.paypalId}`);
      if (order.status === 'APPROVED') {
        order = await this.api('POST', `/v2/checkout/orders/${record.paypalId}/capture`, {});
      }
      return { status: order.status, paid: order.status === 'COMPLETED' };
    }
    const inv = await this.api('GET', `/v2/invoicing/invoices/${record.paypalId}`);
    const status = inv.status;
    return { status, paid: ['PAID', 'MARKED_AS_PAID'].includes(status) };
  }
}

/** Offline mock: same interface, fake IDs, pay links point at a local mock checkout page. */
export class MockPayPalClient {
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.mode = 'sandbox-mock';
    this.paid = new Set();
    this.publicUrl = cfg.publicUrl || 'http://localhost:5174';
  }
  _id(prefix) { return `MOCK-${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`; }
  async createOrder(quote, referenceId) {
    const body = buildOrderBody(quote, { returnUrl: '', cancelUrl: '', brandName: this.cfg.invoicerName, referenceId });
    const id = this._id('ORDER');
    return { kind: 'order', paypalId: id, status: 'PAYER_ACTION_REQUIRED', payLink: `${this.publicUrl}/mock-paypal/${id}`, raw: { mock: true, request: body } };
  }
  async createInvoice(quote) {
    const body = buildInvoiceBody(quote, { invoicerName: this.cfg.invoicerName });
    const id = this._id('INV');
    return { kind: 'invoice', paypalId: id, status: 'SENT', payLink: `${this.publicUrl}/mock-paypal/${id}`, raw: { mock: true, request: body } };
  }
  markPaid(paypalId) { this.paid.add(paypalId); }
  async refreshStatus(record) {
    const paid = this.paid.has(record.paypalId);
    if (record.kind === 'order') return { status: paid ? 'COMPLETED' : 'PAYER_ACTION_REQUIRED', paid };
    return { status: paid ? 'PAID' : 'SENT', paid };
  }
}

export function createPayPal(cfg, fetchImpl) {
  return cfg.mode === 'sandbox-live' ? new PayPalClient(cfg, fetchImpl) : new MockPayPalClient(cfg);
}
