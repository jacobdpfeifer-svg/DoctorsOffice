import { Lock, Plus } from "lucide-react";
import type { Profile } from "../lib/types.ts";
import { CATEGORIES, LABELS } from "./constants.ts";

interface Props {
  draft: Profile;
  setDraft: (d: Profile) => void;
  onSample: () => void;
  onSave: () => void;
}

export function Fill({ draft, setDraft, onSample, onSave }: Props) {
  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [k]: e.target.value } as Profile);

  const ready = Boolean(draft.name && draft.dob);

  return (
    <div className="lf-pad lf-scroll">
      <div className="lf-h">
        <h3>Set up your profile</h3>
        <button className="lf-mini" onClick={onSample} type="button">
          <Plus size={12} /> Use sample answers
        </button>
      </div>
      <p className="lf-note">You enter this once. It's saved on this phone — not on our servers.</p>

      {CATEGORIES.map((c) => {
        const Icon = c.icon;
        return (
          <fieldset className="lf-fs" key={c.id}>
            <legend><Icon size={13} /> {c.label}</legend>
            {c.fields.map((f) => (
              <label className="lf-field" key={f}>
                <span>{LABELS[f]}</span>
                <input
                  value={draft[f] ?? ""}
                  onChange={set(f)}
                  placeholder={LABELS[f]}
                  spellCheck={false}
                />
              </label>
            ))}
          </fieldset>
        );
      })}

      <button className="lf-primary" disabled={!ready} onClick={onSave} type="button">
        <Lock size={15} /> Save to this device
      </button>
    </div>
  );
}
