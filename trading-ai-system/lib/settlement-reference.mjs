import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePythonPath } from './integration-build.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(moduleDir, '../..');
const defaultScriptPath = path.resolve(moduleDir, '../tools/build-settlement-reference.py');

export function summarizeSettlementReference(reference = {}) {
  const summary = reference.summary || {};
  return {
    hasSettlementReference: Boolean(summary.hasSettlementReference),
    referenceWorkbookCount: Number(summary.workbookCount || 0),
    spotReconciliationWorkbookCount: Number(summary.spotReconciliationWorkbookCount || 0),
    monthlySettlementWorkbookCount: Number(summary.monthlySettlementWorkbookCount || 0),
    actualDaily96ExportFiles: Number(summary.actualDaily96ExportFiles || 0),
    settlementExportFiles: Number(summary.settlementExportFiles || 0),
    positionExportFiles: Number(summary.positionExportFiles || 0),
    canFillActualKwh: Boolean(summary.canFillActualKwh),
    canFillSettleAmount: Boolean(summary.canFillSettleAmount),
  };
}

export async function buildSettlementReference(options = {}) {
  const python = await resolvePythonPath(options.pythonPath || '');
  const scriptPath = options.scriptPath || defaultScriptPath;
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(python, [scriptPath, '--project-root', projectRoot], {
      cwd: projectRoot,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
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
        reject(new Error(`settlement reference build exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`settlement reference JSON parse failed: ${error.message}`));
      }
    });
  });
}
