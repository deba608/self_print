-- Customer profile self-editing: avatar photo + display name.
-- display_name already existed (add_user_management.sql); this adds the
-- avatar column and a public storage bucket for the photo itself.

alter table public.customer_profiles
  add column if not exists avatar_url text;

-- Public bucket: avatars are shown in the navbar unauthenticated-rendered
-- shell, so they must be readable without a signed URL. Ownership is
-- enforced by the object path (`${auth.uid()}/...`), not bucket privacy.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatar images are publicly readable" on storage.objects;
create policy "avatar images are publicly readable" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "customers can upload own avatar" on storage.objects;
create policy "customers can upload own avatar" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "customers can replace own avatar" on storage.objects;
create policy "customers can replace own avatar" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "customers can delete own avatar" on storage.objects;
create policy "customers can delete own avatar" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
