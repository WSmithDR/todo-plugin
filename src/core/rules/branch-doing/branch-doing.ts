import { ALLOW, advise, type Decision, type ToolEvent } from "../../lib/protocol/protocol.ts"

export type BranchDoingContext = {
  hasTodoDir: boolean
  /** Rama DESPUÉS de que el comando corrió. La resuelve el adapter, no el string. */
  branch: string
}

/**
 * Solo los comandos que te dejan PARADO en otra rama. `git checkout <archivo>`
 * restaura un archivo y `git branch foo` crea sin moverse: ninguno cambia dónde
 * estás, así que no disparan.
 */
const SWITCHES_BRANCH = /git\s+(switch(\s|$)|checkout\s+-[bB])/

/** Ramas base y el HEAD detached: nada de eso es empezar una tarea. */
const NOT_A_FEATURE = new Set(["main", "master", "develop", "HEAD", ""])

/**
 * Cambiar a una rama de feature es la señal más confiable de "empecé algo".
 * Enforcement suave —`advise`— porque el hook no puede saber qué tarea es: eso
 * lo decide el modelo leyendo TODO.md.
 */
export function branchDoing(event: ToolEvent, ctx: BranchDoingContext): Decision {
  if (event.phase !== "after" || event.kind !== "bash") return ALLOW
  if (!ctx.hasTodoDir) return ALLOW
  if (!event.command || !SWITCHES_BRANCH.test(event.command)) return ALLOW
  if (NOT_A_FEATURE.has(ctx.branch)) return ALLOW

  return advise(
    `TODO-DOING: Estás en la rama de feature '${ctx.branch}'.
Asegurate de que la(s) tarea(s) que vas a trabajar en esta rama estén en .todo/DOING.md
(una rama puede abarcar varias). Mové las que falten con la skill todo-doing (DOING.md es
la fuente de verdad de lo en progreso).
  → Las que ya estén en DOING.md: ignoralas.
  → Las que aún no existan en .todo/TODO.md: agregalas primero y luego movelas.
Nota: este aviso solo dispara al crear/cambiar de rama; si más adelante arrancás otra tarea
en esta misma rama, movela vos con todo-doing (no hay señal automática para eso).`,
  )
}
