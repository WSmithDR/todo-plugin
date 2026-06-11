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

## Actualizar

**Scope project:**
```bash
claude plugin update todo-plugin@todo-plugin --scope project
```

**Scope user (global):**
```bash
claude plugin update todo-plugin@todo-plugin
```

Para verificar que el update tomó efecto, ejecutar `/todo-health` — la versión mostrada debe coincidir con la última publicada.

### Convención de versionado

El plugin sigue [semver](https://semver.org/lang/es/): `MAJOR.MINOR.PATCH`.
La versión se incrementa en cada cambio publicado, por lo que si `/todo-health` muestra una versión anterior a la esperada, el caché local no se actualizó correctamente.

## Verificar integración

```
/todo-health
```

## Desarrollo del plugin

### Setup inicial (una vez por clon)

```bash
bash bin/dev/setup.sh
```

Instala un symlink en `.git/hooks/pre-commit` que corre los tests antes de cada commit, independientemente del editor o CLI que uses.

### Correr tests manualmente

```bash
bash bin/dev/test-hooks.sh
```

### Estructura de `bin/`

```
bin/
  hooks/       ← scripts del plugin (se envían a usuarios al instalar)
  dev/
    git-hooks/ ← hooks de git para desarrollo (versionados, no enviados a usuarios)
    setup.sh   ← instala el pre-commit hook
    test-hooks.sh ← suite de tests de los hooks
```

> Los scripts en `bin/dev/` son solo para desarrollar el plugin y nunca forman parte de lo que el usuario final instala.

### Conventional commits y versionado

El hook `commit-msg` bumpeaa la versión en `.claude-plugin/plugin.json` automáticamente según el prefijo del mensaje:

| Prefijo | Ejemplo | Bump |
|---|---|---|
| `feat:` | `feat: agregar skill todo-config` | minor |
| `fix:` | `fix: corregir exit code en pre-commit` | patch |
| `chore:`, `docs:`, `refactor:`, `style:`, `test:`, `ci:` | `docs: actualizar README` | patch |
| `feat!:` o `BREAKING CHANGE` en el cuerpo | `feat!: cambiar formato de config.json` | major |

Si modificás `plugin.json` manualmente antes de commitear, el hook no toca la versión.

### CI

GitHub Actions corre `bin/dev/test-hooks.sh` en cada push y PR a `main`.

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
