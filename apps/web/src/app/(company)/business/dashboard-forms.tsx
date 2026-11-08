"use client";

import { useActionState } from "react";
import { createCompanyAction, inviteAction, type FormState } from "./actions";

function Feedback({ state }: { state: FormState }) {
  if (state.error)
    return (
      <p role="alert" className="text-red-700">
        {state.error}
      </p>
    );
  if (state.notice) return <p className="text-emerald-800">{state.notice}</p>;
  return null;
}

export function CreateCompanyForm() {
  const [state, submit, pending] = useActionState(createCompanyAction, {});
  return (
    <form action={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-medium">Company name</span>
        <span className="text-zinc-500">
          Recipients see this: &ldquo;PayGo sent you a gift&rdquo;.
        </span>
        <input
          name="displayName"
          required
          minLength={2}
          maxLength={120}
          className="rounded border border-zinc-300 bg-white px-3 py-2"
        />
      </label>
      <Feedback state={state} />
      <button
        disabled={pending}
        className="self-start rounded bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create company"}
      </button>
    </form>
  );
}

export function InviteForm() {
  const [state, submit, pending] = useActionState(inviteAction, {});
  return (
    <form action={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="colleague@company.com"
          aria-label="Colleague's email"
          className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-3 py-2"
        />
        <button
          disabled={pending}
          className="rounded border border-zinc-300 bg-white px-3 py-2 font-medium disabled:opacity-50"
        >
          {pending ? "Inviting…" : "Invite"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
