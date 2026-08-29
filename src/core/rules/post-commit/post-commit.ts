import { ALLOW, advise, type Decision } from "../../protocol.ts"

export type PostCommitInput = {
  hasTodoDir: boolean
  /** El pre-commit dejó su marca: la revisión de tareas se vio antes de este commit. */
  preCommitRan: boolean
  /** Asunto del reflog de HEAD (`%gs`): distingue amend/rebase/merge de un commit normal. */
  reflogSubject: string
  /** Subject del commit recién hecho. */
  subject: string
  /** Commits desde el último que tocó DONE.md, oneline (retroactivo). */
  unregistered: string[]
}

const MAX_UNREGISTERED_SHOWN = 10

/** Un amend/rebase/merge no es trabajo nuevo: el commit original ya se revisó. */
const MECHANICAL = /^(commit \(amend\)|commit \(merge\)|rebase|merge|cherry-pick|revert)/

/**
 * Red de contención del `--no-verify` de entrada. El pre-commit no puede verse a
 * sí mismo saltear; git, en cambio, corre post-commit igual aunque el commit se
 * haya forzado, así que el aviso todavía llega a algún lado.
 *
 * Ojo con qué delata: como el `advise` del pre-commit aborta el commit, forzarlo
 * DESPUÉS de leer el mensaje es el camino sancionado y no genera ruido. Lo que
 * queda sin cubrir —y esto lo cubre— es el commit forzado de entrada, que nunca
 * pasó por la revisión.
 */
export function postCommitReview(input: PostCommitInput): Decision {
  if (!input.hasTodoDir) return ALLOW
  if (MECHANICAL.test(input.reflogSubject)) return ALLOW
  if (input.preCommitRan) return ALLOW

  const sections = [
    `TODO-POST-COMMIT: este commit nunca pasó por la revisión de tareas (--no-verify de entrada).
  ${input.subject}`,
  ]

  if (input.unregistered.length > 0) {
    const shown = input.unregistered.slice(0, MAX_UNREGISTERED_SHOWN).map((line) => `  ${line}`)
    const extra = input.unregistered.length > MAX_UNREGISTERED_SHOWN
      ? `\n  … y ${input.unregistered.length - MAX_UNREGISTERED_SHOWN} más`
      : ""
    sections.push(`Commits sin registro desde el último cierre (${input.unregistered.length}):
${shown.join("\n")}${extra}`)
  }

  sections.push(`Si alguno resolvió algo, registralo AHORA: creá la tarea y escribila directo en
DONE.md (skill todo-done, edge case "Trabajo no contemplado"). Un arreglo sin
tarea desaparece del registro, y DONE.md es la fuente de lo completado.
Si de verdad no resuelven nada —WIP, formato, docs, renombres—, ignorá esto.`)

  return advise(sections.join("\n\n"))
}
