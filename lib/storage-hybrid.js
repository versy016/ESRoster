/**
 * Hybrid storage layer - uses Supabase if configured, otherwise falls back to AsyncStorage
 * This allows the app to work immediately with local storage, and seamlessly upgrade to Supabase
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as db from "./db";
import { supabase } from "./supabase";
import Constants from "expo-constants";
import { format, startOfWeek, addDays } from "date-fns";

// Check if Supabase is configured
const isSupabaseConfigured = () => {
  const url = Constants.expoConfig?.extra?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = Constants.expoConfig?.extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return !!(url && key && url !== "" && key !== "");
};

// Mapping functions between app values (SOUTH/NORTH) and database values (STSP/NTNP)
// For rosters and demand, we use area terminology (mapped to area column in database)
const areaToDbForRoster = (area) => {
  if (area === "SOUTH") return "STSP";
  if (area === "NORTH") return "NTNP";
  return area; // Return as-is if not SOUTH or NORTH
};

const areaFromDbForRoster = (area) => {
  if (area === "STSP") return "SOUTH";
  if (area === "NTNP") return "NORTH";
  return area; // Return as-is if not STSP or NTNP
};

const areaToDb = (area) => {
  if (area === "SOUTH") return "STSP";
  if (area === "NORTH") return "NTNP";
  return area; // Return as-is if not SOUTH or NORTH
};

const areaFromDb = (area) => {
  if (area === "STSP") return "SOUTH";
  if (area === "NTNP") return "NORTH";
  return area; // Return as-is if not STSP or NTNP
};

// ==================== SURVEYORS ====================

export async function saveSurveyors(surveyors) {
  if (isSupabaseConfigured()) {
    // Use Supabase - sync all surveyors
    try {
      // First, get all existing surveyors from database
      const existingResult = await db.getSurveyors();
      const existingSurveyors = existingResult.success ? existingResult.data : [];
      const existingIds = new Set(existingSurveyors.map(s => s.id));
      const newIds = new Set(surveyors.map(s => s.id));
      
      // Find surveyors that need to be deleted (exist in DB but not in new array)
      const idsToDelete = existingSurveyors
        .filter(s => !newIds.has(s.id))
        .map(s => s.id);
      
      // Delete surveyors that are no longer in the array
      for (const idToDelete of idsToDelete) {
        await db.deleteSurveyor(idToDelete);
      }
      
      // Now create/update remaining surveyors
      const results = [];
      for (const surveyor of surveyors) {
        if (surveyor.id && surveyor.id.startsWith("s")) {
          // This is a local ID, create new in Supabase
          const result = await db.createSurveyor({
            name: surveyor.name,
            email: surveyor.email,
            photoUrl: surveyor.photoUrl,
            active: surveyor.active,
            shiftPreference: surveyor.shiftPreference,
            areaPreference: surveyor.areaPreference, // Will be mapped to STSP/NTNP in db.js
            nonAvailability: surveyor.nonAvailability,
          });
          if (result.success) results.push(result.data);
        } else {
          // This might be a UUID from Supabase, try to update
          const result = await db.updateSurveyor(surveyor.id, {
            name: surveyor.name,
            email: surveyor.email,
            photoUrl: surveyor.photoUrl,
            active: surveyor.active,
            shiftPreference: surveyor.shiftPreference !== undefined ? surveyor.shiftPreference : null,
            areaPreference: surveyor.areaPreference !== undefined ? surveyor.areaPreference : null, // Will be mapped to STSP/NTNP in db.js
            nonAvailability: surveyor.nonAvailability !== undefined ? surveyor.nonAvailability : [],
          });
          if (result.success) results.push(result.data);
        }
      }
      return { success: true, data: results };
    } catch (error) {
      console.error("Error saving surveyors to Supabase:", error);
      // Fall back to AsyncStorage
    }
  }

  // Fallback to AsyncStorage
  try {
    await AsyncStorage.setItem("@esroster:surveyors", JSON.stringify(surveyors));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function loadSurveyors() {
  if (isSupabaseConfigured()) {
    try {
      console.log("Loading surveyors from Supabase...");
      const result = await db.getSurveyors();
      console.log("getSurveyors result:", result);
      
      if (result.success) {
        console.log(`Raw data from Supabase: ${result.data?.length || 0} items`);
        
        if (!result.data || result.data.length === 0) {
          console.warn("Supabase returned empty array - check if surveyors table has data");
          return [];
        }
        
        // Transform Supabase format to app format
        const surveyors = result.data.map((s) => {
          const transformed = {
            id: s.id,
            name: s.name,
            email: s.email || null,
            photoUrl: s.photo_url || s.photoUrl || null,
            active: s.active !== undefined ? s.active : true,
            shiftPreference: s.shift_preference || null,
            areaPreference: areaFromDb(s.area) || null,
            nonAvailability: s.non_availability ? (typeof s.non_availability === 'string' ? JSON.parse(s.non_availability) : s.non_availability) : [],
          };
          const areaPrefDisplay = transformed.areaPreference ? (transformed.areaPreference === "SOUTH" ? "STSP" : "NTNP") : "None";
          console.log(`Transformed surveyor: ${transformed.name} (active: ${transformed.active}, areaPreference: ${areaPrefDisplay}, DB area: ${s.area || "null"})`);
          return transformed;
        });
        
        // Log area preference summary
        const stspCount = surveyors.filter(s => s.areaPreference === "SOUTH").length;
        const ntnpCount = surveyors.filter(s => s.areaPreference === "NORTH").length;
        const noPrefCount = surveyors.filter(s => !s.areaPreference).length;
        console.log(`Surveyor area preference summary: STSP=${stspCount}, NTNP=${ntnpCount}, No preference=${noPrefCount}, Total=${surveyors.length}`);
        
        console.log(`Successfully loaded ${surveyors.length} surveyors from Supabase`);
        return surveyors;
      } else {
        console.error("Failed to load surveyors from Supabase:", result.error);
        // Return empty array if database query failed
        return [];
      }
    } catch (error) {
      console.error("Error loading surveyors from Supabase:", error);
      console.error("Error stack:", error.stack);
      // Fall back to AsyncStorage
    }
  } else {
    console.log("Supabase not configured, using local storage");
    const url = Constants.expoConfig?.extra?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = Constants.expoConfig?.extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    console.log("Supabase URL:", url ? "Set" : "Not set");
    console.log("Supabase Key:", key ? "Set" : "Not set");
  }

  // Fallback to AsyncStorage
  try {
    const data = await AsyncStorage.getItem("@esroster:surveyors");
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Error loading surveyors:", error);
    return [];
  }
}

// ==================== ROSTERS ====================

export async function saveRoster(roster) {
  if (isSupabaseConfigured()) {
    try {
      // Check if roster exists in Supabase by date range (startDate and endDate)
      let rosterId = roster.id;
      let isExistingRoster = false;
      
      // If roster ID starts with "roster_", it's a generated ID - check for existing roster by date range and area
      const rosterArea = roster.area || "SOUTH";
      console.log(`saveRoster called with roster.area: ${roster.area}, rosterArea: ${rosterArea}, rosterId: ${rosterId}`);
      if (!rosterId || rosterId.startsWith("roster_")) {
        // Check if a roster already exists for this date range and area
        const allRostersResult = await db.getAllRosters();
        if (allRostersResult.success && allRostersResult.data) {
          const existingRoster = allRostersResult.data.find(
            (r) => {
              const rArea = areaFromDbForRoster(r.area || "STSP");
              return r.start_date === roster.startDate && 
                     r.end_date === roster.endDate && 
                     rArea === rosterArea;
            }
          );
          
          if (existingRoster) {
            rosterId = existingRoster.id;
            isExistingRoster = true;
          }
        }
      } else {
        // Check if the roster ID exists in the database
        const rosterResult = await db.getRoster(rosterId);
        if (rosterResult.success && rosterResult.data) {
          isExistingRoster = true;
        }
      }
      
      if (!isExistingRoster) {
        // Create new roster in Supabase
        const result = await db.createRoster({
          startDate: roster.startDate,
          endDate: roster.endDate,
          status: roster.status || "draft",
          area: areaToDbForRoster(rosterArea),
        });
        
        if (result.success) {
          rosterId = result.data.id;
          
          // Delete any existing assignments for this roster (in case of partial saves or retries)
          const { error: deleteError } = await supabase
            .from("assignments")
            .delete()
            .eq("roster_id", rosterId);
          
          if (deleteError) {
            console.warn("Warning: Error deleting existing assignments before creating new ones:", deleteError);
            // Continue anyway - might be first time creating
          }
          
          // Save assignments
          const assignments = [];
          const assignmentsByDate = roster.assignmentsByDate || {};
          console.log(`Preparing to save assignments for roster ${rosterId}. AssignmentsByDate keys:`, Object.keys(assignmentsByDate));
          
          for (const [dateKey, items] of Object.entries(assignmentsByDate)) {
            if (!Array.isArray(items)) {
              console.warn(`Skipping invalid assignment data for ${dateKey}: not an array`, items);
              continue;
            }
            for (const assignment of items) {
              if (!assignment.surveyorId) {
                console.warn(`Skipping assignment without surveyorId:`, assignment);
                continue;
              }
              assignments.push({
                rosterId,
                surveyorId: assignment.surveyorId,
                dateKey,
                shift: assignment.shift,
                breakMins: assignment.breakMins,
                confirmed: assignment.confirmed,
              });
            }
          }
          
          if (assignments.length > 0) {
            console.log(`Saving ${assignments.length} assignments for roster ${rosterId}`);
            console.log(`Sample assignment:`, assignments[0]);
            const assignmentsResult = await db.bulkCreateAssignments(assignments);
            if (!assignmentsResult.success) {
              console.error("Error saving assignments:", assignmentsResult.error);
              return { success: false, error: `Failed to save assignments: ${assignmentsResult.error}`, data: null };
            }
            console.log(`Successfully saved ${assignmentsResult.data?.length || 0} assignments`);
          } else {
            console.log(`No assignments to save for roster ${rosterId}. AssignmentsByDate had ${Object.keys(assignmentsByDate).length} date keys`);
          }
          
          return { success: true, data: { id: rosterId } };
        }
      } else {
        // Update existing roster - delete old assignments and create new ones
        console.log(`Deleting old assignments for roster ${rosterId}`);
        const { data: deletedData, error: deleteError } = await supabase
          .from("assignments")
          .delete()
          .eq("roster_id", rosterId)
          .select();
        
        if (deleteError) {
          console.error("Error deleting old assignments:", deleteError);
          throw deleteError;
        }
        console.log(`Deleted ${deletedData?.length || 0} old assignments for roster ${rosterId}`);
        
        // Wait a bit to ensure delete is committed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Save new assignments
        const assignments = [];
        const assignmentsByDate = roster.assignmentsByDate || {};
        console.log(`Preparing to save assignments for roster ${rosterId} (update). AssignmentsByDate keys:`, Object.keys(assignmentsByDate));
        
        for (const [dateKey, items] of Object.entries(assignmentsByDate)) {
          if (!Array.isArray(items)) {
            console.warn(`Skipping invalid assignment data for ${dateKey}: not an array`, items);
            continue;
          }
          for (const assignment of items) {
            if (!assignment.surveyorId) {
              console.warn(`Skipping assignment without surveyorId:`, assignment);
              continue;
            }
            assignments.push({
              rosterId,
              surveyorId: assignment.surveyorId,
              dateKey,
              shift: assignment.shift,
              breakMins: assignment.breakMins,
              confirmed: assignment.confirmed,
            });
          }
        }
        
        if (assignments.length > 0) {
          console.log(`Saving ${assignments.length} assignments for roster ${rosterId} (update)`);
          console.log(`Sample assignment:`, assignments[0]);
          const assignmentsResult = await db.bulkCreateAssignments(assignments);
          if (!assignmentsResult.success) {
            console.error("Error saving assignments:", assignmentsResult.error);
            return { success: false, error: `Failed to save assignments: ${assignmentsResult.error}`, data: null };
          }
          console.log(`Successfully saved ${assignmentsResult.data?.length || 0} assignments`);
        } else {
          console.log(`No assignments to save for roster ${rosterId} (update). AssignmentsByDate had ${Object.keys(assignmentsByDate).length} date keys`);
        }
        
        // Update roster metadata - preserve the area from the roster being saved
        console.log(`Updating roster ${rosterId} with area: ${rosterArea} (DB: ${areaToDbForRoster(rosterArea)})`);
        await db.updateRoster(rosterId, {
          startDate: roster.startDate,
          endDate: roster.endDate,
          status: roster.status || "draft",
          area: areaToDbForRoster(rosterArea), // Use rosterArea which comes from roster.area
        });
        
        return { success: true, data: { id: rosterId } };
      }
    } catch (error) {
      console.error("Error saving roster to Supabase:", error);
      // Fall back to AsyncStorage
    }
  }

  // Fallback to AsyncStorage
  try {
    const rosters = await loadAllRosters();
    // Check if a roster exists for the same date range and area (by startDate, endDate, and area)
    const existing = rosters.find(
      (r) => r.startDate === roster.startDate && r.endDate === roster.endDate && (r.area || "SOUTH") === (roster.area || "SOUTH")
    );
    
    if (existing) {
      // Update existing roster
      const index = rosters.indexOf(existing);
      rosters[index] = {
        ...roster,
        id: existing.id, // Keep the existing ID
        createdAt: existing.createdAt || roster.createdAt, // Keep original creation date
      };
    } else {
      // Create new roster
      rosters.push(roster);
    }
    
    await AsyncStorage.setItem("@esroster:rosters", JSON.stringify(rosters));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function loadRoster(rosterId) {
  if (isSupabaseConfigured()) {
    try {
      const rosterResult = await db.getRoster(rosterId);
      if (rosterResult.success) {
        console.log(`Loading assignments for roster ${rosterId}`);
        const assignmentsResult = await db.getAssignmentsByRoster(rosterId);
        
        if (assignmentsResult.success) {
          console.log(`Found ${assignmentsResult.data?.length || 0} assignments for roster ${rosterId}`);
          
          // Get roster area
          const rosterArea = areaFromDbForRoster(rosterResult.data.area) || "SOUTH";
          const rosterAreaName = rosterArea === "SOUTH" ? "STSP" : "NTNP";
          console.log(`Loading roster ${rosterId} for area: ${rosterAreaName} (${rosterArea})`);
          
          // Load all surveyors to check area preferences
          const surveyorsResult = await db.getSurveyors();
          const surveyorsMap = {};
          const surveyorNamesMap = {}; // For logging
          if (surveyorsResult.success && surveyorsResult.data) {
            surveyorsResult.data.forEach((s) => {
              // Database has area field with "STSP" or "NTNP" values
              const dbArea = s.area; // Raw database value: "STSP", "NTNP", or null
              const areaPref = areaFromDb(s.area) || null; // Converted to app format: "SOUTH", "NORTH", or null
              surveyorsMap[s.id] = {
                id: s.id,
                areaPreference: areaPref,
              };
              surveyorNamesMap[s.id] = s.name;
              // Log the mapping for debugging
              const dbAreaDisplay = dbArea || "null";
              const appAreaDisplay = areaPref ? (areaPref === "SOUTH" ? "STSP" : "NTNP") : "null";
              console.log(`[AREA MAPPING] Surveyor ${s.name}: DB area="${dbAreaDisplay}" → App areaPreference="${appAreaDisplay}" (${areaPref || "null"})`);
            });
            console.log(`Loaded ${Object.keys(surveyorsMap).length} surveyors for area preference checking`);
          } else {
            console.warn("Failed to load surveyors for area preference checking");
          }
          
          // Transform to app format and filter by area preference
          const assignmentsByDate = {};
          let filteredCount = 0;
          const filteredAssignments = []; // Track filtered assignments for logging
          if (assignmentsResult.data && assignmentsResult.data.length > 0) {
            assignmentsResult.data.forEach((a) => {
              // Check if surveyor's area preference matches roster area
              const surveyor = surveyorsMap[a.surveyor_id];
              const surveyorName = surveyorNamesMap[a.surveyor_id] || a.surveyor_id;
              
              if (surveyor && surveyor.areaPreference) {
                // Surveyor has area preference - must match roster area
                // Comparison: surveyor.areaPreference (app format: "SOUTH" or "NORTH") vs rosterArea (app format: "SOUTH" or "NORTH")
                console.log(`[AREA COMPARISON] Checking ${surveyorName}: surveyor.areaPreference="${surveyor.areaPreference}" (${surveyor.areaPreference === "SOUTH" ? "STSP" : "NTNP"}) vs rosterArea="${rosterArea}" (${rosterAreaName})`);
                
                if (surveyor.areaPreference !== rosterArea) {
                  const surveyorAreaName = surveyor.areaPreference === "SOUTH" ? "STSP" : "NTNP";
                  console.warn(`[AREA PREFERENCE FILTER] ❌ MISMATCH - Filtering out assignment: ${surveyorName} (ID: ${a.surveyor_id}) has area preference ${surveyorAreaName} (app: "${surveyor.areaPreference}") but roster is ${rosterAreaName} (app: "${rosterArea}") on date ${a.date_key}`);
                  filteredAssignments.push({
                    surveyorName,
                    surveyorId: a.surveyor_id,
                    surveyorArea: surveyorAreaName,
                    rosterArea: rosterAreaName,
                    dateKey: a.date_key,
                  });
                  filteredCount++;
                  return; // Skip this assignment
                } else {
                  // Log valid assignment for debugging
                  const surveyorAreaName = surveyor.areaPreference === "SOUTH" ? "STSP" : "NTNP";
                  console.log(`[AREA PREFERENCE CHECK] ✅ MATCH - Valid assignment: ${surveyorName} (${surveyorAreaName}, app: "${surveyor.areaPreference}") assigned to ${rosterAreaName} roster (app: "${rosterArea}") on ${a.date_key}`);
                }
              } else {
                // Surveyor has no area preference - allowed in any roster
                console.log(`[AREA PREFERENCE CHECK] ✅ ALLOWED - Assignment allowed: ${surveyorName} (no area preference) assigned to ${rosterAreaName} roster (app: "${rosterArea}") on ${a.date_key}`);
              }
              
              // Assignment is valid - add it
              if (!assignmentsByDate[a.date_key]) {
                assignmentsByDate[a.date_key] = [];
              }
              assignmentsByDate[a.date_key].push({
                id: a.id,
                surveyorId: a.surveyor_id,
                shift: a.shift,
                breakMins: a.break_mins,
                confirmed: a.confirmed,
              });
            });
            
            if (filteredCount > 0) {
              console.warn(`[AREA PREFERENCE FILTER] Filtered out ${filteredCount} assignments with area preference mismatches:`);
              filteredAssignments.forEach(f => {
                console.warn(`  - ${f.surveyorName} (${f.surveyorArea}) in ${f.rosterArea} roster on ${f.dateKey}`);
              });
            }
            console.log(`[AREA PREFERENCE FILTER] Transformed to ${Object.keys(assignmentsByDate).length} days with assignments (kept ${assignmentsResult.data.length - filteredCount}, filtered ${filteredCount})`);
          } else {
            console.log(`No assignments found for roster ${rosterId}`);
          }
          
          return {
            id: rosterResult.data.id,
            startDate: rosterResult.data.start_date,
            endDate: rosterResult.data.end_date,
            area: rosterArea,
            assignmentsByDate,
            createdAt: rosterResult.data.created_at,
          };
        } else {
          console.error(`Failed to load assignments for roster ${rosterId}:`, assignmentsResult.error);
        }
      } else {
        console.error(`Failed to load roster ${rosterId}:`, rosterResult.error);
      }
    } catch (error) {
      console.error("Error loading roster from Supabase:", error);
      // Fall back to AsyncStorage
    }
  }

  // Fallback to AsyncStorage
  try {
    const rosters = await loadAllRosters();
    return rosters.find((r) => r.id === rosterId) || null;
  } catch (error) {
    console.error("Error loading roster:", error);
    return null;
  }
}

export async function deleteRosterFromStorage(rosterId) {
  if (isSupabaseConfigured()) {
    try {
      const result = await db.deleteRoster(rosterId);
      return result;
    } catch (error) {
      console.error("Error deleting roster from Supabase:", error);
      // Fall back to AsyncStorage
    }
  }

  // Fallback to AsyncStorage
  try {
    const rosters = await loadAllRosters();
    const filtered = rosters.filter((r) => r.id !== rosterId);
    await AsyncStorage.setItem("@esroster:rosters", JSON.stringify(filtered));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function loadAllRosters(forceRefresh = false) {
  if (isSupabaseConfigured()) {
    try {
      // Always fetch fresh from database (no caching)
      const result = await db.getAllRosters();
      if (result.success) {
        console.log(`Loaded ${result.data.length} rosters from database`);
        return result.data.map((r) => ({
          id: r.id,
          startDate: r.start_date,
          endDate: r.end_date,
          status: r.status,
          area: areaFromDbForRoster(r.area) || "SOUTH",
          createdAt: r.created_at,
        }));
      }
    } catch (error) {
      console.error("Error loading rosters from Supabase:", error);
      // Fall back to AsyncStorage
    }
  }

  // Fallback to AsyncStorage
  try {
    const data = await AsyncStorage.getItem("@esroster:rosters");
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Error loading rosters:", error);
    return [];
  }
}

/**
 * Find and load a roster that covers a specific date
 * @param {Date} date - The date to find a roster for
 * @returns {Promise<Object|null>} - The loaded roster or null if not found
 */
