import path from 'node:path';
import { mkdir, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';

export function buildCloneLayout({ sourceUserDataDir, profileName, cloneRoot }) {
  return {
    sourceLocalState: path.join(sourceUserDataDir, 'Local State'),
    sourceProfileDir: path.join(sourceUserDataDir, profileName),
    cloneRoot,
    cloneDefaultDir: path.join(cloneRoot, 'Default'),
    cloneLocalState: path.join(cloneRoot, 'Local State'),
  };
}

function runRobocopy(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('robocopy', args, { stdio: 'pipe' });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      // Robocopy returns 0-7 for success-ish outcomes. In our case Chrome may keep a
      // handful of transient files locked; code 8/9 can still yield a usable profile clone.
      if (typeof code === 'number' && code <= 9) {
        resolve();
        return;
      }

      reject(new Error(stderr || `robocopy failed with code ${code}`));
    });
  });
}

export async function cloneChromeProfile({ sourceUserDataDir, profileName, cloneRoot }) {
  const layout = buildCloneLayout({ sourceUserDataDir, profileName, cloneRoot });
  await mkdir(layout.cloneRoot, { recursive: true });

  await cp(layout.sourceLocalState, layout.cloneLocalState, { force: true });

  await runRobocopy([
    layout.sourceProfileDir,
    layout.cloneDefaultDir,
    '/E',
    '/R:1',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP',
    '/XF',
    'LOCK',
    'LOG',
    'LOG.old',
    '*.tmp',
    '*.temp',
    '*-journal',
    '*-wal',
    '*-shm',
    '/XD',
    'Cache',
    'Code Cache',
    'GPUCache',
    'GrShaderCache',
    'GraphiteDawnCache',
    'ShaderCache',
    'Service Worker\\CacheStorage',
    'Service Worker\\ScriptCache',
  ]);

  return layout;
}
