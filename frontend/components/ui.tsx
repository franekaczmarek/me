// Small shared form primitives.

export function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <input
        {...props}
        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300"
      />
    </label>
  );
}

export function Button({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${className}`}
    />
  );
}

export function Message({ kind, children }: { kind: "error" | "info"; children: React.ReactNode }) {
  const color =
    kind === "error"
      ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
      : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  return <p className={`rounded-md px-3 py-2 text-sm ${color}`}>{children}</p>;
}
