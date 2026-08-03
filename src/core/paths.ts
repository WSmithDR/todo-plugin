import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

/**
 * ÚNICO dueño de la resolución del root del plugin. No lo recalcules en otro
 * archivo.
 *
 * Se resuelve por self-location y nunca por `git rev-parse --show-toplevel`, que
 * devuelve el repo del USUARIO y no el del plugin — es la falla que ya apareció
 * tres veces en este ecosistema (ankify/bin/git/plugin-root.sh, que tiene un
 * feedback registrado, y ankify/bin/dev/bump-version.py, donde el archivo se
 * movió de bin/ a bin/dev/ y el cálculo de saltos no lo siguió).
 *
 * Tampoco se lee de CLAUDE_PLUGIN_ROOT: esa variable es para los procesos hijos
 * (las skills la usan desde bash). Acá ya sabemos dónde estamos.
 */
export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

export type Env = Record<string, string | undefined>

/** `$XDG_CACHE_HOME/todo-plugin`, o `~/.cache/todo-plugin`. */
export function cacheDir(env: Env = process.env): string {
  return join(env.XDG_CACHE_HOME || join(env.HOME || homedir(), ".cache"), "todo-plugin")
}

/** `$XDG_DATA_HOME/todo`, o `~/.local/share/todo`. Registro de proyectos sin repo. */
export function storeBase(env: Env = process.env): string {
  return join(env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share"), "todo")
}

export const todoDir = (cwd: string): string => join(cwd, ".todo")
