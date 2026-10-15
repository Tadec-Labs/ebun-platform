-- Proof of delivery for doorstep gifts.
--
-- Until now "Delivered" was the vendor's word alone, and it credited
-- them on the spot. A vendor could be paid for a gift that never reached
-- the door. Now every doorstep gift has a 4-digit handover code that only
-- the recipient sees (on their gift page). The vendor marks it delivered
-- by entering that code — the rider asks for it at the door — or the
-- recipient taps "I've received it" themselves. Ops can still confirm by
-- hand (after speaking to the recipient), and that is recorded as such.
--
-- Four digits because it is read aloud at a gate. Guessing is bounded by
-- handover_code_attempts: five tries per delivery, then only the
-- recipient or ops can complete it.

alter table public.gift_fulfillments
  add column handover_code text
    not null
    -- Volatile default: every existing row gets its own random code too.
    -- gen_random_uuid() is core Postgres and cryptographically random;
    -- 32 bits of it, mod 10,000 (bias is negligible at this size).
    default lpad(
      ((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 10000)::text,
      4,
      '0'
    )
    check (handover_code ~ '^[0-9]{4}$'),
  add column handover_code_attempts integer not null default 0
    check (handover_code_attempts >= 0);

comment on column public.gift_fulfillments.handover_code is
  'Doorstep gifts: 4-digit code shown only to the recipient; the vendor must enter it to mark the gift delivered.';
comment on column public.gift_fulfillments.handover_code_attempts is
  'Codes tried by the vendor for this delivery, right or wrong. Locked at 5.';
comment on column public.gift_fulfillments.delivery_confirmation is
  'How delivery was confirmed: code (vendor entered the recipient''s code), recipient (they tapped "I''ve received it"), ops (staff, after speaking to the recipient), vendor (before handover codes existed).';

-- ------------------------------------------------------------------
-- try_handover_code
--
-- One vendor attempt at the code, counted and compared under the row
-- lock, so parallel guesses can't get past the limit. Only the vendor the
-- delivery is assigned to, only while it's still open. The code itself
-- never leaves the database through this function.
--
-- Returns: 'ok' | 'wrong' | 'locked' | 'not_found'. A correct code on the
-- fifth try still counts; the sixth try is refused without comparing.
-- ------------------------------------------------------------------
create or replace function public.try_handover_code(
  p_order_id  uuid,
  p_vendor_id uuid,
  p_code      text
) returns text
language plpgsql
as $$
declare
  v_row public.gift_fulfillments%rowtype;
begin
  select * into v_row
    from public.gift_fulfillments
   where order_id = p_order_id
     and fulfillment_type = 'physical'
     and vendor_id = p_vendor_id
     and delivered_at is null
     for update;
  if not found then
    return 'not_found';
  end if;

  if v_row.handover_code_attempts >= 5 then
    return 'locked';
  end if;

  update public.gift_fulfillments
     set handover_code_attempts = handover_code_attempts + 1
   where id = v_row.id;

  if v_row.handover_code = p_code then
    return 'ok';
  end if;
  return case when v_row.handover_code_attempts + 1 >= 5 then 'locked' else 'wrong' end;
end;
$$;

revoke execute on function public.try_handover_code(uuid, uuid, text)
  from public, anon, authenticated;
