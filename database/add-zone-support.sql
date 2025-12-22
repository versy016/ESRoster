-- SQL script to add area support to rosters and demand_settings tables
-- Run this in your Supabase SQL Editor

-- Add area column to rosters table
ALTER TABLE rosters 
ADD COLUMN IF NOT EXISTS area TEXT DEFAULT 'STSP'
CHECK (area IN ('STSP', 'NTNP'));

-- Add comment to explain the column
COMMENT ON COLUMN rosters.area IS 'Area/Office: STSP or NTNP. Default is STSP.';

-- Add area column to demand_settings table
ALTER TABLE demand_settings 
ADD COLUMN IF NOT EXISTS area TEXT DEFAULT 'STSP'
CHECK (area IN ('STSP', 'NTNP'));

-- Add comment to explain the column
COMMENT ON COLUMN demand_settings.area IS 'Area/Office: STSP or NTNP. Default is STSP.';

-- Update unique constraint on demand_settings to include area
-- First, drop the existing unique constraint if it exists
ALTER TABLE demand_settings 
DROP CONSTRAINT IF EXISTS demand_settings_date_key_key;

-- Add new unique constraint that includes area
ALTER TABLE demand_settings 
ADD CONSTRAINT demand_settings_date_key_area_key UNIQUE (date_key, area);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_demand_settings_area ON demand_settings(area);
CREATE INDEX IF NOT EXISTS idx_rosters_area ON rosters(area);

