import { chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { ALLOW, advise, mergeDecisions, type Decision } from "../protocol.ts"
import { PLUGIN_ROOT } from "../paths.ts"

export type SessionContext = {
  cwd: string
  /** Inyectable para los tests; en producción es el root real del plugin. */
  pluginRoot?: string
}

/**
 * Al arrancar una sesión: dejar instalado el git hook de revisión de tareas y
 * avisar si el proyecto tiene `.todo/` sin configurar.
 *
 * A diferencia del resto de las reglas, esta tiene efectos — crea un symlink. Se
 * mantuvo así porque el efecto ES la regla: no hay decisión que tomar aparte de
 * "instalalo si falta".
 *
 * La versión en bash exigía `$CLAUDE_PLUGIN_ROOT` y no hacía nada sin ella, que
 * es justamente por qué nunca corrió bajo OpenCode. Acá el root sale de
 * `paths.ts`, por self-location: no depende de ningún CLI.
 */
export function sessionSetup(ctx: SessionContext): Decision {
  const root = ctx.pluginRoot ?? PLUGIN_ROOT
  if (!existsSync(join(ctx.cwd, ".todo"))) return ALLOW

  return mergeDecisions([installGitHook(ctx.cwd, root), checkConfig(ctx.cwd)])
}

function installGitHook(cwd: string, pluginRoot: string): Decision {
  if (!existsSync(join(cwd, ".git"))) return ALLOW

  const dst = join(cwd, ".git", "hooks", "pre-commit")
  const src = join(pluginRoot, "bin", "hooks", "pre-commit.sh")
  if (!existsSync(src)) return ALLOW

  const current = readLinkOrNull(dst)
  if (current === src) return ALLOW

  // Ocupado por otra cosa → se avisa, no se pisa. La versión en bash hacía
  // `ln -sf` incondicional y se llevaba puesto lo que hubiera: en este mismo
  // repo el hook de desarrollo (bin/dev/setup.sh, que corre los tests) y este
  // se sobreescribían mutuamente en cada sesión, sin que nadie se enterara.
  // La solución de fondo —componer los dos hooks— es de la fase 3.
  if (existsSync(dst) || current !== null) {
    return advise(
      `TODO-SETUP: .git/hooks/pre-commit ya existe y no es el del plugin, así que no se tocó.
La revisión de tareas previa al commit NO está activa en este proyecto.
  → Si el hook de ahí no te hace falta, borralo y reabrí la sesión.
  → Si lo necesitás, encadenalo a mano con: bash "${src}"`,
    )
  }

  mkdirSync(join(cwd, ".git", "hooks"), { recursive: true })
  symlinkSync(src, dst)
  try {
    chmodSync(src, 0o755)
  } catch {
    // El plugin puede estar instalado read-only; el symlink ya sirve.
  }
  return advise("TODO-SETUP: Git pre-commit hook instalado en .git/hooks/pre-commit")
}

function checkConfig(cwd: string): Decision {
  if (existsSync(join(cwd, ".todo", "config.json"))) return ALLOW
  return advise(
    `TODO-CONFIG-MISSING: Este proyecto tiene .todo/ pero no tiene config.json.
Invocar Skill('todo-config') para configurar el plugin antes de continuar con cualquier operación de tareas.`,
  )
}

/** El path del symlink, o null si no existe o no es symlink. */
function readLinkOrNull(path: string): string | null {
  try {
    if (!lstatSync(path).isSymbolicLink()) return null
    return readlinkSync(path)
  } catch {
    return null
  }
}

/** Expuesto para que un `todo-config` pueda reinstalar pisando a propósito. */
export function forceInstallGitHook(cwd: string, pluginRoot: string = PLUGIN_ROOT): void {
  const dst = join(cwd, ".git", "hooks", "pre-commit")
  mkdirSync(join(cwd, ".git", "hooks"), { recursive: true })
  try {
    unlinkSync(dst)
  } catch {
    // No existía.
  }
  symlinkSync(join(pluginRoot, "bin", "hooks", "pre-commit.sh"), dst)
}
