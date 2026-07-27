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
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const EMAIL = 'kanhaandbrothers@gmail.com';
const PASSWORD = 'Owner@1234';

async function main() {
  // Try signing up the user via the auth API directly (anon key)
  console.log('Trying to sign up user via auth API...');
  const signupRes = await fetch(`${supabaseUrl}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      data: { role: 'super_admin' }
    })
  });
  const signupBody = await signupRes.text();
  console.log(`Signup status: ${signupRes.status}`);
  console.log(`Signup body: ${signupBody.substring(0, 500)}`);

  // Try signing in
  console.log('\nTrying sign in...');
  const signinRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
    })
  });
  const signinBody = await signinRes.json();
  console.log(`Signin status: ${signinRes.status}`);
  
  if (signinRes.ok && signinBody.access_token) {
    const token = signinBody.access_token;
    const userId = signinBody.user?.id;
    console.log(`Got access token, user ID: ${userId}`);
    
    // Try inserting staff_profiles with the user's own token
    console.log('Trying to insert staff_profiles with user token...');
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/staff_profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': `Bearer ${token}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        id: userId,
        email: EMAIL,
        display_name: 'Owner',
        role: 'super_admin',
      })
    });
    const insertBody = await insertRes.text();
    console.log(`Insert status: ${insertRes.status}`);
    console.log(`Insert body: ${insertBody.substring(0, 500)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
