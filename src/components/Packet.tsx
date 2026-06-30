import { useState } from "react";
import { Check, Copy, Lock } from "lucide-react";
import type { ConsentedPacket } from "../lib/types.ts";
import { CATEGORIES, LABELS } from "./constants.ts";
import type { Profile } from "../lib/types.ts";

interface Props {
  packet: ConsentedPacket;
  fresh: boolean;
  imported: boolean;
  elapsedMs: number;
  onImport: () => void;
}

export function Packet({ packet, fresh, imported, elapsedMs, onImport }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, val: string) => {
    try { await navigator.clipboard.writeText(val); } catch { /* clipboard unavailable */ }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
  };

  // Reconstruct display groups from CATEGORIES, including only fields present in the packet.
  const groups = CATEGORIES.flatMap((c) => {
    const Icon = c.icon;
    const rows: Array<[keyof Profile, string]> = c.fields.flatMap((f) => {
      const v = packet[f];
      return v && v.trim() ? [[f, v] as [keyof Profile, string]] : [];
    });
    return rows.length ? [{ id: c.id, label: c.label, Icon, rows }] : [];
  });

  const totalSecs = Math.round(elapsedMs / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;

  return (
    <article className={"lf-packet" + (fresh ? " lf-land" : "")}>
      <div className="lf-packet-head">
        <div>
          <div className="lf-packet-title">Patient check-in</div>
          <div className="lf-packet-time">
            Received in {mins}:{String(secs).padStart(2, "0")} · vs ~22 min on paper
          </div>
        </div>
        {imported ? (
          <span className="lf-imported"><Check size={13} /> In chart</span>
        ) : (
          <button className="lf-import" onClick={onImport} type="button">Import to chart</button>
        )}
      </div>

      {groups.map((g) => (
        <div className="lf-grp" key={g.id}>
          <div className="lf-grp-h"><g.Icon size={12} /> {g.label}</div>
          {g.rows.map(([f, v]) => (
            <div className="lf-row" key={f}>
              <span className="lf-row-l">{LABELS[f]}</span>
              <span className="lf-row-v">{v}</span>
              <button
                className="lf-copy"
                onClick={() => void copy(f, v)}
                aria-label={"Copy " + LABELS[f]}
                type="button"
              >
                {copied === f ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          ))}
        </div>
      ))}

      <div className="lf-packet-foot">
        <Lock size={11} /> Arrived from the patient's device. No copy held by Carry.
      </div>
    </article>
  );
}
