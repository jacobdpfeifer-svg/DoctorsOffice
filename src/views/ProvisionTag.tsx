import { useState } from "react";
import { useEffect } from "react";
import { Check, Copy, LogOut } from "lucide-react";
import { fetchAuthorizedOffices, type Office } from "../lib/offices.ts";
import { useAuth } from "../context/AuthContext.tsx";
import { CSS } from "../components/styles.ts";

// Minimal local typing for the Web NFC API (not in the TS DOM lib).
interface NDEFReaderLike {
  write(message: string): Promise<void>;
}
type NDEFReaderConstructor = new () => NDEFReaderLike;

function getNDEFReader(): NDEFReaderConstructor | undefined {
  return (window as unknown as { NDEFReader?: NDEFReaderConstructor })
    .NDEFReader;
}

type Status =
  | { kind: "idle" }
  | { kind: "writing" }
  | { kind: "success"; url: string }
  | { kind: "error"; message: string };

export function ProvisionTag() {
  const { user, signOut } = useAuth();

  const [offices, setOffices] = useState<Office[]>([]);
  const [officesLoading, setOfficesLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [urlCopied, setUrlCopied] = useState(false);

  const NDEFReader = getNDEFReader();
  const nfcSupported = NDEFReader !== undefined;

  // Load only the offices this staff member is authorised to manage.
  useEffect(() => {
    if (!user) {
      setOfficesLoading(false);
      return;
    }

    let cancelled = false;

    fetchAuthorizedOffices(user.id)
      .then((list) => {
        if (cancelled) return;
        setOffices(list);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .catch(() => {
        if (!cancelled) setOffices([]);
      })
      .finally(() => {
        if (!cancelled) setOfficesLoading(false);
      });

    return () => { cancelled = true; };
  }, [user]);

  async function writeTag() {
    if (!NDEFReader || !selectedId) return;

    // Belt-and-suspenders: verify the chosen office is still in the
    // authorised list before writing.
    if (!offices.some((o) => o.id === selectedId)) {
      setStatus({
        kind: "error",
        message:
          "Selected office is not in your authorised list. " +
          "Reload the page and try again.",
      });
      return;
    }

    const url = `${window.location.origin}/o/${selectedId}`;
    setStatus({ kind: "writing" });

    try {
      const reader = new NDEFReader();
      await reader.write(url);
      setStatus({ kind: "success", url });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function copyUrl() {
    if (!selectedId) return;
    const url = `${window.location.origin}/o/${selectedId}`;
    try {
      await navigator.clipboard.writeText(url);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch {
      // Clipboard unavailable — no-op; the URL is shown on screen.
    }
  }

  const selectedOffice = offices.find((o) => o.id === selectedId);
  const tagUrl = selectedOffice
    ? `${window.location.origin}/o/${selectedOffice.id}`
    : "";

  return (
    <div className="lf">
      <style>{CSS}</style>
      <section className="lf-col">
        {/* Header */}
        <div
          className="lf-col-head"
          style={{ justifyContent: "space-between", marginBottom: 10 }}
        >
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            Carry — Provision NFC Tag
          </span>
          <button
            type="button"
            className="lf-signout"
            onClick={() => void signOut()}
            title="Sign out"
          >
            <LogOut size={13} aria-hidden="true" /> Sign out
          </button>
        </div>

        <div className="lf-console">
          <div
            style={{
              padding: "20px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {/* Office selector */}
            <div>
              <label
                htmlFor="officeSelect"
                style={{
                  display: "block",
                  fontWeight: 600,
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                Office
              </label>

              {officesLoading ? (
                <p style={{ color: "var(--mute)", fontSize: 13 }}>
                  Loading offices…
                </p>
              ) : offices.length === 0 ? (
                <div
                  className="lf-warn-note"
                  role="alert"
                  style={{ fontSize: 12.5 }}
                >
                  <p>
                    Your account ({user?.email}) is not authorised to manage any
                    offices. Contact your administrator to be granted office
                    membership.
                  </p>
                </div>
              ) : (
                <select
                  id="officeSelect"
                  value={selectedId}
                  onChange={(e) => {
                    setSelectedId(e.target.value);
                    setStatus({ kind: "idle" });
                  }}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: 10,
                    border: "1.5px solid var(--line)",
                    fontFamily: "inherit",
                    fontSize: 13,
                    background: "var(--paper)",
                    color: "var(--ink)",
                    cursor: "pointer",
                  }}
                >
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* URL preview + copy button */}
            {selectedOffice && (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <p style={{ fontWeight: 600, fontSize: 13, margin: 0 }}>
                    Tag URL
                  </p>
                  {/* Copy URL is available on every platform — a QR code generator
                      or shared link can serve as a non-NFC alternative. */}
                  <button
                    type="button"
                    onClick={() => void copyUrl()}
                    disabled={!selectedId}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      color: urlCopied ? "var(--jade)" : "var(--cobalt)",
                      fontFamily: "inherit",
                      fontWeight: 600,
                      fontSize: 12,
                      padding: "3px 6px",
                      borderRadius: 6,
                    }}
                    aria-label="Copy tag URL to clipboard"
                  >
                    {urlCopied ? (
                      <><Check size={12} aria-hidden="true" /> Copied</>
                    ) : (
                      <><Copy size={12} aria-hidden="true" /> Copy URL</>
                    )}
                  </button>
                </div>
                <code
                  style={{
                    display: "block",
                    fontSize: 11,
                    wordBreak: "break-all",
                    background: "var(--line-2)",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    color: "var(--mute)",
                  }}
                  aria-label="Tag URL"
                >
                  {tagUrl}
                </code>
                <p style={{ fontSize: 11, color: "var(--mute)", marginTop: 5 }}>
                  The office ID is a non-guessable UUID — keep the tag URL
                  confidential. You can also paste it into a QR code generator
                  as a non-NFC check-in option.
                </p>
              </div>
            )}

            {/* NFC not supported — copy URL is the fallback */}
            {!nfcSupported && (
              <div className="lf-warn-note" role="status" style={{ fontSize: 12.5 }}>
                <p>
                  Web NFC is not supported in this browser — tag writing requires
                  Chrome on Android. Use <strong>Copy URL</strong> above to get
                  the check-in link and convert it to a QR code or share it
                  another way.
                </p>
              </div>
            )}

            {/* Write button — only shown on NFC-capable browsers */}
            {nfcSupported && (
              <button
                type="button"
                onClick={() => void writeTag()}
                disabled={
                  !selectedId ||
                  status.kind === "writing" ||
                  offices.length === 0
                }
                style={{
                  background:
                    selectedId && status.kind !== "writing" && offices.length > 0
                      ? "var(--ink)"
                      : "var(--line)",
                  color:
                    selectedId && status.kind !== "writing" && offices.length > 0
                      ? "#fff"
                      : "var(--mute)",
                  border: "none",
                  borderRadius: 10,
                  padding: "12px 18px",
                  fontFamily: "inherit",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor:
                    selectedId && status.kind !== "writing" && offices.length > 0
                      ? "pointer"
                      : "not-allowed",
                  transition: "background 0.15s",
                }}
                aria-busy={status.kind === "writing"}
              >
                {status.kind === "writing"
                  ? "Hold tag near device…"
                  : "Write tag"}
              </button>
            )}

            {/* Status feedback — role="status" announces to screen readers politely */}
            {status.kind === "success" && (
              <div
                role="status"
                style={{
                  background: "#F0FDF4",
                  border: "1px solid #86EFAC",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 12.5,
                  color: "#166534",
                }}
              >
                Tag written for <strong>{selectedOffice?.name}</strong>.
              </div>
            )}

            {status.kind === "error" && (
              <div
                role="alert"
                style={{
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 12.5,
                  color: "#991B1B",
                }}
              >
                Write failed: {status.message}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
