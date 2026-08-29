import { test } from "node:test"
import assert from "node:assert/strict"
import { discoverAgents, discoverSkills, parseFrontmatter } from "./discovery.ts"
import { PLUGIN_ROOT } from "../paths/paths.ts"

test("parseFrontmatter separa campos y cuerpo", () => {
  const { fields, body } = parseFrontmatter(`---
name: todo-add
description: "Agrega items"
---
El cuerpo.
`)
  assert.equal(fields.name, "todo-add")
  assert.equal(fields.description, "Agrega items", "las comillas se descartan")
  assert.equal(body, "El cuerpo.")
})

test("sin frontmatter, todo es cuerpo", () => {
  const { fields, body } = parseFrontmatter("Solo texto.")
  assert.deepEqual(fields, {})
  assert.equal(body, "Solo texto.")
})

test("un valor con ':' adentro no se corta", () => {
  const { fields } = parseFrontmatter("---\ndescription: Usar cuando: pasa algo\n---\n")
  assert.equal(fields.description, "Usar cuando: pasa algo")
})

// Contra el plugin real: si alguien renombra skills/ o rompe un frontmatter,
// esto se cae. Es el germen del conformance check de la fase 4.

test("se descubren las skills reales del plugin", () => {
  const skills = discoverSkills(PLUGIN_ROOT)
  assert.ok(skills.length >= 10, `esperaba las skills del plugin, encontré ${skills.length}`)
  assert.ok(skills.some((s) => s.slug === "todo-add"))
})

test("toda skill declara name y description", () => {
  for (const skill of discoverSkills(PLUGIN_ROOT)) {
    assert.ok(skill.name, `${skill.slug} sin name`)
    assert.ok(skill.description, `${skill.slug} sin description`)
  }
})

test("se descubren los agentes reales y traen cuerpo", () => {
  const agents = discoverAgents(PLUGIN_ROOT)
  assert.deepEqual(agents.map((a) => a.slug).sort(), ["todo-agent", "todo-audit"])
  for (const agent of agents) {
    assert.ok(agent.body.length > 0, `${agent.slug} sin cuerpo`)
    assert.doesNotMatch(agent.body, /^---/, "el frontmatter no puede quedar en el prompt")
  }
})

test("un directorio inexistente devuelve []", () => {
  assert.deepEqual(discoverSkills("/no/existe"), [])
  assert.deepEqual(discoverAgents("/no/existe"), [])
})
