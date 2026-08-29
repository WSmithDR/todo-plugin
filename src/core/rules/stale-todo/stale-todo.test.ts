import { test } from "node:test"
import assert from "node:assert/strict"
import { staleTodo } from "./stale-todo.ts"
import { daysSinceReview } from "../../lib/todo-files/todo-files.ts"

const base = { hasTodoDir: true, todoCount: 3, daysSinceReview: 5 }

const messageOf = (input: Parameters<typeof staleTodo>[0]): string => {
  const d = staleTodo(input)
  return d.action === "advise" ? d.message : ""
}

test("lista chica y fresca → silencio", () => {
  assert.equal(staleTodo(base).action, "allow")
})

test("sin .todo/ o sin items abiertos → silencio", () => {
  assert.equal(staleTodo({ ...base, hasTodoDir: false, todoCount: 40 }).action, "allow")
  assert.equal(staleTodo({ ...base, todoCount: 0, daysSinceReview: 900 }).action, "allow")
})

test("lista larga → advise nombrando el motivo", () => {
  const message = messageOf({ ...base, todoCount: 12 })
  assert.match(message, /TODO-TRIAGE-DUE/)
  assert.match(message, /12 items abiertos/)
  assert.match(message, /todo-triage/)
})

test("lista vieja → advise aunque sea corta", () => {
  assert.match(messageOf({ ...base, daysSinceReview: 31 }), /31 días sin revisar/)
})

test("sin línea de última revisión no se inventa antigüedad", () => {
  assert.equal(staleTodo({ ...base, daysSinceReview: null }).action, "allow")
})

test("los dos motivos juntos se reportan juntos", () => {
  const message = messageOf({ todoCount: 20, daysSinceReview: 60, hasTodoDir: true })
  assert.match(message, /20 items abiertos y 60 días sin revisar/)
})

test("daysSinceReview lee el encabezado real de TODO.md", () => {
  const md = "# TODOs — proy\n\n_Última revisión: 2026-08-01_\n\n- [ ] **X**\n"
  assert.equal(daysSinceReview(md, new Date("2026-08-11T12:00:00")), 10)
  assert.equal(daysSinceReview("# TODOs\n\n- [ ] **X**\n", new Date("2026-08-11T12:00:00")), null)
})
