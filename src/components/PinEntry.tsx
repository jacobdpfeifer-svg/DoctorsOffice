import { useState } from "react";
import { Lock } from "lucide-react";

interface Props {
  title: string;
  subtitle: string;
  /** Minimum passphrase length. Defaults to 6. */
  minLength?: number;
  /** When true, disables the form and shows a deriving-key spinner. */
  isLoading?: boolean;
  error?: string;
  onSubmit: (passphrase: string) => void;
  onBack: () => void;
}

const DEFAULT_MIN = 6;

export function PinEntry({
  title,
  subtitle,
  minLength = DEFAULT_MIN,
  isLoading = false,
  error,
  onSubmit,
  onBack,
}: Props) {
  const [value, setValue] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setValue(e.target.value.slice(0, 128)); // generous upper bound

  const canSubmit = value.length >= minLength && !isLoading;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && canSubmit) onSubmit(value);
  };

  return (
    <div className="lf-pad lf-scroll">
      <h3 className="lf-h-solo">{title}</h3>
      <p className="lf-note">{subtitle}</p>

      {error && (
        <p style={{ color: "var(--clay)", fontSize: "13px", fontWeight: 600, margin: "0 0 12px" }}>
          {error}
        </p>
      )}

      <label className="lf-field">
        <span>Passphrase (min {minLength} characters)</span>
        <input
          type="password"
          inputMode="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="••••••"
          autoFocus
          autoComplete="current-password"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={isLoading}
          style={{ letterSpacing: "0.2em", fontSize: "20px", textAlign: "center" }}
        />
      </label>

      {isLoading && (
        <p style={{ fontSize: 12, color: "var(--mute)", textAlign: "center", margin: "6px 0 0" }}>
          Deriving key… this takes a moment to protect your data.
        </p>
      )}

      <div className="lf-actions">
        <button
          className="lf-secondary"
          onClick={onBack}
          type="button"
          disabled={isLoading}
        >
          Back
        </button>
        <button
          className="lf-primary"
          disabled={!canSubmit}
          onClick={() => onSubmit(value)}
          type="button"
        >
          {isLoading ? (
            <><span className="lf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> Working…</>
          ) : (
            <><Lock size={15} /> Confirm</>
          )}
        </button>
      </div>
    </div>
  );
}
