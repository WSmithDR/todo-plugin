import { execFileSync } from "node:child_process"

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
 * Path de la marca que el pre-commit deja al dejar pasar un commit, y que el
 * post-commit consume. Su ausencia es la única evidencia de un `--no-verify`.
 * Vive dentro del `.git/` para no ensuciar el working tree ni el gitignore.
 */
export const preCommitMarker = (cwd: string): string => {
  const dir = git(cwd, "rev-parse", "--absolute-git-dir")
  return dir === "" ? "" : `${dir}/todo-precommit-ok`
}
