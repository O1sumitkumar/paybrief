// AI layer: brief -> structured quote, and unpaid -> polite nudge.
// Live mode: any OpenAI-compatible /chat/completions endpoint (OPENAI_API_KEY [+ OPENAI_BASE_URL]).
// Mock mode: deterministic, clearly labelled generator so the demo runs fully offline.
import { validateQuote, money } from './quote.js';

const QUOTE_SYSTEM = `You are PayBrief, a freelance/agency scoping assistant.
Turn the client brief into a JSON quote. Respond with ONLY a JSON object of shape:
{"title": string, "client": {"name": string, "email": string},
 "scope": string[] (3-8 crisp deliverable bullets),
 "line_items": [{"name": string, "description": string, "quantity": number, "unit_amount": number}],
 "currency": "USD"|"EUR"|"GBP"|"CAD"|"AUD"|"INR",
 "total": number (must equal sum of quantity*unit_amount),
 "assumptions": string[]}
Price realistically for a small professional studio. Use client name/email only if present in the brief, else "".
Use the currency mentioned in the brief, default USD.`;

const NUDGE_SYSTEM = `You write short, warm, professional payment reminder emails for a small studio.
Never threaten. 60-110 words. Include the amount, what it was for, and the pay link verbatim.
Respond with ONLY JSON: {"subject": string, "body": string}`;

async function chatJSON(cfg, system, user, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  return extractJSON(text);
}

export function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI did not return JSON');
    return JSON.parse(m[0]);
  }
}

// ---------- deterministic mock ----------
const CATALOG = [
  { re: /landing|website|site|web ?page|homepage/i, name: 'Landing page design + build', description: 'Responsive marketing page, up to 5 sections', quantity: 1, unit_amount: 900, scope: 'Responsive landing page (mobile-first) with up to 5 sections' },
  { re: /logo|brand|identity/i, name: 'Brand identity kit', description: 'Logo, palette, typography guide', quantity: 1, unit_amount: 650, scope: 'Logo, colour palette and typography mini-guide' },
  { re: /shop|store|e-?commerce|checkout|cart/i, name: 'Store + checkout setup', description: 'Product catalogue and PayPal checkout', quantity: 1, unit_amount: 1400, scope: 'Product catalogue with PayPal checkout' },
  { re: /app|mobile|ios|android|react native/i, name: 'Mobile app MVP screens', description: 'Core screens in React Native', quantity: 6, unit_amount: 220, scope: 'React Native MVP covering ~6 core screens' },
  { re: /seo|search/i, name: 'SEO foundation', description: 'Meta, sitemap, Core Web Vitals pass', quantity: 1, unit_amount: 300, scope: 'On-page SEO, sitemap and Core Web Vitals pass' },
  { re: /blog|cms|content/i, name: 'CMS + blog setup', description: 'Editable content with 3 templates', quantity: 1, unit_amount: 450, scope: 'CMS-backed blog with 3 editable templates' },
  { re: /video|reel|animation/i, name: 'Short promo video', description: '30–60s edited promo', quantity: 1, unit_amount: 500, scope: 'One 30–60 second promo video' },
  { re: /ai|chatbot|gpt|llm|agent/i, name: 'AI assistant integration', description: 'LLM chat widget with guardrails', quantity: 1, unit_amount: 1100, scope: 'AI chat assistant integrated with guardrails' },
  { re: /api|backend|integration|dashboard/i, name: 'Backend / integration work', description: 'API + dashboard development (hours)', quantity: 12, unit_amount: 45, scope: 'Backend API / dashboard integration work' },
];

function detectCurrency(brief) {
  if (/₹|\binr\b|rupee/i.test(brief)) return 'INR';
  if (/€|\beur\b|euro/i.test(brief)) return 'EUR';
  if (/£|\bgbp\b|pound/i.test(brief)) return 'GBP';
  if (/\bcad\b/i.test(brief)) return 'CAD';
  if (/\baud\b/i.test(brief)) return 'AUD';
  return 'USD';
}
const FX = { USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.37, AUD: 1.52, INR: 84 };

