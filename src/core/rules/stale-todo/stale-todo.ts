import { ALLOW, advise, type Decision } from "../../lib/protocol/protocol.ts"

export type StaleTodoInput = {
  hasTodoDir: boolean
  /** Items abiertos en TODO.md. */
  todoCount: number
  /** Días desde `_Última revisión:_`, o null si el archivo no la trae. */
  daysSinceReview: number | null
}

/** Con menos de esto, releer la lista es más barato que triagear. */
const CROWDED = 12
/** Un mes sin revisar: las prioridades de hace un mes ya no son las de hoy. */
const STALE_DAYS = 30

/**
 * `todo-triage` es la única skill que nadie invoca sola: revisar la lista no es
 * urgente nunca, así que no pasa. Esto le da el momento que le faltaba.
 *
 * Dispara por dos motivos distintos —lista larga o lista vieja— porque son dos
 * problemas distintos: 30 items sin ordenar no se navegan, y 5 items de hace tres
 * meses probablemente ya no son lo importante.
 */
export function staleTodo(input: StaleTodoInput): Decision {
  if (!input.hasTodoDir || input.todoCount === 0) return ALLOW

  const crowded = input.todoCount >= CROWDED
  const stale = input.daysSinceReview !== null && input.daysSinceReview > STALE_DAYS
  if (!crowded && !stale) return ALLOW

  const motivo = [
    crowded ? `${input.todoCount} items abiertos` : "",
    stale ? `${input.daysSinceReview} días sin revisar` : "",
  ].filter(Boolean).join(" y ")

  return advise(
    `TODO-TRIAGE-DUE: TODO.md acumuló ${motivo}.
Invocar Skill('todo-triage') para re-priorizar por cuadrante, detectar items muertos y fusionar duplicados.
Si el usuario está en otra cosa, no lo interrumpas: ofrecelo cuando termine lo que está haciendo.`,
  )
}
