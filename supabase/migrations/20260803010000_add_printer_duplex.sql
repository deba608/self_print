alter table agent_printers
  add column if not exists can_duplex integer not null default 0;
