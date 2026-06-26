# Timestamps precisos de inicio/fin de tarea

_Diseño · 2026-06-26_

## Problema

`todo-doing` estampa `iniciado: YYYY-MM-DD` y `todo-done` estampa `resuelto: … · YYYY-MM-DD`,
ambos a resolución de **día**. Eso impide calcular cuánto llevó una tarea con precisión, y
bitacora necesita un buen default para el campo **Días** (hoy lo pregunta a ciegas). Además
`todo-done` **descarta** el `iniciado:` al mover a DONE.md → aunque tuviéramos el inicio, se
pierde al cerrar.

## Objetivo

Inicio y fin con timestamp preciso para que bitacora calcule una **semilla editable** de Días
(`fin − inicio`), que el usuario ajusta al esfuerzo real (la duración transcurrida es cota
superior del esfuerzo, no esfuerzo en sí).

## Cambios

### todo-plugin (emite)

1. **`todo-doing`**: `iniciado:` pasa a timestamp ISO con hora: `INICIADO=$(date -Iminutes)`
   → `iniciado: 2026-06-26T14:32-05:00`. El commit "TODO: start X" que ya hace queda al mismo
   instante (respaldo).
2. **`todo-done`**:
   - `resuelto: … · <ISO con hora>` (`date -Iminutes`).
   - **Conserva `iniciado:`** del ítem de DOING al escribir la entrada en DONE.md (fix clave).

**Formato DONE.md resultante:**
```
- [x] **Título** — desc _(creado por: X · 2026-06-19 | iniciado: 2026-06-26T14:32-05:00)_ ✓ _resuelto: nota — responsable: Y · 2026-06-26T18:10-05:00_
```
Creación queda fecha-sola; inicio y fin son datetime.

### bitacora (consume)

- `parseDone` extrae `iniciado` (inicio) y `resuelto` (fin).
- `elapsedDays(inicio, fin)` → semilla del campo Días, que la skill propone como default editable.

## Compatibilidad y bordes

- **Legacy** (fecha-sola): se parsea como medianoche; duración a resolución de día. No rompe.
- **Cerrada sin pasar por DOING** (sin `iniciado:`): fallback al `creado` como inicio; si tampoco, Días en blanco.
- **Multi-tarea por rama:** irrelevante — cada tarea tiene su `iniciado`/`resuelto` propio por su transición de skill.

## Precisión real

El timestamp es del momento en que corre la skill, no del trabajo en sí. Depende de correr
`todo-doing`/`todo-done` cuando de verdad se arranca/termina. El hook `branch-doing` empuja lo
primero. Es un default mejor que "preguntar a ciegas", no una medición exacta de esfuerzo.

## Testing

- Lógica testeable (parsear timestamps mixtos día/datetime + `elapsedDays`) en `bitacora/test/run.mjs`.
- Edits de skills de todo = instrucciones markdown; se verifican corriendo el flujo.

## Fuera de alcance (YAGNI)

- Derivar inicio/fin de commits de código arbitrarios (frágil con ramas multi-tarea).
- Medir esfuerzo real (horario laboral, descontar pausas) — la semilla editable lo cubre a mano.
