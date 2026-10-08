import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/ops/login">) {
  const params = await searchParams;
  const expired = params.reason === "session";

  return (
    <div className="mx-auto max-w-sm pt-10">
      <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-6 text-zinc-600">Ebun staff only.</p>
      {expired && (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          Your session ended. Sign in again to continue.
        </p>
      )}
      <LoginForm />
    </div>
  );
}
