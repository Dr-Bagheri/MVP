-- 0095 — a named door for deleting ONE summary version.
--
-- Versions are append-only for writers (0008: replacing = a new INSERT, the
-- pointer only moves forward) and no app role holds DELETE on echo.summary —
-- both stay true. The user's version manager (2026-08-25: a delete icon per
-- version in the picker) needs a deliberate exit, so this is a D8-style
-- SECURITY DEFINER door with its reason attached, not a grant:
--
--   * summaries are DERIVED artifacts (invariant 1) — rebuildable from the
--     transcript, which this door cannot touch; deleting a version deletes
--     a rendering, never the record;
--   * the caller must hold the call's EDIT door (owner, or an active admin
--     who can read it — call_update's own shape);
--   * the FK's ON DELETE SET NULL clears the current-summary pointer when
--     the current version dies; the door repoints it to the newest
--     survivor in the same act, so "current = highest version" stays true
--     with no window where a stale pointer serves.

begin;

create function echo.delete_summary_version(p_call uuid, p_version int)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_target uuid;
begin
  if not (echo.owns_call(p_call)
          or (echo.can_read_call(p_call) and echo.actor_is_admin())) then
    raise exception 'only the record''s owner or an admin may delete a summary version'
      using errcode = 'insufficient_privilege';
  end if;

  select s.id into v_target
    from echo.summary s
   where s.call_id = p_call and s.version = p_version;
  if v_target is null then
    raise exception 'no such summary version'
      using errcode = 'no_data_found';
  end if;

  delete from echo.summary where id = v_target;

  -- repoint only when the FK just nulled it (the deleted one was current)
  update echo.call c
     set current_summary_id = (
       select s.id from echo.summary s
        where s.call_id = p_call
        order by s.version desc
        limit 1)
   where c.id = p_call
     and c.current_summary_id is null;
end;
$$;

comment on function echo.delete_summary_version(uuid, int) is
  'D8 door: delete one derived summary version (owner or admin); repoints current_summary_id to the newest survivor. The transcript is untouchable from here.';

grant execute on function echo.delete_summary_version(uuid, int) to echo_app;

commit;
