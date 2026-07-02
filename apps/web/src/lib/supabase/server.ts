import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/** Server Supabase client (docs/12 §3) bound to the request cookies. Reads the
 *  httpOnly session in server components / route handlers; cookie writes from a
 *  server component are no-ops (the middleware refreshes the session instead). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component (read-only cookies) - middleware refreshes.
        }
      },
    },
  });
}
