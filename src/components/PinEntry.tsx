import { useState } from "react";
import { Lock } from "lucide-react";

interface Props {
  title: string;
  subtitle: string;
  error?: string;
  onSubmit: (pin: string) => void;
  onBack: () => void;
}

export function PinEntry({ title, subtitle, error, onSubmit, onBack }: Props) {
  const [pin, setPin] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setPin(e.target.value.replace(/\D/g, "").slice(0, 4));

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
        <span>4-digit PIN</span>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={handleChange}
          placeholder="••••"
          autoFocus
          style={{ letterSpacing: "0.3em", fontSize: "20px", textAlign: "center" }}
        />
      </label>

      <div className="lf-actions">
        <button className="lf-secondary" onClick={onBack} type="button">Back</button>
        <button
          className="lf-primary"
          disabled={pin.length !== 4}
          onClick={() => onSubmit(pin)}
          type="button"
        >
          <Lock size={15} /> Confirm
        </button>
      </div>
    </div>
  );
}
