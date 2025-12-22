/**
 * Database service layer for Supabase
 * Provides high-level functions for database operations
 */

import { supabase } from "./supabase";

// ==================== SURVEYORS ====================

export async function getSurveyors() {
  console.log("Querying Supabase for surveyors...");
  console.log("Supabase client initialized:", !!supabase);
  
  const { data, error, count } = await supabase
    .from("surveyors")
    .select("*", { count: "exact" })
    .order("name", { ascending: true });

  console.log("Query response:", { 
    dataLength: data?.length, 
    error: error?.message,
    count: count,
    hasData: !!data 
  });

  if (error) {
    console.error("Error fetching surveyors:", error);
    console.error("Error code:", error.code);
    console.error("Error details:", error.details);
    console.error("Error hint:", error.hint);
    console.error("Full error:", JSON.stringify(error, null, 2));
    return { success: false, error: error.message, data: null };
  }

  console.log(`Supabase query returned ${data?.length || 0} surveyors (count: ${count})`);
  if (data && data.length > 0) {
    console.log("First surveyor sample:", JSON.stringify(data[0], null, 2));
  } else {
    console.warn("No surveyors found in database. Check:");
    console.warn("1. Are surveyors inserted in Supabase Table Editor?");
    console.warn("2. Are Row Level Security (RLS) policies blocking access?");
    console.warn("3. Is the table name correct? (should be 'surveyors')");
  }
  
  return { success: true, data: data || [] };
}

