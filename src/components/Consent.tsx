import { Lock, Zap, Info } from "lucide-react";
import type { Profile } from "../lib/types.ts";
import { CATEGORIES } from "./constants.ts";

interface Props {
  office: string;
  profile: Profile;
  share: Record<string, boolean>;
  setShare: (s: Record<string, boolean>) => void;
  onBack: () => void;
  onSend: () => void;
}

export function Consent({ office, profile, share, setShare, onBack, onSend }: Props) {
  const toggle = (id: string) => setShare({ ...share, [id]: !share[id] });

  return (
    <div className="lf-pad lf-scroll">
      <h3 className="lf-h-solo">Share with {office}?</h3>
      <p className="lf-note">
        Choose what to send. Your full profile stays on this phone — the office
        only receives the copy you approve below.
      </p>

      <div className="lf-consent">
        {CATEGORIES.map((c) => {
          const has = c.fields.some((f) => profile[f]);
          const on = share[c.id] ?? true;
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              className="lf-ctoggle"
              data-on={String(on)}
              data-locked={String(c.required)}
              disabled={c.required || !has}
              onClick={() => toggle(c.id)}
              type="button"
              role="switch"
              aria-checked={on}
            >
              <span className="lf-ctoggle-l">
                <Icon size={15} aria-hidden="true" /> {c.label}
              </span>
              {/* Visual knob is redundant with aria-checked — hide from AT */}
              <span className="lf-switch" data-on={String(on)} aria-hidden="true">
                <span className="lf-knob" />
              </span>
            </button>
          );
        })}
      </div>

      <div className="lf-priv">
        <Lock size={12} aria-hidden="true" /> End-to-end encrypted. The relay handles only ciphertext — cannot read what you share.
      </div>

      {/* Plain-language explainer — expandable so it doesn't crowd the consent flow */}
      <details
        style={{
          marginBottom: 4,
          fontSize: 11.5,
          color: "var(--ink-soft)",
          lineHeight: 1.55,
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontWeight: 600,
            color: "var(--cobalt)",
            listStyle: "none",
            userSelect: "none",
          }}
        >
          <Info size={12} /> How your data travels
        </summary>
        <div
          style={{
            marginTop: 8,
            padding: "10px 12px",
            background: "var(--line-2)",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <p style={{ margin: 0 }}>
            <strong>Your profile stays here.</strong> Your full profile is
            encrypted on this device. Only the categories you enabled above are
            included in what's sent.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Encrypted before leaving.</strong> The selected fields are
            encrypted on your device with a one-time session key shared only
            with {office}'s desk. The relay server sees ciphertext — not the
            contents.
          </p>
          <p style={{ margin: 0 }}>
            <strong>What the relay observes.</strong> The relay knows a
            check-in occurred, roughly when, and your device's IP address. It
            cannot read the fields you shared.
          </p>
          <p style={{ margin: 0 }}>
            <strong>{office} keeps what you send.</strong> Once {office}'s
            device decrypts the packet, they hold the information you approved.
            It may be added to your patient chart.
          </p>
        </div>
      </details>

      <div className="lf-actions">
        <button className="lf-secondary" onClick={onBack} type="button">Back</button>
        <button className="lf-primary lf-send" onClick={onSend} type="button">
          <Zap size={15} /> Send to front desk
        </button>
      </div>
    </div>
  );
}
