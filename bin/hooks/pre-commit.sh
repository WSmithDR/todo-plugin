#!/bin/bash
# PreToolUse:Bash
# Antes de git commit: verifica si tareas en DOING.md fueron resueltas
# y deben moverse a .todo/DONE.md antes de commitear.

set -euo pipefail

TOOL_INFO=$(cat)

CMD=$(echo "$TOOL_INFO" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('command', ''))
" 2>/dev/null || echo "")

# Solo actuar en git commit (no en git add, git status, etc.)
echo "$CMD" | grep -qE "git\s+commit" || exit 0

# Solo actuar si el proyecto tiene .todo/
[ ! -d ".todo" ] && exit 0

DOING_FILE=".todo/DOING.md"
TODO_FILE=".todo/TODO.md"

# Contar items abiertos en DOING
DOING_COUNT=$(grep -c "^\- \[ \]" "$DOING_FILE" 2>/dev/null || echo "0")
TODO_COUNT=$(grep -c "^\- \[ \]" "$TODO_FILE" 2>/dev/null || echo "0")

[ "$DOING_COUNT" = "0" ] && [ "$TODO_COUNT" = "0" ] && exit 0

# Archivos en el staging area de este commit
STAGED=$(git diff --cached --name-only 2>/dev/null | head -20 | tr '\n' ' ')
[ -z "$STAGED" ] && exit 0

# Títulos de items en DOING (sin metadata)
DOING_ITEMS=""
if [ "$DOING_COUNT" != "0" ]; then
    DOING_ITEMS=$(grep "^\- \[ \]" "$DOING_FILE" 2>/dev/null \
        | sed -E 's/^\- \[ \] \*\*([^*]+)\*\*.*/  · \1/' \
        | head -8)
fi

# Commits recientes (para contexto de resolución)
RECENT_COMMITS=$(git log --oneline -5 2>/dev/null | sed 's/^/  /' || echo "  (sin commits recientes)")

MSG="TODO-PRE-COMMIT: Revisión previa al commit.

Archivos en staging: $STAGED
"
if [ "$DOING_COUNT" != "0" ]; then
    MSG="${MSG}Tareas EN PROGRESO ($DOING_COUNT en DOING.md):
${DOING_ITEMS}
"
fi
if [ "$TODO_COUNT" != "0" ]; then
    MSG="${MSG}Tareas ABIERTAS: $TODO_COUNT items en TODO.md
"
fi
MSG="${MSG}Commits recientes:
${RECENT_COMMITS}

Instrucciones:
  1. Compara los archivos en staging con las tareas en progreso.
  2. Si alguna tarea fue resuelta por este commit → invocar todo-done primero.
  3. Si ninguna fue resuelta → continuar con el commit sin cambios.
  4. No bloquear el commit si no hay coincidencias claras."

echo "$MSG" >&2
exit 2
