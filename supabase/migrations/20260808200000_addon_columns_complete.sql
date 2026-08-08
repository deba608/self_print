-- Completes the print add-on schema on Postgres.
--
-- The add-on features (spiral binding, cover file, bond paper) were shipped
-- with SQLite auto-migrations only (see ensureJobColumns / ensurePricingColumns
-- in src/lib/db.ts). The earlier 20260808000000_spiral_cover_addons.sql covered
-- part of it but was never applied and predates bond paper, the per-add-on
-- quantities, and the spiral binding price slabs.
--
-- Without these columns every job insert fails with PGRST204
-- ("Could not find the 'has_bond_paper' column of 'jobs'"), which surfaces to
-- the customer as "Upload failed". Additive and idempotent.

alter table jobs
  add column if not exists has_spiral_binding boolean not null default false,
  add column if not exists has_cover_file     boolean not null default false,
  add column if not exists has_bond_paper     boolean not null default false,
  add column if not exists spiral_binding_qty integer not null default 1,
  add column if not exists cover_file_qty     integer not null default 1;

alter table pricing_config
  add column if not exists spiral_binding_per_page_paise integer not null default 150,
  add column if not exists cover_file_paise              integer not null default 1000,
  add column if not exists bond_paper_per_page_paise     integer not null default 100,
  add column if not exists spiral_binding_slab1_paise    integer not null default 2000,
  add column if not exists spiral_binding_slab2_paise    integer not null default 2500,
  add column if not exists spiral_binding_slab3_paise    integer not null default 3000,
  add column if not exists spiral_binding_slab4_paise    integer not null default 4000,
  add column if not exists spiral_binding_slab5_paise    integer not null default 5000;

-- PostgREST caches the schema; without this the new columns stay invisible to
-- the API until the next restart.
notify pgrst, 'reload schema';
