# PayBrief 💸

**Paste a client brief → AI scopes and prices it → real PayPal invoice / checkout link → a reminder agent chases unpaid ones (politely).**

Built for the PayPal AI Hackathon by Sumit Jha / AonHive.

## Quick start

```bash
npm install
npm test          # 22 tests: AI schema/guardrails, PayPal client (mocked HTTP), reminder agent, HTTP e2e
npm start         # builds the React UI if needed, serves everything on http://localhost:5174
npm run dev       # API with --watch on :5174 + Vite dev UI on http://localhost:5173
```

With **no env vars** everything runs offline in clearly labelled mock mode (badges in the header say `AI: mock` / `PayPal: sandbox-mock`; mock pay links open a local "MOCK MODE" checkout page). Add keys to `.env` (copy `.env.example`) to switch to live automatically.

## Env vars

| Var | Purpose |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal **sandbox** REST app credentials (free: developer.paypal.com → Apps & Credentials → Sandbox → Create App). Both set ⇒ `sandbox-live`. |
| `PAYPAL_BASE_URL` | Default `https://api-m.sandbox.paypal.com` |
| `PAYPAL_RETURN_URL` / `PAYPAL_CANCEL_URL` | Where PayPal sends the buyer after Orders approval |
| `PAYPAL_SEND_INVOICE_EMAIL` | `1` lets PayPal email the invoice to the recipient. Default `0` = link only, nobody is emailed |
| `INVOICER_NAME` | Business name on invoices/checkout |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Any OpenAI-compatible chat API (OpenAI, Groq, OpenRouter, local). Unset ⇒ deterministic mock generator |
| `REMINDER_DELAY_SECONDS` | Unpaid this long (since creation / last nudge) ⇒ draft a nudge. Default 60 (demo-friendly; use 259200 = 3 days in real life) |
| `REMINDER_POLL_SECONDS` | Background poll interval (default 15, `0` disables) |
| `REMINDER_MAX_NUDGES` | Cap per payment (default 3) |
| `PAYPAL_FORCE_MOCK`, `AI_FORCE_MOCK` | `1` forces mock even if keys exist |
| `PORT`, `PUBLIC_URL`, `DATA_FILE` | Server port, base for mock links, JSON store path (`data/payments.json`) |

## Architecture

```
React (Vite) chat UI ──► Express API (src/app.js)
                           ├─ POST /api/quote ──► AI layer (src/ai.js)
                           │       OpenAI-compatible /chat/completions, JSON mode
                           │       → zod schema + money guardrails (src/quote.js)
                           │         (caps per line/total, total recomputed from line items, cents rounding)
                           ├─ POST /api/pay ────► PayPal client (src/paypal.js)
                           │       OAuth2 client-credentials (token cached)
                           │       kind=invoice: Invoicing v2 create → send (send_to_recipient=false) → payer-view link
                           │       kind=order:   Orders v2 create (intent CAPTURE) → payer-action/approve link
                           │       → JSON store (src/store.js)
                           ├─ GET  /api/payments, POST /api/payments/:id/refresh
                           └─ POST /api/reminders/run ─► Reminder agent (src/reminders.js)
                                   polls status (auto-captures APPROVED orders), marks PAID,
                                   drafts AI nudge for unpaid > delay; never sends email
Mock mode: MockPayPalClient (same interface) + /mock-paypal/:id checkout page; mockQuote/mockNudge in ai.js
```

Key choices: line items are the source of truth for money (the AI's own `total` is never trusted); guardrails re-run server-side before anything hits PayPal; fractional quantities are folded into integer PayPal items so Orders v2 accepts them; every PayPal write carries a `PayPal-Request-Id` for idempotency; live AI errors fall back to the labelled mock so a demo never dead-ends.

### API

| Method | Path | Body → Result |
|---|---|---|
| GET | `/api/health` | modes (ai, paypal), reminder settings |
| POST | `/api/quote` | `{brief}` → `{quote, warnings, source}` |
| POST | `/api/quote/validate` | `{quote}` → validated quote (for edited line items) |
| POST | `/api/pay` | `{quote, kind: "invoice"\|"order"}` → payment record with `payLink` |
| GET | `/api/payments` | all tracked payments + nudge drafts |
| POST | `/api/payments/:id/refresh` | poll PayPal for one record |
| POST | `/api/reminders/run` | `{fastForwardSeconds?}` → run agent now (fast-forward is for demos) |

## Demo script (≤ 3 min)

1. **0:00 Problem (15s)** — "Freelancers lose hours turning WhatsApp briefs into quotes and invoices, then awkwardly chasing payment."
2. **0:15 Brief → quote (40s)** — click the Priya/Bloom Cafe sample → *Draft quote*. Show scope bullets, line items, total; edit one price inline to show human control.
3. **0:55 Real PayPal (45s)** — *Create PayPal invoice*. Point at the `PayPal: sandbox-live` badge and the returned `sandbox.paypal.com` link; open it and pay as the sandbox buyer. (Also show *PayPal checkout link* = Orders v2.)
4. **1:40 Reminder agent (45s)** — second quote, leave unpaid. Click *⏩ Simulate +1 day* → agent drafts a warm AI nudge containing the pay link; *Refresh status* on the paid one → **PAID** (orders auto-captured).
5. **2:25 Why it matters (25s)** — guardrails (caps, totals recomputed, no auto-sending), idempotent PayPal calls, works with any OpenAI-compatible model. Close on the PAID badge.

Record in live mode (sandbox keys + AI key). Mock mode is for offline dev and fallback only.

## Tests

`npm test` (node:test, no network): schema/guardrails + mock & live AI parsing (`test/quote.test.js`), PayPal OAuth/Orders/Invoicing/capture/error handling with a fake HTTP layer (`test/paypal.test.js`), reminder timing/paid detection (`test/reminders.test.js`), and a full HTTP e2e in mock mode (`test/api.test.js`).

## Notes

- Sandbox only by default; no real money moves. Don't commit `.env`.
- `public/index.html`, `src/paypal-mock.js`, `src/reminder.js`, `scripts/simulate.mjs`, `scripts/remind.mjs` are from a parallel prototype and are **not** used by the app (untracked).
