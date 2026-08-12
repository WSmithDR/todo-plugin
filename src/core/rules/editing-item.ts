import { ALLOW, advise, type Decision, type ToolEvent } from "../protocol.ts"
import { itemsMentioning } from "../todo-files.ts"

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

  for (const { item, basename } of itemsMentioning(ctx.todo, event.paths)) {
    if (enCurso.has(item.title)) continue
    if (!ctx.advisedOnce(item.title)) continue

    return advise(
      `TODO-DOING: estás editando ${basename}, que la tarea abierta "${item.title}" menciona,
y esa tarea no está en .todo/DOING.md.

Si arrancaste con ella, movela con la skill todo-doing — DOING.md es la fuente de
verdad de lo que está en curso, y el pre-commit la usa para sugerir qué cerrar.
Si estás tocando el archivo por otra razón, ignorá este aviso: no se repite.`,
    )
  }

  return ALLOW
}
