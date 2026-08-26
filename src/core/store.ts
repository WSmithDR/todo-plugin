import { execFileSync, type ExecFileSyncOptions } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs"
import { join, basename, sep } from "node:path"
import { storeBase, type Env } from "./paths.ts"

/**
 * Registro central de proyectos sin repo (p.ej. un sitio WordPress operado por
 * MCP). El store es UN repo git con un subdirectorio `<id>/.todo/` por proyecto.
 * Identidad = nombre + id; nunca se crean archivos en el cwd.
 */

export type Project = { id: string; name: string }
export type Mode = "repo" | "nonrepo"

export type StoreOptions = {
  env?: Env
  /** Inyectable para testear la fecha de creación. */
  now?: Date
}

/**
 * stderr a pipe y no heredado: el mensaje queda en el Error que se propaga, en
 * vez de escupirse por la salida del proceso que nos llamó (que puede ser un hook).
 */
const QUIET: ExecFileSyncOptions = { stdio: ["ignore", "ignore", "pipe"] }

/** Resuelve symlinks; si el path no existe todavía, se devuelve tal cual. */
function physical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Root físico del repo que contiene `path`, o "" si no hay. */
function repoRoot(path: string): string {
  try {
    return physical(
      execFileSync("git", ["-C", path, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    )
  } catch {
    return ""
  }
}

/** El remote del repo, o "" si no tiene. Es la identidad máquina-agnóstica. */
export function repoUrl(repoPath: string): string {
  try {
    return execFileSync("git", ["-C", repoPath, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return ""
  }
}

type Origin = { url: string; path: string }

/**
 * Dónde vive este proyecto en ESTA máquina. Lo universal va en config.json
 * (commiteado); lo que solo vale acá —el path del clon— en config.local.json,
 * ignorado por el store vía `*.local.json`. Un store sin remote sincroniza
 * igual: cada máquina regenera su .local y listo.
 */
function readOrigin(id: string, opts: StoreOptions): Origin {
  const base = storeBase(opts.env)
  let url = ""
  let path = ""
  try {
    const universal = JSON.parse(readFileSync(join(base, id, ".todo", "config.json"), "utf8")) as {
      origin?: string
      origin_url?: string
    }
    if (typeof universal.origin_url === "string") url = universal.origin_url
  } catch {
    // Sin config no hay origen; el path de abajo también puede fallar.
  }
  try {
    const local = JSON.parse(readFileSync(join(base, id, ".todo", "config.local.json"), "utf8")) as {
      origin_path?: string
    }
    if (typeof local.origin_path === "string") path = physical(local.origin_path)
  } catch {
    // Otra máquina sin adoptar todavía: queda solo la URL.
  }
  // Formato legado (pre-multi-PC): origin era el path, directo en config.json.
  if (url === "" && path === "") {
    try {
      const legacy = JSON.parse(readFileSync(join(base, id, ".todo", "config.json"), "utf8")) as {
        origin?: string
      }
      if (typeof legacy.origin === "string") path = physical(legacy.origin)
    } catch {
      // ídem
    }
  }
  return { url, path }
}

/**
 * Preferencia global del store: ¿los proyectos CON repo también centralizan su
 * .todo acá? Vive en <base>/settings.json — fuera de los config.json por
 * proyecto, porque es una decisión del usuario, no de cada proyecto.
 */
export function centralRepos(opts: StoreOptions = {}): boolean {
  try {
    const raw = JSON.parse(readFileSync(join(storeBase(opts.env), "settings.json"), "utf8")) as {
      central_repos?: boolean
    }
    return raw.central_repos === true
  } catch {
    return false
  }
}

/**
 * ¿El `.todo/` de este directorio sale del repo o del store central?
 *
 * La comparación es sobre paths FÍSICOS. En bash se usaba `$PWD`, que es el path
 * lógico: con un symlink en HOME o en XDG_DATA_HOME un directorio del propio
 * store se clasificaba como `repo` y el plugin escribía en el lugar equivocado.
 */
export function mode(cwd: string, opts: StoreOptions = {}): Mode {
  const base = physical(storeBase(opts.env))
  const here = physical(cwd)
  if (here === base || here.startsWith(base + sep)) return "nonrepo"

  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: here,
      stdio: "ignore",
    })
    // Con la preferencia activa, los repos también operan sobre el store: las
    // skills ya saben resolver nonrepo con menú de proyectos, así que se reutiliza
    // ese flujo tal cual.
    return centralRepos(opts) ? "nonrepo" : "repo"
  } catch {
    return "nonrepo"
  }
}

export function list(opts: StoreOptions = {}): Project[] {
  const base = storeBase(opts.env)
  if (!existsSync(base)) return []

  const projects: Project[] = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const config = join(base, entry.name, ".todo", "config.json")
    if (!existsSync(config)) continue
    try {
      const { id, name } = JSON.parse(readFileSync(config, "utf8")) as Partial<Project>
      if (id && name) projects.push({ id, name })
    } catch {
      // Un config.json corrupto no puede tirar abajo el listado entero.
    }
  }
  return projects
}

