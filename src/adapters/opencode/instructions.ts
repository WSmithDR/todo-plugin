import { PLUGIN_ROOT } from "../../core/paths.ts"
import { discoverSkills } from "../../core/discovery.ts"

/**
 * Índice de skills + reglas duras, para el system prompt.
 *
 * Va por `experimental.chat.system.transform` y no por `messages.transform`: no
 * hay que mutar el mensaje del usuario ni cuidarse de la doble inyección, porque
 * el array de system se arma de cero en cada request.
 */
export function buildInstructions(root: string = PLUGIN_ROOT): string | null {
  const skills = discoverSkills(root)
  if (skills.length === 0) return null

  const index = skills.map((skill) => `- \`${skill.name}\` — ${skill.description}`).join("\n")

  return `## todo-plugin — gestión de tareas por proyecto en \`.todo/\`

Cargá cada skill con el tool nativo \`skill\` cuando aplique:

${index}

Reglas duras:
- NUNCA marques \`- [x]\` a mano en .todo/TODO.md ni DOING.md: un item completado
  se MUEVE a DONE.md vía la skill \`todo-done\`. El guard y el pre-commit lo bloquean,
  y esa regla ni siquiera la autoriza la ventana de escritura.
- NUNCA edites archivos de .todo/ directamente: usá la skill correspondiente, que
  abre la ventana de escritura automáticamente.`
}
