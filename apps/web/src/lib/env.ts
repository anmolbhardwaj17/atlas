/**
 * Public web config (docs/12 §2.1). Only `NEXT_PUBLIC_*` vars - these are inlined
 * into the browser bundle and are safe to expose (the anon key is public by
 * design; never put the service-role key here). Lazy getters so a missing var
 * fails at use, not at module import during build.
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabaseAnonKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function apiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
}
