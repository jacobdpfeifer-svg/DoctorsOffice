import { useState } from "react";
import { Zap } from "lucide-react";

interface Props {
  error?: string;
  onSubmit: (code: string) => void;
  onBack: () => void;
}

export function CodeEntry({ error, onSubmit, onBack }: Props) {
  const [code, setCode] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setCode(e.target.value.replace(/\D/g, "").slice(0, 4));

  return (
    <div className="lf-pad lf-scroll">
      <h3 className="lf-h-solo">Enter desk code</h3>
      <p className="lf-note">
        Enter the 4-digit code shown on the front-desk screen to send your
        approved info directly to the office.
      </p>

      {error && (
        <p style={{ color: "var(--clay)", fontSize: "13px", fontWeight: 600, margin: "0 0 12px" }}>
          {error}
        </p>
      )}

      <label className="lf-field">
        <span>Pairing code</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={code}
          onChange={handleChange}
          placeholder="0000"
          autoFocus
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: "0.4em",
            fontSize: "22px",
            textAlign: "center",
          }}
        />
      </label>

      <div className="lf-actions">
        <button className="lf-secondary" onClick={onBack} type="button">Back</button>
        <button
          className="lf-primary lf-send"
          disabled={code.length !== 4}
          onClick={() => onSubmit(code)}
          type="button"
        >
          <Zap size={15} /> Send
        </button>
      </div>
    </div>
  );
}
