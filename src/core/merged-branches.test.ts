import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { itemsOnMergedBranches, mergedBranches } from "./merged-branches.ts"

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
