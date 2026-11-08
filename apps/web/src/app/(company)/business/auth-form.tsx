"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "./actions";

/** Sign-in and sign-up share one form: email, password, one button. */
export function AuthForm({
  action,
  mode,
  defaultEmail,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  mode: "signin" | "signup";
  defaultEmail?: string;
}) {
  const [state, submit, pending] = useActionState(action, {});
  const signup = mode === "signup";

  if (state.notice) {
    return (
      <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-3 text-emerald-900">
        {state.notice}
      </p>
    );
  }

  return (
    <form action={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-medium">{signup ? "Work email" : "Email"}</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={defaultEmail}
          className="rounded border border-zinc-300 bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Password</span>
        <input
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          minLength={signup ? 8 : undefined}
          required
          className="rounded border border-zinc-300 bg-white px-3 py-2"
        />
      </label>
      {state.error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800"
        >
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {pending ? "One moment…" : signup ? "Create account" : "Sign in"}
      </button>
      <p className="text-center text-zinc-600">
        {signup ? (
          <>
            Have an account?{" "}
            <Link href="/business/login" className="underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href="/business/signup" className="underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
