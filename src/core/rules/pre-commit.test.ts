import { test } from "node:test"
import assert from "node:assert/strict"
import { openItemTitles, preCommitReview } from "./pre-commit.ts"

const base = {
  hasTodoDir: true,
  staged: ["src/x.ts"],
  markedCheckboxes: 0,
  doing: [] as string[],
  todoCount: 0,
  recentCommits: ["abc123 fix: algo"],
}

test("sin .todo/ → allow", () => {
  assert.equal(preCommitReview({ ...base, hasTodoDir: false }).action, "allow")
})

test("sin nada en staging → allow", () => {
  assert.equal(preCommitReview({ ...base, staged: [] }).action, "allow")
})

test("sin tareas abiertas → advise igual: el commit puede resolver algo no contemplado", () => {
  const d = preCommitReview(base)
  assert.equal(d.action, "advise")
  const message = d.action === "advise" ? d.message : ""
  assert.match(message, /Sin tareas abiertas/)
  assert.match(message, /NO figura en TODO\.md\/DOING\.md → NO uses --no-verify/)
})

test("tareas en DOING + staging → advise con los títulos", () => {
  const d = preCommitReview({ ...base, doing: ["Arreglar el guard", "Migrar el store"] })
  assert.equal(d.action, "advise")
  const message = d.action === "advise" ? d.message : ""
  assert.match(message, /TODO-PRE-COMMIT/)
  assert.match(message, /Arreglar el guard/)
  assert.match(message, /--no-verify/)
})

test("solo TODO.md con items → advise", () => {
  assert.equal(preCommitReview({ ...base, todoCount: 3 }).action, "advise")
})

test("'- [x]' staged → deny, y NO admite --no-verify", () => {
  const d = preCommitReview({ ...base, markedCheckboxes: 2 })
  assert.equal(d.action, "deny")
  const message = d.action === "deny" ? d.message : ""
  assert.match(message, /2 checkbox/)
  assert.match(message, /--no-verify NO corresponde/)
})

test("el guard duro gana aunque no haya nada más en staging", () => {
  assert.equal(preCommitReview({ ...base, staged: [], markedCheckboxes: 1 }).action, "deny")
})

test("la lista de DOING se recorta a 8", () => {
  const doing = Array.from({ length: 12 }, (_, i) => `Tarea ${i}`)
  const d = preCommitReview({ ...base, doing })
  const message = d.action === "advise" ? d.message : ""
  assert.match(message, /12 en DOING\.md/, "el total se reporta completo")
  assert.match(message, /Tarea 7/)
  assert.doesNotMatch(message, /Tarea 8/, "solo se listan 8")
})

test("openItemTitles extrae el título en negrita", () => {
  const md = `# TODOs

- [ ] **Primero** — con descripción
- [x] **Completado** — no cuenta
- [ ] **Segundo** — otra
`
  assert.deepEqual(openItemTitles(md), ["Primero", "Segundo"])
})

test("un item sin negrita cae a la línea completa en vez de perderse", () => {
  assert.deepEqual(openItemTitles("- [ ] suelto sin formato"), ["- [ ] suelto sin formato"])
})
