import { test } from "node:test"
import assert from "node:assert/strict"
import { openItemTitles, preCommitReview } from "./pre-commit.ts"

const base = {
  hasTodoDir: true,
  staged: ["src/x.ts"],
  markedCheckboxes: 0,
  registeredWork: 0,
  doing: [] as string[],
  todoOpen: [] as { title: string; text: string }[],
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
  assert.equal(preCommitReview({ ...base, todoOpen: itemsFalsos(3) }).action, "advise")
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

// ── tareas rezagadas: las abiertas que hablan del commit ────────────────────

const itemsFalsos = (n: number): { title: string; text: string }[] =>
  Array.from({ length: n }, (_, i) => ({ title: `T${i}`, text: `- [ ] **T${i}** — algo` }))

test("una tarea abierta que menciona un archivo del staging se NOMBRA", () => {
  const d = preCommitReview({
    ...base,
    staged: ["src/core/window.ts", "README.md"],
    todoOpen: [
      { title: "Ventana del guard mal calculada", text: "- [ ] **Ventana del guard mal calculada** — en window.ts el borde" },
      { title: "Otra cosa", text: "- [ ] **Otra cosa** — nada que ver" },
    ],
  })
  const message = d.action === "advise" ? d.message : ""
  assert.match(message, /¿alguna quedó resuelta\?/)
  assert.match(message, /Ventana del guard mal calculada {2}\(menciona window\.ts\)/)
  assert.doesNotMatch(message, /Otra cosa/, "las que no mencionan nada no se listan")
})

test("sin coincidencias se reporta el total y se dice que ninguna matchea", () => {
  const message = (() => {
    const d = preCommitReview({ ...base, staged: ["src/otro.ts"], todoOpen: itemsFalsos(4) })
    return d.action === "advise" ? d.message : ""
  })()
  assert.match(message, /4 items en TODO\.md \(ninguna menciona/)
})

test("los nombres de archivo demasiado comunes no relacionan nada", () => {
  const message = (() => {
    const d = preCommitReview({
      ...base,
      staged: ["package.json", "src/index.ts"],
      todoOpen: [{ title: "Bump", text: "- [ ] **Bump** — tocar package.json y index.ts" }],
    })
    return d.action === "advise" ? d.message : ""
  })()
  assert.doesNotMatch(message, /¿alguna quedó resuelta\?/)
})

test("un archivo del propio .todo/ no relaciona: editarlo es la operación del plugin", () => {
  const message = (() => {
    const d = preCommitReview({
      ...base,
      staged: [".todo/TODO.md"],
      todoOpen: [{ title: "Migrar TODO.md", text: "- [ ] **Migrar TODO.md** — mover a .todo/TODO.md" }],
    })
    return d.action === "advise" ? d.message : ""
  })()
  assert.doesNotMatch(message, /¿alguna quedó resuelta\?/)
})

// ── trabajo ya registrado en DONE/DISCARDED → allow, no peaje ──────────────

test("staging con item cerrado en DONE.md → ALLOW", () => {
  const decision = preCommitReview({
    hasTodoDir: true,
    staged: ["src/auth.py", ".todo/DONE.md"],
    markedCheckboxes: 0,
    registeredWork: 1,
    doing: [],
    todoOpen: [],
    recentCommits: [],
  })
  assert.equal(decision.action, "allow")
})

test("checkbox huérfano en TODO sigue ganando aunque DONE traiga trabajo", () => {
  const decision = preCommitReview({
    hasTodoDir: true,
    staged: [".todo/TODO.md", ".todo/DONE.md"],
    markedCheckboxes: 2,
    registeredWork: 1,
    doing: [],
    todoOpen: [],
    recentCommits: [],
  })
  assert.equal(decision.action, "deny")
})

test("sin trabajo registrado ni checkboxes, sigue el advise de siempre", () => {
  const decision = preCommitReview({
    hasTodoDir: true,
    staged: ["src/x.ts"],
    markedCheckboxes: 0,
    registeredWork: 0,
    doing: [],
    todoOpen: [],
    recentCommits: [],
  })
  assert.equal(decision.action, "advise")
})
