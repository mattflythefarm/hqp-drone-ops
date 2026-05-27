-- ============================================================
-- HQP Drone Ops — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

create table public.jobs (
  id                  text primary key,
  created_at          timestamptz default now() not null,
  completed_at        timestamptz,
  status              text default 'pending' not null,
  area                text not null,
  description         text,
  target_date         date,
  notes               text,
  contact_name        text,
  contact_email       text,
  -- Booking files (uploaded by client)
  kml_booking_name    text,
  ops_booking_name    text,
  -- Completion records (uploaded by operator)
  kml_flight_name     text,
  screenshot_name     text,
  ops_completed_name  text,
  kestrel             jsonb
);

-- Enable Row Level Security
alter table public.jobs enable row level security;

-- Allow full public access (suitable for internal team tool)
-- If you want to restrict access later, replace this with auth-based policies
create policy "Public access" on public.jobs
  for all
  using (true)
  with check (true);
