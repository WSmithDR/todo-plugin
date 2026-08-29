import { PLUGIN_ROOT } from "../../core/lib/paths/paths.ts"
import { buildInstructions as build, type Dialect } from "../../core/lib/instructions/instructions.ts"

/**
 * El dialecto de Claude Code, y su única diferencia de fondo con OpenCode: acá el
 * índice de skills NO va. Claude Code descubre las del plugin por sí mismo y se
 * las ofrece al modelo; repetirlas sería gastar system prompt en algo que ya está.
 *
 * Las reglas sí van, y en cada sesión. Dos de las tres las hace cumplir el guard
 * en el momento exacto de la violación —que es mejor que cualquier preámbulo—,
 * pero la de preguntar no tiene enforcement posible: a un modelo que pregunta en
 * prosa no lo corrige nadie. Este es su único recordatorio.
 */
const CLAUDE_CODE: Dialect = {
  loadSkill: "Invocá cada skill con el tool Skill:",
  askTool: "AskUserQuestion",
}

export const buildRules = (root: string = PLUGIN_ROOT): string | null =>
  build(root, CLAUDE_CODE, { skipSkillIndex: true })
