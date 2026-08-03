import { ALLOW, advise, deny, type Decision } from "../protocol.ts"

export type PreCommitInput = {
  hasTodoDir: boolean
  /** Archivos en staging (los primeros, para no inundar el mensaje). */
  staged: string[]
  /** Cuántos `- [x]` se AGREGARON a TODO.md/DOING.md en este staging. */
  markedCheckboxes: number
  /** Títulos de los items abiertos en DOING.md. */
  doing: string[]
  /** Cuántos items abiertos hay en TODO.md. */
  todoCount: number
  recentCommits: string[]
}

const MAX_DOING_SHOWN = 8

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

  if (input.staged.length === 0) return ALLOW
  if (input.doing.length === 0 && input.todoCount === 0) return ALLOW

  const sections = [`TODO-PRE-COMMIT: Revisión previa al commit.\n`, `Archivos en staging: ${input.staged.join(" ")}\n`]

  if (input.doing.length > 0) {
    const items = input.doing.slice(0, MAX_DOING_SHOWN).map((title) => `  · ${title}`)
    sections.push(`Tareas EN PROGRESO (${input.doing.length} en DOING.md):\n${items.join("\n")}\n`)
  }
  if (input.todoCount > 0) {
    sections.push(`Tareas ABIERTAS: ${input.todoCount} items en TODO.md\n`)
  }

  const commits = input.recentCommits.length > 0
    ? input.recentCommits.map((line) => `  ${line}`).join("\n")
    : "  (sin commits recientes)"

  sections.push(`Commits recientes:\n${commits}

Instrucciones:
  1. Compara los archivos en staging con las tareas en progreso.
  2. Si alguna tarea fue resuelta por este commit → invocar todo-done primero.
  3. Si ninguna fue resuelta → forzar el commit con: git commit --no-verify
  4. No bloquear el commit si no hay coincidencias claras.`)

  return advise(sections.join("\n"))
}

/** `- [ ] **Título** — descripción` → `Título`. */
export function openItemTitles(markdown: string): string[] {
  const titles: string[] = []
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("- [ ]")) continue
    const match = line.match(/^- \[ \] \*\*([^*]+)\*\*/)
    titles.push(match ? match[1]!.trim() : line)
  }
  return titles
}
