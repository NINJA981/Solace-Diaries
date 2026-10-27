/**
 * Daily Vercel cron (see vercel.json). Free Supabase projects pause after about a week
 * without activity, so this touches the database through the API's health check and
 * Supabase Auth directly. It also wakes the Render API before the morning traffic.
 */
const API_URL = process.env.VITE_API_URL || 'https://solace-api-vsac.onrender.com';

async function check(name, url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(55_000) });
    return { name, status: res.status, ok: res.ok };
  } catch (err) {
    return { name, status: 0, ok: false, error: String(err) };
  }
}

export async function GET(request) {
  // Vercel sends the CRON_SECRET as a bearer token; anything else is turned away.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const results = await Promise.all([
    check('api', `${API_URL.replace(/\/$/, '')}/api/healthz`),
    supabaseUrl && anonKey
      ? check('auth', `${supabaseUrl}/auth/v1/health`, { headers: { apikey: anonKey } })
      : { name: 'auth', status: 0, ok: false, error: 'Supabase env missing' },
  ]);
  const ok = results.every((r) => r.ok);
  return Response.json({ ok, results }, { status: ok ? 200 : 502 });
}

export const maxDuration = 60;
