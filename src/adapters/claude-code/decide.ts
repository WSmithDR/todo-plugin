import { ALLOW, advise, mergeDecisions, type Decision } from "../../core/protocol.ts"
import { sessionSetup } from "../../core/rules/session-setup.ts"
import { rememberHead } from "../../core/session-state.ts"
import { currentHead } from "../../core/git.ts"
import { hasTodoDir, storeAvailable } from "../../core/env.ts"
import { decideAfter, decideBefore, decideSessionClose } from "../../core/pipeline.ts"
import { buildRules } from "./instructions.ts"
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

export const preToolUse = (payload: ClaudePayload): Decision => decideBefore(toToolEvent(payload, "before"))

/**
 * Las tres reglas de post corren en UN solo proceso y se mergean. Antes eran
 * entradas separadas en hooks.json, o sea dos spawns de bash + python3 por cada
 * comando que el modelo ejecutaba.
 */
export const postToolUse = (payload: ClaudePayload): Decision => decideAfter(toToolEvent(payload, "after"))

export function sessionStart(payload: ClaudePayload): Decision {
  const cwd = payload.cwd ?? process.cwd()
  // Se ancla el HEAD acá para que session-end pueda decir si hubo commits.
  const head = currentHead(cwd)
  if (head) rememberHead(cwd, head)

  // Las reglas duras van en cada sesión que tenga dónde aplicarlas. OpenCode las
  // recibe por su system prompt; acá SessionStart es el único canal equivalente.
  const rules = hasTodoDir(cwd) || storeAvailable(cwd) ? buildRules() : null

  return mergeDecisions([sessionSetup({ cwd }), rules === null ? ALLOW : advise(rules)])
}

export const sessionEnd = (payload: ClaudePayload): Decision =>
  decideSessionClose(payload.cwd ?? process.cwd())
