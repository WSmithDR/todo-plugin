#!/usr/bin/env node
// Git pre-commit hook. Lo invoca git, no un CLI de IA: corre igual desde
// cualquier editor o desde la terminal pelada.
//
// git no tiene el verbo `advise` — cualquier salida distinta de 0 aborta el
// commit. Los dos verbos se mapean a exit 1; la diferencia es qué dice el
// mensaje sobre si --no-verify corresponde.
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { preCommitMarker } from "../core/git.ts"
import { openItemTitles, openItems, preCommitReview } from "../core/rules/pre-commit.ts"
import { readTodoFile } from "../core/todo-files.ts"
import { resolveProjectDir } from "../core/store.ts"

const MAX_STAGED_SHOWN = 20
const RECENT_COMMITS = 5

const cwd = process.cwd()

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return ""
  }
}

const lines = (text: string): string[] => text.split("\n").filter((line) => line.length > 0)

const projectDir = resolveProjectDir(cwd)

const decision = preCommitReview({
  hasTodoDir: projectDir !== null,
  staged: lines(git("diff", "--cached", "--name-only")).slice(0, MAX_STAGED_SHOWN),
  markedCheckboxes: lines(git("diff", "--cached", "-U0", "--", ".todo/TODO.md", ".todo/DOING.md")).filter((line) =>
    line.startsWith("+- [x]"),
  ).length,
  registeredWork: lines(
    git("diff", "--cached", "-U0", "--", ".todo/DONE.md", ".todo/DISCARDED.md"),
  ).filter((line) => line.startsWith("+- [x]") || line.startsWith("+- ~~")).length,
  doing: openItemTitles(projectDir ? readTodoFile(projectDir, "DOING.md") : ""),
  todoOpen: openItems(projectDir ? readTodoFile(projectDir, "TODO.md") : ""),
  recentCommits: lines(git("log", "--oneline", `-${RECENT_COMMITS}`)),
})

// La marca la consume el post-commit y significa "la revisión se vio", no "salió
// allow": como `advise` aborta el commit, el `--no-verify` que viene después es
// el camino sancionado —el modelo ya leyó el mensaje y decidió—. Lo que la
// ausencia de marca delata es el commit forzado de entrada, que nunca se revisó.
const marker = preCommitMarker(cwd)
if (marker !== "") {
  try {
    writeFileSync(marker, decision.action)
  } catch {
    // Sin marca el post-commit avisa de más, no de menos. No vale abortar por esto.
  }
}

if (decision.action === "allow") process.exit(0)
process.stderr.write(decision.message + "\n")
process.exit(1)
