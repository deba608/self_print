ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS delivery_open_time TEXT DEFAULT '18:00';
ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS delivery_close_time TEXT DEFAULT '20:30';
ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS delivery_days TEXT DEFAULT '1,2,3,4,5,6';

-- Shop pickup hours (9AM-9PM) and delivery hours (Mon-Sat, 6-8:30PM)
-- requested as the initial live default; only backfilled where unset so an
-- already-configured window is left alone.
UPDATE pricing_config
SET order_open_time = COALESCE(order_open_time, '09:00'),
    order_close_time = COALESCE(order_close_time, '21:00')
WHERE id = 1;
