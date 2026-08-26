import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { ALLOW, advise, mergeDecisions, type Decision } from "../protocol.ts"
import { PLUGIN_ROOT, storeBase, type Env } from "../paths.ts"
import { adoptPending, list, mode, projectPath, type Project } from "../store.ts"
import { markAdvisedOnce } from "../session-state.ts"
import { rotateArchives } from "../archive.ts"
import { daysSinceReview, oldestStarted, openItemTitles, readTodoFile } from "../todo-files.ts"
import { staleTodo } from "./stale-todo.ts"

export type SessionContext = {
  cwd: string
  /** Inyectable para los tests; en producción es el root real del plugin. */
  pluginRoot?: string
  /** Inyectable para los tests; en producción es el año de hoy. */
  year?: number
  /** Inyectable para los tests; en producción, hoy. */
  today?: Date
  /**
   * Inyectable para los tests. NO es opcional por elegancia: sin esto, un test
   * que corra la rama del store lee el store REAL del usuario y le escribe
   * estado y commits. Ya pasó una vez.
   */
  env?: Env
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
  const today = ctx.today ?? new Date()

  // Sin `.todo/` propio no hay proyecto local, pero sí puede haber proyectos en
  // el store central (los que no tienen repo: sitios operados por MCP). Antes
  // esta línea era un `return ALLOW` seco y por eso NADA de SessionStart los
  // alcanzaba: ni la poda por año ni el recordatorio de triage. Son justamente
  // los proyectos que menos se abren, o sea donde más se acumula.
  if (!existsSync(join(ctx.cwd, ".todo"))) return storeSetup(ctx, today)

  // La migración perezosa MORDIENDO: con central_repos activa, el primer
  // SessionStart de un repo con .todo/ local lo adopta sin preguntar. No es un
  // aviso que se pueda saltear: es la mudanza ya hecha.
  if (existsSync(join(ctx.cwd, ".todo"))) {
    const migrado = adoptPending(ctx.cwd, { env: ctx.env })
    if (migrado !== null) {
      return mergeDecisions([
        storeSetup(ctx, today),
        advise(`TODO-CENTRAL: este repo pasó al registro central (${migrado.dir}).
Tu .todo/ local fue movido ahí y eliminado del repo: las tareas ya no viven junto al código.
Las skills operan sobre el store desde ahora; no hay paso manual ni vuelta atrás salvo recrear el directorio.`),
      ])
    }
  }

  const todo = readTodoFile(ctx.cwd, "TODO.md")

  return mergeDecisions([
    ...GIT_HOOKS.map((name) => installGitHook(ctx.cwd, root, name)),
    archiveOldYears(ctx.cwd, ctx.year ?? today.getFullYear()),
    staleTodo({
      hasTodoDir: true,
      todoCount: openItemTitles(todo).length,
      daysSinceReview: daysSinceReview(todo, today),
    }),
    checkConfig(ctx.cwd),
  ])
}

/**
 * SessionStart para los proyectos SIN repo, que viven en el store central.
 *
 * Se hace acá y no en cada skill porque es el único momento del ciclo que corre
 * sin que el usuario haya pedido nada: si el recordatorio dependiera de abrir el
 * proyecto, no serviría — el problema ES que no se abre hace meses.
 *
 * Dos diferencias con la rama del repo, las dos deliberadas:
 *  · La rotación por año es SILENCIOSA y se commitea sola. El store es un repo
 *    administrado por la máquina (`create()` ya commitea); dejar archivos nuevos
 *    sin commitear ahí es basura que nadie va a mirar.
 *  · Nada de git hooks. En estos proyectos el trabajo pasa afuera —WordPress por
 *    MCP—, no en commits: una revisión previa al commit no tendría qué revisar.
 */
