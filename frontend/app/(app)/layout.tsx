import { AppNav } from "@/components/AppNav";
import { AuthGate } from "@/components/AuthProvider";
import { ProfileMenu } from "@/components/ProfileMenu";

// Shell for all logged-in pages: module tabs + profile menu.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate requireAuth>
      <div className="flex min-h-full flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-6">
            <span className="text-lg font-semibold tracking-tight">Me</span>
            <AppNav />
          </div>
          <ProfileMenu />
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </AuthGate>
  );
}