export async function loadRosterForDate(date, area = "SOUTH") {
  const dateStr = format(date, "yyyy-MM-dd");

  if (isSupabaseConfigured()) {
    try {
      // Get all rosters and find one that covers this date and matches the area
      const result = await db.getAllRosters();
      if (result.success) {
        console.log(`Looking for roster covering ${dateStr} in area ${area} (${area === "SOUTH" ? "STSP" : "NTNP"})`);
        console.log(`Found ${result.data.length} rosters in database`);
        
        const matchingRoster = result.data.find((r) => {
          // Check date range first
          const dateMatches = r.start_date <= dateStr && r.end_date >= dateStr;
          if (!dateMatches) return false;
          
          // Check area - only match if area is explicitly set and matches
          if (!r.area) {
            console.log(`Roster ${r.id}: No area set, skipping`);
            return false; // Skip rosters without area set
          }
          
          const rArea = areaFromDbForRoster(r.area);
          const areaMatches = rArea === area;
          
          console.log(`Roster ${r.id}: area=${r.area} (mapped to ${rArea}), date range=${r.start_date} to ${r.end_date}, dateMatches=${dateMatches}, areaMatches=${areaMatches}`);
          
          return areaMatches;
        });
        
        if (matchingRoster) {
          console.log(`Found matching roster: ${matchingRoster.id} for area ${area}`);
          // Load the full roster with assignments
          return await loadRoster(matchingRoster.id);
        } else {
          console.log(`No matching roster found for ${dateStr} in area ${area}`);
        }
      }
    } catch (error) {
      console.error("Error loading roster for date from Supabase:", error);
      // Fall back to AsyncStorage
    }
  }

  // Fallback to AsyncStorage
  try {
    const rosters = await loadAllRosters();
    const matchingRoster = rosters.find((r) => {
      return r.startDate <= dateStr && r.endDate >= dateStr && (r.area || "SOUTH") === area;
    });
    
    if (matchingRoster) {
      return await loadRoster(matchingRoster.id);
    }
  } catch (error) {
    console.error("Error loading roster for date:", error);
  }
  
  return null;
}

