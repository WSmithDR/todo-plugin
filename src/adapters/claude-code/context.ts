import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

/**
 * El estado de I/O que las reglas necesitan pero no leen ellas mismas. Vive en el
 * adapter porque es lo único que sabe dónde está parado el CLI.
 */

export const hasTodoDir = (cwd: string): boolean => existsSync(join(cwd, ".todo"))

/** Bypass explícito del guard para editar `.todo/` a mano. */
export const guardEnabled = (env = process.env): boolean => env.TODO_GUARD !== "off"

/**
 * La rama DESPUÉS de que el comando corrió. Se pregunta a git en vez de parsear
 * el string del comando: `git switch -` o un alias no se pueden leer del texto.
 */
export function currentBranch(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return ""
  }
}

/** Claude Code siempre pipea stdin; el timeout es para no colgarse si no lo hace. */
export function readStdin(timeoutMs = 2000): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("")

    let data = ""
    const done = (): void => {
      clearTimeout(timer)
      resolve(data)
    }
    const timer = setTimeout(done, timeoutMs)

    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => (data += chunk))
    process.stdin.on("end", done)
    process.stdin.on("error", done)
  })
}
