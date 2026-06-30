import { Smartphone, ChevronRight } from "lucide-react";

interface Props {
  hasProfile: boolean;
  onTap: () => void;
}

export function Idle({ hasProfile, onTap }: Props) {
  return (
    <div className="lf-pad lf-center">
      <button className="lf-tap" onClick={onTap} aria-label="Tap your phone here">
        <span className="lf-tap-ring" />
        <span className="lf-tap-ring lf-tap-ring2" />
        <span className="lf-tap-core"><Smartphone size={26} strokeWidth={1.8} /></span>
      </button>
      <p className="lf-tap-label">Tap the sticker at the desk</p>
      <p className="lf-tap-sub">
        {hasProfile
          ? "Your profile is already on this phone."
          : "First visit — you'll fill this in once, then it stays with you."}
      </p>
      <button className="lf-link" onClick={onTap}>
        Simulate tap <ChevronRight size={14} />
      </button>
    </div>
  );
}