// ==================== WEEKEND HISTORY ====================

export async function loadWeekendHistory() {
  if (isSupabaseConfigured()) {
    try {
      const result = await db.getWeekendHistory();
      if (result.success) {
        return result.data; // Already in the format we need
      }
    } catch (error) {
      console.error("Error loading weekend history from Supabase:", error);
      // Fall back to AsyncStorage
    }
  }

  // Fallback to AsyncStorage
  try {
    const data = await AsyncStorage.getItem("@esroster:weekend_history");
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error("Error loading weekend history:", error);
    return {};
  }
}

export async function saveWeekendHistory(history) {
  if (isSupabaseConfigured()) {
    try {
      // Sync weekend history to Supabase
      for (const [surveyorId, dates] of Object.entries(history)) {
        for (const date of dates) {
          await db.addWeekendWork(surveyorId, date);
        }
      }
      // Clean up old entries
      await db.cleanupOldWeekendHistory(21);
      return { success: true };
    } catch (error) {
      console.error("Error saving weekend history to Supabase:", error);
      // Fall back to AsyncStorage
    }
  }

  // Fallback to AsyncStorage
  try {
    await AsyncStorage.setItem("@esroster:weekend_history", JSON.stringify(history));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateWeekendHistoryFromRoster(byDate, anchorDate) {
  const { format, startOfWeek, addDays, parseISO, differenceInCalendarDays } = await import("date-fns");
  
  const history = await loadWeekendHistory();
  const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
  const windowDays = Array.from({ length: 14 }, (_, i) => addDays(start, i));
  
  for (const d of windowDays) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) {
      const dateKey = format(d, "yyyy-MM-dd");
      const items = byDate[dateKey] ?? [];
      
      for (const assignment of items) {
        if (assignment.shift !== "OFF" && assignment.confirmed) {
          const surveyorId = assignment.surveyorId;
          if (!history[surveyorId]) history[surveyorId] = [];
          if (!history[surveyorId].includes(dateKey)) {
            history[surveyorId].push(dateKey);
            
            // Save to Supabase if configured
            if (isSupabaseConfigured()) {
              await db.addWeekendWork(surveyorId, dateKey);
            }
          }
        }
      }
    }
  }
  
  // Clean old entries
  const anchorISO = format(anchorDate, "yyyy-MM-dd");
  for (const surveyorId in history) {
    history[surveyorId] = history[surveyorId].filter((dateISO) => {
      const diff = differenceInCalendarDays(parseISO(anchorISO), parseISO(dateISO));
      return diff <= 21;
    });
  }
  
  await saveWeekendHistory(history);
  return { success: true };
}

