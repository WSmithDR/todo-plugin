// config — auto-registra el dir de skills del plugin en el config vivo de
// OpenCode (Config.get() es singleton cacheado: el push acá es visible cuando
// las skills se descubren lazy). Sin symlinks ni edición manual del config.
import { SKILLS_DIR } from '../skills-bootstrap.js';

export function createConfigHandler() {
  return async (config) => {
    config.skills = config.skills || {};
    config.skills.paths = config.skills.paths || [];
    if (!config.skills.paths.includes(SKILLS_DIR)) {
      config.skills.paths.push(SKILLS_DIR);
    }
  };
}
