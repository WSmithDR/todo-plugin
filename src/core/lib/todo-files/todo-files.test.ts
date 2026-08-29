import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { editingContext } from "./todo-files.ts"

// ── contexto de editing-item: cwd o proyecto del store ─────────────────────

test("editingContext usa el .todo/ del cwd cuando existe", () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-ctx-"))
  try {
    mkdirSync(join(dir, ".todo"), { recursive: true })
    writeFileSync(join(dir, ".todo", "TODO.md"), "- [ ] **Arreglar el popup** — toca popup-942.html\n")
    const ctx = editingContext(dir, ["/otro/lado/archivo.php"])
    assert.equal(ctx?.dir, dir)
    assert.deepEqual(ctx?.todo.map((i) => i.title), ["Arreglar el popup"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("sin .todo/ local, el proyecto sale del path del archivo editado", () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-ctx-store-"))
  try {
    const env = { HOME: dir, XDG_DATA_HOME: join(dir, "data") }
    const base = join(env.XDG_DATA_HOME, "todo")
    const proyecto = join(base, "web-vnf")
    mkdirSync(join(proyecto, ".todo"), { recursive: true })
    mkdirSync(join(proyecto, "code"), { recursive: true })
    writeFileSync(join(proyecto, ".todo", "config.json"), JSON.stringify({ id: "web-vnf", name: "web-vnf" }))
    writeFileSync(join(proyecto, ".todo", "TODO.md"), "- [ ] **Donaciones a 3 columnas** — en vnf-donations.php\n")

    const afuera = join(dir, "cwd-sin-todo")
    mkdirSync(afuera, { recursive: true })

    const ctx = editingContext(afuera, [join(proyecto, "code", "vnf-donations.php")], env)
    assert.equal(ctx?.dir, proyecto, "el dueño del path define el proyecto")
    assert.deepEqual(ctx?.todo.map((i) => i.title), ["Donaciones a 3 columnas"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("un archivo fuera del store y sin .todo/ local → null", () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-ctx-nada-"))
  try {
    const env = { HOME: dir, XDG_DATA_HOME: join(dir, "data") }
    assert.equal(editingContext(dir, ["/tmp/cualquier/cosa.php"], env), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
