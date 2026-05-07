import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function loadPlaywright() {
  const bundledNodeModules =
    process.env.CODEX_NODE_MODULES ||
    'C:/Users/R/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';

  const candidates = ['playwright', path.join(bundledNodeModules, 'playwright')];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    'Playwright could not be resolved. Run the PowerShell wrapper so CODEX_NODE_MODULES/NODE_PATH are populated.'
  );
}
