"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Feedback primitives for the working tools (ops and the vendor link):
 * a spinner, a modal, a confirm dialog that replaces window.confirm, a
 * step-by-step progress dialog for multi-part saves, and toasts.
 *
 * The point of all of them is the same: every tap gets an immediate,
 * visible answer. A button that does nothing for two seconds on a Lagos
 * 4G connection gets tapped again, and a vendor who isn't sure their
 * photo saved will ask on WhatsApp — or stop trusting the screen.
 *
 * Modals use the native <dialog> element: focus is trapped, Escape
 * closes, and the page behind is inert, with no library.
 */

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** False while something is in flight: no Escape, no backdrop click. */
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-zinc-950/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-6">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <div className="mt-2">{children}</div>
      </div>
    </dialog>
  );
}

type ConfirmOptions = {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  tone?: "default" | "danger";
};

/**
 * `const [confirm, confirmDialog] = useConfirm();` then
 * `if (!(await confirm({ title: "Delete this gift?" }))) return;` and
 * render `{confirmDialog}` once. A styled, keyboard-friendly replacement
 * for window.confirm, which looks like a browser error on most phones.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };

  const dialog = (
    <Modal open={options !== null} onClose={() => settle(false)} title={options?.title ?? ""}>
      {options?.body && <div className="text-sm leading-relaxed text-zinc-600">{options.body}</div>}
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => settle(false)}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => settle(true)}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
            options?.tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-zinc-900 hover:bg-zinc-800"
          }`}
        >
          {options?.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </Modal>
  );

  return [confirm, dialog];
}

export type ProgressStep = { label: string; state: "pending" | "active" | "done" | "error"; detail?: string };

/** "Saving gift ✓ · Uploading photo … · Linking partner" — for saves that are several requests. */
export function ProgressDialog({ open, title, steps }: { open: boolean; title: string; steps: ProgressStep[] }) {
  return (
    <Modal open={open} onClose={() => undefined} title={title} dismissible={false}>
      <ol className="mt-3 flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.label} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
              {step.state === "active" && <Spinner className="h-4 w-4 text-zinc-900" />}
              {step.state === "done" && <span className="text-emerald-600">✓</span>}
              {step.state === "error" && <span className="text-red-600">!</span>}
              {step.state === "pending" && <span className="h-2 w-2 rounded-full bg-zinc-300" />}
            </span>
            <span>
              <span className={step.state === "pending" ? "text-zinc-400" : "text-zinc-900"}>{step.label}</span>
              {step.detail && <span className="block text-xs text-red-700">{step.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

type Toast = { id: number; tone: "success" | "error"; text: string };
type ToastApi = { success: (text: string) => void; error: (text: string) => void };

const ToastContext = createContext<ToastApi | null>(null);

/** Outside a provider (e.g. a test or a page without one) toasts quietly do nothing. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { success: () => undefined, error: () => undefined };
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-2), { id, tone, text }]);
    // Errors stay longer: they usually need reading, not just noticing.
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), tone === "error" ? 8000 : 3500);
  }, []);

  const [api] = useState<ToastApi>(() => ({
    success: (text) => push("success", text),
    error: (text) => push("error", text),
  }));

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl px-4 py-3 text-sm shadow-lg ring-1 ${
              toast.tone === "error"
                ? "bg-white text-red-800 ring-red-200"
                : "bg-zinc-900 text-white ring-zinc-900"
            }`}
          >
            <span aria-hidden="true">{toast.tone === "error" ? "!" : "✓"}</span>
            <span>{toast.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
