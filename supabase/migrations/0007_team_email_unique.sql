-- 0007: one email per active team member in a firm. Run in the Supabase SQL Editor after 0006.
-- Safe to run more than once.
--
-- The app and the invite-team-member function already refuse a duplicate email; this index
-- enforces it in the database too. Comparison ignores case; blank emails are allowed.

-- Stop with a readable list if existing data already breaks the rule. Fix those rows (change
-- an email, or mark the extra person inactive) and run this file again.
do $$
declare
  v_dups text;
begin
  select string_agg(format('%s (firm %s): %s', d.email, d.firm_id, d.names), '; ')
    into v_dups
  from (
    select tm.firm_id, lower(tm.email) as email, string_agg(tm.name, ', ' order by tm.created_at) as names
    from public.team_members tm
    where tm.active and btrim(tm.email) <> ''
    group by tm.firm_id, lower(tm.email)
    having count(*) > 1
  ) d;
  if v_dups is not null then
    raise exception 'Active team members share an email: %', v_dups
      using hint = 'Change one of the emails or mark the extra team member inactive, then run 0007 again.';
  end if;
end $$;

create unique index if not exists team_members_firm_email_uniq
  on public.team_members (firm_id, lower(email))
  where active and btrim(email) <> '';
