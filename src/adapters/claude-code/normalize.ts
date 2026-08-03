import type { ToolEvent, ToolKind } from "../../core/protocol.ts"

/**
 * Payload que Claude Code manda por stdin a un hook. Todo opcional a propósito:
 * el adapter tiene que tolerar un payload raro sin romperse.
 */
export type ClaudePayload = {
  hook_event_name?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_response?: unknown
  cwd?: string
}

/** Devuelve null si no es JSON. El caller decide qué hacer (acá: dejar pasar). */
export function parsePayload(raw: string): ClaudePayload | null {
  try {
    const value: unknown = JSON.parse(raw)
    return value !== null && typeof value === "object" ? (value as ClaudePayload) : null
  } catch {
    return null
  }
}

const KINDS: Record<string, ToolKind> = {
  edit: "edit",
  write: "write",
  multiedit: "multiedit",
  bash: "bash",
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

export function toToolEvent(payload: ClaudePayload, phase: "before" | "after"): ToolEvent {
  const input = payload.tool_input ?? {}
  const kind = KINDS[(payload.tool_name ?? "").toLowerCase()] ?? "other"

  // filePath además de file_path: no todas las variantes del payload usan el
  // mismo casing, y el guard en bash ya contemplaba las dos.
  const path = str(input.file_path) ?? str(input.filePath)

  const edits = Array.isArray(input.edits) ? input.edits : []
  const contents = [
    str(input.content),
    str(input.new_string),
    ...edits.map((edit) =>
      edit !== null && typeof edit === "object" ? str((edit as Record<string, unknown>).new_string) : undefined,
    ),
  ].filter((text): text is string => text !== undefined)

  return {
    phase,
    kind,
    paths: path ? [path] : [],
    contents,
    command: str(input.command),
    cwd: payload.cwd ?? process.cwd(),
    result: phase === "after" ? toResult(payload.tool_response) : undefined,
  }
}

/**
 * El resultado de una tool viene en varias formas según la versión y la tool.
 * Se contemplan todas las que el error-checker en bash ya manejaba, porque cada
 * una apareció de verdad en algún payload.
 */
function toResult(response: unknown): { ok: boolean; text: string } | undefined {
  if (response === undefined || response === null) return undefined
  if (typeof response === "string") return { ok: true, text: response }
  if (typeof response !== "object") return undefined

  const r = response as Record<string, unknown>
  const content = Array.isArray(r.content) ? (r.content as Record<string, unknown>[]) : []

  const failed =
    r.is_error === true ||
    content.some((part) => part?.is_error === true) ||
    (typeof r.exit_code === "number" && r.exit_code !== 0)

  const fromContent = content
    .map((part) => str(part?.text))
    .filter((text): text is string => text !== undefined)
    .join("\n")

  const text =
    fromContent ||
    [str(r.stderr), str(r.stdout), str(r.output)].filter((s): s is string => Boolean(s)).join("\n")

  return { ok: !failed, text }
}
