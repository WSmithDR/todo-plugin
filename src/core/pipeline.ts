import { mergeDecisions, type Decision, type ToolEvent } from "./protocol.ts"
import { guardEnabled, hasTodoDir, storeAvailable } from "./env.ts"
import { isWindowOpen } from "./window.ts"
import { currentBranch } from "./git.ts"
import { editingContext } from "./todo-files.ts"
import { markAdvisedOnce } from "./session-state.ts"
import { guard } from "./rules/guard.ts"
import { errorTriage } from "./rules/error-triage.ts"
import { branchDoing } from "./rules/branch-doing.ts"
import { editingItem } from "./rules/editing-item.ts"

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

export const decideBefore = (event: ToolEvent): Decision =>
  guard(event, { windowOpen: isWindowOpen(), enabled: guardEnabled() })

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
