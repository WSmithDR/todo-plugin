import { test } from "node:test"
import assert from "node:assert/strict"
import { editingItem } from "./editing-item.ts"
import type { ToolEvent } from "../../protocol.ts"

const edito = (path: string): ToolEvent => ({
  phase: "after",
  kind: "edit",
  paths: [path],
  contents: [],
  cwd: "/p",
  result: { ok: true, text: "" },
})

/** Por defecto todo aviso es nuevo; los tests que miden la repetición lo cambian. */
const ctx = (over: Partial<Parameters<typeof editingItem>[1]> = {}) => ({
  hasTodoDir: true,
  todo: [{ title: "Arreglar el store", text: "- [ ] **Arreglar el store** — falla en `bin/todo-store.sh` al crear" }],
  doing: [] as string[],
  advisedOnce: () => true,
  ...over,
})

test("editar un archivo que una tarea abierta menciona → advise", () => {
  const d = editingItem(edito("/p/bin/todo-store.sh"), ctx())
  assert.equal(d.action, "advise")
  const message = d.action === "advise" ? d.message : ""
  assert.match(message, /Arreglar el store/)
  assert.match(message, /todo-doing/)
})

test("si la tarea YA está en DOING → allow", () => {
  assert.equal(editingItem(edito("/p/bin/todo-store.sh"), ctx({ doing: ["Arreglar el store"] })).action, "allow")
})

test("un archivo que ninguna tarea menciona → allow", () => {
  assert.equal(editingItem(edito("/p/src/otro.ts"), ctx()).action, "allow")
})

// El hook corre en CADA edición: sin esto, el mismo aviso saldría una y otra vez
// y el modelo aprendería a saltearlo.
test("el aviso no se repite", () => {
  assert.equal(editingItem(edito("/p/bin/todo-store.sh"), ctx({ advisedOnce: () => false })).action, "allow")
})

test("editar el propio .todo/ no cuenta como trabajar en la tarea", () => {
  const c = ctx({ todo: [{ title: "x", text: "- [ ] **x** — sobre TODO.md" }] })
  assert.equal(editingItem(edito("/p/.todo/TODO.md"), c).action, "allow")
})

// Sin este filtro, una tarea que menciona index.ts avisaría al tocar cualquier
// index.ts del repo.
test("los nombres demasiado comunes no matchean", () => {
  const c = ctx({ todo: [{ title: "y", text: "- [ ] **y** — tocar index.ts" }] })
  assert.equal(editingItem(edito("/p/src/index.ts"), c).action, "allow")
})

test("un basename muy corto tampoco", () => {
  const c = ctx({ todo: [{ title: "z", text: "- [ ] **z** — sobre a.ts" }] })
  assert.equal(editingItem(edito("/p/a.ts"), c).action, "allow")
})

test("solo en fase after y sobre tools de escritura", () => {
  const evento = edito("/p/bin/todo-store.sh")
  assert.equal(editingItem({ ...evento, phase: "before" }, ctx()).action, "allow")
  assert.equal(editingItem({ ...evento, kind: "bash" }, ctx()).action, "allow")
})

test("sin .todo/ o sin tareas abiertas → allow", () => {
  assert.equal(editingItem(edito("/p/bin/todo-store.sh"), ctx({ hasTodoDir: false })).action, "allow")
  assert.equal(editingItem(edito("/p/bin/todo-store.sh"), ctx({ todo: [] })).action, "allow")
})
