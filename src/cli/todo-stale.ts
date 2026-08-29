#!/usr/bin/env node
// Tareas abiertas que probablemente ya estén resueltas.
//
//   todo-stale        las del proyecto de este directorio (local o del store)
//
// Lo invoca la skill todo-triage. Una sola llamada a git para todo el historial
// relevante, en vez de un `git log` por item: con 48 items abiertos lo segundo es
// donde el modelo se cansa y saltea.
import { execFileSync } from "node:child_process"
import { openItems, readTodoFile } from "../core/lib/todo-files/todo-files.ts"
import { staleCandidates, type Change } from "../core/lib/stale-items/stale-items.ts"
import { staleScope } from "../core/lib/store/store.ts"

const MAX_CHANGES_SHOWN = 3

// Las tareas y el código pueden NO estar en el mismo lugar: en un proyecto
// centralizado las tareas viven en el store y el código en su repo. Cruzar
// contra el git del store no encuentra nada nunca — ese git solo se mueve
// cuando una skill escribe una tarea.
const { tasksDir, codeDir } = staleScope(process.cwd())

const items = openItems(readTodoFile(tasksDir, "TODO.md"))
if (items.length === 0) {
  console.log("Sin items abiertos en .todo/TODO.md.")
  process.exit(0)
}

// La fecha más vieja acota el historial que hace falta traer.
const fechas = items.map((item) => item.text.match(/creado por:[^·]*·\s*(\d{4}-\d{2}-\d{2})/)?.[1]).filter(Boolean)
const desde = fechas.sort()[0] ?? "1 year ago"

const log = (() => {
  try {
    // `-- .` acota al directorio actual. Sin eso, en el registro central —que es
    // UN repo con un subdirectorio por proyecto— los commits de un sitio
    // aparecían como evidencia de las tareas de otro.
    const args = ["log", `--since=${desde}`, "--name-only", "--date=short", "--pretty=format:%x00%h|%ad|%s", "--", "."]
    return execFileSync("git", args, {
      cwd: codeDir,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch {
    return ""
  }
})()

const changes: Change[] = log
  .split("\0")
  .filter((bloque) => bloque.trim().length > 0)
  .map((bloque) => {
    const [head = "", ...rest] = bloque.split("\n")
    const [sha = "", date = "", ...subject] = head.split("|")
    return { sha, date, subject: subject.join("|"), files: rest.filter((line) => line.trim().length > 0) }
  })

const { candidates, skipped } = staleCandidates(items, changes)

if (candidates.length === 0) {
  console.log(`Ninguno de los ${items.length} items abiertos tiene archivos tocados después de su creación.`)
} else {
  console.log(`POSIBLEMENTE RESUELTAS: ${candidates.length} de ${items.length} items abiertos\n`)
  for (const candidate of candidates) {
    const files = candidate.files
      .map(({ name, sharedBy }) => (sharedBy > 1 ? `${name} (lo mencionan ${sharedBy} tareas: señal débil)` : name))
      .join(", ")
    console.log(`- "${candidate.title}"  (creada ${candidate.created}, menciona ${files})`)
    for (const change of candidate.changes.slice(0, MAX_CHANGES_SHOWN)) {
      console.log(`    ${change.sha} ${change.date} ${change.subject}`)
    }
    if (candidate.changes.length > MAX_CHANGES_SHOWN) {
      console.log(`    … y ${candidate.changes.length - MAX_CHANGES_SHOWN} commits más`)
    }
  }
}

if (skipped > 0) {
  console.log(`\n(${skipped} items sin fecha de creación o sin archivos nombrados: esta verificación no los alcanza)`)
}
