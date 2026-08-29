import { ALLOW, advise, deny, type Decision } from "../../lib/protocol/protocol.ts"

// Re-export por compatibilidad: el parseo ahora vive en core/todo-files.ts.
export { openItemTitles } from "../../lib/todo-files/todo-files.ts"
import { itemsMentioning, openItems, type OpenItem } from "../../lib/todo-files/todo-files.ts"
export { openItems }

export type PreCommitInput = {
  hasTodoDir: boolean
  /** Archivos en staging (los primeros, para no inundar el mensaje). */
  staged: string[]
  /** Cuántos `- [x]` se AGREGARON a TODO.md/DOING.md en este staging. */
  markedCheckboxes: number
  /** Cuántos items (`- [x]` / `- ~~`) se AGREGARON a DONE.md/DISCARDED.md en este staging. */
  registeredWork: number
  /** Títulos de los items abiertos en DOING.md. */
  doing: string[]
  /** Los items abiertos de TODO.md, con su texto: se cruzan contra el staging. */
  todoOpen: OpenItem[]
  recentCommits: string[]
}

const MAX_DOING_SHOWN = 8
const MAX_RELATED_SHOWN = 6

/**
 * Revisión previa al commit. Editor-agnóstico: lo invoca git, no un CLI de IA,
 * así que corre igual desde cualquier editor o desde la terminal pelada.
 */
export function preCommitReview(input: PreCommitInput): Decision {
  if (!input.hasTodoDir) return ALLOW

  // Guard duro, y va ANTES del "¿hay algo en staging?": un `- [x]` puesto a mano
  // rompe DONE.md como fuente de verdad de lo completado, y --no-verify no
  // corresponde para saltearlo.
  if (input.markedCheckboxes > 0) {
    return deny(
      `TODO-PRE-COMMIT: ${input.markedCheckboxes} checkbox(es) '- [x]' marcados A MANO en TODO.md/DOING.md (staged).
Un item completado NO se marca: se MUEVE a DONE.md con narrativa y atribución.
→ Revertí el/los '- [x]' y corré la skill todo-done (todo-plugin); después volvé a commitear.
  --no-verify NO corresponde acá: el checkbox huérfano rompe DONE.md como fuente de completados.`,
    )
  }

  // El peaje tenía que tener una moneda: si el staging YA registra el trabajo
  // (items cerrados en DONE/DISCARDED), el commit pasa sin --no-verify. Esta es
  // la condición de allow que antes no existía — un gate que nunca puede pasar
  // obliga a normalizar --no-verify, que desarma toda la cadena de hooks.
  if (input.registeredWork > 0) return ALLOW

  if (input.staged.length === 0) return ALLOW

  const sections = [`TODO-PRE-COMMIT: Revisión previa al commit.\n`, `Archivos en staging: ${input.staged.join(" ")}\n`]

  if (input.doing.length > 0) {
    const items = input.doing.slice(0, MAX_DOING_SHOWN).map((title) => `  · ${title}`)
    sections.push(`Tareas EN PROGRESO (${input.doing.length} en DOING.md):\n${items.join("\n")}\n`)
  }

  // Lo que se rezaga es esto: la tarea que nunca pasó por DOING y sigue abierta
  // aunque el arreglo ya esté hecho. Mostrar solo el CONTADOR de TODO.md no
  // alcanzaba — nadie compara 40 items contra un diff. Nombrar las que hablan de
  // lo que estás commiteando convierte el aviso en una pregunta concreta.
  const relacionadas = itemsMentioning(input.todoOpen, input.staged)
  if (relacionadas.length > 0) {
    const items = relacionadas
      .slice(0, MAX_RELATED_SHOWN)
      .map(({ item, basename }) => `  · ${item.title}  (menciona ${basename})`)
    sections.push(
      `Tareas ABIERTAS que mencionan archivos de este commit — ¿alguna quedó resuelta?:\n${items.join("\n")}\n`,
    )
  } else if (input.todoOpen.length > 0) {
    sections.push(`Tareas ABIERTAS: ${input.todoOpen.length} items en TODO.md (ninguna menciona lo que estás commiteando)\n`)
  }

  if (input.doing.length === 0 && input.todoOpen.length === 0) {
    sections.push(`Sin tareas abiertas: si este commit resolvió algo, igual va registrado (paso 3).\n`)
  }

  const commits = input.recentCommits.length > 0
    ? input.recentCommits.map((line) => `  ${line}`).join("\n")
    : "  (sin commits recientes)"

  sections.push(`Commits recientes:\n${commits}

Instrucciones:
  1. Compará los archivos en staging con las tareas de arriba — las EN PROGRESO y
     las ABIERTAS que mencionan esos archivos.
  2. Si alguna quedó resuelta por este commit → invocá todo-done primero. Una tarea
     abierta cuyo arreglo ya está en el diff no se deja para después: se cierra acá
     o se queda rezagada para siempre.
  3. Si el commit resolvió algo que NO figura en TODO.md/DOING.md → NO uses --no-verify:
     creá la tarea ahora y cerrala en el mismo paso con todo-done (registrala directo
     en DONE.md, con narrativa y responsable). Un arreglo sin tarea es trabajo que
     desaparece del registro — DONE.md es lo que consumen las otras herramientas.
  4. --no-verify SOLO si el commit no resuelve nada: WIP, formato, docs, renombres.`)

  return advise(sections.join("\n"))
}

/** Minutos que un registro sigue acreditando commits después de haberse escrito. */
export const TANDA_MINUTES = 30

/**
 * ¿El registro en disco acredita este commit?
 *
 * La comparación contra HEAD se consume sola —apenas entra el commit, HEAD queda
 * más nuevo que DONE.md— y eso es lo correcto para que un registro viejo no
 * habilite commits para siempre. Pero asume 1 registro = 1 commit, y la
 * convención del proyecto (una unidad de trabajo por commit, con sus tests)
 * produce N commits por registro: el camino disciplinado —registrar todo junto,
 * después commitear en unidades— era justo el que el gate castigaba, y el
 * --no-verify resultante saltea toda la cadena de hooks, no solo este chequeo.
 *
 * Así que el registro acredita la TANDA: sigue valiendo mientras sea reciente.
 *
 * ponytail: la tanda es una ventana de tiempo, no un conjunto de commits
 * identificado. Techo conocido: un commit no relacionado dentro de los 30 min de
 * un registro también pasa. El upgrade, si molesta, es anotar en la marca
 * `todo-precommit-ok` qué registro se acreditó y contra eso comparar.
 */
export function registrationCredits(registeredAt: number, head: number, now: number): boolean {
  if (registeredAt <= 0) return false
  return registeredAt > head || now - registeredAt < TANDA_MINUTES * 60_000
}
