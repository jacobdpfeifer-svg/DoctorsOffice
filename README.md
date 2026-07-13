# Carry

A privacy-first patient check-in PWA. Patients store an encrypted health profile on their own device; when checking in they share a consented subset directly to the front desk via an ephemeral, end-to-end-encrypted channel. No health data is persisted on any server. No account required for patients.

---

## What it does

A patient scans an NFC sticker at the front desk with their phone. The app opens, asks them to select which parts of their health profile to share, and transmits the selection — encrypted end-to-end — to the receptionist's screen. The whole handshake takes seconds.

- **For patients:** profile is stored only on your phone, encrypted with your passphrase. You choose exactly what to share each visit.
- **For staff:** typed, legible, structured patient data appears on the desk screen the moment the patient approves. No paper forms, no manual transcription.

---

## Architecture

```
Patient device (browser)          Supabase               Staff device (browser)
─────────────────────────         ──────────             ──────────────────────
Profile (encrypted, IndexedDB)
         │
         │ tap NFC tag
         ▼
  open /o/:officeId
         │
         │ ECDH keypair              Realtime
         │ "join" ping  ──────────► channel  ──────────► /desk/:officeId
         │                                               ECDH keypair
         │                                               "desk-pubkey"
         │ ◄─────────────────────── relay  ─────────────      │
         │                                                     │
         │ derive shared key (ECDH + HKDF + transcript)        │
         │                                               derive shared key
         │                                                     │
         │ SAS display ←────────── (human comparison) ──────► SAS display
         │                                                     │
         │ AES-GCM(packet) ──────► relay  ──────────────────► │
         │                                               AES-GCM decrypt
         │                                               → onPacket callback
         │                                               AES-GCM(ack) ──────►
         │ ◄─────────────────────── relay  ──────────────── ack
         ▼
   show "Confirmed"
```

The Supabase Realtime relay is **in the path** of every message and can observe metadata (IPs, timing, channel names) but **never sees plaintext health data** — only ciphertext.

### Two flows

**Patient flow** (`/o/:officeId`) — unauthenticated

1. First visit: fill in a health profile → encrypt with Argon2id + AES-GCM → store in IndexedDB.
2. Returning visit: enter passphrase → decrypt profile in memory.
3. Consent screen: select which categories to share.
4. Join the desk's Realtime channel via the 8-character pairing code.
5. ECDH key exchange → derive shared key + Short Authenticated String.
6. Human SAS comparison (MITM detection).
7. Encrypt and send the consented packet; wait for authenticated ack.
8. PHI is wiped from React state immediately after send.

**Staff flow** (`/desk/:officeId`, `/provision`) — requires Supabase Auth + office membership

- Staff sign in via magic link or email/password.
- `ProtectedRoute` gates both `/desk/:officeId` and `/provision`.
- `office_staff` RLS enforces per-office membership on top of authentication.
- Desk opens a Realtime channel with a fresh pairing code; displays it on screen.
- Receptionist asks patient to compare SAS before any data is sent.
- Decrypted packet appears on screen; can be imported to the chart.
- `/provision` writes NFC tags for authorised offices only (Chrome on Android).

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19 + TypeScript 6 + Vite 8 |
| Routing | React Router DOM 7 |
| Backend / auth / realtime | Supabase (Postgres, Auth, Realtime) |
| At-rest encryption | Argon2id via `hash-wasm` → HKDF → AES-GCM |
| Transit encryption | ECDH P-256 + HKDF → AES-GCM (Web Crypto API) |
| Runtime frame validation | Zod 4 |
| PWA / offline | vite-plugin-pwa (Workbox, precached fonts + assets) |
| NFC tag writing | Web NFC API (Chrome on Android) |
| Icons | Lucide React |
| Fonts | Self-hosted via `@fontsource` (no Google Fonts request) |

---

## Quick start

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier is fine for development)

### Install and run

```bash
cp .env.example .env     # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev              # http://localhost:5173
```

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check + production build → `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Type-check only (no emit) |

### Environment variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL (`https://xxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Project anon/public key (safe to expose in the browser) |

Both are exposed to the browser via the `VITE_` prefix. **Never put the service-role key here.**

---

## Routes

| Path | Auth required | Description |
|---|---|---|
| `/o/:officeId` | No | Patient check-in flow (tap NFC tag → fill form → send) |
| `/desk/:officeId` | **Yes + office membership** | Front-desk receiver |
| `/provision` | **Yes** | Write NFC tags (Chrome on Android) |
| `/login` | No | Staff sign-in |
| `/` and `*` | No | Public landing — "Scan the NFC sticker to check in" |

---

## Supabase project setup

### 1. Enable Auth

In the Supabase dashboard go to **Authentication → Providers** and ensure **Email** is enabled. Choose between:

- **Magic Link** (recommended) — passwordless; staff click a link in their inbox.
- **Email + Password** — turn on "Confirm email" in Auth settings if you want address verification.

