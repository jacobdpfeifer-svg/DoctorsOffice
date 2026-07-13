-- Migration: Realtime channel authorization (RLS on realtime.messages)
--
-- Carry uses Supabase Realtime broadcast channels named:
--   carry:{officeId}:{8-char-pairing-code}
--
-- These policies control who may subscribe to and broadcast on those channels
-- at the server level, so client-side auth checks cannot be bypassed.
--
-- IMPORTANT — Prerequisites before running this migration:
--   1. In the Supabase dashboard, go to Database → Extensions and enable the
--      "supabase_realtime" extension if it isn't already active.
--   2. Enable RLS on the realtime.messages table. You can do this in the
--      dashboard under Realtime → Policies, or run:
--        ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
--      (The ALTER TABLE line is included below for convenience, but it may
--       require superuser/postgres credentials depending on your Supabase plan.)
--
-- Policy design:
--   • anon role      — patients are never signed in; they must be able to
--                      join any carry:* channel to send their encrypted packet.
--                      The 8-char pairing code and ECDH encryption already
--                      guarantee that eavesdropping on the channel yields only
--                      ciphertext, so allowing anon access here is safe.
--   • authenticated role — a signed-in staff user may only use channels whose
--                      officeId matches a row in public.office_staff for their
--                      user_id. This prevents a rogue staff account from
--                      subscribing to another clinic's desk channels.

-- Enable RLS (idempotent; safe to run multiple times).
alter table realtime.messages enable row level security;

-- ─── anon (patients) ──────────────────────────────────────────────────────
-- Patients are unauthenticated and may participate in any carry:* channel.
create policy "anon can use carry channels"
  on realtime.messages
  for all
  to anon
  using  (realtime.topic() like 'carry:%')
  with check (realtime.topic() like 'carry:%');

-- ─── authenticated (staff) ────────────────────────────────────────────────
-- Staff may only use channels whose embedded officeId they are authorized for.
-- The channel topic format is  carry:{officeId}:{code}  so the officeId is
-- the second colon-delimited segment: split_part(topic, ':', 2).
create policy "authenticated staff can use authorized office carry channels"
  on realtime.messages
  for all
  to authenticated
  using (
    realtime.topic() like 'carry:%'
    and exists (
      select 1
      from   public.office_staff os
      where  os.user_id   = auth.uid()
        and  os.office_id = split_part(realtime.topic(), ':', 2)
    )
  )
  with check (
    realtime.topic() like 'carry:%'
    and exists (
      select 1
      from   public.office_staff os
      where  os.user_id   = auth.uid()
        and  os.office_id = split_part(realtime.topic(), ':', 2)
    )
  );
