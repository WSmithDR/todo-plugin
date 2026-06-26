#!/bin/bash
# PostToolUse:Bash
# Al crear/cambiar a una rama de feature, recuerda mover la tarea en curso a DOING.md.
# Enforcement suave: exit 2 con directiva (Claude decide e invoca la skill todo-doing).

set -euo pipefail

TOOL_INFO=$(cat)

# Solo en proyectos con .todo/
[ ! -d ".todo" ] && exit 0

CMD=$(echo "$TOOL_INFO" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', ''))
except Exception:
    print('')
" 2>/dev/null || echo "")

# Solo comandos que te dejan PARADO en una rama nueva: 'git switch …' o 'git checkout -b/-B …'.
# (Un 'git checkout archivo' o 'git branch foo' no cambian la rama actual → no disparan.)
echo "$CMD" | grep -qE "git[[:space:]]+(switch([[:space:]]|$)|checkout[[:space:]]+-[bB])" || exit 0

# Rama resultante (PostToolUse corre DESPUÉS del comando; no se parsea el string).
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
[ -z "$BRANCH" ] && exit 0

# Ramas base o detached → no es una feature
case "$BRANCH" in
    main|master|develop|HEAD) exit 0 ;;
esac

echo "TODO-DOING: Estás en la rama de feature '$BRANCH'.
Si la tarea en la que estás trabajando todavía no está en .todo/DOING.md, movela ahora
con la skill todo-doing (DOING.md es la fuente de verdad de lo en progreso).
  → Si ya está en DOING.md: ignorá esto.
  → Si todavía no existe en .todo/TODO.md: agregala primero y luego movela." >&2
exit 2
