-- Optional, consent-based browser geolocation for delivery orders.
-- Coordinates remain protected by the existing jobs RLS policies.
alter table public.jobs
  add column if not exists delivery_latitude double precision,
  add column if not exists delivery_longitude double precision,
  add column if not exists delivery_accuracy_meters double precision,
  add column if not exists delivery_location_captured_at timestamptz;

alter table public.jobs
  drop constraint if exists jobs_delivery_latitude_check,
  add constraint jobs_delivery_latitude_check
    check (delivery_latitude is null or delivery_latitude between -90 and 90),
  drop constraint if exists jobs_delivery_longitude_check,
  add constraint jobs_delivery_longitude_check
    check (delivery_longitude is null or delivery_longitude between -180 and 180),
  drop constraint if exists jobs_delivery_accuracy_check,
  add constraint jobs_delivery_accuracy_check
    check (delivery_accuracy_meters is null or delivery_accuracy_meters between 0 and 100000);

create index if not exists jobs_delivery_dispatch_idx
  on public.jobs (delivery_status, created_at desc)
  where delivery_method = 'delivery';

comment on column public.jobs.delivery_latitude is
  'Customer-consented browser geolocation latitude for delivery navigation.';
comment on column public.jobs.delivery_longitude is
  'Customer-consented browser geolocation longitude for delivery navigation.';
comment on column public.jobs.delivery_accuracy_meters is
  'Browser-reported geolocation accuracy radius in metres.';
