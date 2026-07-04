// experimental.chat.messages.transform — inyecta el bootstrap de skills en el
// PRIMER mensaje de usuario (no en system: evita token bloat por turno y los
// system múltiples que rompen algunos modelos). Guard anti-doble-inyección: el
// hook corre en cada step y puede recibir mensajes ya transformados.
import { buildBootstrap, BOOTSTRAP_MARKER } from '../skills-bootstrap.js';

export function createTransformHandler() {
  return async (_input, output) => {
    const bootstrap = buildBootstrap();
    if (!bootstrap || !output.messages?.length) return;
    const firstUser = output.messages.find((m) => m.info?.role === 'user');
    if (!firstUser || !firstUser.parts?.length) return;
    if (firstUser.parts.some((p) => p.type === 'text' && p.text?.includes(BOOTSTRAP_MARKER))) return;

    const ref = firstUser.parts[0];
    firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap });
  };
}
