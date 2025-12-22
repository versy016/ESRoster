-- South Road Surveyor Scheduling Tool - Database Schema
-- Run this SQL in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Surveyors table
CREATE TABLE IF NOT EXISTS surveyors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  photo_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Rosters table
CREATE TABLE IF NOT EXISTS rosters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'published'))
);

-- Assignments table (links surveyors to dates in rosters)
CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  roster_id UUID REFERENCES rosters(id) ON DELETE CASCADE,
  surveyor_id UUID REFERENCES surveyors(id) ON DELETE CASCADE,
  date_key DATE NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('DAY', 'NIGHT', 'OFF')),
  break_mins INTEGER DEFAULT 30,
  confirmed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(roster_id, surveyor_id, date_key)
);

-- Weekend history table (tracks weekend work for rule validation)
CREATE TABLE IF NOT EXISTS weekend_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  surveyor_id UUID REFERENCES surveyors(id) ON DELETE CASCADE,
  weekend_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(surveyor_id, weekend_date)
);

-- Demand settings table
CREATE TABLE IF NOT EXISTS demand_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  date_key DATE NOT NULL,
  day_demand INTEGER DEFAULT 0,
  night_demand INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(date_key)
);

-- Demand template table (for weekly templates)
CREATE TABLE IF NOT EXISTS demand_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  mon_fri_day INTEGER DEFAULT 2,
  sat_day INTEGER DEFAULT 2,
  night INTEGER DEFAULT 1,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_assignments_roster_id ON assignments(roster_id);
CREATE INDEX IF NOT EXISTS idx_assignments_surveyor_id ON assignments(surveyor_id);
CREATE INDEX IF NOT EXISTS idx_assignments_date_key ON assignments(date_key);
CREATE INDEX IF NOT EXISTS idx_weekend_history_surveyor_id ON weekend_history(surveyor_id);
CREATE INDEX IF NOT EXISTS idx_weekend_history_date ON weekend_history(weekend_date);
CREATE INDEX IF NOT EXISTS idx_demand_settings_date_key ON demand_settings(date_key);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to auto-update updated_at
CREATE TRIGGER update_surveyors_updated_at BEFORE UPDATE ON surveyors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rosters_updated_at BEFORE UPDATE ON rosters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assignments_updated_at BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_demand_settings_updated_at BEFORE UPDATE ON demand_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_demand_templates_updated_at BEFORE UPDATE ON demand_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
-- Enable RLS on all tables
ALTER TABLE surveyors ENABLE ROW LEVEL SECURITY;
ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekend_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_templates ENABLE ROW LEVEL SECURITY;

-- For MVP: Allow all operations (adjust based on your auth requirements)
-- In production, you'll want to restrict based on user roles

-- Surveyors: Allow all operations for authenticated users
CREATE POLICY "Allow all for authenticated users" ON surveyors
  FOR ALL USING (auth.role() = 'authenticated');

-- Rosters: Allow all for authenticated users
CREATE POLICY "Allow all for authenticated users" ON rosters
  FOR ALL USING (auth.role() = 'authenticated');

-- Assignments: Allow all for authenticated users
CREATE POLICY "Allow all for authenticated users" ON assignments
  FOR ALL USING (auth.role() = 'authenticated');

-- Weekend history: Allow all for authenticated users
CREATE POLICY "Allow all for authenticated users" ON weekend_history
  FOR ALL USING (auth.role() = 'authenticated');

-- Demand settings: Allow all for authenticated users
CREATE POLICY "Allow all for authenticated users" ON demand_settings
  FOR ALL USING (auth.role() = 'authenticated');

-- Demand templates: Allow all for authenticated users
CREATE POLICY "Allow all for authenticated users" ON demand_templates
  FOR ALL USING (auth.role() = 'authenticated');

-- For development/testing: Allow all operations (disable in production)
-- Uncomment below if you want to allow anonymous access during development
/*
CREATE POLICY "Allow all for anon" ON surveyors FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON rosters FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON assignments FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON weekend_history FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON demand_settings FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON demand_templates FOR ALL USING (true);
*/