/**
 * `café` → `cafe`, no `caf`.
 *
 * El `tr -cs 'a-z0-9'` de bash borraba los acentuados en vez de transliterarlos,
 * y los nombres de cliente con tilde quedaban mutilados. NFD separa la letra de
 * su diacrítico y se descarta solo el diacrítico.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "proyecto"
}

function today(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function gitUserName(): string {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

/**
 * Da de alta un proyecto y devuelve su id.
 *
 * Si el commit falla —la causa típica es no tener identidad git global— se borra
 * el directorio recién creado. Sin esa limpieza quedaba un `<id>/` huérfano y el
 * siguiente intento con el mismo nombre se corría a `<id>-2`, acumulando basura
 * en cada reintento.
 */
export function create(name: string, opts: StoreOptions = {}): string {
  const base = storeBase(opts.env)
  mkdirSync(base, { recursive: true })
  if (!existsSync(join(base, ".git"))) {
    execFileSync("git", ["-C", base, "init", "-q"], QUIET)
  }

  const slug = slugify(name)
  let id = slug
  for (let n = 2; existsSync(join(base, id)); n++) id = `${slug}-${n}`

  const projectDir = join(base, id)
  const todoPath = join(projectDir, ".todo")
  mkdirSync(todoPath, { recursive: true })

  try {
    writeFileSync(
      join(todoPath, "config.json"),
      JSON.stringify(
        {
          name,
          id,
          created_at: today(opts.now ?? new Date()),
          created_by: gitUserName(),
          gitignore_todo: false,
        },
        null,
        2,
      ) + "\n",
    )
    execFileSync("git", ["-C", base, "add", join(id, ".todo", "config.json")], QUIET)
    execFileSync("git", ["-C", base, "commit", "-q", "-m", `todo: registrar proyecto ${name}`], QUIET)
  } catch (error) {
    rmSync(projectDir, { recursive: true, force: true })
    throw error
  }

  return id
}

/**
 * Registra (o actualiza) qué repo alimenta este proyecto. Lo consume
 * `projectForRepo` para resolver hooks, pipeline y editing-item en repos
 * centralizados: un repo = un proyecto.
 */
export function setOrigin(id: string, repoRootPath: string, opts: StoreOptions = {}): void {
  const base = storeBase(opts.env)
  const todoDir = join(base, id, ".todo")
  const configPath = join(todoDir, "config.json")
  const localPath = join(todoDir, "config.local.json")

  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>
  const url = repoUrl(repoRootPath)
  const previo = readOrigin(id, opts)
  if (previo.url === url && previo.path === physical(repoRootPath)) return

  // Universal: viaja con el store. Legado se limpia si estaba.
  delete config.origin
  if (url !== "") config.origin_url = url
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")

  // Local por máquina: nunca se versiona.
  writeFileSync(localPath, JSON.stringify({ origin_path: physical(repoRootPath) }, null, 2) + "\n")
  ensureStoreGitignore(base)

  try {
    execFileSync("git", ["-C", base, "add", join(id, ".todo", "config.json")], QUIET)
    execFileSync("git", ["-C", base, "commit", "-q", "-m", `todo: ${id} ← ${url !== "" ? url : basename(physical(repoRootPath))}`], QUIET)
  } catch {
    // El store puede no tener identidad git; el dato ya quedó escrito.
  }
}

/** Los .local.json son de esta máquina: ignorados en el repo del store. */
function ensureStoreGitignore(base: string): void {
  const gitignore = join(base, ".gitignore")
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*.local.json\n")
}

