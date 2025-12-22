# Troubleshooting: Surveyors Not Showing

If you're seeing "Successfully loaded 0 surveyors from Supabase", this is likely a **Row Level Security (RLS)** issue.

## Quick Fix

1. **Open Supabase SQL Editor**
2. **Run this SQL**:

```sql
ALTER TABLE surveyors DISABLE ROW LEVEL SECURITY;
```

3. **Refresh your app** - surveyors should now appear!

## Why This Happens

Supabase enables Row Level Security (RLS) by default on new tables. Without policies, queries return empty results even if data exists.

## Verify Data Exists

Run this in Supabase SQL Editor to check:

```sql
SELECT COUNT(*) FROM surveyors;
SELECT * FROM surveyors LIMIT 5;
```

If you see data here but not in the app, it's definitely RLS.

## Better Solution (For Production)

Instead of disabling RLS, create a policy:

```sql
-- Enable RLS
ALTER TABLE surveyors ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations
CREATE POLICY "Allow all operations on surveyors" 
ON surveyors 
FOR ALL 
USING (true) 
WITH CHECK (true);
```

## Test Database Connection

You can test the connection by opening browser console and running:

```javascript
// Import the test function (if available)
testDatabaseConnection();
```

Or check the console logs - you should see detailed information about the query.

## Common Issues

1. **RLS blocking access** - Most common, fix with SQL above
2. **Wrong table name** - Should be `surveyors` (lowercase)
3. **No data inserted** - Check Supabase Table Editor
4. **Wrong credentials** - Verify EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY

