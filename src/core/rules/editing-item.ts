import { ALLOW, advise, type Decision, type ToolEvent } from "../protocol.ts"

export type EditingItemContext = {
  hasTodoDir: boolean
  /** Títulos + descripción de los items abiertos en TODO.md. */
  todo: { title: string; text: string }[]
  /** Títulos de los items abiertos en DOING.md. */
  doing: string[]
  /** Marca el aviso y devuelve si era nuevo. Evita repetirlo en cada edición. */
  advisedOnce: (subject: string) => boolean
}

/**
 * Nombres tan comunes que aparecer en un item no significa nada. Sin este filtro,
 * cualquier item que mencione `index.ts` avisaría al tocar cualquier index.ts del
 * repo.
 */
const DEMASIADO_COMUNES = new Set([
  "index.ts", "index.js", "index.tsx", "main.ts", "main.js", "mod.ts",
  "types.ts", "utils.ts", "config.ts", "README.md", "package.json",
])

/**
 * Empezaste a editar un archivo que un item de TODO.md menciona, y ese item no
 * está en DOING.md.
 *
 * Es el hueco que el propio mensaje de `branch-doing` admite: esa regla solo
 * dispara al cambiar de rama, así que si trabajás varias tareas en la misma rama
 * únicamente la primera avisa. Editar el archivo que la tarea nombra es la señal
 * más directa de "empecé con esto".
 *
 * Avisa UNA vez por item y por proyecto: el hook corre en cada edición, y un
 * aviso repetido es ruido que el modelo aprende a saltear.
 */
export function editingItem(event: ToolEvent, ctx: EditingItemContext): Decision {
  if (event.phase !== "after") return ALLOW
  if (!["edit", "write", "multiedit"].includes(event.kind)) return ALLOW
  if (!ctx.hasTodoDir || ctx.todo.length === 0) return ALLOW

  const enCurso = new Set(ctx.doing)

  for (const path of event.paths) {
    // El propio .todo/ no cuenta: editarlo es la operación del plugin, no trabajo
    // sobre una tarea.
    if (path.includes(".todo/")) continue

    const basename = path.split(/[\\/]/).pop() ?? ""
    if (basename.length < 5 || DEMASIADO_COMUNES.has(basename)) continue

    for (const item of ctx.todo) {
      if (enCurso.has(item.title)) continue
      if (!item.text.includes(basename)) continue
      if (!ctx.advisedOnce(item.title)) continue

      return advise(
        `TODO-DOING: estás editando ${basename}, que la tarea abierta "${item.title}" menciona,
y esa tarea no está en .todo/DOING.md.

Si arrancaste con ella, movela con la skill todo-doing — DOING.md es la fuente de
verdad de lo que está en curso, y el pre-commit la usa para sugerir qué cerrar.
Si estás tocando el archivo por otra razón, ignorá este aviso: no se repite.`,
      )
    }
  }

  return ALLOW
}
