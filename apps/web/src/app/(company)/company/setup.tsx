"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatNaira } from "@/lib/format-money";
import type {
  AddPeopleResult,
  Campaign,
  CampaignCatalogueItem,
  CampaignPerson,
} from "@/lib/company/api";
import { useMediaRecorder } from "@/lib/media-recording/use-media-recorder";
import {
  addPeopleAction,
  checkoutAction,
  clearMessageAction,
  clearPeopleAction,
  removePersonAction,
  reopenAction,
  saveDetailsAction,
  setGiftsAction,
} from "./actions";

/** Vercel refuses bigger request bodies; the in-browser recorder stays well under it. */
const MAX_UPLOAD_BYTES = 4_000_000;

/**
 * Setting up a campaign, top to bottom: the message, the gift, the
 * people, then paying. Each section saves on its own, so HR can do the
 * list today and the CEO's video tomorrow. Once checkout starts the API
 * freezes everything (what's charged is what's on screen), and this page
 * says so rather than offering edits that would fail.
 */
export function CampaignSetup({
  campaign,
  catalogue,
  people,
}: {
  campaign: Campaign;
  catalogue: CampaignCatalogueItem[];
  people: CampaignPerson[];
}) {
  const locked = campaign.status !== "draft";
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{campaign.companyName}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{campaign.title}</h1>
        <p className="mt-1 text-zinc-600">
          Four steps: your message, the gift, who it&rsquo;s for, then one payment. Each step saves on its own.
        </p>
      </div>

      {locked && <LockedNotice />}

      <Section number={1} title="Your message" done={campaign.missing.every((m) => !m.includes("message"))}>
        <MessageStep campaign={campaign} locked={locked} />
      </Section>

      <Section number={2} title="The gift" done={campaign.options.length > 0}>
        <GiftStep campaign={campaign} catalogue={catalogue} locked={locked} />
      </Section>

      <Section number={3} title="Who it's for" done={campaign.recipientsCount > 0}>
        <PeopleStep campaign={campaign} people={people} locked={locked} />
      </Section>

      <Section number={4} title="Review and pay" done={false}>
        <PayStep campaign={campaign} />
      </Section>
    </div>
  );
}

function LockedNotice() {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-950">
      Payment has started, so this campaign is locked — what you pay for is exactly what&rsquo;s below. Use
      &ldquo;Change something&rdquo; at the bottom to edit it again.
    </div>
  );
}

