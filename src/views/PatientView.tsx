import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { fetchOffice, type Office } from "../lib/offices.ts";
import {
  getProfile,
  saveProfile,
  checkUnlockThrottle,
  recordFailedUnlock,
  clearUnlockThrottle,
} from "../lib/storage.ts";
import {
  deriveNewStorageKey,
  deriveStorageKey,
  deriveStorageKeyV1,
  encryptProfile,
  decryptProfile,
} from "../lib/crypto-storage.ts";
import type { EncryptedBlobV2 } from "../lib/types.ts";
import {
  joinSession,
  sendPacket,
  endSession,
  AckTimeoutError,
  type JoinedSession,
} from "../lib/transit.ts";
import type { EncryptedBlob, Profile, ConsentedPacket } from "../lib/types.ts";
import { CATEGORIES, EMPTY, SAMPLE } from "../components/constants.ts";
import { CSS } from "../components/styles.ts";
import { PhoneTopbar } from "../components/PhoneTopbar.tsx";
import { Idle } from "../components/Idle.tsx";
import { Fill } from "../components/Fill.tsx";
import { Review } from "../components/Review.tsx";
import { Consent } from "../components/Consent.tsx";
import { Done } from "../components/Done.tsx";
import { PinEntry } from "../components/PinEntry.tsx";
import { CodeEntry } from "../components/CodeEntry.tsx";

type Step =
  | "loading"       // initial IndexedDB check
  | "idle"          // tap-to-start screen
  | "fill"          // new-patient intake form
  | "pin-new"       // create PIN → encrypt + save profile
  | "pin-return"    // enter PIN → decrypt stored profile
  | "review"        // health pass + summary
  | "consent"       // per-category share toggles
  | "code-entry"    // enter the desk's 8-char pairing code
  | "sending"       // joinSession or sendPacket in-flight (spinner)
  | "sas-confirm"   // display 6-digit SAS; await user confirmation
  | "done"          // packet delivered AND ack received from desk
  | "unconfirmed";  // packet sent but ack timed out — warn, don't retry

