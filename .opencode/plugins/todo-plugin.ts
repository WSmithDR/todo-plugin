// Punto de entrada del plugin de OpenCode.
//
// Solo existe porque OpenCode busca los plugins acá. Todo el cableado vive en
// src/adapters/opencode/plugin.ts, que importa el MISMO core que usa el adapter
// de Claude Code — no hay lógica duplicada entre CLIs, ni un bridge que spawnee
// bash para preguntarle algo a un script.
import { createHooks } from "../../src/adapters/opencode/plugin.ts"

export const TodoPlugin = async (input?: { directory?: string }) =>
  createHooks(input?.directory ?? process.cwd())

export default TodoPlugin
