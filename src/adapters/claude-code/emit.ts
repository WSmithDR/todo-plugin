import type { Decision } from "../../core/lib/protocol/protocol.ts"
import type { Mode } from "./decide.ts"

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
 * Excepción, `SessionStart`: ahí el canal es stdout con exit 0 — Claude Code lo
 * agrega al contexto del modelo. Con exit 2 el texto va a stderr, sale como
 * "SessionStart:startup hook error" y el modelo NUNCA lo ve: en ese evento el
 * exit 2 solo se le muestra al usuario. O sea que el aviso de setup, la rotación
 * y el triage se estaban perdiendo, disfrazados de error.
 *
 * Que los dos verbos compartan exit code es una propiedad de ESTE CLI, no del
 * contrato: en OpenCode se traducen a cosas completamente distintas (throw vs.
 * append al output). Por eso el core mantiene la distinción aunque acá se pierda.
 *
 * ponytail: `advise` en fase `before` no lo produce ninguna regla hoy, y acá
 * bloquearía en vez de aconsejar. Si alguna lo necesita, el mecanismo es JSON por
 * stdout con {"hookSpecificOutput":{"permissionDecision":"allow"},"systemMessage":…}.
 */
export function emit(decision: Decision, mode: Mode): never {
  if (decision.action === "allow") process.exit(0)
  if (mode === "session-start") {
    process.stdout.write(decision.message + "\n")
    process.exit(0)
  }
  process.stderr.write(decision.message + "\n")
  process.exit(2)
}
