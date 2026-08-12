import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolvePythonPath(preferredPath) {
  if (preferredPath && (await exists(preferredPath))) {
    return preferredPath;
  }

  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  const bundled = path.resolve(
    userProfile,
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
  );
  if (await exists(bundled)) {
    return bundled;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

export async function buildIntegrationSummaryFile({ scriptPath, pythonPath }) {
  const python = await resolvePythonPath(pythonPath);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(python, [scriptPath], {
      cwd: path.dirname(path.dirname(scriptPath)),
      windowsHide: true,
    });

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`integration summary build exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({
        ok: true,
        outputPath: stdout.trim().split(/\r?\n/).at(-1),
        stderr: stderr.trim(),
      });
    });
  });
}
