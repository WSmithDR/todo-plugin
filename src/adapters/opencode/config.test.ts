import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { PLUGIN_ROOT } from "../../core/lib/paths/paths.ts"
import { injectConfig, type OpenCodeConfig } from "./config.ts"

test("registra el dir de skills del plugin", () => {
  const config: OpenCodeConfig = {}
  injectConfig(config, PLUGIN_ROOT)
  assert.ok(config.skills?.paths?.includes(join(PLUGIN_ROOT, "skills")))
})

test("no duplica el path si ya estaba", () => {
  const skillsDir = join(PLUGIN_ROOT, "skills")
  const config: OpenCodeConfig = { skills: { paths: [skillsDir] } }
  injectConfig(config, PLUGIN_ROOT)
  assert.equal(config.skills!.paths!.filter((p) => p === skillsDir).length, 1)
})

test("genera un /comando por skill", () => {
  const config: OpenCodeConfig = {}
  injectConfig(config, PLUGIN_ROOT)
  assert.ok(config.command?.["todo-add"], "esperaba el comando de todo-add")
  assert.ok(Object.keys(config.command!).length >= 10)
})

test("traduce los agentes al formato de OpenCode", () => {
  const config: OpenCodeConfig = {}
  injectConfig(config, PLUGIN_ROOT)

  const agent = config.agent?.["todo-audit"] as { prompt?: string; mode?: string; description?: string } | undefined
  assert.ok(agent, "todo-audit no se registró")
  assert.equal(agent!.mode, "subagent")
  assert.ok(agent!.description)
  assert.ok((agent!.prompt ?? "").length > 100, "el cuerpo del .md tiene que ir a prompt")
  assert.doesNotMatch(agent!.prompt ?? "", /^---/, "el frontmatter no puede quedar en el prompt")
})

test("lo que el usuario ya definió gana", () => {
  const config: OpenCodeConfig = {
    command: { "todo-add": { template: "mío" } },
    agent: { "todo-audit": { prompt: "mío" } },
  }
  injectConfig(config, PLUGIN_ROOT)
  assert.deepEqual(config.command!["todo-add"], { template: "mío" })
  assert.deepEqual(config.agent!["todo-audit"], { prompt: "mío" })
})

test("un root sin skills ni agents no rompe", () => {
  const config: OpenCodeConfig = {}
  injectConfig(config, "/no/existe")
  assert.deepEqual(config.command, {})
  assert.deepEqual(config.agent, {})
})
