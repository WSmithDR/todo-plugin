import { test } from "node:test"
import assert from "node:assert/strict"
import { creationDate, mentionedFiles, staleCandidates, type Change } from "./stale-items.ts"

const item = (title: string, text: string): { title: string; text: string } => ({ title, text })

const commit = (sha: string, date: string, files: string[]): Change => ({ sha, date, subject: "fix: algo", files })

test("la fecha de creación sale de la metadata, no de otras fechas de la línea", () => {
  const text = "- [ ] **X** — algo _(creado por: SmithDR · 2026-07-01 | iniciado: 2026-08-30T10:00-05:00)_"
  assert.equal(creationDate(text), "2026-07-01")
  assert.equal(creationDate("- [ ] **X** — sin metadata"), null)
})

test("los archivos nombrados salen del texto, sin los que están en todos lados", () => {
  const text = "- [ ] **X** — tocar window-calc.ts y package.json, ver estilos.scss"
  assert.deepEqual(mentionedFiles(text).sort(), ["estilos.scss", "window-calc.ts"])
})

test("un archivo cambiado DESPUÉS de crearse la tarea la marca como candidata", () => {
  const items = [item("Ventana mal calculada", "- [ ] **Ventana mal calculada** — en window-calc.ts _(creado por: T · 2026-07-01)_")]
  const { candidates } = staleCandidates(items, [commit("a1b2c3d", "2026-07-15", ["src/core/window-calc.ts"])])

  assert.equal(candidates.length, 1)
  assert.deepEqual(candidates[0]?.files, [{ name: "window-calc.ts", sharedBy: 1 }])
  assert.equal(candidates[0]?.changes[0]?.sha, "a1b2c3d")
})

test("un cambio ANTERIOR a la tarea no cuenta: la tarea se creó sabiéndolo", () => {
  const items = [item("X", "- [ ] **X** — en window-calc.ts _(creado por: T · 2026-07-01)_")]
  assert.equal(staleCandidates(items, [commit("a1", "2026-06-30", ["src/window-calc.ts"])]).candidates.length, 0)
})

test("un commit en otro archivo no relaciona", () => {
  const items = [item("X", "- [ ] **X** — en window-calc.ts _(creado por: T · 2026-07-01)_")]
  assert.equal(staleCandidates(items, [commit("a1", "2026-08-01", ["src/otra-cosa.ts"])]).candidates.length, 0)
})

test("los items sin fecha o sin archivos se cuentan aparte, no se pierden en silencio", () => {
  const items = [
    item("Sin fecha", "- [ ] **Sin fecha** — toca window-calc.ts"),
    item("Sin archivos", "- [ ] **Sin archivos** — mejorar la comunicación _(creado por: T · 2026-07-01)_"),
  ]
  const { candidates, skipped } = staleCandidates(items, [commit("a1", "2026-08-01", ["src/window-calc.ts"])])
  assert.equal(candidates.length, 0)
  assert.equal(skipped, 2)
})

test("se listan todos los commits que tocaron el archivo, no solo el primero", () => {
  const items = [item("X", "- [ ] **X** — en window-calc.ts _(creado por: T · 2026-07-01)_")]
  const changes = [
    commit("a1", "2026-07-15", ["src/window-calc.ts"]),
    commit("b2", "2026-08-01", ["src/window-calc.ts", "otro.ts"]),
  ]
  assert.equal(staleCandidates(items, changes).candidates[0]?.changes.length, 2)
})

test("un archivo que mencionan varias tareas se reporta como señal débil, no se filtra", () => {
  // El caso real: en un tema de WordPress media lista menciona functions.php.
  // Antes se resolvía metiendo el nombre en una lista fija, que crece sin fondo
  // con cada stack. Ahora el número lo dice el propio proyecto.
  const items = [
    item("A", "- [ ] **A** — en functions.php _(creado por: T · 2026-07-01)_"),
    item("B", "- [ ] **B** — también functions.php _(creado por: T · 2026-07-01)_"),
    item("C", "- [ ] **C** — en design-tokens.md _(creado por: T · 2026-07-01)_"),
  ]
  const changes = [commit("a1", "2026-08-01", ["theme/functions.php", "docs/design-tokens.md"])]
  const { candidates } = staleCandidates(items, changes)

  assert.equal(candidates.length, 3, "ninguna se descarta en silencio")
  assert.equal(candidates.find((c) => c.title === "A")?.files[0]?.sharedBy, 2)
  assert.equal(candidates.find((c) => c.title === "C")?.files[0]?.sharedBy, 1)
})
