// shell.env — inyecta el root del plugin en el entorno de los comandos.
//
// OpenCode no setea CLAUDE_PLUGIN_ROOT (grep sobre su binario: 0 apariciones),
// pero las 12 SKILL.md arrancan con:
//     "${TODO_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/bin/todo-guard.sh" open
// Sin ninguna de las dos, eso expande a "/bin/todo-guard.sh", falla, la ventana
// de escritura nunca se abre y el guard termina bloqueando las skills del propio
// plugin. Lo mismo con todo-store.sh, o sea que además se rompe la resolución
// de proyecto.
//
// Se declaran DOS variables a propósito:
//
//   TODO_PLUGIN_ROOT    la nuestra, sin ambigüedad. OpenCode le pasa el MISMO
//                       objeto `output.env` a todos los plugins registrados
//                       (arranca en {} y se usa como extendEnv del proceso), así
//                       que CLAUDE_PLUGIN_ROOT es un nombre global para un valor
//                       que es por-plugin: dos plugins que lo escriban se pisan y
//                       las skills del perdedor fallan en silencio.
//
//   CLAUDE_PLUGIN_ROOT  compatibilidad, y solo si nadie la puso antes. Cualquier
//                       cosa que la lea sigue andando; el que llegó primero manda.
import { PLUGIN_ROOT } from '../runner.js';

export function createEnvHandler() {
  return async (_input, output) => {
    output.env = output.env || {};
    output.env.TODO_PLUGIN_ROOT = PLUGIN_ROOT;
    if (!output.env.CLAUDE_PLUGIN_ROOT) {
      output.env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
    }
  };
}
