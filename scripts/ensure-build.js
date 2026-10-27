// Build the React UI once if dist/ is missing (so `npm start` always serves the UI).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
if (!fs.existsSync(new URL('../dist/index.html', import.meta.url))) {
  console.log('dist/ missing -> running vite build');
  execSync('npx vite build', { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
}
