#!/usr/bin/env node
// Git pre-commit hook. Lo invoca git, no un CLI de IA: corre igual desde
// cualquier editor o desde la terminal pelada.
//
// git no tiene el verbo `advise` — cualquier salida distinta de 0 aborta el
// commit. Los dos verbos se mapean a exit 1; la diferencia es qué dice el
// mensaje sobre si --no-verify corresponde.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { openItemTitles, preCommitReview } from "../core/rules/pre-commit.ts"

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

const read = (path: string): string => {
  try {
    return readFileSync(join(cwd, path), "utf8")
  } catch {
    return ""
  }
}

const lines = (text: string): string[] => text.split("\n").filter((line) => line.length > 0)

const decision = preCommitReview({
  hasTodoDir: existsSync(join(cwd, ".todo")),
  staged: lines(git("diff", "--cached", "--name-only")).slice(0, MAX_STAGED_SHOWN),
  markedCheckboxes: lines(git("diff", "--cached", "-U0", "--", ".todo/TODO.md", ".todo/DOING.md")).filter((line) =>
    line.startsWith("+- [x]"),
  ).length,
  doing: openItemTitles(read(".todo/DOING.md")),
  todoCount: openItemTitles(read(".todo/TODO.md")).length,
  recentCommits: lines(git("log", "--oneline", `-${RECENT_COMMITS}`)),
})

if (decision.action === "allow") process.exit(0)
process.stderr.write(decision.message + "\n")
process.exit(1)
