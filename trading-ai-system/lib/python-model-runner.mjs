import { spawn } from 'node:child_process';
const LIMIT = 1024 * 1024;
export function unavailablePythonForecast() { return { status: 'candidate_unavailable', fallbackAllowed: true, fallbackModelId: 'strongest_validated_seasonal_baseline', warnings: ['python_model_unavailable'] }; }
export function runPythonForecast({ pythonPath, scriptPath, modelPath, snapshotPath, timeoutMs = 60000 }) {
  return new Promise((resolve, reject) => {
    let settled = false, output = '', stderr = '';
    const child = spawn(pythonPath, [scriptPath, '--model', modelPath, '--snapshot', snapshotPath], { shell: false, stdio: ['ignore','pipe','pipe'], windowsHide: true });
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    child.stdout.on('data', (chunk) => { output += chunk; if (output.length > LIMIT) { child.kill(); finish(new Error('python_model_stdout_limit')); } });
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 4096) stderr = stderr.slice(-4096); });
    child.on('error', () => finish(null, unavailablePythonForecast()));
    child.on('exit', (code) => { if (code) return finish(new Error(`python_model_failed:${stderr.replace(/[A-Za-z]:\\[^\s]+/g, '[path]')}`)); try { finish(null, JSON.parse(output)); } catch { finish(new Error('python_model_output_invalid')); } });
    const timer = setTimeout(() => { child.kill(); finish(new Error('python_model_timeout')); }, timeoutMs);
  });
}
