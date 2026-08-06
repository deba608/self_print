import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
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
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (!config.supabaseUrl || config.supabaseUrl.includes('your-project') || !config.supabaseKey || config.supabaseKey.includes('your-service-role-key')) {
  console.error('agent/config.json still has placeholder values — fill in the real Supabase URL/key before packaging.');
  process.exit(1);
}

// agent/src/index.ts only imports @supabase/supabase-js, sharp, and
// @hyzyla/pdfium (plus Node builtins) — everything else in the repo's
// node_modules (Next.js, React, Razorpay, Leaflet, pdfjs-dist, Vitest, ...)
// is there for the web app, not the agent, and was previously copied
// wholesale into every delivery zip for no reason. Building a separate,
// minimal node_modules containing only what the agent actually runs (plus
// tsx, which executes it) cuts the zip from ~190MB of mostly-unused
// dependencies down to just the native binaries (sharp/pdfium) it needs.
// Versions are pinned to whatever's currently locked in the main
// package-lock.json, so this never silently drifts from what's actually
// been tested against.
console.log('Resolving pinned versions for the agent\'s actual runtime deps...');
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const AGENT_DEPS = ['@supabase/supabase-js', 'sharp', '@hyzyla/pdfium', 'tsx'];
const pinned = {};
for (const dep of AGENT_DEPS) {
  const entry = lock.packages[`node_modules/${dep}`];
  if (!entry) {
    console.error(`Could not find "${dep}" in package-lock.json — has agent/src/index.ts started importing something new? Update AGENT_DEPS in scripts/package-for-shop.mjs.`);
    process.exit(1);
  }
  pinned[dep] = entry.version;
}

const buildDir = path.join(root, 'dist-shop-package', '.agent-deps-build');
mkdirSync(buildDir, { recursive: true });
writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify({
  name: 'selfprint-agent',
  private: true,
  scripts: { agent: 'tsx agent/src/index.ts' },
  dependencies: pinned
}, null, 2));

console.log(`Installing minimal agent-only dependencies (${Object.entries(pinned).map(([k, v]) => `${k}@${v}`).join(', ')})...`);
// npm.cmd on Windows is a shell script, not a real executable — needs shell:true
// to spawn. Args are fixed literals (no user input), so shell:true is safe here
// despite Node's generic deprecation warning about that combination.
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (process.platform === 'win32') {
  execFileSync(`${npmCmd} install --no-audit --no-fund`, { cwd: buildDir, stdio: 'inherit', shell: true });
} else {
  execFileSync(npmCmd, ['install', '--no-audit', '--no-fund'], { cwd: buildDir, stdio: 'inherit' });
}

const tsxBin = path.join(buildDir, 'node_modules', '.bin', 'tsx.cmd');
if (!existsSync(tsxBin)) {
  console.error('node_modules/.bin/tsx.cmd not found after install — something went wrong building the minimal dependency set.');
  process.exit(1);
}

// Everything the app actually needs (package.json, node_modules, the real
// agent/ folder with its own SETUP.bat/TEST-PRINTER.bat/config.json/src/
// dev-tools/) lives one level down in engine/ — not at the zip root. A
// client who unzips this should see almost nothing: just the two things
// they're meant to click, plus a README. Burying node_modules and a dozen
// support files behind one extra folder is what keeps that first screen
// readable for someone who isn't a developer.
console.log('Copying minimal package.json/package-lock.json/node_modules, and agent/, into engine/...');
cpSync(path.join(buildDir, 'package.json'), path.join(engineDir, 'package.json'));
cpSync(path.join(buildDir, 'package-lock.json'), path.join(engineDir, 'package-lock.json'));
cpSync(path.join(buildDir, 'node_modules'), path.join(engineDir, 'node_modules'), { recursive: true });
rmSync(buildDir, { recursive: true, force: true });
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

