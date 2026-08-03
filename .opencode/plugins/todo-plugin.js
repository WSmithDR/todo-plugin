// Plugin de OpenCode para todo-plugin — ORQUESTADOR.
// Cada hook de OpenCode tiene su archivo en lib/hooks/ (patrón espejo de ankify
// y superpowers):
//   config              → auto-registra skills/ en config.skills.paths
//   shell.env           → inyecta CLAUDE_PLUGIN_ROOT (OpenCode no lo setea)
//   messages.transform  → inyecta el bootstrap de skills en el 1er mensaje
//   tool.execute.before → todo-guard (bloquea escrituras directas a .todo/ y
//                         checkboxes '- [x]' marcados a mano en TODO/DOING)
import { createBeforeHandler } from './lib/hooks/before.js';
import { createConfigHandler } from './lib/hooks/config.js';
import { createEnvHandler } from './lib/hooks/env.js';
import { createTransformHandler } from './lib/hooks/transform.js';

const _hooks = {
  before: createBeforeHandler(),
  config: createConfigHandler(),
  env: createEnvHandler(),
  transform: createTransformHandler(),
};

export const TodoPlugin = async () => ({
  config: async (config) => { await _hooks.config(config); },
  'shell.env': async (input, output) => { await _hooks.env(input, output); },
  'tool.execute.before': async (input, output) => { await _hooks.before(input, output); },
  'experimental.chat.messages.transform': async (_input, output) => { await _hooks.transform(_input, output); },
});

export default TodoPlugin;
