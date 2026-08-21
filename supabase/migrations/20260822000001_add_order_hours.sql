ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS accepting_orders BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS order_open_time TEXT;
ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS order_close_time TEXT;
