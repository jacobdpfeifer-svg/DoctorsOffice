import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Building2, Wifi, RotateCcw, ShieldAlert, ShieldCheck, LogOut } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { fetchOffice, type Office } from "../lib/offices.ts";
import {
  startDeskSession,
  listenForPacket,
  endSession,
} from "../lib/transit.ts";
import { SESSION_TIMEOUT_MS } from "../lib/session-config.ts";
import { getSupabase } from "../lib/supabase.ts";
import { useAuth } from "../context/AuthContext.tsx";
import type { ConsentedPacket } from "../lib/types.ts";
import { Packet } from "../components/Packet.tsx";
import { CSS } from "../components/styles.ts";

type Step = "starting" | "waiting" | "sas-active" | "received" | "expired" | "error";

/** Three-state membership check: null = pending, true = member, false = denied. */
type Membership = null | true | false;

export function DeskView() {
  const { officeId } = useParams<{ officeId: string }>();
  const { user, signOut } = useAuth();

  // --- Office record + membership check (resolved in parallel) ------------
  /**
   * The office record fetched from the public.offices table.
   * null while loading or when the officeId is not a known office UUID.
   */
  const [office, setOffice] = useState<Office | null>(null);
  const [membership, setMembership] = useState<Membership>(null);

  useEffect(() => {
    if (!user || !officeId) {
      setMembership(false);
      return;
    }
    setMembership(null);
    setOffice(null);

    Promise.all([
      getSupabase()
        .from("office_staff")
        .select("office_id")
        .eq("user_id", user.id)
        .eq("office_id", officeId)
        .maybeSingle(),
      fetchOffice(officeId),
    ]).then(([{ data, error }, foundOffice]) => {
      setMembership(!error && data !== null ? true : false);
      setOffice(foundOffice);
    });
  }, [user, officeId]);

  // --- Desk session state -------------------------------------------------
  const [step, setStep] = useState<Step>("starting");
  const [code, setCode] = useState("");
  const [sas, setSas] = useState("");
  const [packet, setPacket] = useState<ConsentedPacket | null>(null);
  const [imported, setImported] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [sessionStart, setSessionStart] = useState(0);
  const [receivedAt, setReceivedAt] = useState(0);

  /**
   * Incrementing this counter causes the session useEffect to re-run,
   * cleanly tearing down the old channel and starting a fresh one.
   * Only the "Start new session" UI action increments it.
   */
  const [restartKey, setRestartKey] = useState(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const consoleRef = useRef<HTMLDivElement | null>(null);

  /**
   * In-app session restart — replaces "refresh the page" in the expired/error
   * UI.  Resets all session state then bumps restartKey to trigger a fresh
   * startDeskSession via the useEffect dependency.
   */
  const handleNewSession = useCallback(() => {
    setStep("starting");
    setCode("");
    setSas("");
    setPacket(null);
    setImported(false);
    setFresh(false);
    setErrorMsg("");
    setSessionStart(0);
    setReceivedAt(0);
    setRestartKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!officeId || !office || membership !== true) return;
    let active = true;

    startDeskSession(
      officeId,
      // onSAS: fires once the patient's public key arrives and the shared key
      // is derived.  Transition to "sas-active" so the receptionist can read
      // the 6-digit code aloud (or show the patient both screens).
      (newSas) => {
        if (!active) return;
        setSas(newSas);
        setStep("sas-active");
      },
      // onError: surfaces async errors from inside channel listeners (e.g.
      // key derivation failure for a well-formed-but-invalid public key).
      // These cannot be caught by the .catch() below because they happen
      // after the startDeskSession promise has already resolved.
      (err) => {
        if (!active) return;
        setErrorMsg(err.message);
        setStep("error");
      },
    )
      .then(({ code: c, channel }) => {
        if (!active) {
          void channel.unsubscribe();
          return;
        }
        channelRef.current = channel;
        setCode(c);
        setSessionStart(Date.now());
        setStep("waiting");

        listenForPacket(
          channel,
          // onPacket — transit.ts clears its own inactivity timer on delivery.
          (pkt) => {
            if (!active) return;
            setPacket(pkt);
            setReceivedAt(Date.now());
            setFresh(true);
            setImported(false);
            setStep("received");
            setTimeout(() => setFresh(false), 600);
            setTimeout(() => consoleRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 60);
          },
          // onExpire — transit.ts has already called closeDeskSession (channel
          // is unsubscribed, keys are wiped) before calling this.  We null the
          // ref so the cleanup below doesn't attempt a redundant endSession,
          // then surface the "expired" step with an in-app restart option.
          () => {
            if (!active) return;
            channelRef.current = null;
            setStep("expired");
          },
        );
      })
      .catch((err: unknown) => {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setStep("error");
        }
      });

    return () => {
      active = false;
      // endSession is idempotent (no-op if already closed by transit.ts).
      if (channelRef.current) { endSession(channelRef.current); channelRef.current = null; }
    };
  // restartKey is intentionally included: incrementing it triggers a full
  // effect teardown + re-run, starting a fresh session without a page reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId, office, membership, restartKey]);

  // --- Render helpers -----------------------------------------------------

  function Header({ children }: { children?: React.ReactNode }) {
    return (
      <div className="lf-col-head" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <Building2 size={14} />
          {children}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          style={{
            background: "none", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 5,
            color: "var(--mute)", fontSize: 11.5, fontWeight: 600,
            fontFamily: "inherit", padding: "4px 6px", borderRadius: 7,
          }}
          title="Sign out"
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>
    );
  }

  // membership === null means both the membership query AND the office fetch
  // are still in flight (they run in parallel in the same effect).
  if (membership === null) {
    return (
      <div className="lf">
        <style>{CSS}</style>
        <section className="lf-col">
          <Header>Front desk{office ? ` · ${office.name}` : ""}</Header>
          <div className="lf-console">
            <div className="lf-empty">
              <div className="lf-spin" />
              <p className="lf-empty-title" style={{ marginTop: 14 }}>Checking access…</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // office is null when the officeId UUID doesn't match any row in the
  // offices table — checked after loading completes (membership !== null).
  if (!office) {
    return (
      <div className="lf">
        <style>{CSS}</style>
        <section className="lf-col">
          <Header>Front desk</Header>
          <div className="lf-console">
            <div className="lf-empty">
              <p className="lf-empty-title">Office not recognized</p>
              <p className="lf-empty-body">
                The URL contains an unrecognized office ID. Check that the NFC
                tag or link is current and points to a provisioned office.
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (membership === false) {
    return (
      <div className="lf">
        <style>{CSS}</style>
        <section className="lf-col">
          <Header>Front desk · {office.name}</Header>
          <div className="lf-console">
            <div className="lf-empty">
              <div className="lf-empty-ring"><ShieldAlert size={20} /></div>
              <p className="lf-empty-title">Access denied</p>
              <p className="lf-empty-body">
                Your account ({user?.email}) is not authorized to operate the
                desk for <strong>{office.name}</strong>. Contact your
                administrator to be added to this office.
              </p>
              <button
                type="button"
                onClick={() => void signOut()}
                style={{
                  marginTop: 16, background: "var(--ink)", color: "#fff",
                  border: "none", borderRadius: 10, padding: "10px 18px",
                  fontFamily: "inherit", fontWeight: 600, fontSize: 13,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
                }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const elapsedMs =
    receivedAt > 0 && sessionStart > 0 ? receivedAt - sessionStart : 0;

  // Format the pairing code as XXXX-XXXX for readability.
  const displayCode = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

  // Format the 6-digit SAS as XXX XXX for readability.
  const displaySas = sas.length === 6 ? `${sas.slice(0, 3)} ${sas.slice(3)}` : sas;

  return (
    <div className="lf">
      <style>{CSS}</style>
      <section className="lf-col">
        <Header>Front desk · {office.name}</Header>

        <div className="lf-console" ref={consoleRef}>
          {step === "starting" && (
            <div className="lf-empty">
              <div className="lf-empty-ring"><Wifi size={20} /></div>
              <p className="lf-empty-title">Starting session…</p>
            </div>
          )}

          {step === "waiting" && (
            <div className="lf-empty">
              <div className="lf-empty-ring"><Wifi size={20} /></div>
              <p className="lf-empty-title">No check-ins yet</p>
              <p
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "2.2rem",
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "var(--ink)",
                  margin: "12px 0 4px",
                }}
              >
                {displayCode}
              </p>
              <p className="lf-empty-body">
                When a patient taps and approves, their info arrives here —
                typed, legible, and structured. It travels end-to-end
                encrypted; the relay handles only ciphertext and cannot read
                what was shared.
              </p>
            </div>
          )}

          {step === "sas-active" && (
            /*
             * SAS (Short Authenticated String) confirmation step.
             *
             * The shared key has been derived from the ECDH exchange.
             * A 6-digit code is shown here AND on the patient's screen.
             * If both codes match, the connection is direct (no MITM).
             * If they differ, an active attacker has substituted a key —
             * the patient should tap "Don't match" to abort.
             *
             * The receptionist's role: tell the patient "Do your 6 digits
             * say [code]?" before any data is sent.
             */
            <div className="lf-empty">
              <div className="lf-empty-ring" style={{ background: "#EAEDFB", borderColor: "#C4CCF4", color: "var(--cobalt)" }}>
                <ShieldCheck size={20} />
              </div>
              <p className="lf-empty-title">Patient connecting</p>
              <p className="lf-empty-body" style={{ marginBottom: 4 }}>
                Ask the patient to compare their screen with this code:
              </p>
              <p
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "2.4rem",
                  fontWeight: 700,
                  letterSpacing: "0.2em",
                  color: "var(--cobalt)",
                  margin: "8px 0",
                  background: "#EAEDFB",
                  border: "2px solid #C4CCF4",
                  borderRadius: 14,
                  padding: "14px 24px",
                }}
              >
                {displaySas}
              </p>
              <p className="lf-empty-body">
                If the codes match the patient will tap <strong>Confirm &amp; send</strong>.
                A mismatch means the connection may be intercepted — ask the
                patient to tap <strong>Don't match</strong> and try again.
              </p>
            </div>
          )}

          {step === "received" && packet && (
            <Packet
              packet={packet}
              fresh={fresh}
              imported={imported}
              elapsedMs={elapsedMs}
              onImport={() => setImported(true)}
            />
          )}

          {step === "expired" && (
            <div className="lf-empty">
              <div className="lf-empty-ring"><RotateCcw size={20} /></div>
              <p className="lf-empty-title">Session expired</p>
              <p className="lf-empty-body">
                No check-in arrived within{" "}
                {Math.round(SESSION_TIMEOUT_MS / 60_000)} minutes. Start a new
                session to display a fresh code.
              </p>
              <button
                type="button"
                onClick={handleNewSession}
                style={{
                  marginTop: 18,
                  background: "var(--cobalt)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 20px",
                  fontFamily: "inherit",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                <RotateCcw size={14} /> Start new session
              </button>
            </div>
          )}

          {step === "error" && (
            <div className="lf-empty">
              <div className="lf-empty-ring" style={{ background: "#FEF2F2", borderColor: "#FECACA", color: "#DC2626" }}>
                <ShieldAlert size={20} />
              </div>
              <p className="lf-empty-title">Session error</p>
              <p className="lf-empty-body">{errorMsg}</p>
              <button
                type="button"
                onClick={handleNewSession}
                style={{
                  marginTop: 18,
                  background: "var(--ink)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 20px",
                  fontFamily: "inherit",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                <RotateCcw size={14} /> Start new session
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
