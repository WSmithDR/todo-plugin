/** Lo único específico de Claude Code: cómo llega el payload. */

/** Claude Code siempre pipea stdin; el timeout es para no colgarse si no lo hace. */
export function readStdin(timeoutMs = 2000): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("")

    let data = ""
    const done = (): void => {
      clearTimeout(timer)
      resolve(data)
    }
    const timer = setTimeout(done, timeoutMs)

    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => (data += chunk))
    process.stdin.on("end", done)
    process.stdin.on("error", done)
  })
}
