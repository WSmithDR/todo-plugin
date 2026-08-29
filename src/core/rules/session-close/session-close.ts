import { ALLOW, advise, type Decision } from "../../protocol.ts"

export type SessionCloseContext = {
  hasTodoDir: boolean
  /** Items abiertos en DOING.md. */
  doing: string[]
  /** HEAD se movió desde la última vez que miramos: hubo commits. */
  headMoved: boolean
}

const MAX_SHOWN = 8

/**
 * Al cerrar la sesión, recordar cerrar lo que quedó en DOING.md.
 *
 * Condicionado a que HEAD se haya movido, y no solo a que DOING tenga items: si
 * no commiteaste nada, es muy probable que la tarea siga realmente en curso y el
 * aviso sería ruido en cada sesión. Con commits de por medio, en cambio, algo se
 * terminó — y ese es justo el momento en que uno se olvida de correr todo-done.
 *
 * Es el único hook que mira el final. `branch-doing` avisa al empezar y el
 * pre-commit al commitear; entre medio, y después del último commit, no había
 * ninguna señal.
 */
export function sessionClose(ctx: SessionCloseContext): Decision {
  if (!ctx.hasTodoDir || !ctx.headMoved || ctx.doing.length === 0) return ALLOW

  const items = ctx.doing.slice(0, MAX_SHOWN).map((title) => `  · ${title}`)
  const resto = ctx.doing.length > MAX_SHOWN ? `\n  … y ${ctx.doing.length - MAX_SHOWN} más` : ""

  return advise(
    `TODO-SESSION-END: hubo commits nuevos y quedan ${ctx.doing.length} tarea(s) en DOING.md:
${items.join("\n")}${resto}

Si alguna quedó resuelta, cerrala con la skill todo-done — DONE.md es la fuente
de verdad de lo completado, y un item que se queda en DOING deja de reflejar en
qué estás trabajando.
Si siguen en curso, ignorá este aviso.`,
  )
}
