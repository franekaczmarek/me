import { createClient } from "@supabase/supabase-js";

// Browser Supabase client. Used for auth only; data goes through the FastAPI backend.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
);
