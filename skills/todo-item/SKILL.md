---
name: todo-item
description: "Creates a complete TODO entry in one shot: add → solutions → recommend → clarify."
---

# TODO Item

Orchestrates four skills in sequence for a single new item. Run them in order — each step builds on the previous.

## Sequence

1. **`todo-add`** — write and insert the item in the correct section of `.todo/TODO.md`, including `_(creado por: GitName · YYYY-MM-DD)_` metadata
2. **`todo-solutions`** — add 2–4 concrete, distinct solution options to that item
3. **`todo-recommend`** — read the options and add a justified recommendation
4. **`todo-clarify`** — scan only the newly added text and add inline clarifications for non-obvious terms

Follow each skill's own rules. No need to repeat them here.

## When to use individual skills instead

Use `todo-item` for **new items** that deserve full treatment immediately.

Use individual skills when:
- Enriching an existing item that already has a description
- The user wants to review options before a recommendation is added
- Working in batch and deciding per item
