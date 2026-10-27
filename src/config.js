// Runtime config. Live modes switch on automatically when env vars are present.
export function getConfig(env = process.env) {
  const paypalLive = Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) && env.PAYPAL_FORCE_MOCK !== '1';
  const aiLive = Boolean(env.OPENAI_API_KEY) && env.AI_FORCE_MOCK !== '1';
  return {
    port: Number(env.PORT || 5174),
    paypal: {
      mode: paypalLive ? 'sandbox-live' : 'sandbox-mock',
      clientId: env.PAYPAL_CLIENT_ID || '',
      clientSecret: env.PAYPAL_CLIENT_SECRET || '',
      baseUrl: env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com',
      invoicerName: env.INVOICER_NAME || 'AonHive Studio',
      returnUrl: env.PAYPAL_RETURN_URL || 'http://localhost:5174/?paid=1',
      cancelUrl: env.PAYPAL_CANCEL_URL || 'http://localhost:5174/?cancelled=1',
      // Invoices are sent with send_to_recipient=false unless explicitly enabled (no emails by default).
      sendInvoiceEmail: env.PAYPAL_SEND_INVOICE_EMAIL === '1',
      publicUrl: (env.PUBLIC_URL || `http://localhost:${Number(env.PORT || 5174)}`).replace(/\/$/, ''),
    },
    reminders: {
      delayMs: Number(env.REMINDER_DELAY_SECONDS ?? 60) * 1000,
      intervalMs: Number(env.REMINDER_POLL_SECONDS ?? 15) * 1000,
      maxNudges: Number(env.REMINDER_MAX_NUDGES ?? 3),
    },
    dataFile: env.DATA_FILE || 'data/payments.json',
    ai: {
      mode: aiLive ? 'live' : 'mock',
      apiKey: env.OPENAI_API_KEY || '',
      baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
    },
  };
}
