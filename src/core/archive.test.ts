import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { closingYear, rotateArchives } from "./archive.ts"

function withTodo<T>(files: Record<string, string>, fn: (cwd: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "todo-archive-"))
  try {
    mkdirSync(join(dir, ".todo"), { recursive: true })
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, ".todo", name), content)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const read = (cwd: string, name: string): string => readFileSync(join(cwd, ".todo", name), "utf8")

const DONE = `# Completados — proy

_Última actualización: 2026-01-02_

- [x] **Viejo** — algo _(creado por: A · 2024-11-01)_ ✓ _resuelto: hecho — responsable: A · 2025-02-03T10:00-05:00_
- [x] **Nuevo** — otra _(creado por: A · 2025-12-30)_ ✓ _resuelto: hecho — responsable: A · 2026-01-02T10:00-05:00_
`

test("el año de cierre sale de la ÚLTIMA fecha, no de la de creación", () => {
  assert.equal(
    closingYear("- [x] **X** _(creado por: A · 2024-11-01)_ ✓ _resuelto: … · 2025-02-03T10:00-05:00_"),
    2025,
  )
  assert.equal(closingYear("- [x] **Sin fechas**"), null)
})

test("los items del año en curso se quedan; los viejos se van al archivo del año", () => {
  withTodo({ "DONE.md": DONE }, (cwd) => {
    const rotations = rotateArchives(cwd, 2026)
    assert.deepEqual(rotations, [{ file: "DONE.md", year: 2025, moved: 1 }])

    const quedaron = read(cwd, "DONE.md")
    assert.match(quedaron, /\*\*Nuevo\*\*/)
    assert.doesNotMatch(quedaron, /\*\*Viejo\*\*/)
    assert.match(quedaron, /# Completados — proy/, "el header sobrevive")

    const archivo = read(cwd, "DONE-2025.md")
    assert.match(archivo, /\*\*Viejo\*\*/)
    assert.match(archivo, /^# Completados — proy — 2025/)
  })
})

test("es idempotente: la segunda corrida no mueve nada", () => {
  withTodo({ "DONE.md": DONE }, (cwd) => {
    rotateArchives(cwd, 2026)
    const antes = read(cwd, "DONE-2025.md")
    assert.deepEqual(rotateArchives(cwd, 2026), [])
    assert.equal(read(cwd, "DONE-2025.md"), antes, "el archivo del año no se duplica")
  })
})

test("un item sin fecha se queda: moverlo sin poder fecharlo es perderlo", () => {
  withTodo({ "DONE.md": "# Completados\n\n- [x] **Sin fecha** — vaya a saber\n" }, (cwd) => {
    assert.deepEqual(rotateArchives(cwd, 2026), [])
    assert.match(read(cwd, "DONE.md"), /Sin fecha/)
  })
})

test("DISCARDED.md rota igual, con su línea de continuación", () => {
  const discarded = `# Descartados — proy

- ~~**Viejo**~~ — algo _(creado por: A · 2024-01-01)_
  _Descartado 2024-06-01: ya no aplica_
- ~~**Nuevo**~~ — otra _(creado por: A · 2026-01-01)_
  _Descartado 2026-02-01: tampoco_
`
  withTodo({ "DISCARDED.md": discarded }, (cwd) => {
    assert.deepEqual(rotateArchives(cwd, 2026), [{ file: "DISCARDED.md", year: 2024, moved: 1 }])

    const archivo = read(cwd, "DISCARDED-2024.md")
    assert.match(archivo, /ya no aplica/, "la explicación se va con su item")
    assert.doesNotMatch(read(cwd, "DISCARDED.md"), /ya no aplica/)
    assert.match(read(cwd, "DISCARDED.md"), /tampoco/)
  })
})

test("varios años viejos → un archivo por año", () => {
  const done = `# Completados

- [x] **A** ✓ _resuelto: … · 2024-03-01T10:00-05:00_
- [x] **B** ✓ _resuelto: … · 2025-03-01T10:00-05:00_
- [x] **C** ✓ _resuelto: … · 2026-03-01T10:00-05:00_
`
  withTodo({ "DONE.md": done }, (cwd) => {
    const rotations = rotateArchives(cwd, 2026)
    assert.equal(rotations.length, 2)
    assert.match(read(cwd, "DONE-2024.md"), /\*\*A\*\*/)
    assert.match(read(cwd, "DONE-2025.md"), /\*\*B\*\*/)
    assert.match(read(cwd, "DONE.md"), /\*\*C\*\*/)
  })
})

test("sin los archivos no explota", () => {
  withTodo({}, (cwd) => {
    assert.deepEqual(rotateArchives(cwd, 2026), [])
    assert.equal(existsSync(join(cwd, ".todo", "DONE-2025.md")), false)
  })
})
