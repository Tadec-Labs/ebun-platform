import { CheckGlyph } from "./icons";

type StepState = "done" | "current" | "upcoming";

interface StatusLineProps {
  steps: { label: string; state: StepState }[];
}

export function StatusLine({ steps }: StatusLineProps) {
  return (
    <div className="flex w-full items-start">
      {steps.map((step, i) => (
        <div key={step.label} className="flex flex-1 flex-col items-center gap-2 last:flex-none">
          <div className="flex w-full items-center">
            {i > 0 && (
              <span
                className="h-px flex-1"
                style={{
                  background:
                    step.state === "upcoming" ? "var(--border)" : "var(--gold-dim)",
                }}
              />
            )}
            <span
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border"
              style={{
                borderColor: step.state === "upcoming" ? "var(--border-strong)" : "var(--gold)",
                background: step.state === "current" ? "var(--gold)" : "transparent",
              }}
            >
              {step.state === "done" && (
                <CheckGlyph className="h-3 w-3 text-[color:var(--gold)]" />
              )}
              {step.state === "current" && (
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--ink)" }}
                />
              )}
            </span>
          </div>
          <span
            className="text-center text-[10px] tracking-wide"
            style={{
              color: step.state === "upcoming" ? "var(--cream-faint)" : "var(--cream-dim)",
            }}
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
