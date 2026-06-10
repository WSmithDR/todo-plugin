---
name: todo-done
description: "Marks TODO items as completed, moving them to .todo/DONE.md or .todo/DISCARDED.md with responsible attribution."
---

# TODO Done

Moves completed items from `.todo/TODO.md` or `.todo/DOING.md` into `.todo/DONE.md`, and discarded items into `.todo/DISCARDED.md`. Keeps TODO.md and DOING.md clean — only open, active work stays there.

## Process

### 0. Detect and migrate legacy files

```bash
if [ ! -d ".todo" ] && { [ -f "TODO.md" ] || [ -f "DOING.md" ]; }; then
  mkdir -p .todo
  for f in TODO.md DOING.md DONE.md DISCARDED.md; do
    [ -f "$f" ] && git mv "$f" ".todo/$f"
  done
  CREATOR=$(git log --format='%an' -1 -- TODO.md 2>/dev/null || git config user.name)
  TODAY=$(date +%Y-%m-%d)
  for f in .todo/TODO.md .todo/DOING.md; do
    [ -f "$f" ] && sed -i -E \
      "/^\- \[ \] / { /creado por/! s/$/ _(creado por: $CREATOR · $TODAY)_/ }" "$f"
  done
  git add .todo/
  git commit -m "TODO: migrate legacy files to .todo/ + backfill creator metadata"
fi
CREATOR=$(git config user.name); TODAY=$(date +%Y-%m-%d)
for f in .todo/TODO.md .todo/DOING.md; do
  [ -f "$f" ] && sed -i -E \
    "/^\- \[ \] / { /creado por/! s/$/ _(creado por: $CREATOR · $TODAY)_/ }" "$f"
done
```

### 1. Gather evidence of completed work

Use all available sources — don't rely on just one:

**A. Git log (most reliable when work was done in this repo):**
```bash
git log --oneline --since="$(git log -1 --format=%ci .todo/TODO.md 2>/dev/null || echo '1 week ago')"
git diff HEAD~5 --stat
```

**B. User description:** If the user says "hice X, Y, Z" or "los cambios se hicieron en la UI / en producción / externamente" — use that description directly. Don't require git evidence for work done outside the repo.

**C. Conversation context:** If the current session involved implementing something, use that as evidence too.

**D. CLAUDE.md / project docs:** If a deliberate architectural decision was documented that makes a TODO irrelevant, that item can go to DISCARDED.md (not DONE.md) with the reason.

### 2. Read all open items

```bash
grep -n "^\- \[ \]" .todo/TODO.md .todo/DOING.md 2>/dev/null
```

Locate or create `.todo/DONE.md` and `.todo/DISCARDED.md` if they don't exist:

```markdown
# Completados — [Project Name]

_Última actualización: YYYY-MM-DD_
```

```markdown
# Descartados — [Project Name]

_Última actualización: YYYY-MM-DD_
```

### 3. Identify responsible(s) using git

For each item to be completed, extract the creation date from its `_(creado por: ... · YYYY-MM-DD)_` metadata, then query git contributors since that date:

```bash
# Extract creation date from item text (the YYYY-MM-DD after '·' in _(creado por: ...)_)
CREATION_DATE="YYYY-MM-DD"   # parsed from item metadata

# Get all contributors since the task was created
git log --format='%an' --since="$CREATION_DATE" --no-merges | sort -u
```

If the result is empty (external work, no commits), fallback to:
```bash
git config user.name
```

There can be more than one responsible — collect all contributors from the git log output.

### 4. Match evidence to items

For each piece of completed work, find the item it resolves. Be strict: only move an item if the evidence clearly covers it. When in doubt, leave it open and note what's still missing.

Matching rules:
- A fix to `auth.py` closes a TODO about auth bugs in `auth.py`
- "Agregué TZ=America/Santiago al .env" closes the timezone TODO
- "Eliminé el nodo huérfano en n8n UI" closes the orphan-node TODO even with no git diff
- A partial fix (only one of two sub-cases handled) → leave open, add a note about what remains

### 5. Move completed items to .todo/DONE.md

Remove the item (including its indented options/recommendation) from `.todo/TODO.md` or `.todo/DOING.md` and append to `.todo/DONE.md`:

```markdown
- [x] **[Item title]** — [original description] _(creado por: GitName · YYYY-MM-DD)_ ✓ _resuelto: [brief note of how] — responsable: Name1, Name2 · YYYY-MM-DD_
```

- `responsable:` lists all contributors from Step 3, comma-separated
- If only one contributor, still use the `responsable:` label
- The creation date and creator are preserved from the original item's metadata

Examples:
- `_(creado por: SmithDR · 2026-05-10)_ ✓ _resuelto: TZ=America/Santiago en .env — responsable: SmithDR · 2026-06-09_`
- `_(creado por: Alice · 2026-04-01)_ ✓ _resuelto: implementado en commit a3f9b2c — responsable: Alice, Bob · 2026-06-09_`
- `_(creado por: SmithDR · 2026-05-20)_ ✓ _resuelto: según descripción del usuario — responsable: SmithDR · 2026-06-09_`

### 6. Move discarded items to .todo/DISCARDED.md

For items closed as "won't fix" or made irrelevant by a decision, remove from `.todo/TODO.md`/`.todo/DOING.md` and append to `.todo/DISCARDED.md`:

```markdown
- ~~**[Item title]**~~ — [original description] _(creado por: GitName · YYYY-MM-DD)_
  _Descartado YYYY-MM-DD: [explicación del por qué — qué cambió, qué se decidió, por qué no vale la pena implementarlo]_
```

### 7. Update dates

```bash
# En DONE.md y/o DISCARDED.md según corresponda
_Última actualización: YYYY-MM-DD_
```

Also update `_Última revisión:_` in `.todo/TODO.md` if items were removed from it.

### 8. Commit

```bash
git add .todo/TODO.md .todo/DOING.md .todo/DONE.md .todo/DISCARDED.md
git commit -m "TODO: close [N] items — [M] done, [K] discarded"
```

Report to the user: which items were moved where, who is listed as responsible, which were left open and why, and if any need clarification about whether they were fully resolved.

## Edge cases

**"Lo hice en la UI / en producción / sin git"** — accept the user's word. Use `git config user.name` as responsible. Note: `✓ _resuelto: según descripción del usuario — responsable: Name · YYYY-MM-DD_`

**Partial completion** — if a TODO had 3 sub-cases and only 2 were fixed, leave it open and edit the description to reflect what remains.

**Cascading resolution** — fixing one item sometimes makes another irrelevant. Flag to the user: "Resolver X abre la puerta a cerrar Y — ¿lo implementaste también?"

**Item in DOING.md** — treat the same as one in TODO.md. The source file doesn't change the process.

**Multiple responsables** — if git log returns several names, list all of them. Don't filter to just the last committer.