function Section({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <header className="flex items-center gap-3 border-b border-zinc-100 px-5 py-3.5">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
            done ? "bg-emerald-600 text-white" : "bg-zinc-900 text-white"
          }`}
        >
          {done ? "✓" : number}
        </span>
        <h2 className="font-semibold">{title}</h2>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Errors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul role="alert" className="list-disc rounded-lg border border-red-200 bg-red-50 py-2 pr-3 pl-8 text-red-800">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-zinc-900 disabled:bg-zinc-50 disabled:text-zinc-500";
const primary =
  "rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50";
const secondary =
  "rounded-lg border border-zinc-300 bg-white px-4 py-2 font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50";

/** ISO -> value for <input type="datetime-local"> in the viewer's own time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ------------------------------------------------------------------ 1

function MessageStep({ campaign, locked }: { campaign: Campaign; locked: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(campaign.title);
  const [from, setFrom] = useState(campaign.senderDisplayName ?? "");
  const [text, setText] = useState(campaign.message.text ?? "");
  const [when, setWhen] = useState<"now" | "later">(campaign.sendAt ? "later" : "now");
  const [sendAt, setSendAt] = useState(toLocalInput(campaign.sendAt));
  const [days, setDays] = useState(campaign.giftDays);
  const [mode, setMode] = useState<"text" | "voice" | "video">(campaign.message.type);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function save() {
    setErrors([]);
    setSaved(false);
    start(async () => {
      if (when === "later" && !sendAt) {
        setErrors(["Choose when the gifts go out."]);
        return;
      }
      const result = await saveDetailsAction({
        title: title.trim(),
        senderDisplayName: from.trim(),
        messageText: text.trim(),
        sendAt: when === "later" ? new Date(sendAt).toISOString() : null,
        giftDays: days,
      });
      if (!result.ok) setErrors(result.errors);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">What it&rsquo;s for</span>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={locked} placeholder="Thank you for an amazing 2026" />
          <span className="text-xs text-zinc-500">The headline people see when they open it.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Who it&rsquo;s from</span>
          <input className={input} value={from} onChange={(e) => setFrom(e.target.value)} maxLength={120} disabled={locked} placeholder="Ada Obi, CEO" />
          <span className="text-xs text-zinc-500">Leave blank to say {campaign.companyName}.</span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-medium">The message</span>
        <div className="flex gap-1 self-start rounded-lg bg-zinc-100 p-1">
          {(["text", ...(campaign.mediaEnabled ? (["video", "voice"] as const) : [])] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={locked}
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === m ? "bg-white shadow-sm" : "text-zinc-600"}`}
            >
              {m === "text" ? "Write" : m === "video" ? "Video" : "Voice note"}
            </button>
          ))}
        </div>
        {mode === "text" ? (
          <>
            <textarea
              className={`${input} min-h-28`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              disabled={locked}
              placeholder="Thank you for everything you did this year…"
            />
            {campaign.message.type !== "text" && (
              <p className="text-xs text-amber-800">
                Saving a written message here keeps your recording too — remove the recording to send text only.
              </p>
            )}
          </>
        ) : (
          <Recorder kind={mode} campaign={campaign} locked={locked} />
        )}
        {mode !== "text" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-zinc-600">A line to go with it (optional)</span>
            <input className={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} disabled={locked} />
          </label>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 font-medium">When it goes out</legend>
          <label className="flex items-center gap-2">
            <input type="radio" checked={when === "now"} onChange={() => setWhen("now")} disabled={locked} />
            As soon as it&rsquo;s paid
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={when === "later"} onChange={() => setWhen("later")} disabled={locked} />
            On a date
          </label>
          {when === "later" && (
            <input type="datetime-local" className={input} value={sendAt} onChange={(e) => setSendAt(e.target.value)} disabled={locked} />
          )}
        </fieldset>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Time to claim it</span>
          <select className={input} value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={locked}>
            {[14, 30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">Unclaimed gifts after this are credited back to you.</span>
        </label>
      </div>

      <Errors errors={errors} />
      {!locked && (
        <div className="flex items-center gap-3">
          <button type="button" className={primary} onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-emerald-700">Saved.</span>}
        </div>
      )}
    </div>
  );
}

function Recorder({ kind, campaign, locked }: { kind: "voice" | "video"; campaign: Campaign; locked: boolean }) {
  const router = useRouter();
  const maxSecs = kind === "video" ? 30 : 60;
  const { status, elapsedSecs, recorded, stream, start, stop, reset } = useMediaRecorder({
    kind: kind === "video" ? "video" : "audio",
    maxDurationSecs: maxSecs,
  });
  const preview = useRef<HTMLVideoElement | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (preview.current) preview.current.srcObject = stream;
  }, [stream]);

  const current = campaign.message.type === kind ? campaign.message.playbackUrl : null;

  async function upload() {
    if (!recorded) return;
    if (recorded.blob.size > MAX_UPLOAD_BYTES) {
      setErrors(["That recording is too large to send. Please record a shorter one."]);
      return;
    }
    setErrors([]);
    setBusy(true);
    const form = new FormData();
    form.set("kind", kind);
    form.set("durationSecs", String(Math.max(1, Math.round(recorded.durationSecs))));
    form.set("media", recorded.blob, kind === "video" ? "message.mp4" : "message.m4a");
    try {
      const res = await fetch("/company/upload-message", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        setErrors([Array.isArray(body.message) ? body.message[0] : (body.message ?? "Couldn't save it. Try again.")]);
        return;
      }
      reset();
      router.refresh();
    } catch {
      setErrors(["Couldn't reach SendEbun. Check your connection and try again."]);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    const result = await clearMessageAction();
    setBusy(false);
    if (!result.ok) setErrors(result.errors);
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      {current && !recorded && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-emerald-800">Saved — this is what people will see.</p>
          {kind === "video" ? (
            <video src={current} controls playsInline className="max-h-72 w-full rounded-lg bg-black" />
          ) : (
            <audio src={current} controls className="w-full" />
          )}
          {!locked && (
            <button type="button" className={`${secondary} self-start`} onClick={remove} disabled={busy}>
              Remove recording
            </button>
          )}
        </div>
      )}

      {!locked && (
        <>
          {status === "unsupported" && <p>Recording isn&rsquo;t supported in this browser. Try Chrome or Safari on a phone.</p>}
          {status === "permission-denied" && (
            <p>Allow the {kind === "video" ? "camera and microphone" : "microphone"} for this site, then try again.</p>
          )}
          {kind === "video" && status === "recording" && (
            <video ref={preview} autoPlay muted playsInline className="max-h-72 w-full rounded-lg bg-black" />
          )}
          {recorded && (
            kind === "video" ? (
              <video src={recorded.url} controls playsInline className="max-h-72 w-full rounded-lg bg-black" />
            ) : (
              <audio src={recorded.url} controls className="w-full" />
            )
          )}
          <div className="flex flex-wrap items-center gap-2">
            {status !== "recording" && !recorded && (
              <button type="button" className={primary} onClick={() => void start()}>
                {current ? "Record a new one" : kind === "video" ? "Record video" : "Record voice note"}
              </button>
            )}
            {status === "recording" && (
              <button type="button" className={primary} onClick={stop}>
                Stop · {elapsedSecs}s / {maxSecs}s
              </button>
            )}
            {recorded && (
              <>
                <button type="button" className={primary} onClick={() => void upload()} disabled={busy}>
                  {busy ? "Saving…" : "Use this"}
                </button>
                <button type="button" className={secondary} onClick={reset} disabled={busy}>
                  Record again
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            Up to {maxSecs} seconds. Record on a phone held upright, somewhere quiet.
          </p>
        </>
      )}
      <Errors errors={errors} />
    </div>
  );
}

// ------------------------------------------------------------------ 2

function GiftStep({
  campaign,
  catalogue,
  locked,
}: {
  campaign: Campaign;
  catalogue: CampaignCatalogueItem[];
  locked: boolean;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>(campaign.options.map((o) => o.giftTemplateId));
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const changed =
    chosen.length !== campaign.options.length ||
    chosen.some((id, i) => campaign.options[i]?.giftTemplateId !== id);

  // Options already chosen but since gone off sale stay visible, so they can be removed.
  const items = useMemo(() => {
    const ids = new Set(catalogue.map((c) => c.id));
    const gone = campaign.options
      .filter((o) => !ids.has(o.giftTemplateId))
      .map((o) => ({
        id: o.giftTemplateId,
        name: o.name,
        description: o.description,
        category: "",
        imageUrl: o.imageUrl,
        deliveryType: o.deliveryType,
        giftValue: o.giftValue,
        deliveryFee: o.deliveryFee,
        seatPrice: o.seatPrice,
        unavailable: true,
      }));
    return [...gone, ...catalogue.map((c) => ({ ...c, unavailable: false }))];
  }, [catalogue, campaign.options]);

  function toggle(id: string) {
    setChosen((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : current.length >= 3 ? current : [...current, id],
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-zinc-600">
        Pick one gift for everyone, or up to three and let each person choose. Everyone&rsquo;s gift is priced at
        the dearest option you pick, so they can choose freely; if someone picks a cheaper one, the difference is
        credited back to you.
      </p>
      {catalogue.length === 0 && (
        <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-zinc-600">
          No gifts are available right now. SendEbun will be in touch.
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const on = chosen.includes(item.id);
          const full = !on && chosen.length >= 3;
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={locked || full}
                onClick={() => toggle(item.id)}
                aria-pressed={on}
                className={`flex h-full w-full flex-col overflow-hidden rounded-xl border text-left transition-colors disabled:opacity-60 ${
                  on ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200 hover:border-zinc-400"
                }`}
              >
                <div className="flex h-32 items-center justify-center bg-zinc-100">
                  {item.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- R2 gift photos
                    <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-3xl">🎁</span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-zinc-500">
                    {item.deliveryType === "physical" ? "Delivered to their door" : "Collected at a partner"}
                  </p>
                  <p className="mt-auto pt-1 font-semibold tabular-nums">
                    {formatNaira(item.seatPrice)}
                    {item.deliveryFee > 0 && (
                      <span className="ml-1 text-xs font-normal text-zinc-500">incl. {formatNaira(item.deliveryFee)} delivery</span>
                    )}
                  </p>
                  {item.unavailable && <p className="text-xs font-medium text-red-700">No longer available — remove it.</p>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <Errors errors={errors} />
      {!locked && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={primary}
            disabled={pending || chosen.length === 0 || !changed}
            onClick={() =>
              start(async () => {
                setErrors([]);
                const result = await setGiftsAction(chosen);
                if (!result.ok) setErrors(result.errors);
                else router.refresh();
              })
            }
          >
            {pending ? "Saving…" : chosen.length > 1 ? `Offer these ${chosen.length}` : "Use this gift"}
          </button>
          <span className="text-zinc-500">{chosen.length}/3 chosen</span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 3

function PeopleStep({
  campaign,
  people,
  locked,
}: {
  campaign: Campaign;
  people: CampaignPerson[];
  locked: boolean;
}) {
  const router = useRouter();
  const [list, setList] = useState("");
  const [result, setResult] = useState<AddPeopleResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [pending, start] = useTransition();
  const shown = showAll ? people : people.slice(0, 25);

  return (
    <div className="flex flex-col gap-4">
      {!locked && (
        <>
          <p className="text-zinc-600">
            Paste from Excel or Google Sheets, or upload a CSV. Columns: <strong>name</strong>, <strong>phone</strong>,
            and ideally <strong>email</strong> (we email each person their link). An optional <strong>note</strong>{" "}
            column — team, city — comes back in your report.
          </p>
          <textarea
            className={`${input} min-h-32 font-mono text-xs`}
            value={list}
            onChange={(e) => setList(e.target.value)}
            placeholder={"name,phone,email,note\nAda Obi,08031234567,ada@company.ng,Finance"}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={primary}
              disabled={pending || !list.trim()}
              onClick={() =>
                start(async () => {
                  setErrors([]);
                  const res = await addPeopleAction(list);
                  if (!res.ok) {
                    setErrors(res.errors);
                    return;
                  }
                  setResult(res.data);
                  setList("");
                  router.refresh();
                })
              }
            >
              {pending ? "Adding…" : "Add to list"}
            </button>
            <label className={`${secondary} cursor-pointer`}>
              Upload CSV
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) setList(await file.text());
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </>
      )}

      {result && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
          <p>
            Added <strong>{result.added}</strong>
            {result.alreadyOnList > 0 && <> · {result.alreadyOnList} already on the list</>} · {result.total} in total.
          </p>
          {result.problems.length > 0 && (
            <>
              <p className="mt-2 font-medium text-amber-900">These lines weren&rsquo;t added — fix them and paste them again:</p>
              <ul className="mt-1 list-disc pl-5 text-amber-900">
                {result.problems.map((p) => (
                  <li key={`${p.line}-${p.reason}`}>
                    Line {p.line}: {p.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <Errors errors={errors} />

      <div className="flex items-center justify-between">
        <p className="font-medium">
          {campaign.recipientsCount} {campaign.recipientsCount === 1 ? "person" : "people"}
        </p>
        {!locked && people.length > 0 && (
          <button
            type="button"
            className="text-xs text-red-700 hover:underline"
            onClick={() =>
              start(async () => {
                if (!window.confirm(`Remove all ${people.length} people from the list?`)) return;
                const res = await clearPeopleAction();
                if (!res.ok) setErrors(res.errors);
                else router.refresh();
              })
            }
          >
            Clear the list
          </button>
        )}
      </div>
      {people.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full min-w-[560px] text-left">
            <thead className="bg-zinc-50 text-xs text-zinc-500 uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Note</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {shown.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 tabular-nums">{p.phone}</td>
                  <td className="px-3 py-2">{p.email ?? <span className="text-amber-700">No email — share from link sheet</span>}</td>
                  <td className="px-3 py-2 text-zinc-600">{p.note}</td>
                  <td className="px-3 py-2 text-right">
                    {!locked && (
                      <button
                        type="button"
                        className="text-xs text-zinc-500 hover:text-red-700"
                        onClick={() =>
                          start(async () => {
                            const res = await removePersonAction(p.id);
                            if (!res.ok) setErrors(res.errors);
                            else router.refresh();
                          })
                        }
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {people.length > 25 && (
        <button type="button" className="self-start text-xs text-zinc-600 underline" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${people.length}`}
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ 4

function PayStep({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const q = campaign.quote;

  function pay() {
    start(async () => {
      setErrors([]);
      if (campaign.status === "awaiting_payment") {
        const reopened = await reopenAction();
        if (!reopened.ok) {
          setErrors(reopened.errors);
          return;
        }
      }
      const result = await checkoutAction();
      if (!result.ok) {
        setErrors(result.errors);
        router.refresh();
        return;
      }
      window.location.href = result.data.checkoutUrl;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {q ? (
        <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2">
          <dt className="text-zinc-600">
            {q.recipients} {q.recipients === 1 ? "gift" : "gifts"} × {formatNaira(q.seatPrice)}
          </dt>
          <dd className="text-right tabular-nums">{formatNaira(q.giftTotal)}</dd>
          <dt className="text-zinc-600">SendEbun fee ({q.feeBps / 100}%)</dt>
          <dd className="text-right tabular-nums">{formatNaira(q.fee)}</dd>
          <dt className="border-t border-zinc-200 pt-2 font-semibold">Total</dt>
          <dd className="border-t border-zinc-200 pt-2 text-right text-lg font-semibold tabular-nums">
            {formatNaira(q.amountDue)}
          </dd>
        </dl>
      ) : (
        <p className="text-zinc-600">Choose a gift to see the total.</p>
      )}

      {campaign.missing.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
          <p className="font-medium">Before you pay:</p>
          <ul className="mt-1 list-disc pl-5 text-zinc-700">
            {campaign.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-zinc-500">
        You pay once, by card or bank transfer, through Paystack. Gifts unclaimed after{" "}
        {campaign.giftDays} days — and the difference when someone picks a cheaper option — are credited to your next
        campaign. A receipt comes from Paystack to {campaign.contactEmail}.
      </p>

      <Errors errors={errors} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={primary}
          disabled={pending || (campaign.status === "draft" && campaign.missing.length > 0) || !q}
          onClick={pay}
        >
          {pending ? "Opening Paystack…" : q ? `Pay ${formatNaira(q.amountDue)}` : "Pay"}
        </button>
        {campaign.status === "awaiting_payment" && (
          <button
            type="button"
            className={secondary}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await reopenAction();
                if (!res.ok) setErrors(res.errors);
                else router.refresh();
              })
            }
          >
            Change something
          </button>
        )}
      </div>
    </div>
  );
}

/** After Paystack sends them back: wait for the webhook to confirm, re-reading every few seconds. */
export function ConfirmingPayment() {
  const router = useRouter();
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (waited >= 40) return;
    const t = setTimeout(() => {
      router.refresh();
      setWaited((w) => w + 1);
    }, 3000);
    return () => clearTimeout(t);
  }, [waited, router]);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-5 py-6 text-center shadow-sm">
      <p className="text-lg font-semibold">Confirming your payment…</p>
      <p className="mt-1 text-zinc-600">
        {waited < 40
          ? "This usually takes a few seconds. Keep this page open."
          : "It's taking longer than usual. If you paid, you'll get an email from Paystack — refresh this page in a few minutes."}
      </p>
    </div>
  );
}