function storeSetup(ctx: SessionContext, today: Date): Decision {
  const env = ctx.env

  // Solo fuera de un repo. Un repo sin `.todo/` es un proyecto de código ajeno a
  // todo esto: recordarle ahí las tareas de un sitio WordPress es exactamente el
  // aviso fuera de lugar que el modelo aprende a saltear.
  if (mode(ctx.cwd, { env }) !== "nonrepo") return ALLOW

  let projects: Project[]
  try {
    projects = list({ env })
  } catch {
    return ALLOW // sin store no hay nada que hacer
  }
  if (projects.length === 0) return ALLOW

  const year = ctx.year ?? today.getFullYear()
  const pendientes: string[] = []
  let rotados = false

  for (const project of projects) {
    const dir = projectPath(project.id, { env })
    if (rotateArchives(dir, year).length > 0) rotados = true

    const todo = readTodoFile(dir, "TODO.md")
    const decision = staleTodo({
      hasTodoDir: true,
      todoCount: openItemTitles(todo).length,
      daysSinceReview: daysSinceReview(todo, today),
    })

    const motivos: string[] = []
    if (decision.action === "advise") motivos.push(motivoDe(decision))

    // Lo trabado en DOING. En un repo esto lo cubre `session-close`, que dispara
    // después de commitear; acá no hay commits tuyos que lo disparen, así que sin
    // esto una tarea puede quedar "en curso" para siempre — y DOING.md es lo que
    // el pre-commit consulta para sugerir qué cerrar.
    const trabada = oldestStarted(readTodoFile(dir, "DOING.md"), today)
    if (trabada !== null && trabada.days >= STUCK_DAYS) {
      motivos.push(`"${trabada.title}" en curso hace ${trabada.days} días`)
    }

    if (motivos.length === 0) continue

    // Una vez por proyecto y por día: son varios proyectos y este aviso no
    // depende de nada que vos hagas, así que repetirlo en cada sesión es la
    // receta para que se vuelva invisible.
    const fecha = fechaLocal(today)
    if (!markAdvisedOnce(storeStateKey, `stale-${project.id}-${fecha}`, env)) continue

    pendientes.push(`  · ${project.name} — ${motivos.join(" · ")}`)
  }

  if (rotados) commitStore(env)
  if (pendientes.length === 0) return ALLOW

  return advise(
    `TODO-TRIAGE-DUE (proyectos sin repo): hay listas que se están acumulando o tareas sin cerrar.
${pendientes.join("\n")}
Invocar Skill('todo-triage') y elegir el proyecto en el menú. Si el usuario está
en otra cosa, no lo interrumpas: ofrecelo cuando termine.`,
  )
}

/** Dos semanas "en curso": o está trabada, o ya se hizo y nadie la movió. */
const STUCK_DAYS = 14

/**
 * La fecha LOCAL, no `toISOString()`, que es UTC.
 *
 * El "una vez por día" del aviso se lleva por fecha. Con UTC, en GMT-5 el día
 * cambiaba a las 19:00 y el mismo aviso volvía a salir a la tarde. Se vio en el
 * archivo de estado: entradas del 13 escritas un 12 a las 19:00.
 */
function fechaLocal(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** El estado "ya avisé" del store se guarda bajo una clave fija, no por cwd. */
const storeStateKey = "todo-store"

/** El motivo que armó staleTodo, sin repetir su lógica de umbrales acá. */
function motivoDe(decision: Decision): string {
  const message = decision.action === "advise" ? decision.message : ""
  return message.match(/acumuló (.+)\./)?.[1] ?? "necesita revisión"
}

/** El store se versiona solo; una rotación sin commit queda como ruido sin dueño. */
function commitStore(env?: Env): void {
  try {
    const cwd = storeBase(env)
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" })
    execFileSync("git", ["commit", "-m", "archive: rotar DONE/DISCARDED por año", "--no-verify"], {
      cwd,
      stdio: "ignore",
    })
  } catch {
    // Sin identidad git, sin cambios o sin repo: la rotación ya está hecha en
    // disco, que es lo que importa. No vale romper el arranque de la sesión.
  }
}

/**
 * Poda por año de DONE.md/DISCARDED.md. Va en SessionStart porque es el único
 * momento en que ya hay `.todo/` y todavía no hay nada en vuelo que se pise.
 */
function archiveOldYears(cwd: string, year: number): Decision {
  const rotations = rotateArchives(cwd, year)
  if (rotations.length === 0) return ALLOW

  const detail = rotations.map((r) => `${r.moved} de ${r.file.replace(".md", "")} → ${r.file.replace(".md", `-${r.year}.md`)}`)
  return advise(
    `TODO-ARCHIVE: se archivaron items cerrados en años anteriores.
  ${detail.join("\n  ")}
Nada se perdió: los archivos quedan al lado, en .todo/. Commiteálos cuando toque.`,
  )
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
