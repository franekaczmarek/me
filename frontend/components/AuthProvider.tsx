"use client";

import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type AuthState = { session: Session | null; loading: boolean };

const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      setState({ session, loading: false }),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext value={state}>{children}</AuthContext>;
}

export function useAuth() {
  return useContext(AuthContext);
}

// Renders children only for logged-in users; otherwise redirects.
// requireAuth=false does the opposite (for login/signup pages).
export function AuthGate({
  requireAuth,
  children,
}: {
  requireAuth: boolean;
  children: React.ReactNode;
}) {
  const { session, loading } = useAuth();
  const router = useRouter();
  const allowed = requireAuth ? !!session : !session;

  useEffect(() => {
    if (!loading && !allowed) router.replace(requireAuth ? "/login" : "/timeline");
  }, [loading, allowed, requireAuth, router]);

  if (loading || !allowed) {
    return <div className="flex flex-1 items-center justify-center text-zinc-500">Loading…</div>;
  }
  return <>{children}</>;
}