Set `Site URL` (Auth → URL Configuration) to your deployment origin, e.g. `https://carry.yourdomain.com`. Add `/login` (and any preview URLs) to **Redirect URLs**.

### 2. Run the migrations

Apply the SQL files in `supabase/migrations/` in order. Use the Supabase **SQL Editor** or the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase db push
```

#### Migration 1 — `office_staff` table (`20250101000000_office_staff.sql`)

Creates `public.office_staff (user_id, office_id)` with RLS:

- `authenticated` users may **SELECT** their own rows.
- All mutations are restricted to the **service role** (admin only).

#### Migration 2 — Realtime RLS (`20250101000001_realtime_rls.sql`)

Enables row-level security on `realtime.messages` and installs policies for the `carry:{officeId}:{code}` channel namespace:

| Role | Permission |
|---|---|
| `anon` | Full access to any `carry:*` channel (required for unauthenticated patients) |
| `authenticated` | Access only to `carry:{officeId}:*` channels where they have an `office_staff` row for that `officeId` |

> **Note:** `realtime.messages` RLS requires Realtime to run in **Row Level Security** mode. Enable this in **Realtime → Policies** in the dashboard, or run:
>
> ```sql
> ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
> ```

#### Migration 3 — `offices` table (`20250101000002_offices.sql`)

Creates `public.offices (id uuid, name text)` with RLS:

- Publicly readable (required for the patient flow).
- Only the service role may insert/update/delete.

Office IDs are opaque UUIDs (`gen_random_uuid()`). Add at least one row before provisioning NFC tags.

#### Migration 4 — Realtime RLS v2 (`20250101000003_realtime_rls_v2.sql`)

Tightens the `anon` Realtime policy to validate that the `officeId` segment of the channel name corresponds to a real row in `public.offices`.

### 3. Add offices

In the Supabase **Table Editor** (or SQL Editor), insert a row for each clinic location:

```sql
INSERT INTO public.offices (name)
VALUES ('Main Street Clinic');
-- Postgres generates the UUID automatically via gen_random_uuid()
```

Copy the generated UUID — you will need it for `office_staff` membership and for provisioning NFC tags.

### 4. Add staff members

Staff users must sign in at least once (so Supabase creates their `auth.users` row), then be granted access to an office:

```sql
-- Grant a staff member access to an office
INSERT INTO public.office_staff (user_id, office_id)
VALUES (
  'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',  -- auth.users.id from Authentication → Users
  'yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy'   -- offices.id from the offices table
);
```

A staff member may belong to multiple offices; insert one row per office.

### 5. Provision NFC tags

1. Sign in at `/login` with a staff account that belongs to the office.
2. Navigate to `/provision` on a Chrome for Android device.
3. Select the office from the dropdown (only offices you are a member of are shown).
4. Hold an NFC tag to the back of the phone and tap **Write tag**.

The tag stores a URL of the form `https://your-domain.com/o/<office-uuid>`. When a patient taps it, they are taken directly to that office's check-in flow.

---

## Auth flow summary

```
Staff visits /desk/<office-uuid>
       │
       ▼
ProtectedRoute checks Supabase session
       │ no session
       ▼
/login  ──magic link or password──▶  Supabase Auth
                                           │ signed in
                                           ▼
                                  redirect back to /desk/<office-uuid>
                                           │
                                           ▼
                             DeskView queries office_staff
                              (enforced by RLS server-side)
                                           │ no row
                                           ▼
                                    "Access denied" screen
                                           │ row found
                                           ▼
                                   Desk session starts
                             (Realtime channel open, JWT sent)
                                           │
                              Realtime RLS checks policy:
                              authenticated + office member?
                                           │ yes
                                           ▼
                                   Waiting for patients
```

Patient flow (`/o/:officeId`) is entirely unauthenticated — the `anon` Realtime policy permits patients to join channels. Per-session ECDH encryption ensures that anyone who subscribes to the same channel receives only ciphertext they cannot decrypt without the desk's ephemeral private key.

---

## Security model

### Cryptographic layers

| Layer | Mechanism |
|---|---|
| Patient profile at rest | Argon2id (memory-hard KDF, per-device random salt) → HKDF → AES-GCM; key derived from a 6+ character alphanumeric passphrase stored only in the patient's head |
| Transit encryption | Ephemeral ECDH P-256 key exchange + HKDF with cryptographic transcript binding (both public keys + pairing code in `info`) → AES-GCM per message |
| MITM detection | Short Authenticated String (SAS): a 6-digit code derived from the session key is displayed on both screens; staff asks the patient to compare before any data is sent |
| Delivery confirmation | Authenticated ack: the desk broadcasts an AES-GCM-encrypted acknowledgement after decryption; the patient waits for it before showing "confirmed" |
| Replay protection | Per-session IV deduplication (`seenIVs`) and a `packetDelivered` flag; duplicate or replayed packet frames are silently dropped |
| Input validation | Every inbound Realtime frame is validated with Zod before use; malformed frames are logged and dropped, never thrown into application logic |
| PHI minimisation | Decrypted profile, draft, and consented packet are wiped from React state immediately after a successful or unconfirmed send |
| Desk UI access | Supabase Auth session required (JWT checked client-side by `ProtectedRoute`) |
| Desk office membership | `office_staff` row required; Postgres RLS blocks unauthorised reads server-side |
| Realtime channel access | `realtime.messages` RLS policies; authenticated staff restricted to their office's channels; `anon` permitted for the patient flow |
| Office IDs | Opaque UUIDs stored in `public.offices`; not enumerable from the client bundle |
| NFC provisioning | `/provision` is authenticated + membership-scoped; only offices the user belongs to appear in the dropdown |
| No third-party font requests | Fonts are self-hosted via `@fontsource`; no Google Fonts request is made at runtime |

