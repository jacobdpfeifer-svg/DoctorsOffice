import { useState } from "react";

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
  const [officeId, setOfficeId] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const NDEFReader = getNDEFReader();
  const supported = NDEFReader !== undefined;

  async function writeTag() {
    if (!NDEFReader) return;
    const trimmed = officeId.trim();
    if (!trimmed) return;

    const url = `${window.location.origin}/o/${trimmed}`;
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

  return (
    <main>
      <h1>Carry — Provision Tag</h1>

      {!supported && (
        <p>
          Web NFC is not supported in this browser. Tag writing works only in
          Chrome on Android.
        </p>
      )}

      <label htmlFor="officeId">Office ID</label>
      <input
        id="officeId"
        type="text"
        value={officeId}
        onChange={(e) => setOfficeId(e.target.value)}
        placeholder="e.g. demo"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />

      <button
        type="button"
        onClick={() => void writeTag()}
        disabled={!supported || officeId.trim() === "" || status.kind === "writing"}
      >
        {status.kind === "writing" ? "Writing…" : "Write tag"}
      </button>

      {status.kind === "writing" && <p>Hold an NFC tag near the device…</p>}
      {status.kind === "success" && <p>Tag written: {status.url}</p>}
      {status.kind === "error" && <p>Failed to write tag: {status.message}</p>}
    </main>
  );
}
