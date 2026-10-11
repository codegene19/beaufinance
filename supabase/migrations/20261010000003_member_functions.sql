-- Member management helpers. SECURITY DEFINER so app users never need direct access to auth.users.
create or replace function public.business_member_list(bid uuid)
returns table (user_id uuid, email text, role member_role, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from business_members m join auth.users u on u.id = m.user_id
  where m.business_id = bid and is_member(bid)
  order by m.created_at
$$;

create or replace function public.add_business_member(bid uuid, member_email text, member_role member_role)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_owner(bid) then raise exception 'Only owners can add members' using errcode = '42501'; end if;
  select id into uid from auth.users where lower(email) = lower(member_email);
  if uid is null then raise exception 'No user with this email has signed up yet' using errcode = 'P0002'; end if;
  insert into business_members (business_id, user_id, role) values (bid, uid, member_role)
  on conflict (business_id, user_id) do update set role = excluded.role;
  return uid;
end $$;

grant execute on function public.business_member_list(uuid), public.add_business_member(uuid, text, member_role) to authenticated;
