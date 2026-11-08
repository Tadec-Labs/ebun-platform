import type { Metadata } from "next";
import { signUpAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = {
  title: "Create an account · SendEbun for companies",
};

export default function BusinessSignupPage() {
  return (
    <div className="mx-auto max-w-sm pt-6">
      <h1 className="mb-1 text-xl font-semibold">
        Gift your team and customers
      </h1>
      <p className="mb-6 text-zinc-600">
        Create your company&rsquo;s SendEbun account.
      </p>
      <AuthForm action={signUpAction} mode="signup" />
    </div>
  );
}
