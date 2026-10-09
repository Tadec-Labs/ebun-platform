import Link from "next/link";
import { GiftForm } from "../gift-form";

export default function NewGiftPage() {
  return (
    <>
      <Link href="/ops/gifts" className="mb-3 inline-block text-zinc-600 hover:text-zinc-900">
        ← Gifts
      </Link>
      <h1 className="mb-1 text-lg font-semibold">Add a gift</h1>
      <p className="mb-6 text-zinc-600">
        It won&rsquo;t appear to senders until you put it on sale.
      </p>
      <GiftForm />
    </>
  );
}
