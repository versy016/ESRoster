-- Fix Row Level Security (RLS) policies to allow access to surveyors
-- Run this in Supabase SQL Editor

-- Step 1: Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'surveyors';

-- Step 2: Disable RLS temporarily (for development)
-- This allows all operations without policies
ALTER TABLE surveyors DISABLE ROW LEVEL SECURITY;

-- Step 3: Verify the change
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'surveyors';

-- Step 4: Test query (should now return all surveyors)
SELECT COUNT(*) FROM surveyors;

-- Alternative: If you want to keep RLS enabled, create a policy instead:
-- ALTER TABLE surveyors ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Allow all operations on surveyors" 
-- ON surveyors FOR ALL USING (true) WITH CHECK (true);

