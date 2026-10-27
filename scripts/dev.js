// `npm run dev`: API server with --watch + Vite dev server (UI on :5173, proxied API on :5174).
import { spawn } from 'node:child_process';
const procs = [
  spawn(process.execPath, ['--watch', 'src/server.js'], { stdio: 'inherit' }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: true }),
];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