export function mockQuote(brief) {
  const text = String(brief || '');
  const hits = CATALOG.filter((c) => c.re.test(text));
  const picked = hits.length ? hits.slice(0, 4) : [CATALOG[0]];
  const currency = detectCurrency(text);
  const rate = FX[currency];
  const rush = /urgent|asap|rush|this week|tomorrow/i.test(text);
  const items = picked.map((c) => ({
    name: c.name,
    description: c.description,
    quantity: c.quantity,
    unit_amount: Math.round(c.unit_amount * rate * (rush ? 1.2 : 1)),
  }));
  items.push({ name: 'Project management & QA', description: 'Kick-off, 2 review rounds, launch checklist', quantity: 1, unit_amount: Math.round(150 * rate) });
  const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [''])[0];
  const NAME = "([A-Z][\\w&'-]+(?:\\s+[A-Z][\\w&'-]+){0,2})";
  const nameMatch =
    text.match(new RegExp(`(?:[Ii] am|[Ii]'m|[Tt]his is|[Cc]lient:?|[Nn]ame:?)\\s+${NAME}`)) ||
    text.match(new RegExp(`(?:for|from)\\s+${NAME}`));
  const total = items.reduce((a, it) => a + it.quantity * it.unit_amount, 0);
  return {
    title: `${picked[0].name.split(' ')[0]} project — ${nameMatch ? nameMatch[1] : 'client'}`.slice(0, 120),
    client: { name: nameMatch ? nameMatch[1] : '', email },
    scope: [...picked.map((c) => c.scope), 'Two rounds of revisions included', 'Handover with short Loom walkthrough'],
    line_items: items,
    currency,
    total,
    assumptions: [
      '[MOCK AI] Deterministic offline generator — set OPENAI_API_KEY for live AI.',
      rush ? 'Rush delivery surcharge (+20%) applied' : 'Standard 2–3 week timeline',
      '50% can be invoiced upfront if preferred',
    ],
  };
}

export function mockNudge(record) {
  const name = record.quote?.client?.name || 'there';
  const amount = `${record.quote.currency} ${money(record.quote.total)}`;
  return {
    subject: `Friendly reminder: ${record.quote.title}`,
    body:
      `Hi ${name},\n\nHope the week is going well! Just a gentle nudge that the payment of ${amount} for "${record.quote.title}" is still open. ` +
      `You can pay securely with PayPal here: ${record.payLink}\n\n` +
      `If you've already paid, please ignore this — and if anything in the quote needs a tweak, just reply and we'll sort it.\n\nThanks so much,\nAonHive Studio`,
    source: 'mock',
  };
}

export function createAI(cfg, fetchImpl = fetch) {
  const live = cfg.mode === 'live';
  return {
    mode: cfg.mode,
    async generateQuote(brief) {
      if (!brief || String(brief).trim().length < 10) throw new Error('Brief is too short (min 10 chars)');
      let raw;
      let source = 'mock';
      if (live) {
        try {
          raw = await chatJSON(cfg, QUOTE_SYSTEM, String(brief).slice(0, 4000), fetchImpl);
          source = 'live';
        } catch (e) {
          // one retry with a repair hint, then fall back to mock so the demo never dead-ends
          try {
            raw = await chatJSON(cfg, QUOTE_SYSTEM + '\nReturn strictly valid JSON.', String(brief).slice(0, 4000), fetchImpl);
            source = 'live';
          } catch {
            raw = mockQuote(brief);
            source = `mock-fallback (${e.message.slice(0, 80)})`;
          }
        }
      } else raw = mockQuote(brief);
      const { quote, warnings } = validateQuote(raw);
      return { quote, warnings, source };
    },
    async draftNudge(record) {
      if (!live) return mockNudge(record);
      try {
        const out = await chatJSON(
          cfg,
          NUDGE_SYSTEM,
          JSON.stringify({
            client: record.quote.client,
            title: record.quote.title,
            amount: `${record.quote.currency} ${money(record.quote.total)}`,
            pay_link: record.payLink,
            days_open: Math.max(1, Math.round((Date.now() - Date.parse(record.createdAt)) / 86400000)),
            reminders_sent_before: (record.nudges || []).length,
          }),
          fetchImpl,
        );
        if (!out.subject || !out.body) throw new Error('bad nudge');
        return { subject: String(out.subject), body: String(out.body), source: 'live' };
      } catch {
        return { ...mockNudge(record), source: 'mock-fallback' };
      }
    },
  };
}
