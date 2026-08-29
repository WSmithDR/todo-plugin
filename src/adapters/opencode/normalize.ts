import type { ToolEvent, ToolKind } from "../../core/lib/protocol/protocol.ts"

/**
 * OpenCode nombra las tools en minúscula y les pasa los argumentos en camelCase
 * (`filePath`, `newString`), al revés de Claude Code (`file_path`, `new_string`).
 *
 * El bridge anterior mandaba `args` tal cual al guard en bash, que solo miraba
 * `new_string`: el guard duro de `- [x]` nunca disparaba sobre un `edit` en
 * OpenCode, solo sobre un `write` (que sí usa `content` en los dos). Acá se leen
 * las dos convenciones.
 */

const KINDS: Record<string, ToolKind> = {
  edit: "edit",
  write: "write",
  multiedit: "multiedit",
  patch: "edit", // `patch` aplica un diff: escribe archivos igual que `edit`.
  bash: "bash",
}

type Args = Record<string, unknown>

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

const pick = (args: Args, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = str(args[key])
    if (value !== undefined) return value
  }
  return undefined
}

export type OpenCodeAfter = {
  output?: string
  metadata?: unknown
}

export function toToolEvent(
  tool: string,
  args: Args,
  cwd: string,
  phase: "before" | "after",
  after?: OpenCodeAfter,
): ToolEvent {
  const path = pick(args, "filePath", "file_path", "path")

  const edits = Array.isArray(args.edits) ? (args.edits as Args[]) : []
  const contents = [
    pick(args, "content"),
    pick(args, "newString", "new_string"),
    ...edits.map((edit) => (edit !== null && typeof edit === "object" ? pick(edit, "newString", "new_string") : undefined)),
  ].filter((text): text is string => text !== undefined)

  return {
    phase,
    kind: KINDS[tool.toLowerCase()] ?? "other",
    paths: path ? [path] : [],
    contents,
    command: pick(args, "command"),
    cwd,
    result: phase === "after" ? toResult(after) : undefined,
  }
}

/** Claves donde podría venir el exit code. Ninguna está garantizada por contrato. */
const EXIT_KEYS = ["exit", "exitCode", "exit_code", "code", "status"]

/**
 * OpenCode no declara en su tipo cómo reporta el fallo de un comando: el hook
 * `after` recibe `{title, output, metadata, attachments}` y `metadata` es `any`.
 *
 * Verificado contra opencode 1.17.18 corriendo, con un plugin espía: para `bash`
 * llega `metadata: { output: string, exit: number, truncated: boolean }` — o sea
 * `exit`, la primera de EXIT_KEYS. Sigue siendo una búsqueda y no un acceso
 * directo porque el contrato no está declarado y la próxima versión puede
 * renombrarla sin que sea un breaking change para ellos.
 *
 * Si no hay ninguna clave se asume ÉXITO. La degradación es en la dirección
 * segura: error-triage solo aconseja ante un fallo, así que no detectarlo hace
 * que calle — nunca que invente un aviso sobre un comando que anduvo bien.
 */
function toResult(after?: OpenCodeAfter): { ok: boolean; text: string } {
  const text = after?.output ?? ""
  const metadata = after?.metadata

  if (metadata !== null && typeof metadata === "object") {
    const meta = metadata as Args
    for (const key of EXIT_KEYS) {
      if (typeof meta[key] === "number") return { ok: meta[key] === 0, text }
    }
    if (typeof meta.error === "boolean") return { ok: !meta.error, text }
  }

  return { ok: true, text }
}
