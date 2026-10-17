-- Private chat chart screenshots. No public URL is created; all access uses Storage RLS.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('orion-chart-images', 'orion-chart-images', false, 3145728, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Orion users read their private chart images"
  on storage.objects for select to authenticated
  using (bucket_id = 'orion-chart-images' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "Orion users upload their private chart images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'orion-chart-images' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "Orion users delete their private chart images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'orion-chart-images' and (storage.foldername(name))[1] = (select auth.uid()::text));
