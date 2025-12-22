# Seed Surveyors to Database

This guide explains how to add the surveyors to your Supabase database.

## Option 1: Using SQL (Recommended - Fastest)

1. **Add email column** (if not already added):
   - Open Supabase SQL Editor
   - Run `database/add-email-column.sql`

2. **Insert surveyors**:
   - Open Supabase SQL Editor
   - Copy and paste the contents of `database/seed-surveyors.sql`
   - Click "Run" (or press Ctrl+Enter)
   - All 17 surveyors will be added with generated avatar images

## Option 2: Using the App

1. **Add email column** (if not already added):
   - Run `database/add-email-column.sql` in Supabase SQL Editor

2. **Use the seed screen**:
   - Navigate to `/seed-surveyors` in your app (you may need to add this route)
   - Click "Seed Surveyors" button
   - Wait for completion

## Option 3: Using the Script Directly

If you have Node.js environment set up:

```bash
node scripts/seed-surveyors.js
```

## Avatar Images

The script automatically generates avatar images using UI Avatars service:
- Format: Initials on golden yellow background (#fbbf24)
- Size: 200x200 pixels
- Example: `https://ui-avatars.com/api/?name=Barry+McDonald&size=200&background=fbbf24&color=000000&bold=true&format=png`

## Surveyors List

The following 17 surveyors will be added:

1. Barry McDonald — barry.mcdonald@engsurveys.com.au
2. Bradley Gosling — bradley.gosling@engsurveys.com.au
3. Cameron Steer — csteer@engsurveys.com.au
4. Changyi Tang — changyi.tang@engsurveys.com.au
5. Chen Bai — chen.bai@engsurveys.com.au
6. Daniel Corcoran — daniel.corcoran@engsurveys.com.au
7. Dario Rigon — dario.rigon@engsurveys.com.au
8. Darren Cross — darren.cross@engsurveys.com.au
9. David Topfer — david.topfer@engsurveys.com.au
10. Ethan Spinks — ethan.spinks@engsurveys.com.au
11. Justin Scott — justin.scott@engsurveys.com.au
12. Kat Bergin — kathryn.bergin@engsurveys.com.au
13. Luke Shawcross — luke.shawcross@engsurveys.com.au
14. Mark Ainsworth — mark.ainsworth@engsurveys.com.au
15. Matthew Gooding — matthew.gooding@engsurveys.com.au
16. Michael Templer — michael.templer@engsurveys.com.au
17. Yasar Chitthiwala — yasar.chitthiwala@engsurveys.com.au

All surveyors will be set as `active: true` by default.

## Verifying

After seeding, check your Supabase dashboard:
1. Go to **Table Editor** → **surveyors**
2. You should see all 17 surveyors with their names and avatar URLs
3. Images will load automatically when displayed in the app

