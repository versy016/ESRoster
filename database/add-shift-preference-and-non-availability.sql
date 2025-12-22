-- SQL script to add shift_preference and non_availability columns to surveyors table
-- Run this in your Supabase SQL Editor

-- Add shift_preference column (can be 'DAY', 'NIGHT', or NULL)
ALTER TABLE surveyors 
ADD COLUMN IF NOT EXISTS shift_preference TEXT 
CHECK (shift_preference IS NULL OR shift_preference IN ('DAY', 'NIGHT'));

-- Add non_availability column (stored as JSON array of date strings)
ALTER TABLE surveyors 
ADD COLUMN IF NOT EXISTS non_availability JSONB DEFAULT '[]'::jsonb;

-- Add comment to explain the columns
COMMENT ON COLUMN surveyors.shift_preference IS 'Preferred shift type: DAY or NIGHT. NULL means no preference.';
COMMENT ON COLUMN surveyors.non_availability IS 'JSON array of date strings (YYYY-MM-DD format) when surveyor is not available';

-- Optional: Create an index for better query performance on non_availability
CREATE INDEX IF NOT EXISTS idx_surveyors_non_availability 
ON surveyors USING GIN (non_availability);

