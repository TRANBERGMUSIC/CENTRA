-- CENTRA sync schema. The server stores ciphertext only: no titles, no types, no content.
create table public.changes (
  seq      bigserial primary key,
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  id       text not null,             -- random batch id (dedupe / echo suppression)
  device   text not null,
  key_id   text not null,
  body     text not null,             -- XChaCha20-Poly1305 ciphertext (base64)
  at       timestamptz not null default now(),
  unique (user_id, id)
);
create index changes_user_seq on public.changes (user_id, seq);

-- Wrapped content keys and KDF parameters; useless without the passphrase.
create table public.accounts (
  user_id  uuid primary key default auth.uid() references auth.users on delete cascade,
  kdf      jsonb not null,
  wrapped  jsonb not null,
  updated  timestamptz not null default now()
);

create table public.devices (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  id        text not null,
  name      text not null,
  platform  text not null,
  push_token text,
  last_seen timestamptz not null default now(),
  revoked   boolean not null default false,
  primary key (user_id, id)
);

alter table public.changes  enable row level security;
alter table public.accounts enable row level security;
alter table public.devices  enable row level security;

create policy "own changes"  on public.changes  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own account"  on public.accounts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own devices"  on public.devices  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Revoked devices may not write.
create policy "no writes from revoked devices" on public.changes as restrictive for insert
  with check (not exists (select 1 from public.devices d where d.user_id = auth.uid() and d.id = device and d.revoked));

alter publication supabase_realtime add table public.changes;
