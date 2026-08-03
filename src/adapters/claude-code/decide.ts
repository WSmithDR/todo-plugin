import { ALLOW, mergeDecisions, type Decision } from "../../core/protocol.ts"
import { guard } from "../../core/rules/guard.ts"
import { errorTriage } from "../../core/rules/error-triage.ts"
import { branchDoing } from "../../core/rules/branch-doing.ts"
import { sessionSetup } from "../../core/rules/session-setup.ts"
import { isWindowOpen } from "../../core/window.ts"
import { currentBranch, guardEnabled, hasTodoDir } from "./context.ts"
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
export function decide(raw: string, mode: "pre-tool-use" | "post-tool-use" | "session-start"): Decision {
  const payload = parsePayload(raw)
  if (!payload) return ALLOW

  switch (mode) {
    case "pre-tool-use":
      return preToolUse(payload)
    case "post-tool-use":
      return postToolUse(payload)
    case "session-start":
      return sessionStart(payload)
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
  const todo = hasTodoDir(event.cwd)

  return mergeDecisions([
    errorTriage(event, { hasTodoDir: todo }),
    branchDoing(event, { hasTodoDir: todo, branch: todo ? currentBranch(event.cwd) : "" }),
  ])
}

export function sessionStart(payload: ClaudePayload): Decision {
  return sessionSetup({ cwd: payload.cwd ?? process.cwd() })
}
