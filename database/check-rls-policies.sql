-- Check and fix Row Level Security (RLS) policies for surveyors table
-- Run this in Supabase SQL Editor if surveyors are not showing up

-- 1. Check current RLS status
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'surveyors';

-- 2. If RLS is enabled but no policies exist, disable it for now (for development)
-- Or create a policy that allows all operations

-- Option A: Disable RLS (for development/testing)
ALTER TABLE surveyors DISABLE ROW LEVEL SECURITY;

-- Option B: Create a policy that allows all operations (better for production)
-- First, enable RLS
ALTER TABLE surveyors ENABLE ROW LEVEL SECURITY;

-- Then create a policy that allows all operations for authenticated users
-- (You may need to adjust this based on your auth setup)
CREATE POLICY "Allow all operations on surveyors" 
ON surveyors 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Option C: Allow public read access (for development)
CREATE POLICY "Allow public read on surveyors" 
ON surveyors 
FOR SELECT 
USING (true);

-- Check existing policies
SELECT * FROM pg_policies WHERE tablename = 'surveyors';

