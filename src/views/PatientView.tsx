import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { getOffice } from "../lib/offices.ts";
import { getProfile, saveProfile } from "../lib/storage.ts";
import {
  deriveStorageKey,
  encryptProfile,
  decryptProfile,
} from "../lib/crypto-storage.ts";
import {
  joinSession,
  sendPacket,
  endSession,
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
  | "loading"     // initial IndexedDB check
  | "idle"        // tap-to-start screen
  | "fill"        // new-patient intake form
  | "pin-new"     // create PIN → encrypt + save profile
  | "pin-return"  // enter PIN → decrypt stored profile
  | "review"      // health pass + summary
  | "consent"     // per-category share toggles
  | "code-entry"  // enter the desk's pairing code
  | "sending"     // joinSession + sendPacket in flight
  | "done";       // packet delivered

export function PatientView() {
  const { officeId } = useParams<{ officeId: string }>();
  const office = officeId ? getOffice(officeId) : undefined;

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

  // Holds the active transit session only during the join → send window.
  // Cleaned up by sendPacket's success path, error path, and unmount.
  const sessionRef = useRef<JoinedSession | null>(null);

  // On mount: check for an existing encrypted blob in IndexedDB.
  useEffect(() => {
    getProfile()
      .then((existing) => {
        if (existing) setBlob(existing);
        setStep("idle");
      })
      .catch(() => setStep("idle"));
  }, []);

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

  // Fill → pin-new: move to PIN creation (draft is held in state).
  const handleFillSave = () => {
    setPinError(undefined);
    setStep("pin-new");
  };

  // pin-new: derive key, encrypt, persist, then advance to review.
  const handlePinNew = async (pin: string) => {
    try {
      const key = await deriveStorageKey(pin);
      const encrypted = await encryptProfile(draft, key);
      await saveProfile(encrypted);
      setBlob(encrypted);
      setProfile(draft);
      setReturning(false);
      setStep("review");
    } catch {
      setPinError("Failed to save. Try again.");
    }
  };

  // pin-return: derive key, decrypt blob; show error without crashing on wrong PIN.
  const handlePinReturn = async (pin: string) => {
    if (!blob) return;
    try {
      const key = await deriveStorageKey(pin);
      const decrypted = await decryptProfile(blob, key);
      setProfile(decrypted);
      setReturning(true);
      setPinError(undefined);
      setStep("review");
    } catch {
      setPinError("Incorrect PIN");
    }
  };

  // consent → code-entry: build a ConsentedPacket from only the toggled-on categories.
  // This is the ONLY place a ConsentedPacket is constructed — it is a strict subset of
  // the decrypted Profile; the full Profile never leaves this function.
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

  // code-entry → sending → done: join the desk session, transit-encrypt the consented
  // packet, send. The full profile and storage key are not touched here.
  const handleSend = async (code: string) => {
    if (!consentedPacket || !officeId) return;
    setStep("sending");
    try {
      const session = await joinSession(officeId, code);
      sessionRef.current = session;
      await sendPacket(session.channel, consentedPacket, session.sharedKey);
      endSession(session.channel);
      sessionRef.current = null;
      setStep("done");
    } catch (err) {
      if (sessionRef.current) {
        endSession(sessionRef.current.channel);
        sessionRef.current = null;
      }
      setSendError(err instanceof Error ? err.message : String(err));
      setStep("code-entry");
    }
  };

  // ---- "not recognized" guard ----
  if (!office) {
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
          <PhoneTopbar office={office.name} />

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
              title="Create a PIN"
              subtitle="This 4-digit PIN encrypts your profile on this device. Don't share it — we can't recover it."
              error={pinError}
              onSubmit={(pin) => void handlePinNew(pin)}
              onBack={() => { setPinError(undefined); setStep("fill"); }}
            />
          )}

          {step === "pin-return" && (
            <PinEntry
              title="Enter your PIN"
              subtitle="Your profile is encrypted on this device. Enter your PIN to unlock it."
              error={pinError}
              onSubmit={(pin) => void handlePinReturn(pin)}
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
              office={office.name}
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
              onSubmit={(code) => void handleSend(code)}
              onBack={() => setStep("consent")}
            />
          )}

          {(step === "sending" || step === "done") && (
            <Done
              office={office.name}
              sending={step === "sending"}
              onAgain={() => { resetShare(); setStep("review"); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
