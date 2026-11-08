import type { Metadata } from "next";
import { signInAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in · SendEbun for companies" };

export default async function BusinessLoginPage({
  searchParams,
}: PageProps<"/business/login">) {
  const params = await searchParams;
  return (
    <div className="mx-auto max-w-sm pt-6">
      <h1 className="mb-6 text-xl font-semibold">Sign in</h1>
      {params.verified === "1" && (
        <p className="mb-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
          Email verified. Sign in to continue.
        </p>
      )}
      {params.reason === "session" && (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          Your session ended. Sign in again.
        </p>
      )}
      <AuthForm action={signInAction} mode="signin" />
    </div>
  );
}
