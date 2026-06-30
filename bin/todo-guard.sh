#!/bin/bash
# Guard de .todo/: 'open' abre una ventana de escritura; sin args (o 'check')
# corre como hook PreToolUse y bloquea escrituras directas a .todo/.
set -uo pipefail
GUARD_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/todo-plugin"
WINDOW="$GUARD_DIR/window"
WINDOW_MIN=5

if [ "${1:-check}" = "open" ]; then
    mkdir -p "$GUARD_DIR"; touch "$WINDOW"; exit 0
fi

# Modo hook. Bypass explícito.
[ "${TODO_GUARD:-on}" = "off" ] && exit 0

payload="$(cat)"

# ¿La operación escribe en un .todo/? (exit 0 = sí escribe)
if printf '%s' "$payload" | python3 -c '
import json,sys,re
try:
    d=json.load(sys.stdin)
except Exception:
    sys.exit(1)
tool=d.get("tool_name","")
ti=d.get("tool_input",{}) or {}
if tool in ("Edit","Write","MultiEdit"):
    p=(ti.get("file_path","") or "").replace("\\","/")
    sys.exit(0 if "/.todo/" in "/"+p else 1)
if tool=="Bash":
    cmd=ti.get("command","") or ""
    touches=".todo/" in cmd
    writes=bool(re.search(r"sed +-i|>>?|tee|(^|\s)(cp|mv|rm)\s|open\([^)]*[\x27\x22]w", cmd))
    sys.exit(0 if (touches and writes) else 1)
sys.exit(1)
'; then
    if [ -n "$(find "$WINDOW" -mmin "-$WINDOW_MIN" 2>/dev/null)" ]; then
        exit 0
    fi
    echo "TODO-GUARD: edición directa de .todo/ bloqueada. Usá el skill correspondiente (todo-add / todo-doing / todo-done / todo-clarify / todo-solutions / todo-recommend / todo-triage / todo-audit), que abren la ventana de escritura automáticamente. Para editar a mano: exportá TODO_GUARD=off." >&2
    exit 2
fi
exit 0