### What the relay (Supabase) can observe

Supabase Realtime is a relay server — not a peer-to-peer connection. The relay is **in the path** of every message. It cannot read patient health information, but it **can** observe:

- That a check-in occurred and when
- The IP addresses of both the patient's device and the desk
- The channel name, which encodes the office UUID and the 8-character pairing code
- That encrypted data was exchanged (ciphertext and public keys are visible to the relay)
- Supabase Auth metadata: email addresses of staff, login timestamps

The relay **cannot** observe:

- The plaintext patient health information (names, dates of birth, medications, etc.)
- Which specific fields a patient chose to share
- The session key — it is derived from an ECDH exchange whose private keys never leave the respective devices

---

## Threat model

### What this design is intended to protect against

| Threat | Mitigation |
|---|---|
| Passive eavesdropper on the Supabase channel | AES-GCM end-to-end encryption; relay sees only ciphertext |
| Active MITM substituting public keys | SAS (Short Authenticated String): human comparison of a 6-digit code on both screens before transmission |
| Brute-force of the patient's stored profile | Argon2id with a per-device salt; client-side unlock throttling with exponential back-off |
| Replay of a previously captured packet | Per-session IV deduplication; `packetDelivered` flag prevents duplicate delivery |
| Malformed/malicious frame from a rogue channel participant | Zod schema validation on every inbound frame; invalid frames are dropped and logged |
| Brute-force of pairing codes | Supabase Realtime RLS rate-limits subscription attempts; codes are 8-character unambiguous random alphanumeric (~47 bits) |
| Code reuse across sessions | In-memory single-use registry per office; consumed sessions reject late joiners with a clear error |
| Enumeration of office IDs | Office IDs are opaque UUIDs; not hardcoded in the client bundle |
| Unauthorised desk access | Supabase Auth + `office_staff` RLS; a valid session does not grant access to offices the user is not a member of |
| Writing NFC tags for unauthorised offices | `/provision` filters the office dropdown to the user's `office_staff` memberships; write is guarded against stale/bypassed selection |

### Limitations and known assumptions

> **This codebase has not undergone a formal third-party security audit.**
> The following limitations are inherent to the architecture and are documented here, not hidden.

1. **The relay is a trusted intermediary for metadata.** Supabase observes connection events, IPs, and channel names. If Supabase or its infrastructure is compromised or compelled by legal process, that metadata may be disclosed. Plaintext health data would not be exposed, but the fact that check-ins occurred would be.

2. **The SAS check is voluntary.** The security of the MITM-detection step depends on the receptionist actually comparing the 6-digit code with the patient before data is sent. If staff skip this step, a MITM attack substituting keys would go undetected.

3. **Device trust.** If the patient's device or the desk device is compromised (malware, rogue browser extension, physical access), an attacker with local access could read the profile passphrase at entry time or intercept the decrypted packet. This system does not defend against a compromised endpoint.

4. **The office retains what is shared.** Once the packet is decrypted on the desk, the health information is in the office's hands. Its subsequent handling (storage in an EHR, access controls, etc.) is outside Carry's scope.

5. **No server-side audit log.** There is no server-side record of what data was transmitted in a session. An office cannot reconstruct a session from Supabase logs. This is a privacy benefit but also means there is no tamper-evident audit trail.

6. **Argon2id parameters may need tuning.** The memory and iteration parameters for Argon2id should be benchmarked on target devices and adjusted before production use. Parameters that are too low weaken the passphrase protection; parameters that are too high may make unlock too slow on low-end phones.

7. **ECDH is not a PAKE.** The handshake relies on HKDF transcript binding and human SAS verification, not a Password Authenticated Key Exchange. A fully automated cryptographic verification would require a PAKE such as SPAKE2 or CPace. The SAS step is a pragmatic mitigation, not a cryptographic guarantee.

8. **Browser storage isolation.** The encrypted profile is stored in the browser's IndexedDB, which is isolated by origin but accessible to any JavaScript running on that origin. Malicious scripts loaded via XSS could access it. Standard web security hygiene (Content Security Policy, no inline scripts from untrusted sources) applies.

9. **Client-side JWT verification.** `ProtectedRoute` checks the Supabase session in the browser. This is adequate for UX gating; Supabase RLS enforces the hard authorization boundary server-side. Staff should be advised that clearing browser state may require re-authentication.
