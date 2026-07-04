// tool.execute.before — equivalente OpenCode del PreToolUse de hooks/hooks.json.
// Delega la decisión al MISMO bin/todo-guard.sh que usa Claude Code (matching
// case-insensitive y fallback filePath viven en el script, no acá): exit != 0
// => Error => OpenCode cancela la tool call.
import { GUARD_SCRIPT, runBashStdin } from '../runner.js';

export function createBeforeHandler() {
  return async (input, output) => {
    const payload = JSON.stringify({
      tool_name: input.tool || '',
      tool_input: output.args || {},
      cwd: input.cwd || process.cwd(),
    });
    const { code, err } = await runBashStdin(GUARD_SCRIPT, payload);
    if (code !== 0) throw new Error(err.trim() || 'Bloqueado por todo-guard');
  };
}
