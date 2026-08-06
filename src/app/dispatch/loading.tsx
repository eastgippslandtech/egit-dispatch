import { CommandCentreLogo } from "@/app/components/command-centre-logo";

export default function DispatchLoading() {
  return (
    <main className="min-h-screen bg-cc-canvas p-5 text-cc-text">
      <div
        aria-label="Loading Command Centre"
        className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-[1920px] flex-col gap-3"
        role="status"
      >
        <header className="flex h-14 items-center gap-3 border-b border-cc-border">
          <CommandCentreLogo
            className="h-10 w-10 object-contain"
            decorative
            variant="icon-colour"
          />
          <div>
            <p className="text-base font-semibold">Command Centre</p>
            <p className="text-xs text-cc-text-secondary">Loading live operations...</p>
          </div>
        </header>
        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              className="h-16 animate-pulse rounded border border-cc-border bg-cc-surface-1"
              key={index}
            />
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_330px] gap-3">
          <div className="animate-pulse rounded border border-cc-border bg-cc-surface-1" />
          <div className="animate-pulse rounded border border-cc-border bg-cc-surface-1" />
          <div className="animate-pulse rounded border border-cc-border bg-cc-surface-1" />
        </div>
      </div>
    </main>
  );
}
