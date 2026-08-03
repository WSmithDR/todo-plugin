import type { Decision } from "../../core/protocol.ts"

/**
 * Traduce una Decision al protocolo de hooks de Claude Code.
 *
 *   allow   → exit 0, en silencio
 *   deny    → stderr + exit 2. En fase `before` Claude Code cancela la operación
 *             y le muestra el texto al modelo.
 *   advise  → stderr + exit 2. En fase `after` la operación YA corrió: no hay
 *             nada que cancelar, así que el mismo exit code es solo el canal por
 *             el que el texto llega al modelo.
 *
 * Que los dos verbos compartan exit code es una propiedad de ESTE CLI, no del
 * contrato: en OpenCode se traducen a cosas completamente distintas (throw vs.
 * append al output). Por eso el core mantiene la distinción aunque acá se pierda.
 *
 * ponytail: `advise` en fase `before` no lo produce ninguna regla hoy, y acá
 * bloquearía en vez de aconsejar. Si alguna lo necesita, el mecanismo es JSON por
 * stdout con {"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":…}.
 */
export function emit(decision: Decision): never {
  if (decision.action === "allow") process.exit(0)
  process.stderr.write(decision.message + "\n")
  process.exit(2)
}
