alter table pricing_config add column if not exists service_area_config text not null default '';
alter table jobs add column if not exists delivery_pincode text;
alter table jobs add column if not exists delivery_area text;
