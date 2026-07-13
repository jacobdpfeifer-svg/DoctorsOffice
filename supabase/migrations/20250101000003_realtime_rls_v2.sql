-- Migration: tighten Realtime RLS — validate officeId against offices table
--
-- Supersedes the broad anon policy from 20250101000001_realtime_rls.sql.
--
-- Threat model improvement:
--   Before: any unauthenticated client could subscribe to carry:*:* channels,
--   making the 8-char pairing code (2^40 space) the only server-enforced
--   barrier against brute-force subscription attempts.
--
--   After: the officeId segment of the channel name MUST correspond to a row
--   in public.offices.  Because office IDs are non-guessable UUIDs (128 bits),
--   an attacker must guess both:
--     • a valid office UUID  (~2^128 search space)
--     • a valid 8-char pairing code  (~2^40 search space)
--   Combined, this makes brute-force subscription attempts computationally
--   infeasible with no Supabase-side rate limiting required (though enabling
--   Supabase's built-in connection rate limits is still recommended).
--
-- Channel topic format: carry:{officeId}:{pairingCode}
--   officeId   = UUID (from public.offices.id)
--   pairingCode = 8 chars from the unambiguous alphabet ABCDEFGHJKLMNPQRSTUVWXYZ23456789

-- Drop the old broad anon policy (idempotent with IF EXISTS).
drop policy if exists "anon can use carry channels" on realtime.messages;

-- Replace with a policy that validates officeId against the offices table.
-- split_part(realtime.topic(), ':', 2) extracts the second colon-delimited
-- segment, which is the officeId UUID string.  Casting to uuid for comparison
-- also rejects malformed (non-UUID) officeId strings at no extra cost.
create policy "anon can use carry channels for known offices"
  on realtime.messages
  for all
  to anon
  using (
    realtime.topic() like 'carry:%'
    and exists (
      select 1 from public.offices o
      where o.id = split_part(realtime.topic(), ':', 2)::uuid
    )
  )
  with check (
    realtime.topic() like 'carry:%'
    and exists (
      select 1 from public.offices o
      where o.id = split_part(realtime.topic(), ':', 2)::uuid
    )
  );

-- The authenticated staff policy from 20250101000001 already validates via
-- office_staff membership; no changes required there.  Optionally add the
-- offices table cross-check for defense in depth:
--
-- drop policy if exists "authenticated staff can use authorized office carry channels" on realtime.messages;
-- create policy "authenticated staff can use authorized office carry channels"
--   on realtime.messages for all to authenticated
--   using (
--     realtime.topic() like 'carry:%'
--     and exists (
--       select 1 from public.office_staff os
--       join public.offices o on o.id = os.office_id::uuid
--       where os.user_id = auth.uid()
--         and os.office_id = split_part(realtime.topic(), ':', 2)
--     )
--   )
--   with check (
--     realtime.topic() like 'carry:%'
--     and exists (
--       select 1 from public.office_staff os
--       join public.offices o on o.id = os.office_id::uuid
--       where os.user_id = auth.uid()
--         and os.office_id = split_part(realtime.topic(), ':', 2)
--     )
--   );
