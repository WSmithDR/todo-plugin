#!/bin/bash
# PostToolUse:Bash
# Cuando un comando bash falla, evalúa si vale la pena abrir una tarea en .todo/TODO.md.

set -euo pipefail

TOOL_INFO=$(cat)

# Extraer si hubo error
IS_ERROR=$(echo "$TOOL_INFO" | python3 -c "
import json, sys
d = json.load(sys.stdin)
tr = d.get('tool_response', {})
if isinstance(tr, dict):
    is_err = tr.get('is_error', False)
    # Algunos formatos usan exit_code
    exit_code = tr.get('exit_code', 0)
    content = tr.get('content', [])
    if content and isinstance(content, list):
        is_err = is_err or content[0].get('is_error', False)
    print('true' if is_err or exit_code not in (0, None) else 'false')
else:
    print('false')
" 2>/dev/null || echo "false")

[ "$IS_ERROR" != "true" ] && exit 0

# Solo actuar si el proyecto tiene .todo/
[ ! -d ".todo" ] && exit 0

CMD=$(echo "$TOOL_INFO" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('command', '')[:250])
" 2>/dev/null || echo "")

# Ignorar comandos triviales que naturalmente devuelven non-zero
if echo "$CMD" | grep -qE "^\s*(grep|ls|find|cat|head|tail|test |\[ |diff|wc)"; then
    exit 0
fi

# Ignorar errores esperados de verificaciones de existencia
if echo "$CMD" | grep -qE "\|\|.*exit 0|2>/dev/null|>/dev/null"; then
    exit 0
fi

OUTPUT=$(echo "$TOOL_INFO" | python3 -c "
import json, sys
d = json.load(sys.stdin)
tr = d.get('tool_response', {})
if isinstance(tr, dict):
    content = tr.get('content', [])
    if content and isinstance(content, list):
        text = content[0].get('text', '')
    else:
        text = tr.get('stderr', tr.get('stdout', str(tr)))
else:
    text = str(tr)
# Tomar las primeras 5 líneas o 400 chars
lines = text.strip().split('\n')[:5]
print('\n'.join(lines)[:400])
" 2>/dev/null || echo "(sin output)")

echo "TODO-ERROR-CHECKER: El comando falló.
  Comando: $CMD
  Output:  $OUTPUT

Evalúa si vale la pena registrar esto en .todo/TODO.md:
  → Error recurrente o de configuración que podría volver: invocar todo-add
  → Error puntual ya resuelto o esperado:                  ignorar

Solo agregar tarea si hay valor real en trackearla." >&2
exit 2
