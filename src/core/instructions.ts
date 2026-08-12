import { PLUGIN_ROOT } from "./paths.ts"
import { discoverSkills } from "./discovery.ts"

/**
 * El índice de skills y las reglas duras, para el system prompt del CLI que sea.
 *
 * Vivía dentro del adapter de OpenCode, que era el único con canal para esto. Pero
 * el contenido no tiene nada de OpenCode: las reglas son del plugin y las skills
 * salen del mismo `skills/`. Lo único que cambia entre CLIs es cómo se llaman los
 * tools, y eso entra por el dialecto — que sí es cosa del adapter.
 */

export type Dialect = {
  /** Cómo se le pide a este CLI que cargue una skill. */
  loadSkill: string
  /** El tool de preguntas de este CLI. */
  askTool: string
}

export type InstructionsOptions = {
  /** Sin el índice: para un CLI que ya le muestra las skills al modelo por su cuenta. */
  skipSkillIndex?: boolean
}

export function buildInstructions(
  root: string = PLUGIN_ROOT,
  dialect: Dialect,
  opts: InstructionsOptions = {},
): string | null {
  const skills = discoverSkills(root)
  if (skills.length === 0) return null

  const index = opts.skipSkillIndex === true
    ? ""
    : `${dialect.loadSkill}\n\n${skills.map((skill) => `- \`${skill.name}\` — ${skill.description}`).join("\n")}\n\n`

  return `## todo-plugin — gestión de tareas por proyecto en \`.todo/\`

${index}Reglas duras:
- NUNCA marques \`- [x]\` a mano en .todo/TODO.md ni DOING.md: un item completado
  se MUEVE a DONE.md vía la skill \`todo-done\`. El guard y el pre-commit lo bloquean,
  y esa regla ni siquiera la autoriza la ventana de escritura.
- NUNCA edites archivos de .todo/ directamente: usá la skill correspondiente, que
  abre la ventana de escritura automáticamente.
- Toda pregunta al usuario va por \`${dialect.askTool}\`, con las opciones enumeradas.
  Las SKILL.md dicen \`AskUserQuestion\` porque son un solo archivo para todos los
  CLIs: leelo como "el equivalente de este CLI", que acá es \`${dialect.askTool}\`.
  Una pregunta enterrada en un párrafo se contesta con "dale", y ahí una decisión
  del usuario se volvió una decisión del modelo.`
}
