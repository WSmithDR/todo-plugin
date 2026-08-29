import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { itemsOnMergedBranches, mergedBranches } from "./merged-branches.ts"

// Commits vacíos con mismo padre/mensaje/segundo producen EL MISMO hash y git
// deduplica — las ramas colapsan a un solo commit y "--merged" miente.
let TICK = 0
function fechaUnica(): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, ++TICK)).toISOString()
}

function commitUnico(dir: string, mensaje: string): void {
  execFileSync(
    "git",
    ["-C", dir, "-c", "user.email=t@t.com", "-c", "user.name=T", "commit", "--allow-empty", "-q", "-m", mensaje],
    { env: { ...process.env, GIT_AUTHOR_DATE: fechaUnica(), GIT_COMMITTER_DATE: fechaUnica() } },
  )
}

function repoConRamaMergeada(): string {
  const dir = mkdtempSync(join(tmpdir(), "todo-merged-"))
  const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" })
  g("init", "-q", "-b", "main")
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t.com", "-c", "user.name=T", "commit", "--allow-empty", "-q", "-m", "base"])
  g("checkout", "-q", "-b", "feat/estructura")
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t.com", "-c", "user.name=T", "commit", "--allow-empty", "-q", "-m", "trabajo"])
  g("checkout", "-q", "main")
  g("merge", "-q", "--no-ff", "feat/estructura", "-m", "merge")
  // una rama SIN mergear, para verificar que no aparece
  g("checkout", "-q", "-b", "feat/pendiente")
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t.com", "-c", "user.name=T", "commit", "--allow-empty", "-q", "-m", "wip"])
  g("checkout", "-q", "main")
  return dir
}

test("mergedBranches lista solo las mergeadas — sin main ni la actual", () => {
  const dir = repoConRamaMergeada()
  try {
    assert.deepEqual(mergedBranches(dir), ["feat/estructura"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("itemsOnMergedBranches cruza por mención en el texto del item", () => {
  const items = [
    { title: "Estructura organizacional", text: "- [ ] **Estructura organizacional** — feat/estructura ya mergeada a main" },
    { title: "Otra cosa", text: "- [ ] **Otra cosa** — sin rama" },
    { title: "Pendiente real", text: "- [ ] **Pendiente real** — sigue en feat/pendiente" },
  ]
  const hits = itemsOnMergedBranches(items, ["feat/estructura", "feat/pendiente"])
  assert.deepEqual(hits.map((h) => h.title), ["Estructura organizacional", "Pendiente real"])
})

test("sin git o repo roto: silencio", () => {
  assert.deepEqual(mergedBranches("/no/existe"), [])
})

// ── capa squash: el contenido entró aplastado, el tip nunca es ancestro ─────

test("squash merge: subject del PR presente en la base → detectada", () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-squash-"))
  const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" })
  const c = (m: string) => commitUnico(dir, m)
  try {
    g("init", "-q", "-b", "main")
    c("base inicial del proyecto")
    g("checkout", "-q", "-b", "feat/squaseada")
    // GitHub prellena el título del PR con el primer commit: quedan iguales
    c("feat(x): rediseño completo del tablero de stratix")
    c("wip")
    g("checkout", "-q", "main")
    // el squash: UN commit nuevo en main con el título del PR
    c("feat(x): rediseño completo del tablero de stratix")

    const ramas = mergedBranches(dir)
    assert.ok(ramas.includes("feat/squaseada"), `debería detectar squash, got: ${ramas.join(", ")}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("un 'wip' genérico en la base NO da falso positivo por subject corto", () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-wip-"))
  const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" })
  const c = (m: string) => commitUnico(dir, m)
  try {
    g("init", "-q", "-b", "main")
    c("base inicial del proyecto")
    g("checkout", "-q", "-b", "feat/ruido")
    c("wip")
    g("checkout", "-q", "main")
    c("wip") // mismo subject corto en main: no cuenta como squash

    assert.deepEqual(mergedBranches(dir).filter((b) => b === "feat/ruido"), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
