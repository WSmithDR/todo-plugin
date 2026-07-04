// Bootstrap de skills para OpenCode (patrón superpowers): escanea skills/*/SKILL.md,
// arma el índice nombre → description y las instrucciones de uso. Cacheado a nivel
// módulo — el transform hook corre en cada step del agente, no puede re-leer disco.
import fs from 'fs';
import path from 'path';
import { PLUGIN_ROOT } from './runner.js';

export const SKILLS_DIR = path.join(PLUGIN_ROOT, 'skills');

// Marker del guard anti-doble-inyección (el transform puede recibir el mismo
// array de mensajes ya transformado).
export const BOOTSTRAP_MARKER = 'TODO-PLUGIN-SKILLS';

function frontmatterField(content, key) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return '';
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0 && line.slice(0, idx).trim() === key) {
      return line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return '';
}

let _cache; // undefined = no cargado, null = sin skills

export function buildBootstrap() {
  if (_cache !== undefined) return _cache;

  let entries = [];
  try {
    for (const dir of fs.readdirSync(SKILLS_DIR)) {
      const skillPath = path.join(SKILLS_DIR, dir, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      const desc = frontmatterField(fs.readFileSync(skillPath, 'utf8'), 'description');
      entries.push(`- \`${dir}\` — ${desc}`);
    }
  } catch {
    entries = [];
  }
  if (!entries.length) { _cache = null; return null; }

  _cache = `<${BOOTSTRAP_MARKER}>
Tenés el plugin todo-plugin (gestión de TODOs por proyecto en \`.todo/\`).
Cargá cada skill con el tool nativo \`skill\` de OpenCode cuando aplique:

${entries.join('\n')}

Reglas duras:
- NUNCA marques \`- [x]\` a mano en .todo/TODO.md ni DOING.md: un item completado
  se MUEVE a DONE.md vía la skill \`todo-done\` (el guard y el pre-commit lo bloquean).
- NUNCA edites archivos de .todo/ directamente: usá la skill correspondiente
  (todo-add / todo-doing / todo-done / todo-clarify / todo-triage), que abre la
  ventana de escritura del guard automáticamente.
</${BOOTSTRAP_MARKER}>`;
  return _cache;
}
