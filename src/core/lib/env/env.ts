import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Env } from "../paths/paths.ts"
import { list, mode } from "../store/store.ts"

/** Estado del entorno que las reglas reciben como parámetro en vez de leer. */

export const hasTodoDir = (cwd: string): boolean => existsSync(join(cwd, ".todo"))

/**
 * ¿Hay dónde anotar aunque el cwd no tenga `.todo/`? Solo fuera de un repo: en
 * un repo de código sin `.todo/`, mandar una tarea al registro central sería
 * anotarla en el proyecto equivocado.
 *
 * Cuesta un `git rev-parse` y un readdir, así que se pregunta tarde — cuando ya
 * se sabe que hace falta (p.ej. un comando que falló), no en cada evento.
 */
export function storeAvailable(cwd: string, env?: Env): boolean {
  try {
    return mode(cwd, { env }) === "nonrepo" && list({ env }).length > 0
  } catch {
    return false
  }
}

/**
 * Bypass explícito del guard para editar `.todo/` a mano.
 *
 * Tiene que estar exportada en el entorno del CLI ANTES de arrancarlo: el hook
 * corre en otro proceso, así que un prefijo por comando no lo alcanza.
 */
export const guardEnabled = (env: Env = process.env): boolean => env.TODO_GUARD !== "off"
