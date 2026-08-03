import { closeSync, mkdirSync, openSync, statSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { cacheDir, type Env } from "./paths.ts"

/**
 * Ventana de escritura del guard.
 *
 * No hay forma de que un hook pregunte "¿estoy dentro de un skill?", así que
 * cada skill toca un sentinela al arrancar y el guard mira su antigüedad. Diez
 * minutos porque un skill largo (todo-audit) analiza el codebase entero antes de
 * escribir; los que tardan más reabren la ventana antes de la fase de escritura.
 */
export const WINDOW_MINUTES = 10

export const windowPath = (env: Env = process.env): string => join(cacheDir(env), "window")

/** Abre (o extiende) la ventana. Lo llama cada skill como primera acción. */
export function openWindow(env: Env = process.env): void {
  mkdirSync(cacheDir(env), { recursive: true })
  const path = windowPath(env)
  try {
    const now = new Date()
    utimesSync(path, now, now)
  } catch {
    closeSync(openSync(path, "w"))
  }
}

/** `now` es inyectable para poder testear el vencimiento sin esperar 10 minutos. */
export function isWindowOpen(env: Env = process.env, now: number = Date.now()): boolean {
  try {
    return now - statSync(windowPath(env)).mtimeMs < WINDOW_MINUTES * 60_000
  } catch {
    // Sin sentinela no hay ventana. Fail-closed: el guard bloquea.
    return false
  }
}
