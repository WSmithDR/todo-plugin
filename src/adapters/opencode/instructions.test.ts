import { test } from "node:test"
import assert from "node:assert/strict"
import { PLUGIN_ROOT } from "../../core/lib/paths/paths.ts"
import { buildInstructions } from "./instructions.ts"

test("el índice de skills llega con las reglas duras", () => {
  const instructions = buildInstructions(PLUGIN_ROOT) ?? ""
  assert.match(instructions, /todo-add/, "las skills se listan")
  assert.match(instructions, /NUNCA marques `- \[x\]` a mano/)
  assert.match(instructions, /NUNCA edites archivos de \.todo\/ directamente/)
})

test("la regla de preguntar traduce el tool al CLI que corre", () => {
  // Las SKILL.md dicen AskUserQuestion porque son un archivo solo para los dos
  // CLIs; acá se aclara cómo se llama el equivalente en OpenCode.
  const instructions = buildInstructions(PLUGIN_ROOT) ?? ""
  assert.match(instructions, /Toda pregunta al usuario va por `question`/)
  assert.match(instructions, /AskUserQuestion/, "y se aclara cómo lo nombran las SKILL.md")
})
