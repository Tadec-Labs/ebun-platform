import Link from "next/link";

const benefits = [
  {
    title: "Make it personal",
    body: "Choose something thoughtful and add the words that make it yours.",
  },
  {
    title: "Send with ease",
    body: "All you need is their WhatsApp number. No address required to send.",
  },
  {
    title: "A moment, not a code",
    body: "They receive a gift experience made to feel personal from the first tap.",
  },
];

export default function Home() {
  return (
    <main className="relative min-h-svh overflow-hidden bg-[#0e0d0b] px-6 py-6 text-[#f5efe0] sm:px-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 64% 45% at 50% -5%, rgba(201, 168, 76, 0.16), transparent 74%)",
        }}
      />

      <div className="relative mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-6xl flex-col">
        <header className="flex items-center justify-between py-2">
          <p
            className="text-sm tracking-[0.32em] text-[#c9a84c]"
            style={{ fontFamily: "Georgia, serif" }}
          >
            EBUN
          </p>
          <span className="text-xs text-[#f5efe0]/55">Gifting, made personal</span>
        </header>

        <section className="flex flex-1 flex-col justify-center py-16 sm:py-20">
          <p className="mb-5 text-xs font-medium tracking-[0.18em] text-[#c9a84c] uppercase">
            A more thoughtful way to show up
          </p>
          <h1
            className="max-w-3xl text-5xl leading-[0.92] tracking-[-0.04em] text-[#f5efe0] sm:text-7xl"
            style={{ fontFamily: "Georgia, serif" }}
          >
            Give them
            <br />
            a moment.
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-[#f5efe0]/70 sm:text-lg">
            Choose a real gift, make it personal, and send it straight to their WhatsApp.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/send"
              className="inline-flex min-h-13 items-center justify-center bg-[#c9a84c] px-6 text-sm font-semibold text-[#0e0d0b] transition-colors hover:bg-[#e2c07a] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5efe0] sm:w-fit"
            >
              Send a gift
              <span aria-hidden="true" className="ml-3 text-lg leading-none">
                →
              </span>
            </Link>
            <p className="flex items-center text-sm leading-6 text-[#f5efe0]/55 sm:max-w-52">
              It takes just a few minutes to make someone&rsquo;s day.
            </p>
          </div>
        </section>

        <section
          aria-label="How Ebun works"
          className="grid border-t border-[#c9a84c]/20 py-7 sm:grid-cols-3 sm:gap-8"
        >
          {benefits.map((benefit, index) => (
            <article
              key={benefit.title}
              className="grid grid-cols-[2rem_1fr] gap-x-3 border-b border-[#c9a84c]/15 py-5 last:border-b-0 sm:block sm:border-b-0 sm:py-0"
            >
              <span className="text-xs tracking-[0.12em] text-[#c9a84c]/70 sm:mb-5 sm:block">
                0{index + 1}
              </span>
              <div>
                <h2
                  className="text-xl text-[#f5efe0]"
                  style={{ fontFamily: "Georgia, serif" }}
                >
                  {benefit.title}
                </h2>
                <p className="mt-1.5 max-w-65 text-sm leading-6 text-[#f5efe0]/55">
                  {benefit.body}
                </p>
              </div>
            </article>
          ))}
        </section>

        <footer className="flex flex-col gap-2 pb-1 pt-5 text-xs text-[#f5efe0]/45 sm:flex-row sm:items-center sm:justify-between">
          <span>For gifts within Nigeria</span>
          <span>Secure checkout powered by Paystack</span>
        </footer>
      </div>
    </main>
  );
}
