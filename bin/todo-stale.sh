#!/usr/bin/env bash
# Shim: la lógica está en src/cli/todo-stale.ts. Acá solo se resuelve el runtime.
# Lo invoca la skill todo-triage: lista las tareas abiertas cuyos archivos
# cambiaron después de que la tarea se creó, o sea las candidatas a estar ya
# resueltas y rezagadas en TODO.md.
SELF="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"
exec "$ROOT/bin/run.sh" "$ROOT/src/cli/todo-stale.ts" "$@"
