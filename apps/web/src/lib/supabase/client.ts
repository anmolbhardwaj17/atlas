import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/** Browser Supabase client (docs/12 §2.1). Used by client components to start the
 *  Google OAuth flow and read the live session. */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
