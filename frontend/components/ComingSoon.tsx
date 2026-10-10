// Placeholder for modules that are not built yet.
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-zinc-500">Coming soon.</p>
    </div>
  );
}
