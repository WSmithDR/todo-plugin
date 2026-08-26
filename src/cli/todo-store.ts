#!/usr/bin/env node
// Registro de proyectos sin repo, tal como lo consumen las SKILL.md:
//
//   todo-store mode            → "repo" | "nonrepo"
//   todo-store list            → "<id>\t<name>" por línea
//   todo-store create <name>   → imprime el id
//   todo-store path <id>       → imprime el directorio del proyecto
//   todo-store adopt [<ruta>] [<nombre>]  → muda el .todo local al store
//
// El formato de salida es el del script en bash que reemplaza: las skills lo
// parsean, así que cambiarlo las rompe.
import { adopt, create, list, mode, projectPath } from "../core/store.ts"

const [command, ...args] = process.argv.slice(2)

try {
  switch (command) {
    case "mode":
      console.log(mode(process.cwd()))
      break

    case "list":
      for (const project of list()) console.log(`${project.id}\t${project.name}`)
      break

    case "create": {
      const name = args[0]
      if (!name) throw new Error("nombre requerido")
      console.log(create(name))
      break
    }

    case "path": {
      const id = args[0]
      if (!id) throw new Error("id requerido")
      console.log(projectPath(id))
      break
    }

    case "adopt": {
      const [target, name] = args
      const result = adopt(target ?? process.cwd(), name)
      console.log(`${result.id}\t${result.dir}`)
      break
    }

    default:
      process.stderr.write("uso: todo-store {mode|list|create <name>|path <id>|adopt [<ruta>] [<nombre>]}\n")
      process.exit(1)
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
