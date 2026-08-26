import { execFileSync, type ExecFileSyncOptions } from "node:child_process"
import type { OpenItem } from "./todo-files.ts"

/**
 * Ramas mergeadas cruzadas contra items abiertos: la tarea cuyo arreglo ya
 * entró a la rama principal es justo la que queda "en curso" para siempre,
 * porque nada del ciclo de vida mira lo que pasó en git después del DOING.
 *
 * La detección va al revés de lo obvio: no se adivina la rama desde el texto
 * del item (formato nuevo, parser frágil) sino que se listan las ramas YA
 * MERGEADAS — locales Y remotas — y se busca cuál item las menciona.
 */

const QUIET: ExecFileSyncOptions & { encoding: "utf8" } = { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }
const SILENT: ExecFileSyncOptions = { stdio: ["ignore", "ignore", "ignore"] }

const PRINCIPALES = ["main", "master", "develop", "development"]

function esPrincipal(ref: string): boolean {
  const corta = ref.replace(/^origin\//, "")
  return PRINCIPALES.includes(corta) || ref.endsWith("/HEAD")
}

/**
 * La referencia MÁS FRESCA de la rama principal: primero la remota (el merge
 * puede haber llegado por GitHub y el clon local quedar atrás — ese fue el caso
 * eminat-app), después la local, y como último recurso HEAD.
 */
function baseDe(repoPath: string): string {
  const candidatas = [...PRINCIPALES.map((p) => `origin/${p}`), ...PRINCIPALES]
  for (const candidata of candidatas) {
    try {
      execFileSync("git", ["-C", repoPath, "show-ref", "--verify", "-q", `refs/${candidata.includes("/") ? "remotes" : "heads"}/${candidata}`], SILENT)
      return candidata
    } catch {
      // esta candidata no existe; sigo
    }
  }
  return "HEAD"
}

/** Trae del remote lo que falta — sin esto, "ya está mergeada" depende de qué tan viejo es el clon. */
export function fetchPrune(repoPath: string): void {
  try {
    execFileSync("git", ["-C", repoPath, "fetch", "--prune", "--quiet"], QUIET)
  } catch {
    // Sin red: se trabaja con lo local. El próximo intento actualiza.
  }
}

/**
 * ¿La rama llegó a la base por SQUASH? El commit aplastado conserva el título
 * del PR (= el subject del primer commit de la rama), así que basta buscar ese
 * subject entre los de la base. Umbral mínimo para que un "wip" genérico no
 * dé falsos positivos. ponytail: si algún día usan títulos de PR distintos al
 * primer commit, esto se cambia por matchear contra la API de GitHub.
 */
const SUBJECT_MIN = 12

function squashMergeada(repoPath: string, rama: string, base: string, subjectsDeBase: Set<string>): boolean {
  try {
    const subjects = execFileSync("git", ["-C", repoPath, "log", "--format=%s", `${base}..${rama}`], QUIET)
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t.length >= SUBJECT_MIN)
    return subjects.some((t) => subjectsDeBase.has(t))
  } catch {
    return false
  }
}

/** Las ramas —locales y remotas— ya contenidas en la principal, por merge
 * normal (ancestría) O por squash (subject presente en la base). */
export function mergedBranches(repoPath: string): string[] {
  try {
    fetchPrune(repoPath)
    const base = baseDe(repoPath)

    const normales = execFileSync(
      "git",
      ["-C", repoPath, "branch", "--all", "--merged", base, "--format", "%(refname:short)"],
      QUIET,
    )
      .split("\n")
      .map((b) => b.trim().replace(/^remotes\//, ""))
      .filter((b) => b !== "" && !esPrincipal(b))

    // Segunda capa: ramas NO ancestras cuyo contenido entró igual, aplastado.
    const candidatas = execFileSync(
      "git",
      ["-C", repoPath, "branch", "--all", "--no-merged", base, "--format", "%(refname:short)"],
      QUIET,
    )
      .split("\n")
      .map((b) => b.trim().replace(/^remotes\//, ""))
      .filter((b) => b !== "" && !esPrincipal(b))

    const subjectsDeBase = new Set(
      execFileSync("git", ["-C", repoPath, "log", "--format=%s", base], QUIET)
        .split("\n")
        .map((t) => t.trim()),
    )

    const aplastadas = candidatas.filter((rama) => squashMergeada(repoPath, rama, base, subjectsDeBase))
    return [...normales, ...aplastadas]
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
