import { join } from "node:path"
import { PLUGIN_ROOT } from "../../core/paths.ts"
import { discoverAgents, discoverSkills } from "../../core/discovery.ts"

/**
 * Registra en la config viva de OpenCode lo que el plugin declara una sola vez
 * en `skills/` y `agents/`.
 *
 * No se copian archivos: los mismos .md los leen todos los CLIs, y acá se
 * traducen al formato que OpenCode espera. Copias == desincronización.
 */

export type OpenCodeConfig = {
  skills?: { paths?: string[] }
  command?: Record<string, unknown>
  agent?: Record<string, unknown>
}

export function injectConfig(config: OpenCodeConfig, root: string = PLUGIN_ROOT): void {
  const skillsDir = join(root, "skills")

  config.skills ??= {}
  config.skills.paths ??= []
  if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir)

  // Un /comando por skill. No se pisa lo que el usuario ya haya definido con ese
  // nombre: su config gana sobre la nuestra.
  config.command ??= {}
  for (const skill of discoverSkills(root)) {
    config.command[skill.name] ??= {
      template: `Invocá la skill ${skill.name}.`,
      description: skill.description,
    }
  }

  // Los agentes se declaran en el formato neutral (frontmatter + cuerpo) y acá se
  // traducen: el cuerpo pasa a `prompt` y se agrega `mode`, que es un concepto de
  // OpenCode. Sin esto, todo-agent y todo-audit simplemente no existen ahí.
  config.agent ??= {}
  for (const agent of discoverAgents(root)) {
    config.agent[agent.name] ??= {
      description: agent.description,
      prompt: agent.body,
      mode: "subagent",
    }
  }
}
