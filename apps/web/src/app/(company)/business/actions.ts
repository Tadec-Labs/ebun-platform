"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { BizApiError, bizFetch } from "@/lib/business/api";
import { clearBizSession, setBizSession } from "@/lib/business/session";
import {
  authConfigured,
  passwordSignIn,
  signUp,
} from "@/lib/business/supabase-auth";

export interface FormState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "app.ebun.com.ng";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function apiError(err: unknown): FormState {
  if (err instanceof BizApiError) return { error: err.messages.join(" ") };
  throw err;
}

export async function signInAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  if (!authConfigured()) return { error: "Sign-in isn't configured yet." };
  const email = field(form, "email").toLowerCase();
  const password = form.get("password");
  if (!email || typeof password !== "string" || !password)
    return { error: "Enter your email and password." };

  const tokens = await passwordSignIn(email, password);
  // One message for wrong password, unknown email and unverified email: never confirm which exist.
  if (!tokens)
    return {
      error: "Email or password is incorrect, or the email isn't verified yet.",
    };
  await setBizSession(
    tokens.accessToken,
    tokens.refreshToken,
    tokens.expiresIn,
  );
  redirect("/business");
}

export async function signUpAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  if (!authConfigured()) return { error: "Sign-up isn't configured yet." };
  const email = field(form, "email").toLowerCase();
  const password = form.get("password");
  if (!email || typeof password !== "string")
    return { error: "Enter your work email and a password." };
  if (password.length < 8)
    return { error: "Use at least 8 characters for your password." };

  const result = await signUp(
    email,
    password,
    `${await origin()}/business/login?verified=1`,
  );
  if (!result.ok) return { error: result.message };
  if (result.tokens) {
    await setBizSession(
      result.tokens.accessToken,
      result.tokens.refreshToken,
      result.tokens.expiresIn,
    );
    redirect("/business");
  }
  return {
    notice: `We've sent a link to ${email}. Open it to verify your email, then sign in.`,
  };
}

export async function signOutAction(): Promise<void> {
  await clearBizSession();
  redirect("/business/login");
}

export async function createCompanyAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    await bizFetch("/business/company", {
      method: "POST",
      body: { displayName: field(form, "displayName") },
    });
  } catch (err) {
    return apiError(err);
  }
  revalidatePath("/business");
  return {};
}

export async function inviteAction(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const email = field(form, "email");
  try {
    const r = await bizFetch<{ emailSent: boolean }>("/business/members", {
      method: "POST",
      body: { email },
    });
    revalidatePath("/business");
    return {
      notice: r.emailSent
        ? `Invite sent to ${email}.`
        : `${email} is invited, but the email didn't go out. Ask them to sign up at /business/signup.`,
    };
  } catch (err) {
    return apiError(err);
  }
}

export async function removeMemberAction(form: FormData): Promise<void> {
  try {
    await bizFetch(`/business/members/${field(form, "id")}`, {
      method: "DELETE",
    });
  } catch (err) {
    if (!(err instanceof BizApiError)) throw err;
  }
  revalidatePath("/business");
}

export async function newCampaignAction(): Promise<void> {
  const r = await bizFetch<{ portalPath: string }>("/business/campaigns", {
    method: "POST",
    body: {},
  });
  redirect(r.portalPath);
}

export async function openCampaignAction(form: FormData): Promise<void> {
  const r = await bizFetch<{ portalPath: string }>(
    `/business/campaigns/${field(form, "id")}/open`,
    { method: "POST" },
  );
  redirect(r.portalPath);
}
