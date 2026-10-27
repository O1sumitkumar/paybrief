async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.details = data.details || data.paypal;
    throw err;
  }
  return data;
}
export const api = {
  health: () => call('GET', '/api/health'),
  quote: (brief) => call('POST', '/api/quote', { brief }),
  validate: (quote) => call('POST', '/api/quote/validate', { quote }),
  pay: (quote, kind, brief) => call('POST', '/api/pay', { quote, kind, brief }),
  payments: () => call('GET', '/api/payments'),
  refresh: (id) => call('POST', `/api/payments/${id}/refresh`),
  runAgent: (fastForwardSeconds = 0) => call('POST', '/api/reminders/run', { fastForwardSeconds }),
};
