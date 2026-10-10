import { AuthGate } from "@/components/AuthProvider";

// Centered card for login / signup. Logged-in users are sent to the app.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate requireAuth={false}>
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
          <p className="mb-6 text-center text-2xl font-semibold tracking-tight">Me</p>
          {children}
        </div>
      </div>
    </AuthGate>
  );
}
