// Dev-machine trigger for an agent self-update.
//
// This is the CLI twin of POST /api/admin/agent-update: it writes exactly the
// same agent_config columns requestAgentUpdate() writes, so the shop PC picks
// the request up through its normal config poll. It deliberately never talks
// to the agent directly — there is no HTTP agent API, and the database is the
// only channel that works through a shop's NAT.
//
// Usage: npm run agent:push-update
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const IN_FLIGHT = ['requested', 'downloading', 'swapping'];

const root = process.cwd();
const configPath = path.join(root, 'agent', 'config.json');
if (!existsSync(configPath)) {
  console.error('Missing agent/config.json — copy agent/dev-tools/config.example.json and fill in real values first.');
  process.exit(1);
}
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (!config.supabaseUrl || config.supabaseUrl.includes('your-project') || !config.supabaseKey || config.supabaseKey.includes('your-service-role-key')) {
  console.error('agent/config.json still has placeholder values — fill in the real Supabase URL/key before pushing an update.');
  process.exit(1);
}

const supabase = createClient(config.supabaseUrl, config.supabaseKey);

// The published manifest is the only source of the target version — pushing a
// version that has no zip behind it would send the agent into a failed
// download for nothing.
const { data: latestBlob, error: downloadError } = await supabase.storage
  .from('agent-updates').download('latest.json');
if (downloadError || !latestBlob) {
  console.error(`Could not read agent-updates/latest.json (${downloadError?.message ?? 'empty response'}) — run "npm run package:shop -- --publish" first.`);
  process.exit(1);
}

let latest;
try {
  latest = JSON.parse(await latestBlob.text());
} catch {
  console.error('The published latest.json is not valid JSON — fix or delete it before pushing an update.');
  process.exit(1);
}
if (typeof latest?.version !== 'string' || !latest.version) {
  console.error('latest.json has no usable "version" — republish it.');
  process.exit(1);
}

const { data: row, error: rowError } = await supabase
  .from('agent_config')
  .select('agent_version, agent_healthy_at, update_status, update_target_version, config_version')
  .eq('id', 1)
  .single();
if (rowError) {
  console.error(`Could not read agent_config: ${rowError.message}`);
  process.exit(1);
}

console.log(`Agent version:  ${row.agent_version ?? '(unknown — agent has not reported yet)'}`);
console.log(`Last healthy:   ${row.agent_healthy_at ?? '(never)'}`);
console.log(`Published:      ${latest.version} (${latest.kind ?? 'unknown kind'})`);

if (IN_FLIGHT.includes(row.update_status ?? '')) {
  console.error(`An update to ${row.update_target_version ?? '?'} is already in progress (${row.update_status}) — wait for it to finish or fail.`);
  process.exit(1);
}
if (row.agent_version === latest.version) {
  console.error(`Agent is already on ${latest.version} — nothing to do.`);
  process.exit(1);
}

// Same UPDATE as requestAgentUpdate() in src/lib/db-supabase.ts. config_version
// is bumped so the agent's existing config poll notices the change.
const now = new Date().toISOString();
const { error: updateError } = await supabase
  .from('agent_config')
  .update({
    update_target_version: latest.version,
    update_status: 'requested',
    update_message: null,
    update_started_at: now,
    config_version: Number(row.config_version ?? 0) + 1,
    updated_at: now
  })
  .eq('id', 1);
if (updateError) {
  console.error(`Could not queue the update: ${updateError.message}`);
  process.exit(1);
}

console.log(`Requested update to ${latest.version} — agent will pick it up on its next config poll (~30s).`);
