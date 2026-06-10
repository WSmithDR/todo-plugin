# todo-plugin

A Claude Code plugin for task lifecycle management. Maintains `.todo/TODO.md`, `.todo/DOING.md`, `.todo/DONE.md`, and `.todo/DISCARDED.md` using the Eisenhower Q1–Q4 matrix.

## Install

**1. Registrar el marketplace (una sola vez, global):**
```bash
claude plugin marketplace add WSmithDR/todo-plugin
```

**2. Instalar en el proyecto:**
```bash
claude plugin install todo-plugin@todo-plugin --scope project
```

**Global (todos los proyectos):**
```bash
claude plugin install todo-plugin@todo-plugin
```

## Verificar integración

```
/todo-health
```

## Skills

| Skill | Descripción |
|---|---|
| `todo-add` | Agregar items a `.todo/TODO.md` |
| `todo-triage` | Clasificar items por cuadrante Eisenhower |
| `todo-doing` | Mover item de TODO → DOING |
| `todo-done` | Marcar item como completo → DONE |
| `todo-item` | Leer o inspeccionar una tarea |
| `todo-clarify` | Agregar detalle o criterios de aceptación |
| `todo-recommend` | Sugerir el próximo item a trabajar |
| `todo-solutions` | Adjuntar opciones concretas de solución |
| `todo-audit` | Auditoría completa del codebase |
| `todo-health` | Verificar que el plugin está integrado correctamente |
