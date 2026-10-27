// Entrypoint: load .env (if any), wire real/mock services, start reminder agent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config.js';
import { createAI } from './ai.js';
import { createPayPal, MockPayPalClient } from './paypal.js';
import { JsonStore } from './store.js';
import { ReminderAgent } from './reminders.js';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadDotEnv(file = path.join(root, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

loadDotEnv();
const config = getConfig();
const store = new JsonStore(path.resolve(root, config.dataFile));
const ai = createAI(config.ai);
const paypal = createPayPal(config.paypal);
if (paypal instanceof MockPayPalClient) {
  // mock "paid" state survives restarts via the store
  store.all().filter((r) => r.paid).forEach((r) => paypal.markPaid(r.paypalId));
}
const agent = new ReminderAgent({ store, paypal, ai, ...config.reminders, log: console.log });
const app = createApp({ config, store, paypal, ai, agent, staticDir: path.join(root, 'dist') });

app.listen(config.port, () => {
  console.log(`PayBrief on http://localhost:${config.port}  | AI: ${ai.mode} | PayPal: ${paypal.mode} | reminder delay ${config.reminders.delayMs / 1000}s`);
  agent.start();
});
