import Link from "next/link";
import { opsFetch } from "@/lib/ops/api";
import { formatNaira } from "@/lib/format-money";
import type { GiftTemplate } from "@/lib/ops/types";
import { AvailabilityToggle } from "./availability-toggle";

export default async function GiftsPage() {
  const gifts = await opsFetch<GiftTemplate[]>("/ops/gifts");
  const onSale = gifts.filter((gift) => gift.available).length;

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Gifts</h1>
          <p className="text-zinc-600">
            {onSale} on sale · {gifts.length} total
          </p>
        </div>
        <Link href="/ops/gifts/new" className="rounded bg-zinc-900 px-4 py-2 font-medium text-white">
          Add gift
        </Link>
      </div>

      {onSale === 0 && gifts.length > 0 && (
        <p className="mb-5 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          Nothing is on sale, so <span className="font-mono">/send</span> has an empty catalogue and
          no one can send anything. Put at least one gift on sale.
        </p>
      )}

      {gifts.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <p className="mb-1 font-medium">No gifts yet</p>
          <p className="mb-4 text-zinc-600">
            Add what your vendors sell. Nothing can be sent until there&rsquo;s at least one gift on
            sale.
          </p>
          <Link href="/ops/gifts/new" className="rounded bg-zinc-900 px-4 py-2 font-medium text-white">
            Add gift
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="w-full min-w-[640px] text-left">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs tracking-wide text-zinc-500 uppercase">
              <tr>
                <th className="px-4 py-2.5 font-medium">Gift</th>
                <th className="px-4 py-2.5 font-medium">Price</th>
                <th className="px-4 py-2.5 font-medium">How</th>
                <th className="px-4 py-2.5 font-medium">Photo</th>
                <th className="px-4 py-2.5 font-medium">On sale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {gifts.map((gift) => (
                <tr key={gift.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/ops/gifts/${gift.id}`}
                      className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                    >
                      {gift.name}
                    </Link>
                    <div className="text-zinc-500">{gift.category}</div>
                  </td>
                  <td className="px-4 py-3">{formatNaira(gift.basePrice)}</td>
                  <td className="px-4 py-3 text-zinc-600">
                    {gift.deliveryType === "vtu" ? "Sent to phone" : "Collected"}
                  </td>
                  <td className="px-4 py-3">
                    {gift.imageUrl ? (
                      <span className="text-zinc-600">Yes</span>
                    ) : (
                      <span className="text-amber-700">None</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <AvailabilityToggle id={gift.id} available={gift.available} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
