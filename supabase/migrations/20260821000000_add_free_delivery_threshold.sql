ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS free_delivery_threshold_paise INTEGER NOT NULL DEFAULT 20000;
