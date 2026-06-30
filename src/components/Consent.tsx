import { Lock, Zap } from "lucide-react";
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
            >
              <span className="lf-ctoggle-l"><Icon size={15} /> {c.label}</span>
              <span className="lf-switch" data-on={String(on)}>
                <span className="lf-knob" />
              </span>
            </button>
          );
        })}
      </div>

      <div className="lf-priv">
        <Lock size={12} /> Nothing is saved to our servers. Transmitted directly to the office.
      </div>

      <div className="lf-actions">
        <button className="lf-secondary" onClick={onBack} type="button">Back</button>
        <button className="lf-primary lf-send" onClick={onSend} type="button">
          <Zap size={15} /> Send to front desk
        </button>
      </div>
    </div>
  );
}
