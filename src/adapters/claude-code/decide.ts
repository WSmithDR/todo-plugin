import { ALLOW, mergeDecisions, type Decision } from "../../core/protocol.ts"
import { guard } from "../../core/rules/guard.ts"
import { errorTriage } from "../../core/rules/error-triage.ts"
import { branchDoing } from "../../core/rules/branch-doing.ts"
import { sessionSetup } from "../../core/rules/session-setup.ts"
import { sessionClose } from "../../core/rules/session-close.ts"
import { editingItem } from "../../core/rules/editing-item.ts"
import { isWindowOpen } from "../../core/window.ts"
import { openItems, openItemTitles, readTodoFile } from "../../core/todo-files.ts"
import { lastSeenHead, markAdvisedOnce, rememberHead } from "../../core/session-state.ts"
import { currentBranch, currentHead } from "../../core/git.ts"
import { guardEnabled, hasTodoDir } from "../../core/env.ts"
import { parsePayload, toToolEvent, type ClaudePayload } from "./normalize.ts"

/**
 * Del payload crudo a una Decision. Separado del entrypoint para poder testear
 * sin process.exit() ni stdin.
 */

/**
 * Un payload que no parsea deja pasar la operación.
 *
 * Fail-open a propósito y solo acá: si el adapter no entiende lo que le mandaron,
 * no tiene base para bloquear nada, y un guard que rompe ante un payload
 * inesperado deja al usuario sin poder trabajar. El fail-CLOSED está donde
 * corresponde —la ventana del guard, que sin sentinela bloquea—.
 */
export type Mode = "pre-tool-use" | "post-tool-use" | "session-start" | "session-end"

export function decide(raw: string, mode: Mode): Decision {
  const payload = parsePayload(raw)
  if (!payload) return ALLOW

  switch (mode) {
    case "pre-tool-use":
      return preToolUse(payload)
    case "post-tool-use":
      return postToolUse(payload)
    case "session-start":
      return sessionStart(payload)
    case "session-end":
      return sessionEnd(payload)
  }
}

export function preToolUse(payload: ClaudePayload): Decision {
  const event = toToolEvent(payload, "before")
  return guard(event, { windowOpen: isWindowOpen(), enabled: guardEnabled() })
}

/**
 * Las dos reglas de post corren en UN solo proceso y se mergean. Antes eran dos
 * entradas separadas en hooks.json, o sea dos spawns de bash + python3 por cada
 * comando que el modelo ejecutaba.
 */
export function postToolUse(payload: ClaudePayload): Decision {
  const event = toToolEvent(payload, "after")
  const cwd = event.cwd
  const todo = hasTodoDir(cwd)

  return mergeDecisions([
    errorTriage(event, { hasTodoDir: todo }),
    branchDoing(event, { hasTodoDir: todo, branch: todo ? currentBranch(cwd) : "" }),
    editingItem(event, {
      hasTodoDir: todo,
      todo: todo ? openItems(readTodoFile(cwd, "TODO.md")) : [],
      doing: todo ? openItemTitles(readTodoFile(cwd, "DOING.md")) : [],
      advisedOnce: (subject) => markAdvisedOnce(cwd, subject),
    }),
  ])
}

export function sessionStart(payload: ClaudePayload): Decision {
  const cwd = payload.cwd ?? process.cwd()
  // Se ancla el HEAD acá para que session-end pueda decir si hubo commits.
  const head = currentHead(cwd)
  if (head) rememberHead(cwd, head)
  return sessionSetup({ cwd })
}

export function sessionEnd(payload: ClaudePayload): Decision {
  const cwd = payload.cwd ?? process.cwd()
  const todo = hasTodoDir(cwd)
  const head = currentHead(cwd)

  const decision = sessionClose({
    hasTodoDir: todo,
    doing: todo ? openItemTitles(readTodoFile(cwd, "DOING.md")) : [],
    headMoved: head !== "" && lastSeenHead(cwd) !== "" && lastSeenHead(cwd) !== head,
  })

  // Se re-ancla igual: si no, la próxima sesión compararía contra un HEAD viejo
  // y avisaría por commits que ya se reportaron.
  if (head) rememberHead(cwd, head)
  return decision
}
