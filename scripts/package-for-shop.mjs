import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';

const root = process.cwd();
const stageDir = path.join(root, 'dist-shop-package', 'selfprint-agent');
const engineDir = path.join(stageDir, 'engine');
const zipPath = path.join(root, 'dist-shop-package', 'selfprint-agent.zip');

// Fresh staging directory every run.
rmSync(path.join(root, 'dist-shop-package'), { recursive: true, force: true });
mkdirSync(engineDir, { recursive: true });

// Fail loudly and early if the source config is missing or still the
// placeholder — a client package with fake credentials would silently
// never connect and every job would sit stuck at "approved".
const configPath = path.join(root, 'agent', 'config.json');
if (!existsSync(configPath)) {
  console.error('Missing agent/config.json — copy agent/dev-tools/config.example.json and fill in real values first.');
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

// Everything the app actually needs (package.json, node_modules, the real
// agent/ folder with its own SETUP.bat/TEST-PRINTER.bat/config.json/src/
// dev-tools/) lives one level down in engine/ — not at the zip root. A
// client who unzips this should see almost nothing: just the two things
// they're meant to click, plus a README. Burying node_modules and a dozen
// support files behind one extra folder is what keeps that first screen
// readable for someone who isn't a developer.
console.log('Copying package.json, package-lock.json, node_modules, agent/ into engine/...');
cpSync(path.join(root, 'package.json'), path.join(engineDir, 'package.json'));
cpSync(path.join(root, 'package-lock.json'), path.join(engineDir, 'package-lock.json'));
cpSync(path.join(root, 'node_modules'), path.join(engineDir, 'node_modules'), { recursive: true });
cpSync(path.join(root, 'agent'), path.join(engineDir, 'agent'), {
  recursive: true,
  // agent.log / agent.log.old are this dev machine's own run history —
  // the shop PC starts with a clean log.
  filter: (src) => !src.endsWith('agent.log') && !src.endsWith('agent.log.old')
});

// Thin relay launchers at the zip root. `%~dp0` inside a called .bat always
// resolves to THAT script's own location regardless of how it was invoked,
// so these can `call` the real scripts in engine/agent/ unmodified — no
// path arithmetic to duplicate or keep in sync.
console.log('Writing root-level launchers...');
writeFileSync(path.join(stageDir, 'SETUP.bat'),
  '@echo off\r\ncall "%~dp0engine\\agent\\SETUP.bat"\r\n');
writeFileSync(path.join(stageDir, 'TEST-PRINTER.bat'),
  '@echo off\r\ncall "%~dp0engine\\agent\\TEST-PRINTER.bat"\r\n');

writeFileSync(path.join(stageDir, 'README.txt'), [
  'SelfPrint - Shop PC Setup',
  '=========================',
  '',
  '1. Double-click SETUP.bat',
  '   - Click "Yes" if Windows asks for permission.',
  '   - Wait for the "DONE!" message.',
  '   - That is it. Printing is now set up and will keep working by',
  '     itself, even after this computer restarts.',
  '',
  '2. (Optional) Double-click TEST-PRINTER.bat to send one test page and',
  '   check the printer is connected properly.',
  '',
  'Do not open or edit anything inside the "engine" folder - it is not',
  'meant to be touched, and nothing in there needs your attention.',
  '',
  'Something not working? Ask whoever set this up for help - they can',
  'check agent.log inside the engine folder for details.',
  ''
].join('\r\n'));

console.log('Zipping...');
execFileSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path "${stageDir}\\*" -DestinationPath "${zipPath}" -Force`
]);

console.log(`Done: ${zipPath}`);
console.log('Client instructions: unzip anywhere, double-click SETUP.bat, done.');
