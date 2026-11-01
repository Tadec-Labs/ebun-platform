-- Event gift lists: one delivery address for every doorstep gift.
--
-- Before this, each gift on a wedding's list became its own order to the
-- host, and the host had to open every one and type the same address.
-- Now the host gives it once on their page; each doorstep gift paid for
-- from the list carries it from the moment its order exists, and the
-- usual delivery flow assigns a shop straight away. The note tells the
-- shop to deliver after the event, and whose gift it is.
--
-- If the host's area isn't one a gift's shops deliver to, that gift
-- quietly falls back to asking the host on its reveal (the existing
-- behaviour of applySenderAddress) — never a failed order.

alter table public.events
  add column delivery_address    text check (char_length(delivery_address) between 5 and 300),
  add column delivery_area       text check (char_length(delivery_area) between 2 and 80),
  add column delivery_note       text check (char_length(delivery_note) <= 200),
  add column delivery_details_at timestamptz;

comment on column public.events.delivery_address is
  'Where doorstep gifts from the gift list go. Personal data: returned only on the host page, never to guests.';

-- Same function as 20261025100000_group_gifting.sql, plus the event block.
create or replace function public.trigger_group_gift(p_group_gift_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_pot      public.group_gifts%rowtype;
  v_fees     bigint;
  v_order_id uuid;
  v_moved    public.orders;
  v_send_at  timestamptz;
begin
  select * into v_pot from public.group_gifts where id = p_group_gift_id for update;
  if v_pot.id is null then
    raise exception 'group_gift_not_found';
  end if;
  if v_pot.status = 'triggered' then
    return v_pot.linked_order_id;
  end if;
  if v_pot.status <> 'funded' then
    raise exception 'group_gift_not_funded';
  end if;
  if v_pot.gift_value is null then
    raise exception 'group_gift_has_no_price';
  end if;

  -- Fees on the shares that paid for the gift; a switch's surplus refund
  -- returns gift value only, so every fee here was genuinely earned.
  select coalesce(sum(service_fee), 0) into v_fees
    from public.group_gift_contributions
   where group_gift_id = p_group_gift_id and status = 'confirmed';

  -- A send time already past means "now".
  v_send_at := case when v_pot.send_at > now() then v_pot.send_at else null end;

  insert into public.orders (
    sender_id, gift_template_id, recipient_name, recipient_phone,
    sender_message, message_type, scheduled_send_at, status,
    total_amount, gift_value, delivery_fee, service_fee,
    reveal_theme, group_gift_id, expires_at
  ) values (
    v_pot.organiser_id, v_pot.gift_template_id, v_pot.recipient_name, v_pot.recipient_phone,
    v_pot.sender_message,
    case when v_pot.sender_message is null then null else 'text' end,
    v_send_at, 'pending_payment',
    v_pot.gift_value + v_pot.delivery_fee + v_fees, v_pot.gift_value, v_pot.delivery_fee, v_fees,
    v_pot.reveal_theme, p_group_gift_id,
    coalesce(v_send_at, now()) + interval '30 days'
  ) returning id into v_order_id;

  v_moved := public.attempt_order_transition(
    v_order_id, 'pending_payment', 'paid', 'webhook', null,
    jsonb_build_object('groupGiftId', p_group_gift_id)
  );
  if v_moved.id is null then
    raise exception 'group_gift_order_transition_failed';
  end if;
  update public.orders set payment_verified_at = now() where id = v_order_id;

  -- An item on an event's gift list, for a doorstep gift: deliver it to
  -- the address the host gave once, after the event. The delivery flow
  -- (DeliveriesService.applySenderAddress) assigns a shop from here, so
  -- the host never fills in an address per gift.
  if v_pot.event_id is not null then
    update public.orders o
       set delivery_address = e.delivery_address,
           delivery_zone = e.delivery_area,
           delivery_phone = e.host_phone,
           delivery_note = left(
             concat_ws(' · ',
               nullif(e.delivery_note, ''),
               'Gift for ' || e.title,
               'Deliver from ' || to_char(e.event_date + 1, 'Dy DD Mon')),
             300),
           delivery_details_at = now()
      from public.events e, public.gift_templates g
     where o.id = v_order_id
       and e.id = v_pot.event_id
       and e.delivery_address is not null
       and e.delivery_area is not null
       and g.id = v_pot.gift_template_id
       and g.delivery_type = 'physical';
  end if;

  update public.group_gifts
     set status = 'triggered', linked_order_id = v_order_id
   where id = p_group_gift_id;

  insert into public.audit_events (
    event_type, actor_id, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  ) values (
    'group_gift.triggered', null, 'system', 'group_gift', p_group_gift_id,
    'funded', 'triggered',
    jsonb_build_object('orderId', v_order_id, 'raised', v_pot.amount_raised, 'fees', v_fees)
  );

  return v_order_id;
end;
$$;

revoke execute on function public.trigger_group_gift(uuid) from public, anon, authenticated;
