-- SQL script to add area column to surveyors table
-- Run this in your Supabase SQL Editor

-- Add area column (can be 'STSP', 'NTNP', or NULL)
ALTER TABLE surveyors 
ADD COLUMN IF NOT EXISTS area TEXT 
CHECK (area IS NULL OR area IN ('STSP', 'NTNP'));

-- Add comment to explain the column
COMMENT ON COLUMN surveyors.area IS 'Preferred area/zone: STSP or NTNP. NULL means no preference.';

