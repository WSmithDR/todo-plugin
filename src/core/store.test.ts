import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { create, list, mode, projectPath, slugify } from "./store.ts"

// Los commits del store necesitan identidad git, que en CI puede no existir.
process.env.GIT_AUTHOR_NAME ||= "T"
process.env.GIT_AUTHOR_EMAIL ||= "t@t.com"
process.env.GIT_COMMITTER_NAME ||= "T"
process.env.GIT_COMMITTER_EMAIL ||= "t@t.com"

function withStore<T>(fn: (env: Record<string, string>, base: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "todo-store-"))
  try {
    return fn({ XDG_DATA_HOME: dir }, join(dir, "todo"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── slugify: los acentos se transliteran, no se descartan ──────────────────

test("café → cafe, no caf", () => {
  assert.equal(slugify("café"), "cafe")
})

test("nombres con tildes y ñ", () => {
  assert.equal(slugify("Panadería Ñandú"), "panaderia-nandu")
})

test("se colapsan los separadores y se recortan los bordes", () => {
  assert.equal(slugify("  Mi   Proyecto!!  "), "mi-proyecto")
})

test("un nombre sin nada slugificable cae al default", () => {
  assert.equal(slugify("¡¿!?"), "proyecto")
})

// ── mode: comparación por path físico ──────────────────────────────────────

test("un dir del store con symlink en la base es nonrepo, no repo", () => {
  const real = mkdtempSync(join(tmpdir(), "todo-real-"))
  const linkParent = mkdtempSync(join(tmpdir(), "todo-link-"))
  try {
    const link = join(linkParent, "data")
    symlinkSync(real, link)

    const project = join(real, "todo", "proyecto-x")
    mkdirSync(project, { recursive: true })
    // Sin esto el test pasaría igual: es lo que hacía que la versión con $PWD
    // lógico devolviera "repo" y el plugin escribiera fuera del store.
    execFileSync("git", ["-C", project, "init", "-q"])

    assert.equal(mode(project, { env: { XDG_DATA_HOME: link } }), "nonrepo")
  } finally {
    rmSync(real, { recursive: true, force: true })
    rmSync(linkParent, { recursive: true, force: true })
  }
})

test("un repo git fuera del store es repo", () => {
  withStore((env) => {
    const repo = mkdtempSync(join(tmpdir(), "todo-repo-"))
    try {
      execFileSync("git", ["-C", repo, "init", "-q"])
      assert.equal(mode(repo, { env }), "repo")
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

test("un dir suelto sin git es nonrepo", () => {
  withStore((env) => {
    const loose = mkdtempSync(join(tmpdir(), "todo-loose-"))
    try {
      assert.equal(mode(loose, { env }), "nonrepo")
    } finally {
      rmSync(loose, { recursive: true, force: true })
    }
  })
})

// ── create ─────────────────────────────────────────────────────────────────

test("create registra el proyecto y lo commitea", () => {
  withStore((env, base) => {
    const id = create("Mi Sitio", { env, now: new Date(2026, 7, 3) })
    assert.equal(id, "mi-sitio")

    const config = JSON.parse(readFileSync(join(base, id, ".todo", "config.json"), "utf8"))
    assert.equal(config.name, "Mi Sitio")
    assert.equal(config.id, "mi-sitio")
    assert.equal(config.created_at, "2026-08-03")
    assert.equal(config.gitignore_todo, false)

    const status = execFileSync("git", ["-C", base, "status", "--porcelain"], { encoding: "utf8" })
    assert.equal(status.trim(), "", "el config debe quedar commiteado, no sin stagear")
  })
})

test("dos proyectos con el mismo nombre → sufijo -2", () => {
  withStore((env) => {
    assert.equal(create("Sitio", { env }), "sitio")
    assert.equal(create("Sitio", { env }), "sitio-2")
  })
})

test("si el commit falla no queda un directorio huérfano", () => {
  withStore((env, base) => {
    // Un index.lock preexistente hace fallar el add/commit de forma determinista.
    mkdirSync(base, { recursive: true })
    execFileSync("git", ["-C", base, "init", "-q"])
    writeFileSync(join(base, ".git", "index.lock"), "")

    assert.throws(() => create("Fallido", { env }))
    assert.equal(
      existsSync(join(base, "fallido")),
      false,
      "el dir tiene que limpiarse: si queda, el próximo create del mismo nombre se corre a -2",
    )
  })
})

// ── list / projectPath ─────────────────────────────────────────────────────

test("list devuelve los proyectos registrados", () => {
  withStore((env) => {
    create("Uno", { env })
    create("Dos", { env })
    assert.deepEqual(
      list({ env }).map((p) => p.id).sort(),
      ["dos", "uno"],
    )
  })
})

test("list ignora un config.json corrupto en vez de romperse", () => {
  withStore((env, base) => {
    create("Bueno", { env })
    const roto = join(base, "roto", ".todo")
    mkdirSync(roto, { recursive: true })
    writeFileSync(join(roto, "config.json"), "{ no es json")

    assert.deepEqual(list({ env }).map((p) => p.id), ["bueno"])
  })
})

test("list sin store → []", () => {
  withStore((env) => assert.deepEqual(list({ env }), []))
})

test("projectPath rechaza un id con path traversal", () => {
  withStore((env) => {
    assert.throws(() => projectPath("../fuera", { env }), /id inválido/)
    assert.throws(() => projectPath("con/barra", { env }), /id inválido/)
    assert.throws(() => projectPath("", { env }), /id inválido/)
  })
})

test("projectPath crea el .todo/ del proyecto", () => {
  withStore((env, base) => {
    const dir = projectPath("nuevo", { env })
    assert.equal(dir, join(base, "nuevo"))
    assert.ok(existsSync(join(dir, ".todo")))
  })
})