export async function createSurveyor(surveyor) {
  // Map areaPreference from app format (SOUTH/NORTH) to database format (STSP/NTNP)
  const areaDb = surveyor.areaPreference === "SOUTH" ? "STSP" : surveyor.areaPreference === "NORTH" ? "NTNP" : null;
  
  const { data, error } = await supabase
    .from("surveyors")
    .insert([{
      name: surveyor.name,
      photo_url: surveyor.photoUrl,
      active: surveyor.active !== undefined ? surveyor.active : true,
      email: surveyor.email || null,
      shift_preference: surveyor.shiftPreference || null,
      area: areaDb,
      non_availability: surveyor.nonAvailability ? JSON.stringify(surveyor.nonAvailability) : null,
    }])
    .select()
    .single();

  if (error) {
    console.error("Error creating surveyor:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data };
}

export async function bulkCreateSurveyors(surveyors) {
  const { data, error } = await supabase
    .from("surveyors")
    .insert(surveyors.map(s => {
      // Map areaPreference from app format (SOUTH/NORTH) to database format (STSP/NTNP)
      const areaDb = s.areaPreference === "SOUTH" ? "STSP" : s.areaPreference === "NORTH" ? "NTNP" : null;
      return {
        name: s.name,
        photo_url: s.photoUrl,
        active: s.active !== undefined ? s.active : true,
        email: s.email || null,
        shift_preference: s.shiftPreference || null,
        area: areaDb,
        non_availability: s.nonAvailability ? JSON.stringify(s.nonAvailability) : null,
      };
    }))
    .select();

  if (error) {
    console.error("Error bulk creating surveyors:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data: data || [] };
}

export async function updateSurveyor(id, updates) {
  const updateData = {
    name: updates.name,
    photo_url: updates.photoUrl,
    active: updates.active,
  };
  
  if (updates.email !== undefined) {
    updateData.email = updates.email || null;
  }
  
  if (updates.shiftPreference !== undefined) {
    updateData.shift_preference = updates.shiftPreference;
  }
  
  if (updates.areaPreference !== undefined) {
    // Map areaPreference from app format (SOUTH/NORTH) to database format (STSP/NTNP)
    updateData.area = updates.areaPreference === "SOUTH" ? "STSP" : updates.areaPreference === "NORTH" ? "NTNP" : null;
  }
  
  if (updates.nonAvailability !== undefined) {
    updateData.non_availability = updates.nonAvailability ? JSON.stringify(updates.nonAvailability) : null;
  }
  
  const { data, error } = await supabase
    .from("surveyors")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating surveyor:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data };
}

export async function deleteSurveyor(id) {
  const { error } = await supabase
    .from("surveyors")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting surveyor:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ==================== ROSTERS ====================

export async function createRoster(roster) {
  // Area should already be in database format (STSP/NTNP) from storage-hybrid.js
  // But handle both formats just in case
  const areaDb = roster.area === "SOUTH" ? "STSP" : 
                 roster.area === "NORTH" ? "NTNP" : 
                 (roster.area || "STSP");
  
  const { data, error } = await supabase
    .from("rosters")
    .insert([{
      start_date: roster.startDate,
      end_date: roster.endDate,
      status: roster.status || "draft",
      area: areaDb,
    }])
    .select()
    .single();

  if (error) {
    console.error("Error creating roster:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data };
}

export async function getRoster(id) {
  const { data, error } = await supabase
    .from("rosters")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error("Error fetching roster:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data };
}

export async function getAllRosters() {
  const { data, error } = await supabase
    .from("rosters")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching rosters:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data: data || [] };
}

export async function updateRoster(id, updates) {
  const updateData = {
    start_date: updates.startDate,
    end_date: updates.endDate,
    status: updates.status,
  };
  if (updates.area !== undefined) {
    // Handle both app format (SOUTH/NORTH) and database format (STSP/NTNP)
    // If already in database format, use it directly; otherwise map from app format
    if (updates.area === "STSP" || updates.area === "NTNP") {
      updateData.area = updates.area; // Already in database format
      console.log(`updateRoster: Area already in DB format: ${updates.area}`);
    } else {
      // Map from app format (SOUTH/NORTH) to database format (STSP/NTNP)
      updateData.area = updates.area === "SOUTH" ? "STSP" : updates.area === "NORTH" ? "NTNP" : "STSP";
      console.log(`updateRoster: Mapped area from app format ${updates.area} to DB format ${updateData.area}`);
    }
  }
  const { data, error } = await supabase
    .from("rosters")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating roster:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data };
}

export async function updateRosterStatus(id, status) {
  const { data, error } = await supabase
    .from("rosters")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating roster status:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data };
}

export async function deleteRoster(id) {
  // Delete assignments first (cascade should handle this, but being explicit)
  const { error: assignmentsError } = await supabase
    .from("assignments")
    .delete()
    .eq("roster_id", id);

  if (assignmentsError) {
    console.error("Error deleting assignments:", assignmentsError);
    return { success: false, error: assignmentsError.message };
  }

  // Delete roster
  const { error } = await supabase
    .from("rosters")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting roster:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ==================== ASSIGNMENTS ====================

export async function getAssignmentsByRoster(rosterId) {
  const { data, error } = await supabase
    .from("assignments")
    .select(`
      *,
      surveyors (id, name, photo_url, active)
    `)
    .eq("roster_id", rosterId)
    .order("date_key", { ascending: true });

  if (error) {
    console.error("Error fetching assignments:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data: data || [] };
}

export async function createAssignment(assignment) {
  const { data, error } = await supabase
    .from("assignments")
    .insert([{
      roster_id: assignment.rosterId,
      surveyor_id: assignment.surveyorId,
      date_key: assignment.dateKey,
      shift: assignment.shift,
      break_mins: assignment.breakMins || 30,
      confirmed: assignment.confirmed || false,
    }])
    .select()
    .single();

  if (error) {
    console.error("Error creating assignment:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data };
}

export async function updateAssignment(id, updates) {
  const { data, error } = await supabase
    .from("assignments")
    .update({
      shift: updates.shift,
      break_mins: updates.breakMins,
      confirmed: updates.confirmed,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating assignment:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data };
}

export async function deleteAssignment(id) {
  const { error } = await supabase
    .from("assignments")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error deleting assignment:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function bulkCreateAssignments(assignments) {
  if (!assignments || assignments.length === 0) {
    return { success: true, data: [] };
  }

  // Check for duplicates within the batch
  const seen = new Set();
  const uniqueAssignments = [];
  for (const a of assignments) {
    const key = `${a.rosterId}_${a.surveyorId}_${a.dateKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueAssignments.push(a);
    } else {
      console.warn(`Skipping duplicate assignment in batch: ${key}`);
    }
  }

  if (uniqueAssignments.length === 0) {
    console.warn("No unique assignments to insert after deduplication");
    return { success: true, data: [] };
  }

  // Use upsert to handle any remaining duplicates (in case delete didn't work)
  const { data, error } = await supabase
    .from("assignments")
    .upsert(
      uniqueAssignments.map(a => ({
        roster_id: a.rosterId,
        surveyor_id: a.surveyorId,
        date_key: a.dateKey,
        shift: a.shift,
        break_mins: a.breakMins || 30,
        confirmed: a.confirmed || false,
      })),
      {
        onConflict: "roster_id,surveyor_id,date_key",
      }
    )
    .select();

  if (error) {
    console.error("Error bulk creating assignments:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data: data || [] };
}

// ==================== WEEKEND HISTORY ====================

export async function getWeekendHistory(surveyorId = null) {
  let query = supabase
    .from("weekend_history")
    .select("*")
    .order("weekend_date", { ascending: false });

  if (surveyorId) {
    query = query.eq("surveyor_id", surveyorId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching weekend history:", error);
    return { success: false, error: error.message, data: null };
  }

  // Group by surveyor_id for easier use
  const grouped = {};
  (data || []).forEach((item) => {
    if (!grouped[item.surveyor_id]) {
      grouped[item.surveyor_id] = [];
    }
    grouped[item.surveyor_id].push(item.weekend_date);
  });

  return { success: true, data: grouped };
}

export async function addWeekendWork(surveyorId, weekendDate) {
  const { data, error } = await supabase
    .from("weekend_history")
    .insert([{
      surveyor_id: surveyorId,
      weekend_date: weekendDate,
    }])
    .select()
    .single();

  if (error) {
    console.error("Error adding weekend work:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data };
}

export async function cleanupOldWeekendHistory(daysToKeep = 21) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const { error } = await supabase
    .from("weekend_history")
    .delete()
    .lt("weekend_date", cutoffDate.toISOString().split("T")[0]);

  if (error) {
    console.error("Error cleaning up weekend history:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ==================== DEMAND SETTINGS ====================

export async function getDemandSettings(startDate, endDate, area = "STSP") {
  const { data, error } = await supabase
    .from("demand_settings")
    .select("*")
    .gte("date_key", startDate)
    .lte("date_key", endDate)
    .eq("area", area)
    .order("date_key", { ascending: true });

  if (error) {
    console.error("Error fetching demand settings:", error);
    return { success: false, error: error.message, data: null };
  }

  return { success: true, data: data || [] };
}

export async function upsertDemandSetting(dateKey, dayDemand, nightDemand, area = "STSP") {
  // First, try to check if a record exists with this date_key and area
  const { data: existing, error: checkError } = await supabase
    .from("demand_settings")
    .select("*")
    .eq("date_key", dateKey)
    .eq("area", area)
    .maybeSingle();

  let result;
  if (existing) {
    // Update existing record
    const { data, error } = await supabase
      .from("demand_settings")
      .update({
        day_demand: dayDemand,
        night_demand: nightDemand,
      })
      .eq("date_key", dateKey)
      .eq("area", area)
      .select()
      .single();
    
    result = { data, error };
  } else {
    // Insert new record
    const { data, error } = await supabase
      .from("demand_settings")
      .insert([{
        date_key: dateKey,
        day_demand: dayDemand,
        night_demand: nightDemand,
        area: area,
      }])
      .select()
      .single();
    
    result = { data, error };
  }

  if (result.error) {
    // Check if the error is about missing area column
    if (result.error.message && result.error.message.includes("area") && result.error.message.includes("schema cache")) {
      console.error(
        "Error: The 'area' column is missing from the demand_settings table.\n" +
        "Please run the migration script: database/add-zone-support.sql\n" +
        "This will add the area column to support STSP and NTNP areas."
      );
      return { 
        success: false, 
        error: "Database schema missing 'area' column. Please run database/add-zone-support.sql migration.", 
        data: null 
      };
    }
    // Check if the error is about missing constraint
    if (result.error.code === '42P10' || (result.error.message && result.error.message.includes("ON CONFLICT"))) {
      console.error(
        "Error: The unique constraint on (date_key, area) is missing from the demand_settings table.\n" +
        "Please run the migration script: database/add-zone-support.sql\n" +
        "This will create the required unique constraint."
      );
      return { 
        success: false, 
        error: "Database constraint missing. Please run database/add-zone-support.sql migration to create the unique constraint on (date_key, area).", 
        data: null 
      };
    }
    console.error("Error upserting demand setting:", result.error);
    return { success: false, error: result.error.message, data: null };
  }

  return { success: true, data: result.data };
}

export async function getDemandTemplates() {
  console.log("[DB] Querying demand_templates table for active templates...");
  const { data, error } = await supabase
    .from("demand_templates")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[DB] Error fetching demand templates:", error);
    console.error("[DB] Error details:", JSON.stringify(error, null, 2));
    return { success: false, error: error.message, data: null };
  }

  console.log(`[DB] Found ${data?.length || 0} active demand template(s)`);
  if (data && data.length > 0) {
    console.log("[DB] Template data:", data.map(t => ({
      id: t.id,
      name: t.name,
      mon_fri_day: t.mon_fri_day,
      sat_day: t.sat_day,
      night: t.night,
      active: t.active,
      created_at: t.created_at,
    })));
  }

  return { success: true, data: data || [] };
}

export async function createDemandTemplate(template) {
  console.log("[DB] Creating demand template:", template);
  
  // First, deactivate all existing active templates
  const { data: deactivatedData, error: deactivateError } = await supabase
    .from("demand_templates")
    .update({ active: false })
    .eq("active", true)
    .select();

  if (deactivateError) {
    console.error("[DB] Error deactivating existing templates:", deactivateError);
    // Continue anyway
  } else {
    console.log(`[DB] Deactivated ${deactivatedData?.length || 0} existing active template(s)`);
  }

  // Then create/insert the new active template
  const insertData = {
    name: template.name,
    mon_fri_day: template.monFriDay,
    sat_day: template.satDay,
    night: template.night,
    active: template.active !== undefined ? template.active : true,
  };
  
  console.log("[DB] Inserting new template:", insertData);
  
  const { data, error } = await supabase
    .from("demand_templates")
    .insert([insertData])
    .select()
    .single();

  if (error) {
    console.error("[DB] Error creating demand template:", error);
    console.error("[DB] Error details:", JSON.stringify(error, null, 2));
    return { success: false, error: error.message, data: null };
  }

  console.log("[DB] ✅ Template created successfully:", data);
  return { success: true, data };
}

