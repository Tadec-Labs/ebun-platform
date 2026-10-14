/**
 * Shown the instant an ops link is tapped, while the server fetches the
 * page — instead of the old page sitting there looking frozen. Shaped
 * like a typical ops page (header, a row of cards, a table) so the swap
 * to real content doesn't jump.
 */
export default function OpsLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="h-7 w-48 rounded-lg bg-zinc-200" />
          <div className="mt-2 h-4 w-72 rounded bg-zinc-200/70" />
        </div>
        <div className="h-9 w-28 rounded-lg bg-zinc-200" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl border border-zinc-200 bg-white" />
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-zinc-100 px-5 py-4 last:border-0">
            <div className="h-10 w-10 rounded-lg bg-zinc-200" />
            <div className="flex-1">
              <div className="h-4 w-1/3 rounded bg-zinc-200" />
              <div className="mt-2 h-3 w-1/4 rounded bg-zinc-200/70" />
            </div>
            <div className="h-6 w-20 rounded-full bg-zinc-200" />
          </div>
        ))}
      </div>
    </div>
  );
}
