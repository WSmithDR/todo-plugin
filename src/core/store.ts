import { execFileSync, type ExecFileSyncOptions } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join, sep } from "node:path"
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
    return "repo"
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
