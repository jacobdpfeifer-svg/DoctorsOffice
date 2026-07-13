import { Link } from "react-router-dom";
import { Smartphone } from "lucide-react";
import { CSS } from "../components/styles.ts";

/**
 * Public landing / catch-all route.
 *
 * Patients always arrive via /o/:officeId (encoded on an NFC tag) — they
 * never type a URL directly.  This page handles two cases:
 *
 *   1. "/" — someone navigated to the root without an NFC tap.
 *   2. "*" — an unrecognised path (broken link, mistyped URL, etc.).
 *
 * It tells the visitor to scan the NFC sticker and offers a staff sign-in
 * link without exposing any app internals.
 */
export function NotFound() {
  return (
    <div
      className="lf"
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <style>{CSS}</style>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          textAlign: "center",
          maxWidth: 300,
          padding: "0 24px",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "var(--line-2)",
            border: "1px dashed var(--line)",
            display: "grid",
            placeItems: "center",
            color: "var(--mute)",
          }}
        >
          <Smartphone size={26} strokeWidth={1.6} />
        </div>

        <p
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            fontSize: 17,
            margin: 0,
            letterSpacing: "-.01em",
          }}
        >
          Scan to check in
        </p>

        <p
          style={{
            fontSize: 13,
            color: "var(--ink-soft)",
            lineHeight: 1.55,
            margin: 0,
          }}
        >
          Tap the NFC sticker at the front desk with your phone to start
          your check-in.
        </p>

        <Link
          to="/login"
          style={{
            marginTop: 8,
            fontSize: 12.5,
            color: "var(--cobalt)",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Staff sign in →
        </Link>
      </div>
    </div>
  );
}
