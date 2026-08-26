import { execFileSync, type ExecFileSyncOptions } from "node:child_process"
import type { OpenItem } from "./todo-files.ts"

/**
 * Ramas mergeadas cruzadas contra items abiertos: la tarea cuyo arreglo ya
 * entró a la rama principal es justo la que queda "en curso" para siempre,
 * porque nada del ciclo de vida mira lo que pasó en git después del DOING.
 *
 * La detección va al revés de lo obvio: no se adivina la rama desde el texto
 * del item (formato nuevo, parser frágil) sino que se listan las ramas locales
 * YA MERGEADAS y se busca cuál item las menciona. Cero metadata nueva.
 */

const QUIET: ExecFileSyncOptions & { encoding: "utf8" } = { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }

/** Las ramas locales mergeadas al HEAD, sin main/master ni la actual. */
export function mergedBranches(repoPath: string): string[] {
  try {
    const actual = execFileSync("git", ["-C", repoPath, "branch", "--show-current"], QUIET).trim()
    return execFileSync("git", ["-C", repoPath, "branch", "--merged", "HEAD", "--format", "%(refname:short)"], QUIET)
      .split("\n")
      .map((b) => b.trim())
      .filter((b) => b !== "" && b !== actual && b !== "main" && b !== "master")
  } catch {
    return [] // sin git, detached, repo roto: silencio, esto es solo un aviso
  }
}

export type MergedHit = { title: string; branch: string }

/** Los items abiertos cuyo texto menciona alguna de esas ramas. */
export function itemsOnMergedBranches(items: OpenItem[], branches: string[]): MergedHit[] {
  const hits: MergedHit[] = []
  for (const branch of branches) {
    for (const item of items) {
      if (!item.text.includes(branch)) continue
      if (hits.some((h) => h.title === item.title && h.branch === branch)) continue
      hits.push({ title: item.title, branch })
    }
  }
  return hits
}
