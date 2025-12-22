import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEYS = {
  SURVEYORS: "@esroster:surveyors",
  ROSTERS: "@esroster:rosters",
  WEEKEND_HISTORY: "@esroster:weekend_history",
  DEMAND: "@esroster:demand",
};

/**
 * Surveyor management
 */
export async function saveSurveyors(surveyors) {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.SURVEYORS, JSON.stringify(surveyors));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function loadSurveyors() {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.SURVEYORS);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Error loading surveyors:", error);
    return null;
  }
}

/**
 * Roster management
 */
export async function saveRoster(roster) {
  try {
    const rosters = await loadAllRosters();
    const existing = rosters.find((r) => r.id === roster.id);
    
    if (existing) {
      const index = rosters.indexOf(existing);
      rosters[index] = roster;
    } else {
      rosters.push(roster);
    }
    
    await AsyncStorage.setItem(STORAGE_KEYS.ROSTERS, JSON.stringify(rosters));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function loadRoster(rosterId) {
  try {
    const rosters = await loadAllRosters();
    return rosters.find((r) => r.id === rosterId) || null;
  } catch (error) {
    console.error("Error loading roster:", error);
    return null;
  }
}

export async function loadAllRosters() {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.ROSTERS);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Error loading rosters:", error);
    return [];
  }
}

export async function deleteRoster(rosterId) {
  try {
    const rosters = await loadAllRosters();
    const filtered = rosters.filter((r) => r.id !== rosterId);
    await AsyncStorage.setItem(STORAGE_KEYS.ROSTERS, JSON.stringify(filtered));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Weekend history tracking
 */
export async function saveWeekendHistory(history) {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.WEEKEND_HISTORY, JSON.stringify(history));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function loadWeekendHistory() {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.WEEKEND_HISTORY);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error("Error loading weekend history:", error);
    return {};
  }
}

/**
 * Update weekend history when a roster is confirmed
 * Call this after validating and confirming a roster
 */
export async function updateWeekendHistoryFromRoster(byDate, anchorDate) {
  try {
    const history = await loadWeekendHistory();
    const { format, startOfWeek, addDays, parseISO, differenceInCalendarDays } = await import("date-fns");
    
    const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
    const windowDays = Array.from({ length: 14 }, (_, i) => addDays(start, i));
    
    for (const d of windowDays) {
      const dow = d.getDay();
      if (dow === 0 || dow === 6) {
        // Weekend day
        const dateKey = format(d, "yyyy-MM-dd");
        const items = byDate[dateKey] ?? [];
        
        for (const assignment of items) {
          if (assignment.shift !== "OFF" && assignment.confirmed) {
            const surveyorId = assignment.surveyorId;
            if (!history[surveyorId]) history[surveyorId] = [];
            if (!history[surveyorId].includes(dateKey)) {
              history[surveyorId].push(dateKey);
            }
          }
        }
      }
    }
    
    // Clean old entries (older than 21 days)
    const anchorISO = format(anchorDate, "yyyy-MM-dd");
    for (const surveyorId in history) {
      history[surveyorId] = history[surveyorId].filter((dateISO) => {
        const diff = differenceInCalendarDays(parseISO(anchorISO), parseISO(dateISO));
        return diff <= 21;
      });
    }
    
    await saveWeekendHistory(history);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Demand settings
 */
export async function saveDemand(demand) {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.DEMAND, JSON.stringify(demand));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function loadDemand() {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.DEMAND);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Error loading demand:", error);
    return null;
  }
}

/**
 * Export roster to JSON (for backup/sharing)
 */
export function exportRosterToJSON(roster) {
  return JSON.stringify(roster, null, 2);
}

/**
 * Export roster to CSV
 */
export function exportRosterToCSV(roster, surveyors) {
  // Helper function to escape CSV values
  const escapeCSV = (value) => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    // If value contains comma, quote, or newline, wrap in quotes and escape quotes
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = ["Date,Surveyor,Shift,Break Minutes,Confirmed"];
  const surveyorMap = Object.fromEntries(surveyors.map((s) => [s.id, s.name]));
  
  for (const [dateKey, assignments] of Object.entries(roster.assignmentsByDate || {})) {
    for (const assignment of assignments) {
      const surveyorName = surveyorMap[assignment.surveyorId] || assignment.surveyorId;
      lines.push(
        [
          escapeCSV(dateKey),
          escapeCSV(surveyorName),
          escapeCSV(assignment.shift || ""),
          escapeCSV(assignment.breakMins || 0),
          escapeCSV(assignment.confirmed ? "Yes" : "No"),
        ].join(",")
      );
    }
  }
  
  return lines.join("\n");
}

