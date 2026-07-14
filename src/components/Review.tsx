import { Check, ShieldCheck, Lock, Pencil, ChevronRight } from "lucide-react";
import type { Profile } from "../lib/types.ts";
import { CATEGORIES } from "./constants.ts";

interface Props {
  profile: Profile;
  returning: boolean;
  onEdit: () => void;
  onContinue: () => void;
}

export function Review({ profile, returning, onEdit, onContinue }: Props) {
  return (
    <div className="lf-pad lf-scroll">
      {returning && (
        <div className="lf-welcome">
          <Check size={14} /> We found your profile on this phone.
        </div>
      )}

      <div className="lf-pass">
        <div className="lf-pass-top">
          <span className="lf-pass-kind">HEALTH PASS</span>
          <ShieldCheck size={16} />
        </div>
        <div className="lf-pass-name">{profile.name || "—"}</div>
        <div className="lf-pass-meta">
          <span>DOB {profile.dob || "—"}</span>
          <span>{profile.insurer ? profile.insurer.split(" ")[0] : "—"}</span>
        </div>
        <div className="lf-pass-foot"><Lock size={11} /> stored on this device</div>
      </div>

      <div className="lf-summary">
        {CATEGORIES.map((c) => {
          const rows = c.fields.map((f) => [f, profile[f]] as [keyof Profile, string | undefined]).filter(([, v]) => v);
          if (!rows.length) return null;
          const Icon = c.icon;
          return (
            <div className="lf-sum-row" key={c.id}>
              <Icon size={14} />
              <div>
                <div className="lf-sum-label">{c.label}</div>
                <div className="lf-sum-val">{rows.map(([, v]) => v).join(" · ")}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="lf-actions">
        <button className="lf-secondary" onClick={onEdit} type="button">
          <Pencil size={14} /> Edit
        </button>
        <button className="lf-primary" onClick={onContinue} type="button">
          Continue <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

