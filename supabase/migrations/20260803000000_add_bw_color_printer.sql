alter table agent_config
  add column if not exists bw_printer_name text,
  add column if not exists color_printer_name text;

update agent_config set bw_printer_name = printer_name where bw_printer_name is null;
update agent_config set color_printer_name = printer_name where color_printer_name is null;
