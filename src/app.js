// Express app factory (dependency-injected so tests can swap PayPal/AI/store).
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { validateQuote, GuardrailError, money } from './quote.js';
import { PayPalError } from './paypal.js';

const PayBody = z.object({
  quote: z.unknown(),
  kind: z.enum(['order', 'invoice']).default('invoice'),
  brief: z.string().max(4000).optional(),
});

export function createApp({ config, store, paypal, ai, agent, staticDir }) {
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false }));

  const fail = (res, e) => {
    if (e instanceof GuardrailError) return res.status(422).json({ error: e.message, details: e.details });
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'Bad request', details: e.issues });
    if (e instanceof PayPalError) return res.status(502).json({ error: e.message, paypal: e.body?.details || e.body?.error_description || null });
    return res.status(400).json({ error: e.message });
  };

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      ai: ai.mode,
      paypal: paypal.mode,
      paypalBaseUrl: paypal.mode === 'sandbox-live' ? config.paypal.baseUrl : null,
      reminder: { delaySeconds: agent.delayMs / 1000, pollSeconds: agent.intervalMs / 1000, lastRunAt: agent.lastRunAt },
    });
  });

  app.post('/api/quote', async (req, res) => {
    try {
      const { brief } = z.object({ brief: z.string().min(10).max(4000) }).parse(req.body);
      res.json(await ai.generateQuote(brief));
    } catch (e) { fail(res, e); }
  });

  app.post('/api/quote/validate', (req, res) => {
    try { res.json(validateQuote(req.body.quote)); } catch (e) { fail(res, e); }
  });

  app.post('/api/pay', async (req, res) => {
    try {
      const body = PayBody.parse(req.body);
      const { quote } = validateQuote(body.quote); // guardrails re-checked server-side before money moves
      const id = `pb_${crypto.randomBytes(4).toString('hex')}`;
      const created = body.kind === 'order' ? await paypal.createOrder(quote, id) : await paypal.createInvoice(quote);
      const rec = store.insert({
        id,
        kind: created.kind,
        paypalId: created.paypalId,
        payLink: created.payLink,
        status: created.status,
        paypalMode: paypal.mode,
        paid: false,
        quote,
        brief: body.brief || '',
        nudges: [],
        createdAt: new Date().toISOString(),
      });
      res.status(201).json(rec);
    } catch (e) { fail(res, e); }
  });

  app.get('/api/payments', (_req, res) => res.json(store.all()));

  app.post('/api/payments/:id/refresh', async (req, res) => {
    const rec = store.get(req.params.id);
    if (!rec) return res.status(404).json({ error: 'not found' });
    try {
      const st = await paypal.refreshStatus(rec);
      res.json(store.update(rec.id, { status: st.status, paid: st.paid || rec.paid, paidAt: st.paid && !rec.paid ? new Date().toISOString() : rec.paidAt, lastCheckedAt: new Date().toISOString() }));
    } catch (e) { fail(res, e); }
  });

  // Run the reminder agent now. fastForwardSeconds lets the demo skip waiting for the delay.
  app.post('/api/reminders/run', async (req, res) => {
    try {
      const ff = Math.max(0, Math.min(Number(req.body?.fastForwardSeconds || 0), 30 * 86400));
      const summary = await agent.tick(Date.now() + ff * 1000);
      res.json({ ...summary, payments: store.all() });
    } catch (e) { fail(res, e); }
  });

  // ---- Mock checkout (only exists in mock mode) ----
  if (paypal.mode === 'sandbox-mock') {
    app.get('/mock-paypal/:pid', (req, res) => {
      const rec = store.findByPayPalId(req.params.pid);
      if (!rec) return res.status(404).send('Unknown mock payment');
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock PayPal checkout</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f7fa;display:grid;place-items:center;min-height:100vh;margin:0}.c{background:#fff;padding:32px;border-radius:16px;box-shadow:0 8px 30px #0001;max-width:420px;width:90%}
.b{background:#ffc439;border:0;border-radius:24px;padding:14px;width:100%;font-weight:700;font-size:16px;cursor:pointer}.m{background:#fee;color:#a00;padding:6px 10px;border-radius:8px;font-size:12px;display:inline-block}</style></head>
<body><div class="c"><span class="m">MOCK MODE — no real PayPal call, no money moves</span><h2 style="color:#003087">PayPal<span style="color:#009cde">checkout</span></h2>
<p><b>${esc(rec.quote.title)}</b></p><p style="font-size:28px;margin:8px 0">${esc(rec.quote.currency)} ${money(rec.quote.total)}</p><p style="color:#666">${esc(rec.kind)} ${esc(rec.paypalId)}</p>
<form method="post" action="/mock-paypal/${esc(rec.paypalId)}/pay"><button class="b">Pay now</button></form></div></body></html>`);
    });
    app.post('/mock-paypal/:pid/pay', (req, res) => {
      const rec = store.findByPayPalId(req.params.pid);
      if (!rec) return res.status(404).json({ error: 'not found' });
      paypal.markPaid(rec.paypalId);
      if (req.is('application/json')) return res.json({ ok: true });
      res.redirect('/?paid=1');
    });
  }

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^\/(?!api\/|mock-paypal\/).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }
  return app;
}
