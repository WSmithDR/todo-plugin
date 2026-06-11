#!/bin/bash
# Git pre-commit hook: verifica si tareas en DOING.md fueron resueltas
# Instalado via todo-config o manualmente:
#   ln -sf "${CLAUDE_PLUGIN_ROOT}/bin/hooks/pre-commit.sh" .git/hooks/pre-commit

set -euo pipefail

[ ! -d ".todo" ] && exit 0

DOING_FILE=".todo/DOING.md"
TODO_FILE=".todo/TODO.md"

DOING_COUNT=$(grep -c "^\- \[ \]" "$DOING_FILE" 2>/dev/null || echo "0")
TODO_COUNT=$(grep -c "^\- \[ \]" "$TODO_FILE" 2>/dev/null || echo "0")

[ "$DOING_COUNT" = "0" ] && [ "$TODO_COUNT" = "0" ] && exit 0

STAGED=$(git diff --cached --name-only 2>/dev/null | head -20 | tr '\n' ' ')
[ -z "$STAGED" ] && exit 0

MSG="TODO-PRE-COMMIT: Revisión previa al commit.

Archivos en staging: $STAGED
"

if [ "$DOING_COUNT" != "0" ]; then
    DOING_ITEMS=$(grep "^\- \[ \]" "$DOING_FILE" 2>/dev/null \
        | sed -E 's/^\- \[ \] \*\*([^*]+)\*\*.*/  · \1/' \
        | head -8)
    MSG="${MSG}Tareas EN PROGRESO ($DOING_COUNT en DOING.md):
${DOING_ITEMS}
"
fi

if [ "$TODO_COUNT" != "0" ]; then
    MSG="${MSG}Tareas ABIERTAS: $TODO_COUNT items en TODO.md
"
fi

RECENT_COMMITS=$(git log --oneline -5 2>/dev/null | sed 's/^/  /' || echo "  (sin commits recientes)")
MSG="${MSG}Commits recientes:
${RECENT_COMMITS}

Instrucciones:
  1. Compara los archivos en staging con las tareas en progreso.
  2. Si alguna tarea fue resuelta por este commit → invocar todo-done primero.
  3. Si ninguna fue resuelta → forzar el commit con: git commit --no-verify
  4. No bloquear el commit si no hay coincidencias claras."

echo "$MSG" >&2
exit 1
