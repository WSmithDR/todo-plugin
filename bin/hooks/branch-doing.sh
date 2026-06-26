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
Asegurate de que la(s) tarea(s) que vas a trabajar en esta rama estén en .todo/DOING.md
(una rama puede abarcar varias). Mové las que falten con la skill todo-doing (DOING.md es
la fuente de verdad de lo en progreso).
  → Las que ya estén en DOING.md: ignoralas.
  → Las que aún no existan en .todo/TODO.md: agregalas primero y luego movelas.
Nota: este aviso solo dispara al crear/cambiar de rama; si más adelante arrancás otra tarea
en esta misma rama, movela vos con todo-doing (no hay señal automática para eso)." >&2
exit 2
