#!/bin/bash
# Guard de .todo/: 'open' abre una ventana de escritura; sin args (o 'check')
# corre como hook PreToolUse y bloquea escrituras directas a .todo/.
set -uo pipefail
GUARD_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/todo-plugin"
WINDOW="$GUARD_DIR/window"
WINDOW_MIN=10

if [ "${1:-check}" = "open" ]; then
    mkdir -p "$GUARD_DIR"; touch "$WINDOW"; exit 0
fi

# Modo hook. Bypass explícito.
[ "${TODO_GUARD:-on}" = "off" ] && exit 0

payload="$(cat)"

# Guard duro (ignora la ventana): '- [x]' agregado a TODO/DOING.
# Un completado se MUEVE a DONE.md vía todo-done; ningún flujo legítimo
# marca checkboxes en TODO.md/DOING.md.
if printf '%s' "$payload" | python3 -c '
import json,sys,re
try:
    d=json.load(sys.stdin)
except Exception:
    sys.exit(1)
tool=(d.get("tool_name","") or "").lower()
ti=d.get("tool_input",{}) or {}
if tool not in ("edit","write","multiedit"):
    sys.exit(1)
p=((ti.get("file_path") or ti.get("filePath") or "")).replace("\\","/")
if not re.search(r"/\.todo/(TODO|DOING)\.md$", "/"+p):
    sys.exit(1)
texts=[ti.get("content","") or "", ti.get("new_string","") or ""]
texts+=[e.get("new_string","") or "" for e in (ti.get("edits") or [])]
sys.exit(0 if any(re.search(r"^\s*- \[x\]", t, re.M) for t in texts) else 1)
'; then
    echo "TODO-GUARD: intento de marcar '- [x]' en TODO.md/DOING.md bloqueado (la ventana de escritura NO lo autoriza). Un item completado se MUEVE a DONE.md: usá la skill todo-done." >&2
    exit 2
fi

# ¿La operación escribe en un .todo/? (exit 0 = sí escribe)
if printf '%s' "$payload" | python3 -c '
import json,sys,re
try:
    d=json.load(sys.stdin)
except Exception:
    sys.exit(1)
tool=(d.get("tool_name","") or "").lower()
ti=d.get("tool_input",{}) or {}
if tool in ("edit","write","multiedit"):
    p=((ti.get("file_path") or ti.get("filePath") or "")).replace("\\","/")
    sys.exit(0 if "/.todo/" in "/"+p else 1)
if tool=="bash":
    cmd=ti.get("command","") or ""
    touches=".todo/" in cmd
    writes=bool(re.search(r"sed +-i|>>?\s*\S*\.todo/|tee|(^|\s)(cp|mv|rm)\s|open\([^)]*[\x27\x22]w", cmd))
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
