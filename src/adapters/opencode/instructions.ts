import { PLUGIN_ROOT } from "../../core/lib/paths/paths.ts"
import { buildInstructions as build, type Dialect } from "../../core/lib/instructions/instructions.ts"

/**
 * El dialecto de OpenCode. Lo único específico del CLI que quedó acá: el texto y
 * las reglas viven en `core/instructions.ts`, compartidos con los demás.
 *
 * Va por `experimental.chat.system.transform` y no por `messages.transform`: no
 * hay que mutar el mensaje del usuario ni cuidarse de la doble inyección, porque
 * el array de system se arma de cero en cada request.
 */
const OPENCODE: Dialect = {
  loadSkill: "Cargá cada skill con el tool nativo `skill` cuando aplique:",
  askTool: "question",
}

export const buildInstructions = (root: string = PLUGIN_ROOT): string | null => build(root, OPENCODE)
