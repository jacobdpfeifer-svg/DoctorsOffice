import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Building2, Wifi, RotateCcw } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getOffice } from "../lib/offices.ts";
import {
  startDeskSession,
  listenForPacket,
  endSession,
} from "../lib/transit.ts";
import type { ConsentedPacket } from "../lib/types.ts";
import { Packet } from "../components/Packet.tsx";
import { CSS } from "../components/styles.ts";

// Mirror the 5-minute window in transit.ts — if no packet arrives in this
// window the desk session has already closed on the server side too.
const EXPIRE_MS = 5 * 60 * 1000;

type Step = "starting" | "waiting" | "received" | "expired" | "error";

export function DeskView() {
  const { officeId } = useParams<{ officeId: string }>();
  const office = officeId ? getOffice(officeId) : undefined;

  const [step, setStep] = useState<Step>("starting");
  const [code, setCode] = useState("");
  const [packet, setPacket] = useState<ConsentedPacket | null>(null);
  const [imported, setImported] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [sessionStart, setSessionStart] = useState(0);
  const [receivedAt, setReceivedAt] = useState(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const expireRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consoleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!officeId || !office) return;
    let active = true;

    startDeskSession(officeId)
      .then(({ code: c, channel }) => {
        if (!active) {
          void channel.unsubscribe();
          return;
        }
        channelRef.current = channel;
        setCode(c);
        const start = Date.now();
        setSessionStart(start);
        setStep("waiting");

        listenForPacket(channel, (pkt) => {
          if (!active) return;
          const now = Date.now();
          setPacket(pkt);
          setReceivedAt(now);
          setFresh(true);
          setImported(false);
          setStep("received");
          // Clear expiry — packet arrived
          if (expireRef.current) { clearTimeout(expireRef.current); expireRef.current = null; }
          setTimeout(() => setFresh(false), 600);
          setTimeout(() => consoleRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 60);
        });

        expireRef.current = setTimeout(() => {
          if (!active) return;
          channelRef.current = null;
          setStep("expired");
        }, EXPIRE_MS);
      })
      .catch((err: unknown) => {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setStep("error");
        }
      });

    return () => {
      active = false;
      if (expireRef.current) { clearTimeout(expireRef.current); expireRef.current = null; }
      if (channelRef.current) { endSession(channelRef.current); channelRef.current = null; }
    };
  }, [officeId, office]);

  if (!office) {
    return (
      <div className="lf">
        <style>{CSS}</style>
        <section className="lf-col">
          <div className="lf-col-head"><Building2 size={14} /> Front desk</div>
          <div className="lf-console">
            <div className="lf-empty">
              <p className="lf-empty-title">Office not recognized</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const elapsedMs =
    receivedAt > 0 && sessionStart > 0 ? receivedAt - sessionStart : 0;

  return (
    <div className="lf">
      <style>{CSS}</style>
      <section className="lf-col">
        <div className="lf-col-head">
          <Building2 size={14} /> Front desk · {office.name}
        </div>

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
                  fontSize: "2.8rem",
                  fontWeight: 700,
                  letterSpacing: "0.25em",
                  color: "var(--ink)",
                  margin: "12px 0 4px",
                }}
              >
                {code}
              </p>
              <p className="lf-empty-body">
                When a patient taps and approves, their info arrives here — typed,
                legible, and structured. Nothing was stored on a server in between.
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
              <p className="lf-empty-title">Code expired, refresh</p>
              <p className="lf-empty-body">
                No check-in arrived within 5 minutes. Refresh the page to start a
                new session.
              </p>
            </div>
          )}

          {step === "error" && (
            <div className="lf-empty">
              <p className="lf-empty-title">Session error</p>
              <p className="lf-empty-body">{errorMsg}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
