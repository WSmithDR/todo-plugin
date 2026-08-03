import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Env } from "./paths.ts"

/** Estado del entorno que las reglas reciben como parámetro en vez de leer. */

export const hasTodoDir = (cwd: string): boolean => existsSync(join(cwd, ".todo"))

/**
 * Bypass explícito del guard para editar `.todo/` a mano.
 *
 * Tiene que estar exportada en el entorno del CLI ANTES de arrancarlo: el hook
 * corre en otro proceso, así que un prefijo por comando no lo alcanza.
 */
export const guardEnabled = (env: Env = process.env): boolean => env.TODO_GUARD !== "off"
