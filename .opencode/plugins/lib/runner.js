// Runner compartido del bridge OpenCode de todo-plugin.
// Resuelve la raíz del plugin y corre scripts bash con payload JSON por stdin.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

export const PLUGIN_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../..'
);

export const GUARD_SCRIPT = path.join(PLUGIN_ROOT, 'bin', 'todo-guard.sh');

// Corre un script bash con el payload por stdin y devuelve {code, err}.
// Best-effort: si el script no puede correr (sin bash/python3), no bloquea.
export function runBashStdin(script, payload, { timeout = 2000 } = {}) {
  return new Promise((resolve) => {
    const proc = spawn('bash', [script], { timeout });
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => resolve({ code, err }));
    proc.on('error', () => resolve({ code: 0, err: '' }));
    proc.stdin.write(payload);
    proc.stdin.end();
  });
}
