/**
 * Shown the moment a tab is tapped, while the page loads — on a counter
 * phone's data connection that can be seconds, and a screen that doesn't
 * change reads as broken.
 */
export default function VendorLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-6 py-8" aria-busy="true" aria-label="Loading">
      <div>
        <div className="h-4 w-32 rounded bg-zinc-200" />
        <div className="mt-3 h-8 w-48 rounded-lg bg-zinc-200" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 rounded-lg border-2 border-zinc-100 bg-zinc-50" />
      ))}
    </div>
  );
}
