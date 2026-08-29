import { test } from "node:test"
import assert from "node:assert/strict"
import { sessionClose } from "./session-close.ts"

const base = { hasTodoDir: true, doing: ["Migrar el store"], headMoved: true }

test("commits + tareas en DOING → advise", () => {
  const d = sessionClose(base)
  assert.equal(d.action, "advise")
  const message = d.action === "advise" ? d.message : ""
  assert.match(message, /TODO-SESSION-END/)
  assert.match(message, /Migrar el store/)
  assert.match(message, /todo-done/)
})

// La condición del HEAD es lo que separa "algo se terminó" de "sigo en la misma
// tarea". Sin ella el aviso saldría en cada sesión que abrieras con DOING lleno.
test("sin commits → allow aunque DOING tenga items", () => {
  assert.equal(sessionClose({ ...base, headMoved: false }).action, "allow")
})

test("DOING vacío → allow aunque haya commits", () => {
  assert.equal(sessionClose({ ...base, doing: [] }).action, "allow")
})

test("sin .todo/ → allow", () => {
  assert.equal(sessionClose({ ...base, hasTodoDir: false }).action, "allow")
})

test("con muchas tareas se listan 8 y se cuenta el resto", () => {
  const doing = Array.from({ length: 11 }, (_, i) => `Tarea ${i}`)
  const d = sessionClose({ ...base, doing })
  const message = d.action === "advise" ? d.message : ""
  assert.match(message, /quedan 11 tarea/)
  assert.match(message, /Tarea 7/)
  assert.doesNotMatch(message, /· Tarea 8/)
  assert.match(message, /y 3 más/)
})
