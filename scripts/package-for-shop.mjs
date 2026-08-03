import { existsSync, mkdirSync, rmSync, cpSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';

const root = process.cwd();
const stageDir = path.join(root, 'dist-shop-package', 'selfprint-agent');
const zipPath = path.join(root, 'dist-shop-package', 'selfprint-agent.zip');

// Fresh staging directory every run.
rmSync(path.join(root, 'dist-shop-package'), { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// Fail loudly and early if the source config is missing or still the
// placeholder — a client package with fake credentials would silently
// never connect and every job would sit stuck at "approved".
const configPath = path.join(root, 'agent', 'config.json');
if (!existsSync(configPath)) {
  console.error('Missing agent/config.json — copy agent/config.example.json and fill in real values first.');
  process.exit(1);
}
const config = JSON.parse(await import('fs/promises').then(m => m.readFile(configPath, 'utf8')));
if (!config.supabaseUrl || config.supabaseUrl.includes('your-project') || !config.supabaseKey || config.supabaseKey.includes('your-service-role-key')) {
  console.error('agent/config.json still has placeholder values — fill in the real Supabase URL/key before packaging.');
  process.exit(1);
}

// node_modules must be a full install (not --omit=dev): tsx (needed by
// `npm run agent`) lives in devDependencies.
const tsxBin = path.join(root, 'node_modules', '.bin', 'tsx.cmd');
if (!existsSync(tsxBin)) {
  console.error('node_modules/.bin/tsx.cmd not found — run a plain "npm install" (not --omit=dev) before packaging.');
  process.exit(1);
}

console.log('Copying package.json, package-lock.json, node_modules, agent/...');
cpSync(path.join(root, 'package.json'), path.join(stageDir, 'package.json'));
cpSync(path.join(root, 'package-lock.json'), path.join(stageDir, 'package-lock.json'));
cpSync(path.join(root, 'node_modules'), path.join(stageDir, 'node_modules'), { recursive: true });
cpSync(path.join(root, 'agent'), path.join(stageDir, 'agent'), {
  recursive: true,
  // agent.log / agent.log.old are this dev machine's own run history —
  // the shop PC starts with a clean log.
  filter: (src) => !src.endsWith('agent.log') && !src.endsWith('agent.log.old')
});

console.log('Zipping...');
execFileSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path "${stageDir}\\*" -DestinationPath "${zipPath}" -Force`
]);

console.log(`Done: ${zipPath}`);
console.log('Client instructions: unzip anywhere, double-click agent\\SETUP.bat, done.');