/** El proyecto cuyo repo de origen es este. Exige la preferencia central_repos. */
export function projectForRepo(root: string, opts: StoreOptions = {}): Project | null {
  if (!centralRepos(opts)) return null
  const here = physical(root)
  if (here === "") return null
  const url = repoUrl(here)
  return (
    list(opts).find((project) => {
      const origin = readOrigin(project.id, opts)
      // Primero la identidad universal (viaja entre máquinas); el path es el
      // fallback para repos sin remote.
      return (url !== "" && origin.url === url) || (here !== "" && origin.path === here)
    }) ?? null
  )
}

/**
 * Dónde están las tareas de este cwd: el `.todo/` local mientras exista —así la
 * migración con `adopt` es optativa y reversible—, sino el proyecto del store
 * con `origin` en este repo. Devuelve el DIR DEL PROYECTO (el que contiene
 * `.todo/`), igual que hace `editingContext`. null si no hay ninguno.
 */
export function resolveProjectDir(cwd: string, env?: Env): string | null {
  if (existsSync(join(cwd, ".todo"))) return cwd
  // Cortocircuito: sin la preferencia no hay nada que buscar en el store, y así
  // el caso por-defecto no paga un `git rev-parse` por evento.
  if (!centralRepos({ env })) return null
  const project = projectForRepo(repoRoot(cwd), { env })
  return project ? join(storeBase(env), project.id) : null
}

/**
 * Mudanza retroactiva: el `.todo/` de un repo pasa al store central y el repo
 * queda amarrado vía `origin`. Idempotente por repo — la segunda llamada
 * encuentra el proyecto por origin y no duplica nada.
 *
 * ponytail: mueve TODO/DOING/DONE/DISCARDED y sus archivos de año; cualquier
 * otro archivo suelto en .todo/ se deja atrás a propósito — si aparece algo que
 * haga falta mudar, se agrega a la lista, no un glob ciego.
 */
export function adopt(repoPath: string, name: string | undefined, opts: StoreOptions = {}): { id: string; dir: string } {
  const root = repoRoot(repoPath)
  if (root === "") throw new Error(`no es un repo git: ${repoPath}`)

  // Mismo predicado que projectForRepo: URL primero (otra máquina), path después.
  const url = repoUrl(root)
  const existing = list(opts).find((project) => {
    const origin = readOrigin(project.id, opts)
    return (url !== "" && origin.url === url) || origin.path === root
  })
  const id = existing?.id ?? create(name ?? basename(root), opts)
  const dir = join(storeBase(opts.env), id)
  mkdirSync(join(dir, ".todo"), { recursive: true })

  const local = join(root, ".todo")
  if (existsSync(local)) {
    const mudados: string[] = []
    for (const file of readdirSync(local)) {
      if (!/^((TODO|DOING|DONE|DISCARDED)(-[0-9]{4})?\.md)$/.test(file)) continue
      cpSync(join(local, file), join(dir, ".todo", file))
      mudados.push(join(id, ".todo", file))
    }
    try {
      if (mudados.length > 0) {
        execFileSync("git", ["-C", storeBase(opts.env), "add", ...mudados], QUIET)
        execFileSync("git", ["-C", storeBase(opts.env), "commit", "-q", "-m", `todo: migrar ${id} desde ${basename(root)}`], QUIET)
      }
    } catch {
      // Sin identidad git en el store el dato ya quedó en disco.
    }
    for (const file of readdirSync(local)) {
      if (!/^((TODO|DOING|DONE|DISCARDED)(-[0-9]{4})?\.md)$/.test(file)) continue
      cpSync(join(local, file), join(dir, ".todo", file))
      rmSync(join(local, file))
    }
    // config.json es metadata del régimen local: si queda, el .todo/ sobrevive
    // vacío y resolveProjectDir seguiría creyendo que las tareas viven acá.
    rmSync(join(local, "config.json"), { force: true })
    // El directorio queda si tenía algo más (config custom, etc.) — eso se deja
    // atrás a propósito. Si quedó vacío, fuera:
    if (readdirSync(local).length === 0) rmdirSync(local)
  }

  setOrigin(id, root, opts)
  return { id, dir }
}

/**
 * La mordida de central_repos: si este cwd es un repo con `.todo/` local que
 * todavía no tiene proyecto en el store, lo adopta AHORA, sin preguntar. Es lo
 * que corre en SessionStart — la migración no se ofrece, pasa.
 *
 * null cuando no corresponde: preferencia apagada, dentro del propio store
 * (nunca se traga a sí mismo), sin `.todo/` local, sin repo o ya adoptado.
 */
