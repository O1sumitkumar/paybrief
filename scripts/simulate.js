// `npm run simulate`: brief -> AI quote -> PayPal invoice + order -> reminder agent -> paid, end-to-end.
// Forces MOCK mode (no network, no money, no emails) unless SIMULATE_LIVE=1, in which case it uses
// PAYPAL_CLIENT_ID/SECRET (+ OPENAI_API_KEY) from env against api-m.sandbox.paypal.com.
import { getConfig } from '../src/config.js';
import { createAI } from '../src/ai.js';
import { createPayPal, MockPayPalClient, buildInvoiceBody, buildOrderBody } from '../src/paypal.js';
import { JsonStore } from '../src/store.js';
import { ReminderAgent } from '../src/reminders.js';
import { money } from '../src/quote.js';

const live = process.env.SIMULATE_LIVE === '1';
const env = live ? process.env : { ...process.env, PAYPAL_FORCE_MOCK: '1', AI_FORCE_MOCK: '1' };
const cfg = getConfig(env);
const ai = createAI(cfg.ai);
const paypal = createPayPal(cfg.paypal);
const store = new JsonStore(null); // in-memory only
const agent = new ReminderAgent({ store, paypal, ai, delayMs: 60_000, maxNudges: 3 });
const hr = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`);
const checks = [];
const check = (name, ok) => { checks.push([name, Boolean(ok)]); };

console.log(`PayBrief simulate | AI: ${ai.mode} | PayPal: ${paypal.mode}${paypal.mode === 'sandbox-mock' ? ' (sandbox mock — no real API calls)' : ` (${cfg.paypal.baseUrl})`}`);

const briefs = [
  { kind: 'invoice', text: "Hi, I'm Priya Shah from Bloom Bakery (priya@bloombakery.example). We need a landing page where customers can order cakes online, plus a refreshed logo. ASAP before Diwali." },
  { kind: 'order', text: 'Hello, Marco Rossi here (marco@rossiarch.example). Our architecture studio wants a new website with SEO, in EUR please.' },
];

const now0 = Date.now();
for (const [i, b] of briefs.entries()) {
  hr(`${i + 1}a. Brief -> AI quote`);
  console.log(`brief: ${b.text}`);
  const { quote, warnings, source } = await ai.generateQuote(b.text);
  console.log(`source=${source}  title="${quote.title}"  client=${quote.client.name || '-'} <${quote.client.email || '-'}>`);
  quote.scope.forEach((s) => console.log(`  • ${s}`));
  quote.line_items.forEach((it) => console.log(`  ${it.name.padEnd(38)} ${String(it.quantity).padStart(3)} × ${money(it.unit_amount).padStart(9)}`));
  const sum = quote.line_items.reduce((s, it) => s + Math.round(it.unit_amount * 100) * it.quantity, 0) / 100;
  console.log(`  TOTAL ${money(quote.total)} ${quote.currency}  (sum of lines ${money(sum)})  warnings=${warnings.length}`);
  check(`quote ${i + 1} total == sum of line items`, money(sum) === money(quote.total));

  hr(`${i + 1}b. Quote -> PayPal ${b.kind === 'invoice' ? 'Invoicing v2 (create draft + send)' : 'Orders v2 (CAPTURE)'}`);
  const body = b.kind === 'invoice' ? buildInvoiceBody(quote, { invoicerName: cfg.paypal.invoicerName }) : buildOrderBody(quote, { returnUrl: cfg.paypal.returnUrl, cancelUrl: cfg.paypal.cancelUrl, brandName: cfg.paypal.invoicerName });
  console.log(`request: ${b.kind === 'invoice' ? `POST /v2/invoicing/invoices items=${body.items.length} currency=${body.detail.currency_code} recipient=${body.primary_recipients?.[0]?.billing_info?.email_address || '-'}` : `POST /v2/checkout/orders intent=${body.intent} amount=${body.purchase_units[0].amount.value} ${body.purchase_units[0].amount.currency_code}`}`);
  const created = b.kind === 'invoice' ? await paypal.createInvoice(quote) : await paypal.createOrder(quote, `pb_sim_${i}`);
  console.log(`-> ${created.kind} ${created.paypalId} status=${created.status}`);
  console.log(`-> pay link: ${created.payLink}`);
  check(`${b.kind} pay link returned`, created.payLink);
  store.insert({ id: `pb_sim_${i}`, kind: created.kind, paypalId: created.paypalId, payLink: created.payLink, status: created.status, paypalMode: paypal.mode, paid: false, quote, brief: b.text, nudges: [], createdAt: new Date(now0).toISOString() });
}

hr('3. Reminder agent tick @ +0s (inside 60s grace)');
const t0 = await agent.tick(now0 + 1_000);
console.log(`checked=${t0.checked} nudged=${t0.nudged.length} paid=${t0.newlyPaid.length}`);
check('no nudge before delay', t0.nudged.length === 0);

hr('4. Reminder agent tick @ +2 days (fast-forward)');
const t1 = await agent.tick(now0 + 2 * 86400_000);
console.log(`checked=${t1.checked} nudged=${t1.nudged.join(', ')} errors=${t1.errors.length}`);
for (const rec of store.all()) {
  const n = rec.nudges.at(-1);
  if (!n) continue;
  console.log(`\n--- draft for ${rec.id} (${rec.kind}, delivered=${n.delivered}, source=${n.source})\nSubject: ${n.subject}\n${n.body}`);
}
check('both unpaid records got a draft nudge', t1.nudged.length === 2);
check('nudges are drafts only (delivered=false)', store.all().every((r) => r.nudges.every((n) => n.delivered === false)));
check('nudge contains pay link', store.all().every((r) => r.nudges.every((n) => n.body.includes(r.payLink))));

hr('5. Client pays the invoice -> agent stops nudging it');
const inv = store.get('pb_sim_0');
if (paypal instanceof MockPayPalClient) paypal.markPaid(inv.paypalId);
else console.log('(live mode: pay the invoice link with a sandbox buyer account, then re-run)');
const t2 = await agent.tick(now0 + 4 * 86400_000);
console.log(`newlyPaid=${t2.newlyPaid.join(', ') || '-'} nudged=${t2.nudged.join(', ') || '-'}`);
if (paypal instanceof MockPayPalClient) {
  check('invoice detected as paid', t2.newlyPaid.includes('pb_sim_0'));
  check('paid invoice not nudged again', !t2.nudged.includes('pb_sim_0') && store.get('pb_sim_0').nudges.length === 1);
  check('still-unpaid order nudged again', t2.nudged.includes('pb_sim_1'));
}

hr('Result');
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
const failed = checks.filter(([, ok]) => !ok).length;
console.log(`\nSIMULATE ${failed ? 'FAIL' : 'PASS'} — ${checks.length - failed}/${checks.length} checks · PayPal ${paypal.mode} · AI ${ai.mode} · nothing sent, nothing charged`);
process.exit(failed ? 1 : 0);