export function PatientView() {
  const { officeId } = useParams<{ officeId: string }>();

  /**
   * Office record loaded asynchronously from the public.offices table.
   * null = still loading or not found; differentiated by `step === "loading"`.
   */
  const [office, setOffice] = useState<Office | null>(null);

  const [step, setStep] = useState<Step>("loading");
  const [draft, setDraft] = useState<Profile>(EMPTY);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [blob, setBlob] = useState<EncryptedBlob | null>(null);
  const [returning, setReturning] = useState(false);
  const [share, setShare] = useState<Record<string, boolean>>(
    () => Object.fromEntries(CATEGORIES.map((c) => [c.id, true])),
  );
  const [consentedPacket, setConsentedPacket] = useState<ConsentedPacket | null>(null);
  const [pinError, setPinError] = useState<string | undefined>();
  const [sendError, setSendError] = useState<string | undefined>();
  /**
   * True while Argon2id key derivation is running (both new-profile and
   * unlock paths).  Disables the PinEntry form to prevent double-submission
   * and shows a progress indicator — Argon2id takes ~1–2 seconds on mobile.
   */
  const [pinLoading, setPinLoading] = useState(false);

  /**
   * Holds the active transit session during the join → SAS-confirm → send
   * window.  The session is kept alive so the patient can still send after
   * confirming the SAS.  Cleaned up on success, error, abort, and unmount.
   */
  const sessionRef = useRef<JoinedSession | null>(null);

  /** 6-digit SAS derived alongside the shared key; displayed for confirmation. */
  const [sas, setSas] = useState("");

  // On mount: load the office record from Supabase and check IndexedDB in parallel.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const officePromise = officeId
        ? fetchOffice(officeId)
        : Promise.resolve<Office | null>(null);

      const [existing, foundOffice] = await Promise.all([
        getProfile().catch(() => undefined as EncryptedBlob | undefined),
        officePromise,
      ]);

      if (cancelled) return;
      if (existing) setBlob(existing);
      setOffice(foundOffice);
      setStep("idle");
    }

    void load();
    return () => { cancelled = true; };
  }, [officeId]);

  // On unmount: tear down any open transit session and drop the shared key ref.
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        endSession(sessionRef.current.channel);
        sessionRef.current = null;
      }
    };
  }, []);

  // ---- helpers ----

  const resetShare = () =>
    setShare(Object.fromEntries(CATEGORIES.map((c) => [c.id, true])));

  const handleTap = () => {
    resetShare();
    setPinError(undefined);
    setSendError(undefined);
    if (blob) {
      setStep("pin-return");
    } else {
      setDraft(EMPTY);
      setStep("fill");
    }
  };

  const handleFillSave = () => {
    setPinError(undefined);
    setStep("pin-new");
  };

  // ---- PIN/passphrase helpers ----

  /**
   * Formats a lockout duration for display in error messages.
   */
  function formatRetryLabel(ms: number): string {
    const secs = Math.ceil(ms / 1000);
    if (secs < 60) return `${secs} second${secs !== 1 ? "s" : ""}`;
    const mins = Math.ceil(secs / 60);
    if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""}`;
    const hours = Math.ceil(mins / 60);
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  }

  /**
   * Creates a new v2 EncryptedBlob from the current draft profile.
   * Runs Argon2id + HKDF to derive a fresh key with a new random salt.
   */
  const handlePinNew = async (passphrase: string) => {
    setPinLoading(true);
    setPinError(undefined);
    try {
      const { key, kdfParams } = await deriveNewStorageKey(passphrase);
      const encrypted = await encryptProfile(draft, key, kdfParams);
      await saveProfile(encrypted);
      await clearUnlockThrottle(); // brand-new device — no prior failures
      setBlob(encrypted);
      setProfile(draft);
      setReturning(false);
      setStep("review");
    } catch {
      setPinError("Failed to save. Try again.");
    } finally {
      setPinLoading(false);
    }
  };

  /**
   * Unlocks an existing profile blob with the user's passphrase.
   *
   * Handles three cases:
   *   1. Device is currently locked out → show retry countdown.
   *   2. Passphrase correct on a v2 blob → decrypt and proceed.
   *   3. Passphrase correct on a legacy v1 blob → decrypt with old PBKDF2
   *      scheme, then immediately re-encrypt under Argon2id (one-time
   *      migration — the v1 blob is replaced in IndexedDB atomically).
   *
   * On any failure: increment the throttle counter and re-check so the
   * error message reflects the new lockout state.
   *
   * ⚠️  PHI — SECURITY REVIEW: throttle state is in IndexedDB and can be
   * cleared by a user who controls the browser. This provides rate-limiting
   * against casual attackers on an unattended device, not against a
   * sophisticated attacker with full device access.
   */
  const handlePinReturn = async (passphrase: string) => {
    if (!blob) return;
    setPinLoading(true);
    setPinError(undefined);

    try {
      // Throttle check — cheap IDB read; do this before the expensive KDF.
      const throttleStatus = await checkUnlockThrottle();
      if (!throttleStatus.allowed) {
        setPinError(
          `Too many failed attempts. Try again in ${formatRetryLabel(throttleStatus.retryAfterMs)}.`,
        );
        return;
      }

      const isV2 = "v" in blob && (blob as EncryptedBlobV2).v === 2;

      if (isV2) {
        // Current format: Argon2id key derivation with per-device salt.
        const key = await deriveStorageKey(passphrase, (blob as EncryptedBlobV2).kdf);
        const decrypted = await decryptProfile(blob, key); // throws on wrong passphrase
        await clearUnlockThrottle();
        setProfile(decrypted);
        setReturning(true);
        setPinError(undefined);
        setStep("review");
      } else {
        /*
         * Legacy v1 blob: decrypt with the old PBKDF2 + fixed-salt scheme,
         * then immediately re-encrypt under Argon2id.
         *
         * The old scheme is weak (fixed salt → rainbow tables, PBKDF2 is not
         * memory-hard).  Re-encryption happens atomically before any PHI is
         * shown to the user, so no v1 blobs linger after a successful unlock.
         *
         * ⚠️  MIGRATION PATH — remove once no v1 blobs remain in the wild.
         */
        const oldKey = await deriveStorageKeyV1(passphrase); // throws on wrong passphrase
        const decrypted = await decryptProfile(blob, oldKey);

        // Re-encrypt with Argon2id + new random salt.
        const { key: newKey, kdfParams } = await deriveNewStorageKey(passphrase);
        const newBlob = await encryptProfile(decrypted, newKey, kdfParams);
        await saveProfile(newBlob);
        await clearUnlockThrottle();

        setBlob(newBlob);
        setProfile(decrypted);
        setReturning(true);
        setPinError(undefined);
        setStep("review");
      }
    } catch {
      // Any thrown exception means the passphrase was wrong (or a transient
      // IDB error).  Increment the throttle counter unconditionally.
      await recordFailedUnlock();
      const status = await checkUnlockThrottle();
      if (!status.allowed) {
        setPinError(
          `Incorrect passphrase. Too many attempts — try again in ${formatRetryLabel(status.retryAfterMs)}.`,
        );
      } else {
        setPinError("Incorrect passphrase.");
      }
    } finally {
      setPinLoading(false);
    }
  };

  // consent → code-entry: build ConsentedPacket from toggled-on categories.
  const handleConsent = () => {
    if (!profile) return;
    const packet: ConsentedPacket = {};
    for (const cat of CATEGORIES) {
      if (!share[cat.id]) continue;
      for (const field of cat.fields) {
        if (profile[field]) packet[field] = profile[field];
      }
    }
    setConsentedPacket(packet);
    setSendError(undefined);
    setStep("code-entry");
  };

  /**
   * Phase 1 of sending: join the desk session and derive the shared key + SAS.
   * Shows the spinner, then transitions to "sas-confirm" where the user
   * visually verifies the SAS before any data is sent.
   *
   * The packet is NOT sent here.  Sending is blocked until the user confirms
   * the SAS matches the desk screen (handleSASConfirm), which is the
   * Short Authenticated String check that detects man-in-the-middle attacks.
   */
  const handleJoin = async (code: string) => {
    if (!consentedPacket || !officeId) return;
    setSendError(undefined);
    setStep("sending");
    try {
      const session = await joinSession(officeId, code);
      sessionRef.current = session;
      setSas(session.sas);
      setStep("sas-confirm");
    } catch (err) {
      if (sessionRef.current) {
        endSession(sessionRef.current.channel);
        sessionRef.current = null;
      }
      setSendError(err instanceof Error ? err.message : String(err));
      setStep("code-entry");
    }
  };

  /**
   * Phase 2 of sending: user confirmed the SAS matches.
   * Encrypts and transmits the consented packet, then waits for an
   * authenticated delivery receipt (ack) from the desk before transitioning
   * to "done".
   *
   * Three outcomes:
   *   • Ack received     → "done"        (confirmed delivery)
   *   • AckTimeoutError  → "unconfirmed" (packet was sent; ack was lost)
   *   • Channel error    → "code-entry"  (genuine send failure; retry is safe)
   *
   * The distinction matters because on AckTimeoutError the session is consumed
   * and the desk likely has the data — telling the patient to "try again" would
   * produce a "session consumed" error on rejoin, confusing them further.
   */
  /**
   * Wipes all decrypted PHI from React state after the send flow completes
   * (success or unconfirmed).  Called on both "done" and "unconfirmed" paths
   * so no plaintext data lingers in the JS heap once the packet has left the
   * device.
   *
   * Note: storage key CryptoKey locals (handlePinNew/Return) and the transit
   * sharedKey (sessionRef.current.sharedKey) are already cleaned up by their
   * respective call sites; this helper handles the React-state side only.
   */
  const wipeAfterSend = () => {
    setConsentedPacket(null);
    setProfile(null);
    setDraft(EMPTY);
    setSas("");
  };

  const handleSASConfirm = async () => {
    if (!consentedPacket || !sessionRef.current) return;
    setStep("sending");
    try {
      await sendPacket(
        sessionRef.current.channel,
        consentedPacket,
        sessionRef.current.sharedKey,
      );
      endSession(sessionRef.current.channel);
      sessionRef.current = null;
      // Wipe PHI from state before rendering "done" so plaintext data does not
      // linger in the JS heap after the packet has been delivered and confirmed.
      wipeAfterSend();
      setStep("done");
    } catch (err) {
      if (sessionRef.current) {
        endSession(sessionRef.current.channel);
        sessionRef.current = null;
      }
      if (err instanceof AckTimeoutError) {
        // Packet was sent; only the confirmation was lost.  Wipe PHI here too —
        // the data has left the device regardless of whether the ack arrived.
        wipeAfterSend();
        setStep("unconfirmed");
      } else {
        // Genuine send failure (channel error, etc.) — safe to retry.
        // PHI is NOT wiped here: the packet was never sent, so the user
        // should be able to retry with the same consentedPacket.
        setSendError(err instanceof Error ? err.message : String(err));
        setStep("code-entry");
      }
    }
  };

  /**
   * User reported the SAS does NOT match the desk screen.
   *
   * This is the detection signal for an active man-in-the-middle attack
   * (or a session mixup).  The session is torn down immediately; no data
   * has been sent.  The user returns to the code-entry screen to try again
   * with a fresh session (new ECDH keypairs, new pairing code).
   */
  const handleSASAbort = () => {
    if (sessionRef.current) {
      endSession(sessionRef.current.channel);
      sessionRef.current = null;
    }
    // Clear the stale SAS — it belongs to the aborted session and must not
    // be re-displayed if the user retries.  profile and consentedPacket are
    // intentionally retained: no data was sent, so the user can retry the
    // same selection without re-entering their passphrase.
    setSas("");
    setSendError(
      "Codes didn't match — session aborted. This may indicate an interception attempt. Try again.",
    );
    setStep("code-entry");
  };

  // ---- "not recognized" guard ----
  // Only show this after the initial fetch completes (step !== "loading");
  // while loading, office is null but the loading spinner is shown instead.
  if (!office && step !== "loading") {
    return (
      <div className="lf">
        <style>{CSS}</style>
        <div className="lf-phone">
          <div className="lf-notch" />
          <div className="lf-screen">
            <div className="lf-pad lf-center">
              <p>Office not recognized</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lf">
      <style>{CSS}</style>
      <div className="lf-phone">
        <div className="lf-notch" />
        <div className="lf-screen">
          <PhoneTopbar office={office?.name ?? "…"} />

          {step === "loading" && (
            <div className="lf-pad lf-center">
              <p style={{ color: "var(--mute)", fontSize: "13px" }}>Loading…</p>
            </div>
          )}

          {step === "idle" && (
            <Idle hasProfile={Boolean(blob)} onTap={handleTap} />
          )}

          {step === "fill" && (
            <Fill
              draft={draft}
              setDraft={setDraft}
              onSample={() => setDraft(SAMPLE)}
              onSave={handleFillSave}
            />
          )}

          {step === "pin-new" && (
            <PinEntry
              title="Create a passphrase"
              subtitle="Choose a passphrase (6+ characters) to encrypt your profile on this device. It never leaves your phone — we can't recover it."
              minLength={6}
              isLoading={pinLoading}
              error={pinError}
              onSubmit={(p) => void handlePinNew(p)}
              onBack={() => { setPinError(undefined); setStep("fill"); }}
            />
          )}

          {step === "pin-return" && (
            <PinEntry
              title="Enter your passphrase"
              subtitle="Your profile is encrypted on this device. Enter your passphrase to unlock it."
              minLength={6}
              isLoading={pinLoading}
              error={pinError}
              onSubmit={(p) => void handlePinReturn(p)}
              onBack={() => { setPinError(undefined); setStep("idle"); }}
            />
          )}

          {step === "review" && profile && (
            <Review
              profile={profile}
              returning={returning}
              onEdit={() => { setDraft(profile); setStep("fill"); }}
              onContinue={() => setStep("consent")}
            />
          )}

          {step === "consent" && profile && (
            <Consent
              office={office?.name ?? ""}
              profile={profile}
              share={share}
              setShare={setShare}
              onBack={() => setStep("review")}
              onSend={handleConsent}
            />
          )}

          {step === "code-entry" && (
            <CodeEntry
              error={sendError}
              onSubmit={(code) => void handleJoin(code)}
              onBack={() => setStep("consent")}
            />
          )}

          {/*
           * SAS confirmation screen.
           *
           * The ECDH handshake is complete and the shared key has been
           * derived.  Both this screen and the desk screen show the SAME
           * 6-digit code — IF the connection is direct.
           *
           * A man-in-the-middle who substituted keys during the exchange
           * will have caused each side to derive a DIFFERENT shared key,
           * so the two SAS values will differ.  The visual comparison is
           * the only way to detect this; the protocol cannot detect it
           * automatically because neither side has an authenticated channel.
           *
           * "Confirm & send" → handleSASConfirm (sends the packet)
           * "Don't match"    → handleSASAbort   (tears down, no data sent)
           */}
          {step === "sas-confirm" && (
            <div className="lf-pad lf-scroll">
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: "#EAEDFB", display: "grid", placeItems: "center",
                  color: "var(--cobalt)", flexShrink: 0,
                }}>
                  <ShieldCheck size={16} />
                </div>
                <h3 className="lf-h-solo" style={{ margin: 0 }}>Verify connection</h3>
              </div>

              <p className="lf-note">
                Compare this code with the number shown on the front-desk
                screen. They must match exactly.
              </p>

              <div style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "2.4rem",
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: "var(--cobalt)",
                background: "#EAEDFB",
                border: "2px solid #C4CCF4",
                borderRadius: 14,
                padding: "16px",
                textAlign: "center",
                margin: "12px 0 14px",
              }}>
                {sas.slice(0, 3)}&nbsp;{sas.slice(3)}
              </div>

              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                background: "#FEF9EC", border: "1px solid #FDE68A",
                borderRadius: 10, padding: "10px 12px", marginBottom: 14,
              }}>
                <ShieldAlert size={14} style={{ color: "#B45309", flexShrink: 0, marginTop: 1 }} />
                <p style={{ margin: 0, fontSize: 11.5, color: "#78350F", lineHeight: 1.5 }}>
                  If the codes don't match, tap <strong>Don't match</strong>.
                  Do not send — a mismatch can indicate an interception attempt.
                </p>
              </div>

              <div className="lf-actions">
                <button
                  className="lf-secondary"
                  type="button"
                  onClick={handleSASAbort}
                  style={{ flex: 1 }}
                >
                  Don't match
                </button>
                <button
                  className="lf-primary lf-send"
                  type="button"
                  onClick={() => void handleSASConfirm()}
                  style={{ flex: 1 }}
                >
                  <ShieldCheck size={14} /> Confirm &amp; send
                </button>
              </div>
            </div>
          )}

          {/*
           * Ack timeout: packet was sent but the desk did not broadcast a
           * delivery receipt within ACK_TIMEOUT_MS.  The session is already
           * consumed — retrying would hit "session consumed" — so this screen
           * tells the patient to verify with the receptionist rather than
           * offering a retry button that would confuse them.
           *
           * This is distinct from a channel error (where retry IS appropriate)
           * and from "done" (where the ack was confirmed).
           */}
          {step === "unconfirmed" && (
            <div className="lf-pad lf-center" style={{ gap: 12 }}>
              <div style={{
                width: 52, height: 52, borderRadius: "50%",
                background: "#FEF9EC", border: "2px solid #FDE68A",
                display: "grid", placeItems: "center",
                color: "#B45309", flexShrink: 0,
              }}>
                <ShieldAlert size={22} />
              </div>

              <p style={{ fontWeight: 700, fontSize: 16, textAlign: "center", margin: 0 }}>
                Sent — confirmation pending
              </p>

              <p style={{ fontSize: 13, color: "var(--mute)", textAlign: "center",
                lineHeight: 1.55, margin: 0, maxWidth: 280 }}>
                Your information was transmitted, but the front desk did not
                send a confirmation in time. This usually means the connection
                was interrupted after delivery.
              </p>

              <div style={{
                background: "#FEF9EC", border: "1px solid #FDE68A",
                borderRadius: 10, padding: "10px 14px", maxWidth: 280,
              }}>
                <p style={{ margin: 0, fontSize: 12, color: "#78350F", lineHeight: 1.5 }}>
                  Please let the receptionist know you've submitted your
                  information. Do not tap-to-start again — a second submission
                  will show an error because the session is already used.
                </p>
              </div>

              <button
                type="button"
                className="lf-primary"
                onClick={() => setStep("idle")}
                style={{ marginTop: 4, alignSelf: "stretch" }}
              >
                OK
              </button>
            </div>
          )}

          {(step === "sending" || step === "done") && (
            <Done
              office={office?.name ?? ""}
              sending={step === "sending"}
              onAgain={() => {
                // Profile was wiped on send (data minimization). Go to idle so
                // the user re-authenticates for the next office rather than
                // re-entering a stale plaintext state.
                resetShare();
                setStep("idle");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
