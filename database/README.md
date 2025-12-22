# Database Setup Guide

This guide will help you set up the Supabase database for the South Road Surveyor Scheduling Tool.

## Step 1: Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up or log in
3. Click "New Project"
4. Fill in:
   - **Name**: ESRoster (or your preferred name)
   - **Database Password**: Choose a strong password (save it!)
   - **Region**: Choose closest to your users
5. Click "Create new project" (takes 1-2 minutes)

## Step 2: Get Your API Keys

1. In your Supabase project dashboard, go to **Settings** → **API**
2. Copy:
   - **Project URL** (under "Project URL")
   - **anon/public key** (under "Project API keys")

## Step 3: Run the Database Schema

1. In Supabase dashboard, go to **SQL Editor**
2. Click "New query"
3. Copy the entire contents of `database/schema.sql`
4. Paste into the SQL Editor
5. Click "Run" (or press Ctrl+Enter)
6. You should see "Success. No rows returned"

## Step 4: Configure Environment Variables

1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Supabase credentials:

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
   ```

3. For Expo, you can also add these to `app.json`:
   ```json
   {
     "expo": {
       "extra": {
         "supabaseUrl": "https://your-project.supabase.co",
         "supabaseAnonKey": "your_anon_key_here"
       }
     }
   }
   ```

## Step 5: Verify Setup

1. In Supabase dashboard, go to **Table Editor**
2. You should see these tables:
   - `surveyors`
   - `rosters`
   - `assignments`
   - `weekend_history`
   - `demand_settings`
   - `demand_templates`

## Step 6: Test the Connection

The app will automatically use Supabase when the environment variables are set. If not set, it will fall back to AsyncStorage (local storage).

## Database Schema Overview

### Tables

- **surveyors**: Stores surveyor information (name, photo, active status)
- **rosters**: Stores roster periods (start/end dates, status)
- **assignments**: Links surveyors to specific dates with shift details
- **weekend_history**: Tracks weekend work for rule validation
- **demand_settings**: Daily demand requirements
- **demand_templates**: Weekly demand templates

### Features

- **Row Level Security (RLS)**: Enabled on all tables
- **Auto-updating timestamps**: `updated_at` fields update automatically
- **Unique constraints**: Prevents duplicate assignments
- **Foreign keys**: Maintains data integrity
- **Indexes**: Optimized for common queries

## Next Steps

1. **Authentication** (optional): Set up Supabase Auth for user management
2. **Real-time** (optional): Enable real-time subscriptions for live updates
3. **Backups**: Configure automatic backups in Supabase dashboard

## Troubleshooting

- **"Invalid API key"**: Check that your keys are correct in `.env`
- **"Table does not exist"**: Make sure you ran `schema.sql` in SQL Editor
- **"Permission denied"**: Check RLS policies in Supabase dashboard