// ==================== DEMAND ====================

export async function saveDemand(demand) {
  if (isSupabaseConfigured()) {
    try {
      // Save demand settings to database
      const { demand: demandSettings, template, area } = demand;
      
      if (demandSettings) {
        // Save each date's demand settings
        const errors = [];
        for (const [dateKey, settings] of Object.entries(demandSettings)) {
          const result = await db.upsertDemandSetting(
            dateKey,
            settings.day || 0,
            settings.night || 0,
            areaToDbForRoster(area || "SOUTH")
          );
          if (!result.success) {
            errors.push(result.error);
            // If it's a schema error, stop trying and return early
            if (result.error && result.error.includes("area") && result.error.includes("schema")) {
              console.error("Database schema error detected. Please run database/add-zone-support.sql");
              return {
                success: false,
                error: "Database schema missing 'area' column. Please run the migration script: database/add-zone-support.sql"
              };
            }
          }
        }
        if (errors.length > 0) {
          console.error("Some demand settings failed to save:", errors);
        }
      }
      
      // Save template if provided
      if (template) {
        console.log(`[SAVE DEMAND] Saving template for area ${area === "SOUTH" ? "STSP" : "NTNP"}:`, template);
        const templateResult = await db.createDemandTemplate({
          name: `Default Template (${area === "SOUTH" ? "STSP" : "NTNP"})`,
          monFriDay: template.monFriDay || 2,
          satDay: template.satDay || 2,
          night: template.night || 1,
          active: true,
        });
        
        if (templateResult.success) {
          console.log(`[SAVE DEMAND] ✅ Template saved successfully:`, templateResult.data);
        } else {
          console.error(`[SAVE DEMAND] ❌ Failed to save template:`, templateResult.error);
        }
      } else {
        console.warn(`[SAVE DEMAND] No template provided to save`);
      }
      
      return { success: true };
    } catch (error) {
      console.error("Error saving demand to Supabase:", error);
      // Fall back to AsyncStorage
    }
  }

  // Fallback to AsyncStorage
  try {
    await AsyncStorage.setItem("@esroster:demand", JSON.stringify(demand));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function loadDemand(area = "SOUTH") {
  if (isSupabaseConfigured()) {
    try {
      // Load demand settings from database
      // Get date range for current month (use a wider range to ensure we get all relevant data)
      const today = new Date();
      const startOfMonth = format(new Date(today.getFullYear(), today.getMonth(), 1), "yyyy-MM-dd");
      const endOfMonth = format(new Date(today.getFullYear(), today.getMonth() + 1, 0), "yyyy-MM-dd");
      
      let demandResult;
      try {
        demandResult = await db.getDemandSettings(startOfMonth, endOfMonth, areaToDbForRoster(area));
      } catch (error) {
        console.error("Error fetching demand settings:", error);
        demandResult = { success: false, error: error.message, data: null };
      }
      
      let templateResult;
      try {
        templateResult = await db.getDemandTemplates();
        console.log(`[LOAD DEMAND] Template query result:`, {
          success: templateResult.success,
          dataLength: templateResult.data?.length || 0,
          error: templateResult.error,
        });
        if (templateResult.success && templateResult.data && templateResult.data.length > 0) {
          console.log(`[LOAD DEMAND] Found ${templateResult.data.length} active template(s):`, templateResult.data);
        } else {
          console.warn(`[LOAD DEMAND] No active templates found in database`);
        }
      } catch (error) {
        console.error("[LOAD DEMAND] Error fetching demand templates:", error);
        templateResult = { success: false, error: error.message, data: null };
      }
      
      if (demandResult.success || templateResult.success) {
        const demand = {};
        if (demandResult.success && demandResult.data) {
          console.log(`[LOAD DEMAND] Loaded ${demandResult.data.length} demand settings for area ${area === "SOUTH" ? "STSP" : "NTNP"}`);
          demandResult.data.forEach((d) => {
            demand[d.date_key] = {
              day: d.day_demand || 0,
              night: d.night_demand || 0,
            };
          });
        } else {
          console.log(`[LOAD DEMAND] No demand settings found for area ${area === "SOUTH" ? "STSP" : "NTNP"}`);
        }
        
        let template;
        if (templateResult.success && templateResult.data && templateResult.data.length > 0) {
          // Use the most recent active template
          const latestTemplate = templateResult.data[0];
          template = {
            monFriDay: latestTemplate.mon_fri_day || 2,
            satDay: latestTemplate.sat_day || 2,
            night: latestTemplate.night || 1,
          };
          console.log(`[LOAD DEMAND] ✅ Loaded template from database:`, template, `(from template: ${latestTemplate.name})`);
        } else {
          // No template in database, use defaults based on area
          const areaName = area === "SOUTH" ? "STSP" : "NTNP";
          if (area === "SOUTH") {
            template = {
              monFriDay: 5,
              satDay: 3,
              night: 1,
            };
          } else {
            template = {
              monFriDay: 3,
              satDay: 1,
              night: 0,
            };
          }
          console.log(`[LOAD DEMAND] ⚠️ No template in database, using default for ${areaName}:`, template);
        }
        
        return { demand, template, area };
      } else {
        console.warn(`[LOAD DEMAND] Both demand and template queries failed`);
      }
    } catch (error) {
      console.error("Error loading demand from Supabase:", error);
      // Fall back to AsyncStorage
    }
  }

  // Fallback to AsyncStorage
  try {
    const data = await AsyncStorage.getItem("@esroster:demand");
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Error loading demand:", error);
    return null;
  }
}

// Export functions for backward compatibility
export { exportRosterToCSV, exportRosterToJSON } from "./storage";

