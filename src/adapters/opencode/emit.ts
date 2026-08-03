import type { Decision } from "../../core/protocol.ts"

/**
 * Traduce una Decision a los mecanismos de OpenCode.
 *
 * Es acá donde se ve por qué el core distingue `deny` de `advise`: en Claude
 * Code los dos son `exit 2`, pero acá son cosas opuestas. Un `throw` cancela la
 * tool call; anexar al output no cancela nada, solo le habla al modelo. El
 * bridge anterior mapeaba todo exit != 0 a `throw`, así que puentear un hook
 * consultivo habría convertido "quizás anotá esto" en "tu comando falló".
 */

/** Fase `before`: solo puede negar. Un `advise` acá no tiene canal — se ignora. */
export function applyBefore(decision: Decision): void {
  if (decision.action === "deny") throw new Error(decision.message)
}

export type AfterOutput = { title: string; output: string; metadata?: unknown }

/**
 * Fase `after`: la operación ya corrió. El texto se anexa al output de la tool,
 * que es lo que el modelo lee. El title lleva una marca porque el output puede
 * quedar plegado en la UI y el usuario no verlo.
 */
export function applyAfter(decision: Decision, output: AfterOutput): void {
  if (decision.action === "allow") return

  output.output = `${output.output}\n\n${decision.message}`
  if (!output.title.includes(TITLE_MARK)) output.title = `${output.title} ${TITLE_MARK}`
}

export const TITLE_MARK = "📋"