// --publish: also build and upload a self-update payload to Supabase Storage.
// Shop PCs that already ran SETUP.bat poll `agent-updates/latest.json` and
// pull the matching zip; the plain packaging flow above is untouched for
// first-time installs.
if (process.argv.includes('--publish')) {
  const { createClient } = await import('@supabase/supabase-js');
  const { createHash } = await import('node:crypto');

  const version = JSON.parse(await readFile(path.join(root, 'agent', 'version.json'), 'utf8')).version;
  if (typeof version !== 'string' || !/^\d+(\.\d+)*$/.test(version)) {
    console.error('agent/version.json must contain a dotted numeric "version" string, e.g. "1.0.0".');
    process.exit(1);
  }
  const zipName = `agent-${version}.zip`;
  // Reuse the agent credentials already validated above.
  const supabase = createClient(config.supabaseUrl, config.supabaseKey);

  // Refuse to republish an existing version — forces a deliberate bump, so a
  // shop that already installed 1.2.0 can never be handed different bytes
  // under the same version number.
  const { data: existing, error: listError } = await supabase.storage
    .from('agent-updates').list('', { search: zipName });
  if (listError) {
    console.error(`Could not list agent-updates bucket: ${listError.message}`);
    process.exit(1);
  }
  if (existing?.some(f => f.name === zipName)) {
    console.error(`${zipName} already published — bump agent/version.json first.`);
    process.exit(1);
  }

  // Read the previous manifest — it drives both the version guard and the
  // code/full decision. A missing object means "first publish"; any OTHER
  // error is a real problem (wrong bucket, bad key, network) and must not
  // quietly degrade into "first publish".
  const { data: latestBlob, error: downloadError } = await supabase.storage
    .from('agent-updates').download('latest.json');
  const notFound = downloadError && (
    String(downloadError.statusCode ?? '') === '404' ||
    /not[ _]?found/i.test(downloadError.message ?? '')
  );
  if (downloadError && !notFound) {
    console.error(`Could not read the current latest.json: ${downloadError.message}`);
    process.exit(1);
  }

  let lastManifest = null;
  if (latestBlob) {
    try {
      lastManifest = JSON.parse(await latestBlob.text());
    } catch {
      console.error('The published latest.json is not valid JSON — fix or delete it before publishing.');
      process.exit(1);
    }
  }

  // Agents only accept a strictly greater version, so republishing downwards
  // would upload bytes nobody ever installs.
  if (typeof lastManifest?.version === 'string') {
    const cmp = (a, b) => {
      const as = a.split('.');
      const bs = b.split('.');
      for (let i = 0; i < Math.max(as.length, bs.length); i++) {
        const av = Number(as[i] ?? 0) || 0;
        const bv = Number(bs[i] ?? 0) || 0;
        if (av !== bv) return av < bv ? -1 : 1;
      }
      return 0;
    };
    if (cmp(version, lastManifest.version) <= 0) {
      console.error(`agent/version.json is ${version}, but ${lastManifest.version} is already published — agents only install strictly higher versions. Bump it.`);
      process.exit(1);
    }
  }

  // code vs full: a "code" update only replaces agent/ (scripts + src), which
  // is safe when node_modules is unchanged. If any pinned dependency moved,
  // the payload has to carry the whole engine instead.
  const lastDeps = lastManifest?.deps ?? null;
  const depsChanged = !lastDeps || AGENT_DEPS.some(d => lastDeps[d] !== pinned[d]);
  const kind = depsChanged ? 'full' : 'code';

  // config.json holds this shop's own credentials — it must never travel in
  // an update payload, or an upgrade would overwrite them.
  const shopConfig = path.join(engineDir, 'agent', 'config.json');
  const notConfig = (src) => path.resolve(src) !== shopConfig;

  const updStage = path.join(root, 'dist-shop-package', 'update-payload');
  rmSync(updStage, { recursive: true, force: true });
  if (kind === 'full') {
    cpSync(engineDir, updStage, { recursive: true, filter: notConfig });
  } else {
    cpSync(path.join(engineDir, 'agent'), path.join(updStage, 'agent'), { recursive: true, filter: notConfig });
  }
  if (existsSync(path.join(updStage, 'agent', 'config.json'))) {
    console.error('config.json leaked into the update payload — refusing to publish.');
    process.exit(1);
  }

  console.log(`Zipping ${kind} update payload...`);
  const updZip = path.join(root, 'dist-shop-package', zipName);
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path "${updStage}\\*" -DestinationPath "${updZip}" -Force`
  ]);

  const zipBytes = await readFile(updZip);
  const sha256 = createHash('sha256').update(zipBytes).digest('hex');

  // Zip first, latest.json LAST — a half-finished publish never advertises a
  // file that isn't there yet.
  console.log(`Uploading ${zipName} (${(zipBytes.length / 1024).toFixed(0)} KB)...`);
  const up1 = await supabase.storage.from('agent-updates')
    .upload(zipName, zipBytes, { contentType: 'application/zip' });
  if (up1.error) {
    console.error(`Upload failed: ${up1.error.message}`);
    process.exit(1);
  }

  const latest = {
    version,
    kind,
    file: zipName,
    sha256,
    publishedAt: new Date().toISOString(),
    // Extra field, ignored by the agent's parseLatestJson — it exists purely
    // so the *next* publish can tell whether dependencies moved.
    deps: pinned
  };
  const up2 = await supabase.storage.from('agent-updates')
    .upload('latest.json', Buffer.from(JSON.stringify(latest, null, 2)), {
      contentType: 'application/json',
      upsert: true
    });
  if (up2.error) {
    // The zip is up but nothing points at it, and the "already published"
    // guard would block every retry of this version. Roll the zip back so a
    // fixed re-run works without hand-deleting objects in the dashboard.
    console.error(`latest.json upload failed: ${up2.error.message}`);
    try {
      const { error: removeError } = await supabase.storage.from('agent-updates').remove([zipName]);
      if (removeError) throw removeError;
      console.error(`Rolled back the orphaned ${zipName} — safe to re-run once the cause is fixed.`);
    } catch (err) {
      console.error(`Could not roll back ${zipName} (${err?.message ?? err}) — delete it manually before re-running, or the "already published" guard will block this version.`);
    }
    process.exit(1);
  }

  // Delete old agent-*.zip files now that latest.json points at the new one.
  const { data: allFiles } = await supabase.storage.from('agent-updates').list('');
  const oldZips = (allFiles ?? [])
    .map(f => f.name)
    .filter(n => n.startsWith('agent-') && n.endsWith('.zip') && n !== zipName);
  if (oldZips.length > 0) {
    const { error: cleanErr } = await supabase.storage.from('agent-updates').remove(oldZips);
    if (cleanErr) {
      console.warn(`Could not delete old zips (${cleanErr.message}) — clean them manually in the dashboard.`);
    } else {
      console.log(`Deleted ${oldZips.length} old zip(s): ${oldZips.join(', ')}`);
    }
  }

  console.log(`Published ${kind} update ${version}, sha256=${sha256}`);
}
