import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { cacheDir, type Env } from "./paths.ts"

/**
 * Estado chico y descartable entre invocaciones de hooks.
 *
 * Los hooks son procesos independientes: no comparten memoria. Sin esto no hay
 * forma de saber si algo ya se avisó, y un aviso que se repite en cada edición
 * se vuelve ruido que el modelo aprende a ignorar.
 *
 * Vive en el cache y se puede borrar sin consecuencias: perder el estado hace
 * que un aviso se repita una vez, nada más.
 */

const stateDir = (env: Env = process.env): string => join(cacheDir(env), "state")

/** El cwd se hashea: los paths tienen barras y largo impredecible. */
const keyFor = (scope: string, cwd: string): string =>
  `${scope}-${createHash("sha256").update(cwd).digest("hex").slice(0, 16)}`

function read(key: string, env: Env = process.env): string {
  try {
    return readFileSync(join(stateDir(env), key), "utf8")
  } catch {
    return ""
  }
}

function write(key: string, value: string, env: Env = process.env): void {
  try {
    mkdirSync(stateDir(env), { recursive: true })
    writeFileSync(join(stateDir(env), key), value)
  } catch {
    // El estado es un lujo: si el cache no se puede escribir, el aviso se
    // repite. No es motivo para romper un hook.
  }
}

/** El último HEAD que vimos en este repo. Sirve para saber si hubo commits. */
export const lastSeenHead = (cwd: string, env?: Env): string => read(keyFor("head", cwd), env).trim()

export const rememberHead = (cwd: string, head: string, env?: Env): void =>
  write(keyFor("head", cwd), head, env)

/**
 * ¿Ya avisamos esto acá? Marca y devuelve si era nuevo.
 *
 * Con esto un aviso sale UNA vez por item y por proyecto, en vez de en cada
 * edición del archivo que lo menciona.
 */
export function markAdvisedOnce(cwd: string, subject: string, env?: Env): boolean {
  const key = keyFor("advised", cwd)
  const seen = read(key, env).split("\n").filter(Boolean)
  if (seen.includes(subject)) return false

  seen.push(subject)
  // Se recorta para que el archivo no crezca sin límite en un proyecto viejo.
  write(key, seen.slice(-200).join("\n"), env)
  return true
}
