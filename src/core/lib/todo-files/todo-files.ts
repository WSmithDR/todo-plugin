import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Env } from "../paths/paths.ts"
import { projectForPath, resolveProjectDir } from "../store/store.ts"

/** Lectura y parseo de los archivos de `.todo/`. Nadie más los interpreta. */

export type OpenItem = {
  /** El texto en negrita del item. */
  title: string
  /** La línea completa: título, descripción y metadata. */
  text: string
}

/** `- [ ] **Título** — descripción` */
export function openItems(markdown: string): OpenItem[] {
  const items: OpenItem[] = []
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("- [ ]")) continue
    const match = line.match(/^- \[ \] \*\*([^*]+)\*\*/)
    // Sin negrita se usa la línea entera como título: es preferible a descartar
    // el item y que desaparezca de los conteos.
    items.push({ title: match ? match[1]!.trim() : line, text: line })
  }
  return items
}

export const openItemTitles = (markdown: string): string[] => openItems(markdown).map((item) => item.title)

/**
 * Dónde están las tareas contra las que evaluar una edición: el `.todo/` del cwd
 * o, si el archivo editado vive dentro del store, el del proyecto dueño de ese
 * path. null si no hay ninguna de las dos.
 *
 * La resolución por path es lo que hace viable `editing-item` en los proyectos
 * sin repo: sin `.todo/` local no hay "el proyecto actual", pero el archivo que
 * se está tocando ya dice a cuál pertenece.
 */
export function editingContext(
  cwd: string,
  paths: string[],
  env?: Env,
): { dir: string; todo: OpenItem[]; doing: string[] } | null {
  const dir = (() => {
    const resolved = resolveProjectDir(cwd, env)
    if (resolved !== null) return resolved
    for (const path of paths) {
      const project = projectForPath(path, { env })
      if (project) return project.dir
    }
    return null
  })()
  if (dir === null) return null

  return {
    dir,
    todo: openItems(readTodoFile(dir, "TODO.md")),
    doing: openItemTitles(readTodoFile(dir, "DOING.md")),
  }
}

/** Un `.todo/<archivo>` que no existe se lee como vacío: no todos existen siempre. */
export function readTodoFile(cwd: string, name: string): string {
  try {
    return readFileSync(join(cwd, ".todo", name), "utf8")
  } catch {
    return ""
  }
}

export const completedCount = (markdown: string): number =>
  markdown.split("\n").filter((line) => line.startsWith("- [x]")).length

/** Los descartados no llevan checkbox: se tachan (`- ~~Título~~`). */
export const discardedCount = (markdown: string): number =>
  markdown.split("\n").filter((line) => line.startsWith("- ~~")).length

/**
 * Nombres tan comunes que aparecer en un item no significa nada. Sin este
 * filtro, cualquier tarea que mencione `index.ts` matchearía con cualquier
 * index.ts del repo.
 */
const DEMASIADO_COMUNES = new Set([
  "index.ts", "index.js", "index.tsx", "main.ts", "main.js", "mod.ts",
  "types.ts", "utils.ts", "config.ts", "README.md", "package.json",
])
// NO agregar nombres acá por cada stack que aparezca. Esta lista es de la época
// en que el matcher solo servía a `editing-item`, y crece sin fondo: hoy
// WordPress, mañana Django. Para lo demás, la señal débil se REPORTA y la decide
// quien lee — ver `sharedBy` en core/stale-items.ts.

/** Un basename que sirve para relacionar: ni corto, ni de los que están en todos lados. */
export function significantBasename(path: string): string | null {
  if (path.includes(".todo/")) return null // el propio registro no cuenta
  const basename = path.split(/[\\/]/).pop() ?? ""
  if (basename.length < 5 || DEMASIADO_COMUNES.has(basename)) return null
  return basename
}

/**
 * Los items que mencionan alguno de estos archivos.
 *
 * Es la misma pregunta que se hace `editing-item` al verte editar un archivo y
 * el pre-commit al ver qué hay en staging: "¿esta tarea habla de esto?". Vive
 * acá para que las dos den la MISMA respuesta.
 */
export function itemsMentioning(items: OpenItem[], paths: string[]): { item: OpenItem; basename: string }[] {
  const hits: { item: OpenItem; basename: string }[] = []

  for (const path of paths) {
    const basename = significantBasename(path)
    if (basename === null) continue

    for (const item of items) {
      if (!item.text.includes(basename)) continue
      if (hits.some((hit) => hit.item.title === item.title)) continue
      hits.push({ item, basename })
    }
  }
  return hits
}

/**
 * El item de DOING.md que lleva más tiempo en curso, según su `iniciado:`.
 *
 * Una tarea que arrancó hace semanas o está trabada o ya se hizo y nadie la
 * movió; en los dos casos DOING.md dejó de decir la verdad, que es justo lo que
 * el pre-commit usa para sugerir qué cerrar.
 */
export function oldestStarted(markdown: string, today: Date): { title: string; days: number } | null {
  let peor: { title: string; days: number } | null = null

  for (const item of openItems(markdown)) {
    const iniciado = item.text.match(/iniciado:\s*(\d{4}-\d{2}-\d{2})/)?.[1]
    if (iniciado === undefined) continue

    const days = Math.floor((today.getTime() - new Date(`${iniciado}T00:00:00`).getTime()) / 86_400_000)
    if (peor === null || days > peor.days) peor = { title: item.title, days }
  }
  return peor
}

/** Días desde el `_Última revisión: YYYY-MM-DD_` del encabezado, o null si no está. */
export function daysSinceReview(markdown: string, today: Date): number | null {
  const match = markdown.match(/_Última revisión:\s*(\d{4}-\d{2}-\d{2})/)
  const date = match?.[1]
  if (date === undefined) return null

  const millis = today.getTime() - new Date(`${date}T00:00:00`).getTime()
  return Math.floor(millis / 86_400_000)
}
