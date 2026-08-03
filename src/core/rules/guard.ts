import { ALLOW, deny, type Decision, type ToolEvent } from "../protocol.ts"

const MARKED_CHECKBOX =
  "TODO-GUARD: intento de marcar '- [x]' en TODO.md/DOING.md bloqueado (la ventana de escritura NO lo autoriza). " +
  "Un item completado se MUEVE a DONE.md: usá la skill todo-done."

const DIRECT_EDIT =
  "TODO-GUARD: edición directa de .todo/ bloqueada. Usá el skill correspondiente " +
  "(todo-add / todo-doing / todo-done / todo-clarify / todo-solutions / todo-recommend / todo-triage / todo-audit), " +
  "que abren la ventana de escritura automáticamente. Para editar a mano: exportá TODO_GUARD=off."

export type GuardContext = {
  /** Algún skill abrió la ventana hace menos de WINDOW_MINUTES. */
  windowOpen: boolean
  /** `false` = bypass explícito (TODO_GUARD=off). */
  enabled: boolean
}

const FILE_TOOLS = new Set(["edit", "write", "multiedit"])

/** Se normalizan las barras y se prefija "/" para que un path relativo matchee igual. */
const normalize = (path: string): string => "/" + path.replace(/\\/g, "/")

const isTodoOrDoing = (path: string): boolean =>
  /\/\.todo\/(TODO|DOING)\.md$/.test(normalize(path))

const touchesTodoDir = (path: string): boolean => normalize(path).includes("/.todo/")

/**
 * Un comando de bash que MENCIONA .todo/ y además escribe. Mencionar no alcanza:
 * `cat .todo/TODO.md` tiene que pasar. La rama del redirect exige que el destino
 * sea un .todo/ — sin eso, cualquier `echo x > /tmp/foo` que nombrara .todo/ en
 * otra parte de la línea quedaba bloqueado.
 */
const BASH_WRITES = /sed +-i|>>?\s*\S*\.todo\/|tee|(^|\s)(cp|mv|rm)\s|open\([^)]*['"]w/

/**
 * Toda mutación de .todo/ tiene que pasar por un skill, que es lo que mantiene
 * el formato consistente. El guard bloquea el resto.
 */
export function guard(event: ToolEvent, ctx: GuardContext): Decision {
  if (!ctx.enabled) return ALLOW

  // Guard duro: ignora la ventana a propósito. Ningún flujo legítimo marca un
  // checkbox en TODO.md/DOING.md — un item completado se MUEVE a DONE.md con
  // narrativa y atribución. Un '- [x]' huérfano rompe DONE.md como fuente de
  // verdad de lo completado, así que ni siquiera un skill puede escribirlo.
  if (FILE_TOOLS.has(event.kind) && event.paths.some(isTodoOrDoing)) {
    if (event.contents.some((text) => /^[ \t]*- \[x\]/m.test(text))) {
      return deny(MARKED_CHECKBOX)
    }
  }

  const writesToTodo =
    (FILE_TOOLS.has(event.kind) && event.paths.some(touchesTodoDir)) ||
    (event.kind === "bash" &&
      event.command !== undefined &&
      event.command.includes(".todo/") &&
      BASH_WRITES.test(event.command))

  if (!writesToTodo) return ALLOW
  return ctx.windowOpen ? ALLOW : deny(DIRECT_EDIT)
}
