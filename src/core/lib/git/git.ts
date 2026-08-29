import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import { join } from "node:path"

/** Lo que las reglas necesitan saber de git. Ningún adapter lo reimplementa. */

function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return ""
  }
}

/**
 * La rama actual. Se le pregunta a git en vez de parsear el comando: `git switch -`
 * o un alias no se pueden leer del texto.
 */
export const currentBranch = (cwd: string): string => git(cwd, "rev-parse", "--abbrev-ref", "HEAD")

/** El SHA de HEAD. Comparado entre dos momentos, dice si hubo commits. */
export const currentHead = (cwd: string): string => git(cwd, "rev-parse", "HEAD")

/**
 * Sello barato del último movimiento de refs: el mtime del reflog, que git
 * reescribe en cada commit, checkout o reset.
 *
 * Es el gate del `git rev-parse` para quien tiene que preguntar por HEAD en cada
 * request —OpenCode, que no tiene hook de fin de sesión y resuelve session-close
 * por `system.transform`—: un stat en vez de un proceso. Devuelve "" si no hay
 * reflog (worktree con `.git` archivo, `core.logAllRefUpdates=false`), y ahí el
 * llamador cae al camino caro, que siempre es correcto.
 */
export const refLogStamp = (cwd: string): string => {
  try {
    return String(statSync(join(cwd, ".git", "logs", "HEAD")).mtimeMs)
  } catch {
    return ""
  }
}

/**
 * Path de la marca que el pre-commit deja al dejar pasar un commit, y que el
 * post-commit consume. Su ausencia es la única evidencia de un `--no-verify`.
 * Vive dentro del `.git/` para no ensuciar el working tree ni el gitignore.
 */
export const preCommitMarker = (cwd: string): string => {
  const dir = git(cwd, "rev-parse", "--absolute-git-dir")
  return dir === "" ? "" : `${dir}/todo-precommit-ok`
}
