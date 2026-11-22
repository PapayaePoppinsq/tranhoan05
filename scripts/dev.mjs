import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const launch = (directory, args) => spawn(process.execPath, args, {
  stdio: 'inherit', cwd: fileURLToPath(new URL(directory, import.meta.url)),
});
const children = [launch('../backend/', ['src/index.js', '--demo']), launch('../frontend/', [vite])];
let exiting = false;
function finish(code) {
  if (exiting) return;
  exiting = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill();
}
process.on('SIGINT', () => finish(0));
process.on('SIGTERM', () => finish(0));
for (const child of children) {
  child.on('exit', (code) => finish(code ?? 1));
  child.on('error', (error) => { console.error(error.message); finish(1); });
}
