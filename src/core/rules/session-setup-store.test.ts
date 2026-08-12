import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sessionSetup } from "./session-setup.ts"

/**
 * La rama del store de sessionSetup: proyectos SIN repo.
 *
 * Todo corre con XDG_DATA_HOME y XDG_CACHE_HOME apuntando a un temp. No es
 * prolijidad: sin eso el test lee el store REAL del usuario y le escribe estado
 * y commits.
 */
function withStore<T>(
  projects: Record<string, { todo?: string; done?: string }>,
  fn: (ctx: { cwd: string; env: Record<string, string>; base: string }) => T,
): T {
  const dir = mkdtempSync(join(tmpdir(), "todo-store-"))
  try {
    const env = { HOME: dir, XDG_DATA_HOME: join(dir, "data"), XDG_CACHE_HOME: join(dir, "cache") }
    const base = join(env.XDG_DATA_HOME, "todo")

    mkdirSync(base, { recursive: true })
    execFileSync("git", ["init", "-q"], { cwd: base })
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: base })
    execFileSync("git", ["config", "user.name", "T"], { cwd: base })

    for (const [id, files] of Object.entries(projects)) {
      const todoDir = join(base, id, ".todo")
      mkdirSync(todoDir, { recursive: true })
      writeFileSync(join(todoDir, "config.json"), JSON.stringify({ id, name: id }))
      if (files.todo !== undefined) writeFileSync(join(todoDir, "TODO.md"), files.todo)
      if (files.done !== undefined) writeFileSync(join(todoDir, "DONE.md"), files.done)
    }
    execFileSync("git", ["add", "-A"], { cwd: base })
    execFileSync("git", ["commit", "-q", "-m", "init", "--no-verify"], { cwd: base })

    // Un cwd cualquiera SIN .todo/: así se entra a la rama del store.
    const cwd = join(dir, "afuera")
    mkdirSync(cwd, { recursive: true })
    return fn({ cwd, env, base })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const listaDe = (n: number): string =>
  `# TODOs\n\n_Última revisión: 2026-08-10_\n\n${Array.from({ length: n }, (_, i) => `- [ ] **T${i}** — x`).join("\n")}\n`

const HOY = new Date("2026-08-12T10:00:00")

test("un proyecto del store cargado dispara el aviso aunque el cwd no tenga .todo/", () => {
  withStore({ "web-emc": { todo: listaDe(20) } }, ({ cwd, env }) => {
    const d = sessionSetup({ cwd, env, today: HOY })
    const message = d.action === "advise" ? d.message : ""
    assert.match(message, /TODO-TRIAGE-DUE \(proyectos sin repo\)/)
    assert.match(message, /web-emc — 20 items abiertos/)
  })
})

test("un proyecto tranquilo no aparece en el aviso", () => {
  withStore({ "web-emc": { todo: listaDe(20) }, tranquilo: { todo: listaDe(2) } }, ({ cwd, env }) => {
    const message = (() => {
      const d = sessionSetup({ cwd, env, today: HOY })
      return d.action === "advise" ? d.message : ""
    })()
    assert.match(message, /web-emc/)
    assert.doesNotMatch(message, /tranquilo/)
  })
})

test("el aviso sale UNA vez por día: la segunda sesión del día calla", () => {
  withStore({ "web-emc": { todo: listaDe(20) } }, ({ cwd, env }) => {
    assert.equal(sessionSetup({ cwd, env, today: HOY }).action, "advise")
    assert.equal(sessionSetup({ cwd, env, today: HOY }).action, "allow", "misma fecha → ya avisado")

    const mañana = new Date("2026-08-13T10:00:00")
    assert.equal(sessionSetup({ cwd, env, today: mañana }).action, "advise", "otro día → vuelve a avisar")
  })
})

test("la rotación por año corre en el store, en silencio y commiteada", () => {
  const done = `# Completados\n\n- [x] **Viejo** ✓ _resuelto: … · 2025-03-01T10:00-05:00_\n`
  withStore({ "web-emc": { todo: listaDe(1), done } }, ({ cwd, env, base }) => {
    const d = sessionSetup({ cwd, env, today: HOY })

    assert.equal(d.action, "allow", "la poda no habla: es housekeeping")
    assert.equal(existsSync(join(base, "web-emc", ".todo", "DONE-2025.md")), true)
    assert.doesNotMatch(readFileSync(join(base, "web-emc", ".todo", "DONE.md"), "utf8"), /Viejo/)

    const limpio = execFileSync("git", ["status", "--porcelain"], { cwd: base, encoding: "utf8" })
    assert.equal(limpio.trim(), "", "la rotación se commitea sola: el store no queda sucio")
  })
})

test("dentro de un repo sin .todo/ NO se avisa del store", () => {
  withStore({ "web-emc": { todo: listaDe(20) } }, ({ cwd, env }) => {
    execFileSync("git", ["init", "-q"], { cwd })
    assert.equal(
      sessionSetup({ cwd, env, today: HOY }).action,
      "allow",
      "un repo de código ajeno no es lugar para recordar las tareas de un sitio WordPress",
    )
  })
})

test("sin store no pasa nada", () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-nostore-"))
  try {
    const env = { HOME: dir, XDG_DATA_HOME: join(dir, "data"), XDG_CACHE_HOME: join(dir, "cache") }
    assert.equal(sessionSetup({ cwd: dir, env, today: HOY }).action, "allow")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("una tarea trabada en DOING también entra al aviso, aunque el TODO esté sano", () => {
  const doing = "# DOING\n\n- [ ] **Verificación por SMS** — trabada _(creado por: T · 2026-07-09 | iniciado: 2026-07-09T14:00-05:00)_\n"
  withStore({ "popular-imports": { todo: listaDe(3) } }, ({ cwd, env, base }) => {
    writeFileSync(join(base, "popular-imports", ".todo", "DOING.md"), doing)

    const d = sessionSetup({ cwd, env, today: HOY })
    const message = d.action === "advise" ? d.message : ""
    assert.match(message, /"Verificación por SMS" en curso hace 34 días/)
  })
})

test("una tarea recién empezada no molesta", () => {
  const doing = "# DOING\n\n- [ ] **Reciente** — x _(creado por: T · 2026-08-11 | iniciado: 2026-08-11T09:00-05:00)_\n"
  withStore({ "popular-imports": { todo: listaDe(3) } }, ({ cwd, env, base }) => {
    writeFileSync(join(base, "popular-imports", ".todo", "DOING.md"), doing)
    assert.equal(sessionSetup({ cwd, env, today: HOY }).action, "allow")
  })
})
