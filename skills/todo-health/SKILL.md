---
name: todo-health
description: "Verifies that todo-plugin is correctly integrated in the current project. Run this after installing the plugin to confirm skills, hooks, and .todo/ structure are working."
---

# Todo Plugin — Health Check

## Process

### 1. Plugin identity

```bash
cat "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"todo-plugin v{d['version']}\")" \
  || echo "todo-plugin (version unknown)"
```

### 2. Skills available

List all skills found in the plugin:

```bash
ls "${CLAUDE_PLUGIN_ROOT}/skills/" 2>/dev/null | sort
```

### 3. Hooks registered

```bash
cat "${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json" 2>/dev/null \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
hooks=d.get('hooks',d)
for event, entries in hooks.items():
    for e in entries:
        for h in e.get('hooks',[]):
            matcher = e.get('matcher','*')
            print(f'  {event}({matcher}): {h[\"command\"][:60]}')
"
```

### 4. Project .todo/ status

```bash
if [ -d ".todo" ]; then
  todo=$(grep -c "^\- \[ \]" .todo/TODO.md 2>/dev/null || echo 0)
  doing=$(grep -c "^\- \[ \]" .todo/DOING.md 2>/dev/null || echo 0)
  done=$(grep -c "^\- \[x\]" .todo/DONE.md 2>/dev/null || echo 0)
  echo ".todo/ found — TODO:$todo  DOING:$doing  DONE:$done"
else
  echo ".todo/ not found — will be created on first todo-add"
fi
```

### 5. Plugin config status

```bash
cat .todo/config.json 2>/dev/null
```

If `.todo/config.json` is missing, note: `⚠ config not set — run todo-config to initialize`.

### 6. Output

Print a clean summary:

```
✓ todo-plugin v1.0.0 — active
✓ Skills: todo-add, todo-audit, todo-clarify, todo-config, todo-doing, todo-done,
          todo-health, todo-item, todo-recommend, todo-solutions, todo-triage
✓ Hooks: PreToolUse(Bash) · PostToolUse(Bash)
✓ .todo/ — TODO:N  DOING:N  DONE:N
✓ Config: gitignore_todo=<valor> · configured_by=<nombre> · <fecha>
  (or) ⚠ Config: not set — run todo-config

Plugin is ready. Run todo-add to create your first task.
```

If `CLAUDE_PLUGIN_ROOT` is empty or any step fails, report:

```
✗ CLAUDE_PLUGIN_ROOT not set — plugin may not be installed via claude plugin install.
  Run: claude plugin install github:WSmithDR/todo-plugin --scope project
```
