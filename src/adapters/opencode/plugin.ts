import { existsSync } from "node:fs"
import { join } from "node:path"
import { mergeDecisions } from "../../core/protocol.ts"
import { PLUGIN_ROOT } from "../../core/paths.ts"
import { guard } from "../../core/rules/guard.ts"
import { errorTriage } from "../../core/rules/error-triage.ts"
import { branchDoing } from "../../core/rules/branch-doing.ts"
import { sessionSetup } from "../../core/rules/session-setup.ts"
import { editingItem } from "../../core/rules/editing-item.ts"
import { openItems, openItemTitles, readTodoFile } from "../../core/todo-files.ts"
import { markAdvisedOnce } from "../../core/session-state.ts"
import { isWindowOpen } from "../../core/window.ts"
import { currentBranch, guardEnabled } from "../claude-code/context.ts"
import { injectConfig, type OpenCodeConfig } from "./config.ts"
import { applyAfter, applyBefore, type AfterOutput } from "./emit.ts"
import { buildInstructions } from "./instructions.ts"
import { toToolEvent } from "./normalize.ts"

/**
 * Los hooks del plugin de OpenCode. Todo el cableado vive acá; el archivo de
 * `.opencode/plugins/` es solo el punto de entrada que OpenCode sabe encontrar.
 *
 * Paridad con Claude Code:
 *
 *   shell.env             el root del plugin, que OpenCode no setea
 *   config                skills + /comandos + agentes
 *   tool.execute.before   guard                                        (PreToolUse)
 *   tool.execute.after    error-triage + branch-doing + editing-item    (PostToolUse)
 *   system.transform      índice de skills + el aviso de setup de sesión
 *
 * SIN equivalente: el `session-end` de Claude Code, que recuerda cerrar lo que
 * quedó en DOING.md si hubo commits. OpenCode expone un hook `event`, pero su
 * tipo no declara qué eventos existen y adivinar un nombre daría un hook que no
 * dispara nunca — declarado y no verificado, justo lo que el conformance check
 * existe para evitar. Se cablea cuando el nombre esté confirmado.
 *
 * El equivalente de SessionStart no es un hook: los efectos corren una vez acá,
 * al construir el plugin, y el aviso resultante se cuelga del system prompt. Un
 * `event` hook obligaría a adivinar el nombre del evento de sesión; el factory
 * corre siempre, y el efecto (instalar el git hook) es idempotente.
 */
export function createHooks(directory: string, root: string = PLUGIN_ROOT) {
  const setup = sessionSetup({ cwd: directory, pluginRoot: root })
  const setupNotice = setup.action === "allow" ? null : setup.message
  const hasTodoDir = existsSync(join(directory, ".todo"))

  return {
    "shell.env": async (_input: unknown, output: { env: Record<string, string> }): Promise<void> => {
      output.env ??= {}
      // TODO_PLUGIN_ROOT es siempre nuestra; CLAUDE_PLUGIN_ROOT solo si nadie
      // llegó antes. OpenCode le pasa el MISMO objeto env a todos los plugins,
      // así que un nombre global para un valor por-plugin se pisa en silencio.
      output.env.TODO_PLUGIN_ROOT = root
      output.env.CLAUDE_PLUGIN_ROOT ??= root
    },

    config: async (config: OpenCodeConfig): Promise<void> => {
      injectConfig(config, root)
    },

    "tool.execute.before": async (
      input: { tool: string },
      output: { args?: Record<string, unknown> },
    ): Promise<void> => {
      const event = toToolEvent(input.tool, output.args ?? {}, directory, "before")
      applyBefore(guard(event, { windowOpen: isWindowOpen(), enabled: guardEnabled() }))
    },

    "tool.execute.after": async (
      input: { tool: string; args?: Record<string, unknown> },
      output: AfterOutput,
    ): Promise<void> => {
      const event = toToolEvent(input.tool, input.args ?? {}, directory, "after", output)
      applyAfter(
        mergeDecisions([
          errorTriage(event, { hasTodoDir }),
          branchDoing(event, { hasTodoDir, branch: hasTodoDir ? currentBranch(directory) : "" }),
          editingItem(event, {
            hasTodoDir,
            todo: hasTodoDir ? openItems(readTodoFile(directory, "TODO.md")) : [],
            doing: hasTodoDir ? openItemTitles(readTodoFile(directory, "DOING.md")) : [],
            advisedOnce: (subject) => markAdvisedOnce(directory, subject),
          }),
        ]),
        output,
      )
    },

    "experimental.chat.system.transform": async (
      _input: unknown,
      output: { system: string[] },
    ): Promise<void> => {
      const instructions = buildInstructions(root)
      if (instructions) output.system.push(instructions)
      if (setupNotice) output.system.push(setupNotice)
    },
  }
}