export function adoptPending(cwd: string, opts: StoreOptions = {}): { id: string; dir: string } | null {
  if (!centralRepos(opts)) return null

  const base = physical(storeBase(opts.env))
  const here = physical(cwd)
  if (here === base || here.startsWith(base + sep)) return null
  if (!existsSync(join(here, ".todo"))) return null

  const root = repoRoot(here)
  if (root === "" || projectForRepo(root, opts) !== null) return null

  return adopt(here, undefined, opts)
}

/**
 * ¿A qué proyecto del store pertenece este path? null si está afuera.
 *
 * Es la resolución más barata y menos ambigua que hay para los proyectos sin
 * repo: el archivo que se está tocando ya dice de quién es. Sin esto habría que
 * buscar el nombre del archivo en las tareas de LOS SEIS proyectos, y un
 * `functions.php` mencionado en tres sitios avisaría del proyecto equivocado.
 */
export function projectForPath(path: string, opts: StoreOptions = {}): (Project & { dir: string }) | null {
  const base = physical(storeBase(opts.env))
  const here = physical(path)
  if (!here.startsWith(base + sep)) return null

  const id = here.slice(base.length + 1).split(sep)[0]
  if (id === undefined || id === "") return null

  // Se valida contra el listado: un directorio suelto dentro del store, sin
  // config.json, no es un proyecto.
  const project = list(opts).find((candidate) => candidate.id === id)
  return project ? { ...project, dir: join(base, id) } : null
}

export function projectPath(id: string, opts: StoreOptions = {}): string {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`id inválido: ${id}`)
  const dir = join(storeBase(opts.env), id)
  mkdirSync(join(dir, ".todo"), { recursive: true })
  return dir
}

/**
 * Pull + push del store contra SU remote, si tiene. Es best-effort y silencioso:
 * sin remote o sin red no hace nada — el store local siempre es la fuente de
 * verdad de esta sesión. Se llama al iniciar sesión (pull antes de leer nada)
 * y al cerrarla (push de lo que las skills commitearon).
 */
export function syncStore(opts: StoreOptions = {}): void {
  const base = storeBase(opts.env)
  if (!existsSync(join(base, ".git"))) return

  let hasRemote = false
  try {
    hasRemote =
      execFileSync("git", ["-C", base, "remote", "get-url", "origin"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() !== ""
  } catch {
    return
  }
  if (!hasRemote) return

  try {
    execFileSync("git", ["-C", base, "pull", "--rebase", "--autostash", "--quiet", "origin"], QUIET)
  } catch {
    // Sin red o con conflicto: se sigue con lo local. El próximo intento lo lleva.
  }
  try {
    execFileSync("git", ["-C", base, "push", "--quiet", "origin", "HEAD"], QUIET)
  } catch {
    // ídem — el pull de la próxima sesión recoge lo que hoy no pudo subir.
  }
}

/** El HEAD del repo hasta donde están registradas las tareas. Universal:
 * el hash vale en cualquier clon del mismo remote. Idempotente por hash. */
export function setLastCommit(id: string, head: string, opts: StoreOptions = {}): void {
  const base = storeBase(opts.env)
  const configPath = join(base, id, ".todo", "config.json")
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>
    if (config.last_commit === head) return
    config.last_commit = head
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
    execFileSync("git", ["-C", base, "add", join(id, ".todo", "config.json")], QUIET)
    execFileSync("git", ["-C", base, "commit", "-q", "-m", `todo: ${id} registrada hasta ${head.slice(0, 7)}`], QUIET)
  } catch {
    // Sin identidad git o sin cambios: el dato ya quedó en disco.
  }
}

export function readLastCommit(id: string, opts: StoreOptions = {}): string {
  try {
    const raw = JSON.parse(readFileSync(join(storeBase(opts.env), id, ".todo", "config.json"), "utf8")) as {
      last_commit?: string
    }
    return typeof raw.last_commit === "string" ? raw.last_commit : ""
  } catch {
    return ""
  }
}

export function repoRootOf(path: string): string {
  return repoRoot(path)
}

/** El repo de ESTA máquina que alimenta el proyecto (config.local.json), o "". */
export function originRepoPath(id: string, opts: StoreOptions = {}): string {
  return readOrigin(id, opts).path
}
