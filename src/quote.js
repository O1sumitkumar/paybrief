// Quote schema + guardrails. Line items are the source of truth for money.
import { z } from 'zod';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR'];
export const LIMITS = {
  maxLineItemAmount: 50_000, // per line (qty * unit)
  maxTotal: 100_000,
  maxItems: 20,
  maxQuantity: 1000,
};

export const LineItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  quantity: z.coerce.number().positive().max(LIMITS.maxQuantity),
  unit_amount: z.coerce.number().positive(),
});

export const QuoteSchema = z.object({
  title: z.string().trim().min(1).max(120),
  client: z
    .object({
      name: z.string().trim().max(120).default(''),
      email: z.string().trim().email().or(z.literal('')).default(''),
    })
    .default({ name: '', email: '' }),
  scope: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
  line_items: z.array(LineItemSchema).min(1).max(LIMITS.maxItems),
  currency: z.enum(CURRENCIES),
  total: z.coerce.number().nonnegative(),
  assumptions: z.array(z.string().trim().max(300)).max(10).default([]),
});

export class GuardrailError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'GuardrailError';
    this.details = details;
  }
}

export const toCents = (n) => Math.round(Number(n) * 100);
export const fromCents = (c) => Math.round(c) / 100;
export const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

export function lineTotalCents(item) {
  return Math.round(toCents(item.unit_amount) * item.quantity);
}

export function sumLineItems(items) {
  return fromCents(items.reduce((acc, it) => acc + lineTotalCents(it), 0));
}

/**
 * Validate raw (AI or user) quote JSON.
 * - schema check (zod)
 * - absurd-amount caps -> GuardrailError (needs human review, never auto-invoiced)
 * - total mismatch -> total recomputed from line items, warning recorded
 * Returns { quote, warnings }.
 */
export function validateQuote(raw, { strictTotal = false } = {}) {
  const parsed = QuoteSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GuardrailError(
      'Quote failed schema validation',
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const q = parsed.data;
  const warnings = [];
  const problems = [];

  q.line_items = q.line_items.map((it) => ({ ...it, unit_amount: fromCents(toCents(it.unit_amount)) }));
  q.line_items.forEach((it, idx) => {
    const lt = fromCents(lineTotalCents(it));
    if (lt > LIMITS.maxLineItemAmount) {
      problems.push(`line_items[${idx}] "${it.name}" = ${money(lt)} exceeds cap ${LIMITS.maxLineItemAmount}`);
    }
  });

  const sum = sumLineItems(q.line_items);
  if (sum <= 0) problems.push('Quote total must be greater than zero');
  if (sum > LIMITS.maxTotal) problems.push(`Total ${money(sum)} exceeds cap ${LIMITS.maxTotal}`);

  if (toCents(q.total) !== toCents(sum)) {
    if (strictTotal) problems.push(`total ${money(q.total)} != sum of line items ${money(sum)}`);
    else warnings.push(`AI total ${money(q.total)} did not match line items; corrected to ${money(sum)}`);
    q.total = sum;
  }

  if (problems.length) throw new GuardrailError('Quote blocked by guardrails', problems);
  q.total = fromCents(toCents(q.total));
  return { quote: q, warnings };
}
