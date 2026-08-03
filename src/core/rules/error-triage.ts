import { ALLOW, advise, type Decision, type ToolEvent } from "../protocol.ts"

export type ErrorTriageContext = {
  /** El proyecto tiene `.todo/`. Sin eso no hay dónde anotar nada. */
  hasTodoDir: boolean
}

/** Devuelven non-zero como parte de su uso normal: un fallo no significa nada. */
const TRIVIAL = /^\s*(grep|ls|find|cat|head|tail|test |\[ |diff|wc)/

/** El autor ya previó el fallo, así que no es una sorpresa que valga anotar. */
const EXPECTED_FAILURE = /\|\|.*exit 0|2>\/dev\/null|>\/dev\/null/

const MAX_COMMAND = 250
const MAX_OUTPUT_LINES = 5
const MAX_OUTPUT_CHARS = 400

/**
 * Un comando que falla puede ser una tarea que vale la pena abrir — o ruido.
 * Esta regla filtra el ruido obvio y deja la decisión final en el modelo:
 * `advise`, nunca `deny`. La operación ya corrió; no hay nada que bloquear.
 */
export function errorTriage(event: ToolEvent, ctx: ErrorTriageContext): Decision {
  if (event.phase !== "after" || event.kind !== "bash") return ALLOW
  if (!event.result || event.result.ok) return ALLOW
  if (!ctx.hasTodoDir) return ALLOW

  const command = (event.command || "").slice(0, MAX_COMMAND)
  if (TRIVIAL.test(command) || EXPECTED_FAILURE.test(command)) return ALLOW

  const output =
    event.result.text
      .trim()
      .split("\n")
      .slice(0, MAX_OUTPUT_LINES)
      .join("\n")
      .slice(0, MAX_OUTPUT_CHARS) || "(sin output)"

  return advise(
    `TODO-ERROR-CHECKER: El comando falló.
  Comando: ${command}
  Output:  ${output}

Evalúa si vale la pena registrar esto en .todo/TODO.md:
  → Error recurrente o de configuración que podría volver: invocar todo-add
  → Error puntual ya resuelto o esperado:                  ignorar

Solo agregar tarea si hay valor real en trackearla.`,
  )
}
