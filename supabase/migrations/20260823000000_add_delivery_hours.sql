ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS delivery_open_time TEXT DEFAULT '18:00';
ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS delivery_close_time TEXT DEFAULT '20:30';
ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS delivery_days TEXT DEFAULT '1,2,3,4,5,6';
ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS order_open_time2 TEXT;
ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS order_close_time2 TEXT;
ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS order_days TEXT DEFAULT '1,2,3,4,5,6';

-- Shop pickup hours (Mon-Sat, split 9am-1pm / 4:30-8:30pm, Sunday closed)
-- and delivery hours (Mon-Sat, 6-8:30pm) requested as the initial live
-- default; only backfilled where unset so an already-configured window is
-- left alone.
UPDATE pricing_config
SET order_open_time = COALESCE(order_open_time, '09:00'),
    order_close_time = COALESCE(order_close_time, '13:00'),
    order_open_time2 = COALESCE(order_open_time2, '16:30'),
    order_close_time2 = COALESCE(order_close_time2, '20:30')
WHERE id = 1;
