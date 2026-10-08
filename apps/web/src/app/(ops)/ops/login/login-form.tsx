"use client";

import { useState, useTransition } from "react";
import { loginAction } from "../actions";

export function LoginForm() {
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setErrors([]);
        startTransition(async () => {
          // On success the action redirects, so there's no result to
          // handle; a returned value always means a failure.
          const result = await loginAction(formData);
          if (result && !result.ok) setErrors(result.errors);
        });
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-medium">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="rounded border border-zinc-300 bg-white px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border border-zinc-300 bg-white px-3 py-2"
        />
      </label>
      {errors.length > 0 && (
        <ul role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
