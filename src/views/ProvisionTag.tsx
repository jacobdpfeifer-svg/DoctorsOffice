import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
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

  const NDEFReader = getNDEFReader();
  const nfcSupported = NDEFReader !== undefined;

  // Load only the offices this staff member is authorised to manage.
  // fetchAuthorizedOffices filters via office_staff, so a staff member
  // cannot write tags for offices they are not a member of.
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
    // authorised list before writing.  This guards against stale state and
    // any UI-level bypass of the disabled/empty-list checks.
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

  const selectedOffice = offices.find((o) => o.id === selectedId);

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
            onClick={() => void signOut()}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              color: "var(--mute)",
              fontSize: 11.5,
              fontWeight: 600,
              fontFamily: "inherit",
              padding: "4px 6px",
              borderRadius: 7,
            }}
            title="Sign out"
          >
            <LogOut size={13} /> Sign out
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
                  style={{
                    background: "#FEF9EC",
                    border: "1px solid #FDE68A",
                    borderRadius: 10,
                    padding: "10px 14px",
                    fontSize: 12.5,
                    color: "#78350F",
                  }}
                >
                  Your account ({user?.email}) is not authorised to manage any
                  offices. Contact your administrator to be granted office
                  membership.
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

            {/* URL preview */}
            {selectedOffice && (
              <div>
                <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  Tag URL
                </p>
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
                >
                  {window.location.origin}/o/{selectedOffice.id}
                </code>
                <p style={{ fontSize: 11, color: "var(--mute)", marginTop: 5 }}>
                  The office ID is a non-guessable UUID — keep the tag URL
                  confidential.
                </p>
              </div>
            )}

            {/* NFC not supported notice */}
            {!nfcSupported && (
              <div
                style={{
                  background: "#FEF9EC",
                  border: "1px solid #FDE68A",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 12.5,
                  color: "#78350F",
                }}
              >
                Web NFC is not supported in this browser. Tag writing requires
                Chrome on Android.
              </div>
            )}

            {/* Write button */}
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
              >
                {status.kind === "writing"
                  ? "Hold tag near device…"
                  : "Write tag"}
              </button>
            )}

            {/* Status feedback */}
            {status.kind === "success" && (
              <div
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
