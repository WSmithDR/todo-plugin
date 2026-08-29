import { test } from "node:test"
import assert from "node:assert/strict"
import { PLUGIN_ROOT } from "../paths/paths.ts"
import { buildInstructions, type Dialect } from "./instructions.ts"

const CLI_IMAGINARIO: Dialect = { loadSkill: "Cargá una skill así:", askTool: "preguntame" }

test("el dialecto decide cómo se nombra el tool de preguntas", () => {
  const instructions = buildInstructions(PLUGIN_ROOT, CLI_IMAGINARIO) ?? ""
  assert.match(instructions, /va por `preguntame`/)
  assert.doesNotMatch(instructions, /`question`/, "no se filtra el dialecto de otro CLI")
})

test("las reglas duras no dependen del dialecto", () => {
  const instructions = buildInstructions(PLUGIN_ROOT, CLI_IMAGINARIO) ?? ""
  assert.match(instructions, /NUNCA marques `- \[x\]` a mano/)
  assert.match(instructions, /NUNCA edites archivos de \.todo\/ directamente/)
})

test("un CLI que ya muestra sus skills puede pedir solo las reglas", () => {
  const instructions = buildInstructions(PLUGIN_ROOT, CLI_IMAGINARIO, { skipSkillIndex: true }) ?? ""
  assert.match(instructions, /Reglas duras/)
  assert.doesNotMatch(instructions, /Cargá una skill así/)
  assert.doesNotMatch(instructions, /- `todo-add`/, "sin el índice")
})
