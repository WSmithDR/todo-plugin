import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decideBefore, decideSessionClose } from "./pipeline.ts"
import { clearTouched, touchedProjects } from "./session-state.ts"
import { openWindow } from "./window.ts"

// El estado y el store son reales: se apuntan a un temp para no tocar los del
// usuario. XDG_DATA_HOME además decide dónde está el store.
const HOME = mkdtempSync(join(tmpdir(), "todo-pipeline-"))
process.env.XDG_CACHE_HOME = join(HOME, "cache")
process.env.XDG_DATA_HOME = join(HOME, "data")
process.on("exit", () => rmSync(HOME, { recursive: true, force: true }))

const STORE = join(HOME, "data", "todo")

function proyecto(id: string, doing: string): string {
  const dir = join(STORE, id)
  mkdirSync(join(dir, ".todo"), { recursive: true })
  writeFileSync(join(dir, ".todo", "config.json"), JSON.stringify({ id, name: id }))
  writeFileSync(join(dir, ".todo", "DOING.md"), doing)
  return dir
}

const evento = (path: string): Parameters<typeof decideBefore>[0] => ({
  phase: "before",
  kind: "edit",
  paths: [path],
  contents: ["- [ ] **X** — algo"],
  cwd: "/afuera",
})

test("una escritura al store con la ventana abierta marca el proyecto como tocado", () => {
  const dir = proyecto("web-uno", "- [ ] **Media pila** — en curso\n")
  clearTouched()
  openWindow()

  assert.equal(decideBefore(evento(join(dir, ".todo", "TODO.md"))).action, "allow")
  assert.deepEqual(touchedProjects(), [dir])
})

test("un archivo fuera del store no marca nada", () => {
  clearTouched()
  openWindow()

  decideBefore(evento("/otro/lado/.todo/TODO.md"))
  assert.deepEqual(touchedProjects(), [])
})

test("al cerrar la sesión avisa de lo que quedó en curso, solo de lo tocado", () => {
  const tocado = proyecto("web-dos", "- [ ] **Sin cerrar** — en curso\n")
  proyecto("web-tres", "- [ ] **Ni la abrí** — en curso\n")

  clearTouched()
  openWindow()
  decideBefore(evento(join(tocado, ".todo", "TODO.md")))

  const d = decideSessionClose("/afuera", "session-end")
  const message = d.action === "advise" ? d.message : ""
  assert.match(message, /TODO-SESSION-END/)
  assert.match(message, /"Sin cerrar"/)
  assert.doesNotMatch(message, /Ni la abrí/, "de un proyecto que no tocaste no se habla")
})

test("el aviso sale una vez: consume el marcador", () => {
  const dir = proyecto("web-cuatro", "- [ ] **Sin cerrar** — en curso\n")
  clearTouched()
  openWindow()
  decideBefore(evento(join(dir, ".todo", "TODO.md")))

  assert.equal(decideSessionClose("/afuera", "session-end").action, "advise")
  assert.equal(decideSessionClose("/afuera", "session-end").action, "allow")
})

test("per-request no habla de los proyectos del store: la sesión no terminó", () => {
  const dir = proyecto("web-cinco", "- [ ] **Sin cerrar** — en curso\n")
  clearTouched()
  openWindow()
  decideBefore(evento(join(dir, ".todo", "TODO.md")))

  assert.equal(
    decideSessionClose("/afuera", "per-request").action,
    "allow",
    "a mitad de sesión, decirte que cierres es apurarte",
  )
  assert.deepEqual(touchedProjects(), [dir], "y el marcador sigue vivo para el cierre real")
})

test("sin tareas en curso no hay nada que avisar", () => {
  const dir = proyecto("web-seis", "# DOING\n")
  clearTouched()
  openWindow()
  decideBefore(evento(join(dir, ".todo", "TODO.md")))

  assert.equal(decideSessionClose("/afuera", "session-end").action, "allow")
})
