import { ALLOW, advise, mergeDecisions, type Decision, type ToolEvent } from "./protocol.ts"
import { guardEnabled, hasTodoDir, storeAvailable } from "./env.ts"
import { isWindowOpen } from "./window.ts"
import { currentBranch, currentHead, refLogStamp } from "./git.ts"
import { editingContext, openItemTitles, readTodoFile } from "./todo-files.ts"
import { projectForPath } from "./store.ts"
import {
  clearTouched,
  lastSeenHead,
  lastSeenStamp,
  markAdvisedOnce,
  rememberHead,
  rememberStamp,
  rememberTouched,
  touchedProjects,
} from "./session-state.ts"
import { guard } from "./rules/guard.ts"
import { errorTriage } from "./rules/error-triage.ts"
import { branchDoing } from "./rules/branch-doing.ts"
import { editingItem } from "./rules/editing-item.ts"
import { sessionClose } from "./rules/session-close.ts"

/**
 * Qué reglas corren en cada fase y con qué contexto.
 *
 * Esto vivía duplicado en los dos adapters: mismas reglas, mismo orden, mismo
 * armado de contexto, escrito dos veces con los comentarios copiados. Cada regla
 * nueva se agregaba dos veces y cada ajuste había que acordarse de hacerlo en los
 * dos lados — el día que uno se olvida, los CLIs se comportan distinto y nadie se
 * entera hasta que alguien lo nota en producción.
 *
 * Lo que queda en cada adapter es lo único que de verdad es suyo: traducir su
 * payload a `ToolEvent` (normalize) y su `Decision` a lo que ese CLI entiende
 * (emit).
 */

export function decideBefore(event: ToolEvent): Decision {
  const decision = guard(event, { windowOpen: isWindowOpen(), enabled: guardEnabled() })

  // Una escritura autorizada al `.todo/` de un proyecto del store es la señal de
  // "esta sesión trabajó acá": en esos proyectos no hay commits del usuario que lo
  // digan. Se anota solo si el guard dejó pasar —o sea, si una skill abrió la
  // ventana—, y solo mirando paths que ya contienen `.todo/`, para no resolver
  // nada en la ruta caliente.
  if (decision.action === "allow") {
    for (const path of event.paths) {
      if (!path.includes(".todo")) continue
      const project = projectForPath(path)
      if (project) rememberTouched(project.dir)
    }
  }

  return decision
}

/** Quién está preguntando, que es lo único que cambia entre CLIs. */
export type CloseTrigger = "session-end" | "per-request"

/**
 * El aviso de cierre, con el anclaje de HEAD que lo hace salir una vez por commit
 * y no una vez por invocación.
 *
 * El disparador no es cosmético: Claude Code llama esto en `SessionEnd`, una vez;
 * OpenCode no tiene ese evento y lo resuelve por `system.transform`, que corre en
 * CADA request. De ahí salen las dos diferencias: el gate del reflog (que ahí
 * convierte el costo en un stat) y el aviso de los proyectos sin repo, que solo
 * tiene sentido cuando la sesión de verdad termina — a mitad de camino, decirte
 * "cerrá lo que quedó" es apurarte.
 */
export function decideSessionClose(cwd: string, trigger: CloseTrigger = "session-end"): Decision {
  if (!hasTodoDir(cwd)) return trigger === "session-end" ? storeSessionClose() : ALLOW

  if (trigger === "per-request") {
    const stamp = refLogStamp(cwd)
    if (stamp !== "" && stamp === lastSeenStamp(cwd)) return ALLOW
    if (stamp !== "") rememberStamp(cwd, stamp)
  }

  const head = currentHead(cwd)
  if (head === "") return ALLOW

  // Se re-ancla siempre, aunque no se avise: si no, la próxima vez se compararía
  // contra un HEAD viejo y el mismo commit avisaría de nuevo.
  const previo = lastSeenHead(cwd)
  rememberHead(cwd, head)

  return sessionClose({
    hasTodoDir: true,
    doing: openItemTitles(readTodoFile(cwd, "DOING.md")),
    // Sin un HEAD previo esto es el primer anclaje, no un commit nuevo.
    headMoved: previo !== "" && previo !== head,
  })
}

/**
 * El cierre para los proyectos sin repo: no hay HEAD que se mueva, así que lo
 * que se mira es qué proyectos tocó ESTA sesión y si les quedó algo en DOING.
 *
 * Consume el marcador: el aviso sale una vez, y si el usuario cierra sin hacer
 * nada, el de SessionStart lo vuelve a levantar cuando la tarea se pone vieja.
 */
function storeSessionClose(): Decision {
  const pendientes = touchedProjects()
    .map((dir) => ({ dir, doing: openItemTitles(readTodoFile(dir, "DOING.md")) }))
    .filter(({ doing }) => doing.length > 0)

  clearTouched()
  if (pendientes.length === 0) return ALLOW

  const detalle = pendientes
    .map(({ dir, doing }) => `  · ${dir.split("/").pop() ?? dir}: ${doing.map((title) => `"${title}"`).join(", ")}`)
    .join("\n")

  return advise(
    `TODO-SESSION-END: trabajaste en proyectos del registro central y les quedó trabajo en curso.
${detalle}
Si alguna quedó terminada, cerrala con la skill todo-done antes de irte: en estos
proyectos no hay commits que lo delaten después.`,
  )
}

export function decideAfter(event: ToolEvent): Decision {
  const cwd = event.cwd
  const todo = hasTodoDir(cwd)

  // El store solo se consulta si el comando falló y no hay `.todo/` local: es la
  // única combinación donde la respuesta cambia algo, y así no se paga un
  // `git rev-parse` por cada comando que anda bien.
  const storeMode = !todo && event.result?.ok === false && storeAvailable(cwd)

  // El contexto sale del cwd o —sin `.todo/` local— del proyecto del store dueño
  // del archivo editado. El "una vez por item" se ancla al mismo dir, así el
  // aviso de un sitio no consume el cupo de otro.
  const editing = editingContext(cwd, event.paths)

  return mergeDecisions([
    errorTriage(event, { hasTodoDir: todo, storeMode }),
    branchDoing(event, { hasTodoDir: todo, branch: todo ? currentBranch(cwd) : "" }),
    editingItem(event, {
      hasTodoDir: editing !== null,
      todo: editing?.todo ?? [],
      doing: editing?.doing ?? [],
      advisedOnce: (subject) => markAdvisedOnce(editing?.dir ?? cwd, subject),
    }),
  ])
}
