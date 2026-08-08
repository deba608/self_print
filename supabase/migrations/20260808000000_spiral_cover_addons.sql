alter table jobs
  add column if not exists has_spiral_binding boolean not null default false;

alter table jobs
  add column if not exists has_cover_file boolean not null default false;

alter table pricing_config
  add column if not exists spiral_binding_paise integer not null default 2000,
  add column if not exists cover_file_paise integer not null default 1000;
