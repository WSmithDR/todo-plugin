import { PLUGIN_ROOT } from "../../core/paths.ts"
import { sessionSetup } from "../../core/rules/session-setup.ts"
import { decideAfter, decideBefore, decideSessionClose } from "../../core/pipeline.ts"
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
 * `session-close` también va por `system.transform`, y no por el hook `event`.
 * OpenCode no tiene un evento de fin de sesión: lo más parecido es
 * `session.idle`, que es fin de TURNO —el análogo de `Stop` de Claude Code, no de
 * `SessionEnd`—. Y el hook `event` devuelve void: no tiene canal de salida, así
 * que un aviso emitido ahí no llegaría al modelo.
 *
 * `system.transform` sí corre en cada request y sí tiene canal. La condición de
 * la regla (HEAD se movió) hace el resto: avisa una vez por commit, no una vez
 * por request. Y el `git rev-parse` está gateado por el mtime del reflog: en el
 * caso normal —nada se movió— el costo por request es un stat, no un proceso.
 *
 * El equivalente de SessionStart no es un hook: los efectos corren una vez acá,
 * al construir el plugin, y el aviso resultante se cuelga del system prompt. Un
 * `event` hook obligaría a adivinar el nombre del evento de sesión; el factory
 * corre siempre, y el efecto (instalar el git hook) es idempotente.
 */

export function createHooks(directory: string, root: string = PLUGIN_ROOT) {
  const setup = sessionSetup({ cwd: directory, pluginRoot: root })
  const setupNotice = setup.action === "allow" ? null : setup.message

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
      applyBefore(decideBefore(toToolEvent(input.tool, output.args ?? {}, directory, "before")))
    },

    "tool.execute.after": async (
      input: { tool: string; args?: Record<string, unknown> },
      output: AfterOutput,
    ): Promise<void> => {
      const event = toToolEvent(input.tool, input.args ?? {}, directory, "after", output)
      applyAfter(decideAfter(event), output)
    },

    "experimental.chat.system.transform": async (
      _input: unknown,
      output: { system: string[] },
    ): Promise<void> => {
      const instructions = buildInstructions(root)
      if (instructions) output.system.push(instructions)
      if (setupNotice) output.system.push(setupNotice)

      // perRequest: system.transform corre en cada request, así que el gate del
      // reflog evita spawnear git cuando no se movió nada.
      const cierre = decideSessionClose(directory, { perRequest: true })
      if (cierre.action !== "allow") output.system.push(cierre.message)
    },
  }
}
