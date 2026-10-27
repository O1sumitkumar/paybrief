import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const SAMPLES = [
  'Hi, I am Priya Shah (priya@bloomcafe.in). We need a landing page and a logo for Bloom Cafe, plus basic SEO. Launch in 3 weeks. Budget in USD.',
  'Client: Marco Rossi, marco@rossi.eu — we want an online store with PayPal checkout and a blog for our wine shop. Prices in EUR please.',
  'Urgent: need an AI chatbot on our existing site for customer FAQs plus a small admin dashboard. Contact dan@acme.io',
];
const fmt = (n, c) => `${c} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ago = (iso) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

function Badge({ tone, children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function QuoteCard({ msg, onPay, busy }) {
  const [q, setQ] = useState(msg.quote);
  const total = q.line_items.reduce((a, it) => a + Number(it.quantity) * Number(it.unit_amount), 0);
  const setItem = (i, k, v) => setQ({ ...q, line_items: q.line_items.map((it, j) => (j === i ? { ...it, [k]: k === 'name' ? v : Number(v) } : it)) });
  const locked = Boolean(msg.payment);
  return (
    <div className="quote">
      <div className="quote-head">
        <div>
          <h3>{q.title}</h3>
          {q.client?.name || q.client?.email ? <div className="muted">{[q.client.name, q.client.email].filter(Boolean).join(' · ')}</div> : null}
        </div>
        <Badge tone={msg.source === 'live' ? 'ok' : 'warn'}>{msg.source === 'live' ? 'AI · live' : `AI · ${msg.source}`}</Badge>
      </div>
      <div className="label">Scope</div>
      <ul className="scope">{q.scope.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <div className="label">Line items {locked ? '' : <span className="muted">(editable)</span>}</div>
      <table>
        <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Total</th></tr></thead>
        <tbody>
          {q.line_items.map((it, i) => (
            <tr key={i}>
              <td>{locked ? it.name : <input value={it.name} onChange={(e) => setItem(i, 'name', e.target.value)} />}<div className="muted small">{it.description}</div></td>
              <td className="num">{locked ? it.quantity : <input className="n" type="number" min="0" step="0.5" value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} />}</td>
              <td className="num">{locked ? it.unit_amount : <input className="n" type="number" min="0" value={it.unit_amount} onChange={(e) => setItem(i, 'unit_amount', e.target.value)} />}</td>
              <td className="num">{fmt(it.quantity * it.unit_amount, q.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan="3">Total</td><td className="num strong">{fmt(total, q.currency)}</td></tr></tfoot>
      </table>
      {msg.warnings?.length ? <div className="note warn">{msg.warnings.join(' · ')}</div> : null}
      {q.assumptions?.length ? <div className="muted small assumptions">{q.assumptions.join(' · ')}</div> : null}
      {!locked ? (
        <div className="actions">
          <button className="pp" disabled={busy} onClick={() => onPay(msg.id, { ...q, total }, 'invoice')}>Create PayPal invoice</button>
          <button className="ghost" disabled={busy} onClick={() => onPay(msg.id, { ...q, total }, 'order')}>PayPal checkout link</button>
        </div>
      ) : (
        <div className="paylink">
          <div>
            <div className="label">{msg.payment.kind === 'order' ? 'PayPal order' : 'PayPal invoice'} · {msg.payment.paypalId}</div>
            <a href={msg.payment.payLink} target="_blank" rel="noreferrer">{msg.payment.payLink}</a>
          </div>
          <button className="ghost" onClick={() => navigator.clipboard?.writeText(msg.payment.payLink)}>Copy</button>
        </div>
      )}
    </div>
  );
}

function Payments({ payments, onRun, onRefresh, running, health }) {
  const [open, setOpen] = useState(null);
  return (
    <aside className="panel">
      <div className="panel-head">
        <div>
          <h2>Reminder agent</h2>
          <div className="muted small">Polls PayPal every {health?.reminder?.pollSeconds ?? '–'}s · drafts a nudge after {health?.reminder?.delaySeconds ?? '–'}s unpaid · never auto-sends</div>
        </div>
      </div>
      <div className="row gap">
        <button className="ghost" disabled={running} onClick={() => onRun(0)}>Run now</button>
        <button className="ghost" disabled={running} onClick={() => onRun(86400)}>⏩ Simulate +1 day</button>
      </div>
      {payments.length === 0 ? <div className="empty">No pay links yet. Create one from a quote →</div> : null}
      {payments.map((p) => (
        <div key={p.id} className={`pay ${p.paid ? 'paid' : ''}`}>
          <div className="row between">
            <strong className="ellipsis">{p.quote.title}</strong>
            <Badge tone={p.paid ? 'ok' : p.nudges?.length ? 'warn' : 'info'}>{p.paid ? 'PAID' : p.status}</Badge>
          </div>
          <div className="row between muted small">
            <span>{fmt(p.quote.total, p.quote.currency)} · {p.kind} · {ago(p.createdAt)}</span>
            <span>{p.paypalMode === 'sandbox-live' ? 'PayPal sandbox' : 'mock'}</span>
          </div>
          <div className="row gap small">
            <a href={p.payLink} target="_blank" rel="noreferrer">Open pay link</a>
            <button className="link" onClick={() => onRefresh(p.id)}>Refresh status</button>
            {p.nudges?.length ? <button className="link" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Hide' : 'Show'} {p.nudges.length} nudge draft{p.nudges.length > 1 ? 's' : ''}</button> : null}
          </div>
          {open === p.id && p.nudges.map((n, i) => (
            <div key={i} className="nudge">
              <div className="row between small"><strong>{n.subject}</strong><Badge tone={n.source === 'live' ? 'ok' : 'warn'}>{n.source}</Badge></div>
              <pre>{n.body}</pre>
              <button className="link small" onClick={() => navigator.clipboard?.writeText(`${n.subject}\n\n${n.body}`)}>Copy draft</button>
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [brief, setBrief] = useState('');
  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [payments, setPayments] = useState([]);
  const endRef = useRef(null);

  const loadPayments = () => api.payments().then(setPayments).catch(() => {});
  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    if (new URLSearchParams(location.search).has('paid')) {
      api.runAgent(0).then((r) => setPayments(r.payments)).catch(() => {});
      history.replaceState(null, '', '/');
    } else loadPayments();
    const t = setInterval(loadPayments, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [msgs]);

  const push = (m) => setMsgs((xs) => [...xs, { id: crypto.randomUUID(), ...m }]);
  const send = async () => {
    const text = brief.trim();
    if (text.length < 10 || busy) return;
    push({ role: 'user', text });
    setBrief('');
    setBusy(true);
    try {
      const r = await api.quote(text);
      push({ role: 'ai', ...r, brief: text });
    } catch (e) {
      push({ role: 'error', text: `${e.message}${e.details ? ' — ' + [].concat(e.details).join('; ') : ''}` });
    } finally { setBusy(false); }
  };
  const pay = async (msgId, quote, kind) => {
    setBusy(true);
    try {
      const msg = msgs.find((m) => m.id === msgId);
      const rec = await api.pay(quote, kind, msg?.brief);
      setMsgs((xs) => xs.map((m) => (m.id === msgId ? { ...m, quote: rec.quote, payment: rec } : m)));
      push({ role: 'sys', text: `Pay link ready (${rec.paypalMode === 'sandbox-live' ? 'real PayPal sandbox' : 'mock PayPal'}). The reminder agent is now watching ${rec.paypalId}.` });
      loadPayments();
    } catch (e) {
      push({ role: 'error', text: `${e.message}${e.details ? ' — ' + JSON.stringify(e.details) : ''}` });
    } finally { setBusy(false); }
  };
  const runAgent = async (ff) => {
    setRunning(true);
    try { const r = await api.runAgent(ff); setPayments(r.payments); } finally { setRunning(false); }
  };
  const refresh = async (id) => { await api.refresh(id).catch(() => {}); loadPayments(); };

  return (
    <div className="app">
      <header>
        <div className="brand"><span className="logo">PB</span><div><h1>PayBrief</h1><div className="muted small">Client brief → AI quote → PayPal pay link → gentle follow-ups</div></div></div>
        <div className="row gap">
          {health ? <>
            <Badge tone={health.ai === 'live' ? 'ok' : 'warn'}>AI: {health.ai}</Badge>
            <Badge tone={health.paypal === 'sandbox-live' ? 'ok' : 'warn'}>PayPal: {health.paypal}</Badge>
          </> : <Badge tone="info">connecting…</Badge>}
        </div>
      </header>
      <main>
        <section className="chat">
          <div className="msgs">
            {msgs.length === 0 && (
              <div className="hero">
                <h2>Paste a client brief. Get paid.</h2>
                <p className="muted">PayBrief scopes the work, prices it, and turns it into a real PayPal invoice or checkout link in seconds.</p>
                <div className="samples">{SAMPLES.map((s, i) => <button key={i} className="sample" onClick={() => setBrief(s)}>{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m) => m.role === 'ai' ? (
              <div key={m.id} className="bubble ai"><QuoteCard msg={m} onPay={pay} busy={busy} /></div>
            ) : (
              <div key={m.id} className={`bubble ${m.role}`}>{m.text}</div>
            ))}
            {busy && <div className="bubble ai typing"><span /><span /><span /></div>}
            <div ref={endRef} />
          </div>
          <div className="composer">
            <textarea
              placeholder="e.g. Need a landing page + logo for my bakery, launch in 2 weeks, contact sam@bakery.com"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
              rows={3}
            />
            <button className="primary" disabled={busy || brief.trim().length < 10} onClick={send}>Draft quote ↵</button>
          </div>
        </section>
        <Payments payments={payments} onRun={runAgent} onRefresh={refresh} running={running} health={health} />
      </main>
    </div>
  );
}
