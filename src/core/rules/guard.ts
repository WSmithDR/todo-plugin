import { ALLOW, deny, type Decision, type ToolEvent } from "../protocol.ts"

const MARKED_CHECKBOX =
  "TODO-GUARD: intento de marcar '- [x]' en TODO.md/DOING.md bloqueado (la ventana de escritura NO lo autoriza). " +
  "Un item completado se MUEVE a DONE.md: usá la skill todo-done."

const DIRECT_EDIT =
  "TODO-GUARD: edición directa de .todo/ bloqueada. Usá el skill correspondiente " +
  "(todo-add / todo-item / todo-doing / todo-done / todo-clarify / todo-solutions / todo-recommend / todo-triage / todo-audit), " +
  "que abren la ventana de escritura automáticamente.\n" +
  "Para editar a mano hay que exportar TODO_GUARD=off en el shell que lanza el CLI, ANTES de arrancarlo. " +
  "Un prefijo por comando (TODO_GUARD=off cmd) no sirve: el hook corre en otro proceso y lee su propio entorno."

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
 * Detectar una escritura a `.todo/` desde una línea de bash necesita DOS cosas,
 * y la versión anterior solo pedía una y media:
 *
 *   1. que la línea tenga un operador que escriba, y
 *   2. que haya un TOKEN que sea una ruta bajo `.todo/`.
 *
 * Antes alcanzaba con que el string `.todo/` apareciera en cualquier parte del
 * comando. Eso bloqueaba dos clases de comando legítimo, las dos observadas de
 * verdad mientras se escribía esta misma documentación:
 *
 *   git commit -m "create escribe un <id>/.todo/config.json"
 *   sed -i 's|.todo/algo|otra cosa|' CLAUDE.md
 *
 * El primero contiene la secuencia `>/.todo/` —el `>` es el del placeholder— y
 * el segundo tiene `sed -i` sobre un archivo que no es del `.todo/`.
 */

/** Los `<placeholder>` no son redirects: se descartan antes de buscar el `>`. */
const stripPlaceholders = (command: string): string => command.replace(/<[^<>]{1,60}>/g, "")

/**
 * ¿Algún token del comando ES una ruta a un archivo bajo `.todo/`?
 *
 * Dos filtros, cada uno por un falso positivo real:
 *
 *   - se descartan los tokens con metacaracteres de shell, que no son rutas sino
 *     expresiones: así el script `'s|…|…|'` de un `sed` deja de contar como si el
 *     sed apuntara ahí;
 *   - se exige que después de `.todo/` venga el principio de un nombre de
 *     archivo. Un `.todo/` suelto —en un comentario, o entre backticks en un
 *     texto— nombra el directorio, no escribe en él.
 */
const TODO_FILE = /\.todo\/[A-Za-z0-9_.-]/

const hasTodoPathToken = (command: string): boolean =>
  command.split(/\s+/).some((raw) => {
    const token = raw.replace(/^['"]+|['"]+$/g, "")
    return !/[|;&()]/.test(token) && TODO_FILE.test(token)
  })

/** Operadores que escriben apuntando a un `.todo/`. */
const WRITE_OPERATORS: RegExp[] = [
  /(^|\s)sed\s+-i/,
  // El redirect exige que el destino sea un .todo/: `cat .todo/x > /tmp/y` lee.
  />{1,2}\s*['"]?\S*\.todo\//,
  /(^|\s)tee(\s|$)/,
  /(^|\s)(cp|mv|rm)\s/,
  /open\([^)]*['"]w/,
]

export function bashWritesToTodo(command: string): boolean {
  if (!hasTodoPathToken(command)) return false
  const limpio = stripPlaceholders(command)
  return WRITE_OPERATORS.some((operador) => operador.test(limpio))
}

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
    (event.kind === "bash" && event.command !== undefined && bashWritesToTodo(event.command))

  if (!writesToTodo) return ALLOW
  return ctx.windowOpen ? ALLOW : deny(DIRECT_EDIT)
}
