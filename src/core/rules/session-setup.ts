import { chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, symlinkSync, unlinkSync } from "node:fs"
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

  return mergeDecisions([...GIT_HOOKS.map((name) => installGitHook(ctx.cwd, root, name)), checkConfig(ctx.cwd)])
}

/** `pre-commit` revisa antes de commitear; `post-commit` es la red para el --no-verify. */
export const GIT_HOOKS = ["pre-commit", "post-commit"] as const

function installGitHook(cwd: string, pluginRoot: string, name: string): Decision {
  if (!existsSync(join(cwd, ".git"))) return ALLOW

  const dst = join(cwd, ".git", "hooks", name)
  const src = join(pluginRoot, "bin", "hooks", `${name}.sh`)
  if (!existsSync(src)) return ALLOW

  const current = readLinkOrNull(dst)
  if (current === src) return ALLOW

  // Ocupado por otra cosa → se ENCADENA, no se pisa ni se abandona. Antes acá se
  // avisaba "instalalo a mano" y nadie lo hacía: en este mismo repo el hook de
  // desarrollo ocupaba el slot y la revisión de tareas estuvo inactiva sin que
  // nadie se enterara. Ahora el hook que había pasa a `<name>.local` y el shim
  // del plugin lo invoca. Retroactivo: corre en la próxima sesión de cualquier
  // proyecto que hoy tenga el slot tomado.
  let chained = ""
  if (existsSync(dst) || current !== null) {
    const local = `${dst}.local`
    if (existsSync(local) || readLinkOrNull(local) !== null) {
      return advise(
        `TODO-SETUP: .git/hooks/${name} está ocupado y ya hay un ${name}.local, así que no se tocó nada.
La cadena quedaría de tres eslabones y eso se resuelve a mano.
  → Encadená el del plugin desde el tuyo: bash "${src}"`,
      )
    }
    renameSync(dst, local)
    chained = ` (el que había se movió a ${name}.local y se sigue ejecutando)`
  }

  mkdirSync(join(cwd, ".git", "hooks"), { recursive: true })
  symlinkSync(src, dst)
  try {
    chmodSync(src, 0o755)
  } catch {
    // El plugin puede estar instalado read-only; el symlink ya sirve.
  }
  return advise(`TODO-SETUP: git hook ${name} instalado en .git/hooks/${name}${chained}`)
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
