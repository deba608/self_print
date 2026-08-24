import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(import.meta.dirname, '..', '.env');
const envText = readFileSync(envPath, 'utf8');
const env = Object.fromEntries(
  envText.split('\n').filter(l => l.includes('=')).map(l => {
    const [k, ...rest] = l.split('=');
    return [k.trim(), rest.join('=').trim()];
  })
);

const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Pass credentials as CLI args ΓÇö never hardcode real accounts in source.
// Usage: node scripts/create-owner.mjs owner@shop.com 'SomeStrongPassword!'
const [EMAIL, PASSWORD] = process.argv.slice(2);
if (!EMAIL || !PASSWORD) {
  console.error('Usage: node scripts/create-owner.mjs <email> <password>');
  process.exit(1);
}

async function main() {
  // 1. Create auth user (or find existing)
  console.log(`Looking up auth user: ${EMAIL}`);
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list.users.find(u => u.email === EMAIL);
  let userId;
  if (existing) {
    userId = existing.id;
    console.log(`Found existing user ID: ${userId}`);
  } else {
    console.log('User not found, creating...');
    const { data: userData, error: userErr } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (userErr) { console.error('createUser error:', userErr); process.exit(1); }
    userId = userData.user.id;
    console.log(`Created new user ID: ${userId}`);
  }

  // 2. Insert staff_profiles row
  console.log('Inserting staff_profiles row (role: super_admin)...');
  const { error: insertErr } = await admin
    .from('staff_profiles')
    .upsert({
      id: userId,
      email: EMAIL,
      display_name: 'Owner',
      role: 'super_admin',
    }, { onConflict: 'id' });
  if (insertErr) {
    console.error('Insert error:', insertErr);
    process.exit(1);
  }

  console.log('Done! Owner account created.');
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`  Role:     super_admin`);
}

main().catch(e => { console.error(e); process.exit(1); });
