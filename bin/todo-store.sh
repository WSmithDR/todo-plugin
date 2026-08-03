#!/usr/bin/env bash
# Shim: la lógica está en src/cli/todo-store.ts. Acá solo se resuelve el runtime.
# Lo invocan las skills: mode | list | create <name> | path <id>.
#
# Se resuelve el symlink antes del dirname: este archivo se instala symlinkeado
# en .git/hooks/, y sin readlink el dirname apunta ahí y no al plugin.
SELF="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"
exec "$ROOT/bin/run.sh" "$ROOT/src/cli/todo-store.ts" "$@"
