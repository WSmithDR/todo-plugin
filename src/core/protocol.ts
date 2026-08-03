// El vocabulario compartido entre reglas y adapters. Este archivo es lo ÚNICO
// que los adapters importan del core: no conocen .todo/, ni Eisenhower, ni el
// guard. Es la frontera que hace la capa reusable por otro plugin.

/** Herramienta normalizada. Cada CLI las nombra distinto (Edit/edit, Bash/bash…). */
export type ToolKind = "edit" | "write" | "multiedit" | "bash" | "other"

/**
 * Una operación de herramienta, ya normalizada. Absorbe las diferencias de
 * nombres y de forma del payload entre CLIs para que las reglas vean siempre lo
 * mismo.
 */
export type ToolEvent = {
  /** `before` = todavía se puede bloquear. `after` = ya corrió. */
  phase: "before" | "after"
  kind: ToolKind
  /** Archivos que la operación toca. */
  paths: string[]
  /** Texto que se va a escribir (content, new_string, edits[].new_string). */
  contents: string[]
  /** Solo para `bash`. */
  command?: string
  cwd: string
  /** Solo en fase `after`. */
  result?: { ok: boolean; text: string }
}

/**
 * Qué hacer. Los tres verbos son el contrato: cada adapter los traduce al
 * dialecto de su CLI, y la regla nunca sabe cuál está corriendo.
 *
 *   deny    Claude Code: exit 2 + stderr  ·  OpenCode: throw
 *   advise  Claude Code: exit 2 + stderr  ·  OpenCode: append a output.output
 *
 * La distinción existe porque `exit 2` significa dos cosas distintas según la
 * fase, y colapsarlas convierte un aviso en una cancelación.
 */
export type Decision =
  | { action: "allow" }
  | { action: "deny"; message: string }
  | { action: "advise"; message: string }

export const ALLOW: Decision = { action: "allow" }
export const deny = (message: string): Decision => ({ action: "deny", message })
export const advise = (message: string): Decision => ({ action: "advise", message })

/**
 * Combina las decisiones de varias reglas sobre el mismo evento.
 *
 * El primer `deny` gana y corta: no tiene sentido aconsejar sobre una operación
 * que no va a ocurrir. Si no hay ninguno, los `advise` se concatenan — el modelo
 * recibe todos los avisos en un solo mensaje en vez de perder los posteriores.
 */
export function mergeDecisions(decisions: Decision[]): Decision {
  for (const decision of decisions) {
    if (decision.action === "deny") return decision
  }
  const messages = decisions.flatMap((d) => (d.action === "advise" ? [d.message] : []))
  return messages.length > 0 ? advise(messages.join("\n\n")) : ALLOW
}
