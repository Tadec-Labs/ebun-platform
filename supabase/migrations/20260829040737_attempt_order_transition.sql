-- ============================================================
-- EBUN — Atomic Order Transition Write
-- ============================================================
-- Adds attempt_order_transition(): the DB-side counterpart to apps/api's
-- OrderStateMachineService. NestJS validates WHETHER a transition is
-- legal (business rules, in order-state-machine.ts); this function
-- guarantees HOW the write happens — atomically, compare-and-swap
-- against the caller's expected current status, with the matching
-- audit_events row inserted in the same function call. Mirrors
-- attempt_redemption()'s existing pattern for the same reason: prevents
-- two concurrent writers from both passing a stale read and clobbering
-- each other, and prevents a crash between "write status" and "write
-- audit row" from producing an incomplete audit trail.
--
-- This function deliberately does NOT re-check which transitions are
-- legal — see order_status's own comment: "state transitions are
-- enforced in NestJS, not here." It must only ever be called AFTER
-- OrderStateMachineService.assertNormalTransition /
-- assertAdminOverrideTransition has already approved the from->to pair.
-- Duplicating the legality rules here in SQL would create a second
-- source of truth that could silently drift from the TypeScript one.
-- ============================================================

create or replace function attempt_order_transition(
  p_order_id uuid,
  p_expected_status order_status,
  p_new_status order_status,
  p_actor_type actor_type,
  p_actor_id uuid default null,
  p_metadata jsonb default null
)
returns public.orders
language plpgsql
security definer
as $$
declare
  v_order public.orders;
begin
  update public.orders
  set
    status     = p_new_status,
    updated_at = now()
  where id = p_order_id
    and status = p_expected_status
  returning * into v_order;

  if v_order.id is null then
    return null;
  end if;

  insert into public.audit_events (
    event_type, actor_id, actor_type, resource_type, resource_id,
    previous_state, new_state, metadata
  ) values (
    'ORDER_STATUS_CHANGED', p_actor_id, p_actor_type, 'order', p_order_id,
    p_expected_status::text, p_new_status::text, p_metadata
  );

  return v_order;
end;
$$;

comment on function attempt_order_transition is
  'Atomic order status write with audit logging, called only after
   NestJS''s OrderStateMachineService has already validated that the
   from->to transition is legal. Uses a compare-and-swap UPDATE (status
   must still equal p_expected_status) to prevent races between
   concurrent writers, and inserts the audit_events row in the same
   function so a crash cannot leave the audit trail incomplete.
   Returns NULL if the compare-and-swap failed (order not found, or its
   status no longer matches p_expected_status) — the caller must treat
   NULL as a write conflict, not as "the transition was illegal" (that
   was already ruled out by OrderStateMachineService before this
   function was ever called).';