#!/usr/bin/env node
// Git pre-commit hook. Lo invoca git, no un CLI de IA: corre igual desde
// cualquier editor o desde la terminal pelada.
//
// git no tiene el verbo `advise` — cualquier salida distinta de 0 aborta el
// commit. Los dos verbos se mapean a exit 1; la diferencia es qué dice el
// mensaje sobre si --no-verify corresponde.
import { execFileSync } from "node:child_process"
import { statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
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

const mtime = (path: string): number => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

/**
 * ¿Este commit trae trabajo registrado? Se pregunta primero al índice y, si ahí
 * no hay nada, al disco.
 *
 * El índice solo no alcanza: `.todo/` puede estar gitignoreado (una opción que
 * `todo-config` ofrece) o vivir en el store central con la preferencia
 * `central_repos`. En los dos casos DONE.md JAMÁS aparece en `git diff --cached`:
 * el gate no podía dar allow ni con la tarea cerrada, con narrativa y responsable,
 * y `--no-verify` volvía a ser obligatorio — justo lo que este allow vino a
 * evitar. Y `--no-verify` no saltea este chequeo: saltea toda la cadena de hooks.
 *
 * El disco se compara contra la fecha del último commit, así que la señal se
 * consume sola: apenas el commit entra, HEAD queda más nuevo que el archivo y el
 * siguiente commit vuelve a pedir registro.
 *
 * ponytail: la resolución es el mtime, no el contenido. Techo conocido: cualquier
 * reescritura de DONE.md posterior al último commit cuenta como registro —p.ej. la
 * rotación de año que corre en SessionStart—. Si molesta, el upgrade es parsear el
 * `resuelto:` de los items y comparar ESE timestamp.
 */
function registeredWork(projectDir: string | null): number {
  const staged = lines(git("diff", "--cached", "-U0", "--", ".todo/DONE.md", ".todo/DISCARDED.md")).filter(
    (line) => line.startsWith("+- [x]") || line.startsWith("+- ~~"),
  ).length
  if (staged > 0 || projectDir === null) return staged

  // Sin HEAD (el commit inicial) no hay contra qué comparar: que decida el resto.
  const head = Number(git("log", "-1", "--format=%ct")) * 1000
  if (!Number.isFinite(head) || head <= 0) return 0

  return ["DONE.md", "DISCARDED.md"].some((name) => mtime(join(projectDir, ".todo", name)) > head) ? 1 : 0
}

const decision = preCommitReview({
  hasTodoDir: projectDir !== null,
  staged: lines(git("diff", "--cached", "--name-only")).slice(0, MAX_STAGED_SHOWN),
  markedCheckboxes: lines(git("diff", "--cached", "-U0", "--", ".todo/TODO.md", ".todo/DOING.md")).filter((line) =>
    line.startsWith("+- [x]"),
  ).length,
  registeredWork: registeredWork(projectDir),
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
