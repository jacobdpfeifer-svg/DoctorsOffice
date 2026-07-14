import { Smartphone } from "lucide-react";

interface Props {
  hasProfile: boolean;
  onTap: () => void;
}

/**
 * True when the device appears to have touch capability, which is a reliable
 * proxy for "can use NFC" on the patient side.  The NFC read is handled by
 * the device OS (no Web NFC API required) — this check is purely for showing
 * the right instructional copy.  Desktop users with pointer-only input see a
 * fallback note.
 */
const isTouchDevice =
  typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;

export function Idle({ hasProfile, onTap }: Props) {
  return (
    <div className="lf-pad lf-center">
      <button
        className="lf-tap"
        onClick={onTap}
        aria-label="Start check-in"
        type="button"
      >
        {/* Purely decorative pulse rings — hidden from screen readers */}
        <span className="lf-tap-ring" aria-hidden="true" />
        <span className="lf-tap-ring lf-tap-ring2" aria-hidden="true" />
        <span className="lf-tap-core" aria-hidden="true">
          <Smartphone size={26} strokeWidth={1.8} />
        </span>
      </button>

      {isTouchDevice ? (
        <>
          <p className="lf-tap-label">Tap to check in</p>
          <p className="lf-tap-sub">
            {hasProfile
              ? "Your profile is already on this phone."
              : "First visit — you'll fill this in once, then it stays with you."}
          </p>
        </>
      ) : (
        <>
          <p className="lf-tap-label">Start check-in</p>
          <p className="lf-tap-sub">
            NFC requires a mobile phone. Use your phone to tap the sticker at
            the desk, or continue here to fill out your info manually.
          </p>
        </>
      )}
    </div>
  );
}
