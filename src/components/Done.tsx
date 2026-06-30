import { Check, Lock, ChevronRight } from "lucide-react";

interface Props {
  office: string;
  sending: boolean;
  onAgain: () => void;
}

export function Done({ office, sending, onAgain }: Props) {
  return (
    <div className="lf-pad lf-center">
      <div className={"lf-done-ring" + (sending ? " is-sending" : "")}>
        {sending ? <span className="lf-spin" /> : <Check size={30} strokeWidth={2.6} />}
      </div>
      <p className="lf-done-title">{sending ? "Sending…" : "Sent to the front desk"}</p>
      <p className="lf-done-sub">
        {sending
          ? "Handing your approved info to " + office
          : "Your info is with " + office + "."}
      </p>
      {!sending && (
        <>
          <div className="lf-done-pill"><Lock size={12} /> Still stored on this device only</div>
          <button className="lf-link" onClick={onAgain} type="button">
            Next office is one tap <ChevronRight size={14} />
          </button>
        </>
      )}
    </div>
  );
}
