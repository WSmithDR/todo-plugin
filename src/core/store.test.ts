import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { adopt, adoptPending, create, list, mode, projectForRepo, projectPath, resolveProjectDir, setOrigin, slugify, syncStore } from "./store.ts"

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

// ── central_repos: los repos también salen del store ────────────────────────

function withRepo<T>(fn: (env: Record<string, string>, base: string, repo: string) => T): T {
  return withStore((env, base) => {
    const repo = mkdtempSync(join(tmpdir(), "todo-repo-"))
    execFileSync("git", ["-C", repo, "init", "-q"])
    try {
      return fn(env, base, repo)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
}

test("por defecto un repo sigue siendo repo", () => {
  withRepo((env, _base, repo) => {
    assert.equal(mode(repo, { env }), "repo")
  })
})

test("central_repos: un repo reporta nonrepo", () => {
  withRepo((env, base, repo) => {
    mkdirSync(base, { recursive: true })
    writeFileSync(join(base, "settings.json"), JSON.stringify({ central_repos: true }))
    assert.equal(mode(repo, { env }), "nonrepo")
  })
})

test("dentro del propio store siempre es nonrepo, con o sin la preferencia", () => {
  withStore((env, base) => {
    create("algo", { env })
    assert.equal(mode(join(base, "algo"), { env }), "nonrepo")
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

// ── origin / projectForRepo / resolveProjectDir ────────────────────────────

test("projectForRepo exige central_repos y matchea por origin físico", () => {
  withRepo((env, base, repo) => {
    const id = create("Mi Repo", { env })
    // sin la preferencia, no resuelve aunque haya origin
    setOrigin(id, repo, { env })
    assert.equal(projectForRepo(repo, { env }), null)
    writeFileSync(join(base, "settings.json"), JSON.stringify({ central_repos: true }))
    assert.equal(projectForRepo(repo, { env })?.id, id)
    // y un repo distinto no resuelve a este proyecto
    const other = mkdtempSync(join(tmpdir(), "todo-other-"))
    execFileSync("git", ["-C", other, "init", "-q"])
    assert.equal(projectForRepo(other, { env }), null)
    rmSync(other, { recursive: true, force: true })
  })
})

test("resolveProjectDir: .todo local gana; si no hay, el proyecto con origin", () => {
  withRepo((env, base, repo) => {
    const id = create("Con Origen", { env })
    setOrigin(id, repo, { env })
    writeFileSync(join(base, "settings.json"), JSON.stringify({ central_repos: true }))
    assert.equal(resolveProjectDir(repo, env), join(base, id))
    // con .todo local, gana el local (hasta que adopt lo mueva)
    mkdirSync(join(repo, ".todo"))
    assert.equal(resolveProjectDir(repo, env), repo)
  })
})

test("resolveProjectDir sin repo ni .todo → null", () => {
  withStore((env) => {
    const suelto = mkdtempSync(join(tmpdir(), "todo-suelto-"))
    assert.equal(resolveProjectDir(suelto, env), null)
    rmSync(suelto, { recursive: true, force: true })
  })
})

// ── adopt ──────────────────────────────────────────────────────────────────

test("adopt muda el .todo local al store, registra origin y borra el local", () => {
  withRepo((env, _base, repo) => {
    mkdirSync(join(repo, ".todo"))
    writeFileSync(join(repo, ".todo", "TODO.md"), "# TODOs\n\n- [ ] **Pendiente viejo**\n")
    writeFileSync(join(repo, ".todo", "DONE.md"), "# Completados\n")
    // un archivo que no matchea la lista de mudanza se queda atrás
    writeFileSync(join(repo, ".todo", "notas.txt"), "queda")

    const { id, dir } = adopt(repo, undefined, { env })

    assert.ok(existsSync(join(dir, ".todo", "TODO.md")))
    assert.match(readFileSync(join(dir, ".todo", "TODO.md"), "utf8"), /Pendiente viejo/)
    assert.ok(existsSync(join(dir, ".todo", "DONE.md")))
    // el directorio sobrevive si tenía algo más; solo los mudados se van
    assert.ok(existsSync(join(repo, ".todo", "notas.txt")))
    assert.ok(!existsSync(join(repo, ".todo", "TODO.md")))
    const name = list({ env }).find((p) => p.id === id)?.name
    assert.equal(typeof name === "string" && /^todo-repo/.test(name), true) // nombre = basename del repo
    // segunda llamada sobre el mismo repo NO crea un proyecto nuevo
    const again = adopt(repo, undefined, { env })
    assert.equal(again.id, id)
  })
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

// ── adoptPending: la mordida de central_repos en SessionStart ───────────────

test("adoptPending: sin preferencia no hace nada; con ella adopta y es idempotente", () => {
  withRepo((env, base, repo) => {
    mkdirSync(join(repo, ".todo"))
    writeFileSync(join(repo, ".todo", "TODO.md"), "# TODOs\n\n- [ ] **Pendiente**\n")
    assert.equal(adoptPending(repo, { env }), null)

    mkdirSync(base, { recursive: true })
    writeFileSync(join(base, "settings.json"), JSON.stringify({ central_repos: true }))
    const r = adoptPending(repo, { env })
    assert.ok(r !== null)
    assert.ok(existsSync(join(r.dir, ".todo", "TODO.md")))
    assert.ok(!existsSync(join(repo, ".todo")))
    assert.equal(adoptPending(repo, { env }), null)
  })
})

test("adoptPending: jamás se traga al propio store ni directorios sin .todo", () => {
  withStore((env, base) => {
    const id = create("Proyecto Store", { env })
    mkdirSync(base, { recursive: true })
    writeFileSync(join(base, "settings.json"), JSON.stringify({ central_repos: true }))
    assert.equal(adoptPending(base, { env }), null)
    assert.equal(adoptPending(join(base, id), { env }), null)

    const vacio = mkdtempSync(join(tmpdir(), "todo-vacio-"))
    execFileSync("git", ["-C", vacio, "init", "-q"])
    assert.equal(adoptPending(vacio, { env }), null)
    rmSync(vacio, { recursive: true, force: true })
  })
})

// ── identidad universal (URL) vs local (path) ───────────────────────────────

test("setOrigin separa universal de local; el store ignora los .local.json", () => {
  withRepo((env, base, repo) => {
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/x/repoy.git"])
    const id = create("Con URL", { env })
    setOrigin(id, repo, { env })

    const cfg = JSON.parse(readFileSync(join(base, id, ".todo", "config.json"), "utf8"))
    assert.equal(cfg.origin_url, "https://github.com/x/repoy.git")
    assert.equal(cfg.origin, undefined)

    const local = JSON.parse(readFileSync(join(base, id, ".todo", "config.local.json"), "utf8"))
    assert.equal(local.origin_path, realpathSync(repo))
    assert.ok(readFileSync(join(base, ".gitignore"), "utf8").includes("*.local.json"))
  })
})

test("projectForRepo matchea por remote URL desde OTRO clon — otra máquina", () => {
  withRepo((env, base, repo) => {
    execFileSync("git", ["-C", repo, "remote", "add", "origin", "git@github.com:x/y.git"])
    mkdirSync(base, { recursive: true })
    writeFileSync(join(base, "settings.json"), JSON.stringify({ central_repos: true }))
    const id = create("Multi PC", { env })
    setOrigin(id, repo, { env })

    const otraPc = mkdtempSync(join(tmpdir(), "otra-pc-"))
    execFileSync("git", ["-C", otraPc, "init", "-q"])
    execFileSync("git", ["-C", otraPc, "remote", "add", "origin", "git@github.com:x/y.git"])
    assert.equal(projectForRepo(otraPc, { env })?.id, id)
    rmSync(otraPc, { recursive: true, force: true })
  })
})

test("adopt reutiliza el proyecto por URL — el segundo clon no duplica nada", () => {
  withRepo((env, base, repoA) => {
    execFileSync("git", ["-C", repoA, "remote", "add", "origin", "git@github.com:x/dup.git"])
    mkdirSync(base, { recursive: true })
    writeFileSync(join(base, "settings.json"), JSON.stringify({ central_repos: true }))
    mkdirSync(join(repoA, ".todo"))
    writeFileSync(join(repoA, ".todo", "TODO.md"), "- [ ] **Uno**\n")
    const r1 = adopt(repoA, undefined, { env })

    const clonB = mkdtempSync(join(tmpdir(), "clon-b-"))
    execFileSync("git", ["-C", clonB, "init", "-q"])
    execFileSync("git", ["-C", clonB, "remote", "add", "origin", "git@github.com:x/dup.git"])
    const r2 = adopt(clonB, undefined, { env })

    assert.equal(r2.id, r1.id)
    assert.equal(list({ env }).length, 1)
    const local = JSON.parse(
      readFileSync(join(base, r1.id, ".todo", "config.local.json"), "utf8"),
    )
    assert.equal(local.origin_path, realpathSync(clonB))
    rmSync(clonB, { recursive: true, force: true })
  })
})


test("storeSync: sin remote es un no-op silencioso; con remoto pelado empuja de verdad", () => {
  withStore((env, base) => {
    // sin remote, ni siquiera con commits locales:
    create("Sin Remoto", { env })
    execFileSync("git", ["-C", base, "commit", "-q", "--allow-empty", "-m", "nada"], { stdio: "ignore" })
    syncStore({ env })

    // con remote pelado: el push aterriza el historial
    const remoto = mkdtempSync(join(tmpdir(), "remoto-"))
    execFileSync("git", ["init", "-q", "--bare", join(remoto, "store.git")])
    execFileSync("git", ["-C", base, "remote", "add", "origin", join(remoto, "store.git")])
    syncStore({ env })
    const head = execFileSync("git", ["-C", join(remoto, "store.git"), "log", "-1", "--format=%s"], {
      encoding: "utf8",
    }).trim()
    assert.ok(head.length > 0)
    rmSync(remoto, { recursive: true, force: true })
  })
})
