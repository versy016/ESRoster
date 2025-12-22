/**
 * API client for roster solver (Phase 2)
 * 
 * This module handles communication with the FastAPI backend
 * that uses OR-Tools to generate compliant rosters.
 */

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Generate a roster using the solver
 * 
 * @param {Object} params
 * @param {Array} params.surveyors - List of surveyors with {id, name, active}
 * @param {Object} params.demand - Demand requirements by date
 * @param {Date} params.startDate - Start date for the roster period
 * @param {Object} params.weekendHistory - Weekend work history per surveyor
 * @param {Array} params.lockedAssignments - Array of assignment IDs to lock
 * @returns {Promise<Object>} Generated roster with assignments
 */
export async function generateRoster({
  surveyors,
  demand,
  startDate,
  weekendHistory = {},
  lockedAssignments = [],
}) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/roster/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        surveyors: surveyors.filter((s) => s.active),
        demand,
        start_date: startDate.toISOString().split("T")[0],
        weekend_history: weekendHistory,
        locked_assignments: lockedAssignments,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to generate roster");
    }

    const data = await response.json();
    return {
      success: true,
      roster: data.roster,
      assignmentsByDate: data.assignments_by_date,
    };
  } catch (error) {
    console.error("Error generating roster:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Regenerate roster while keeping locked assignments
 * 
 * @param {Object} params - Same as generateRoster
 * @returns {Promise<Object>} Regenerated roster
 */
export async function regenerateRoster(params) {
  // Same as generateRoster, but backend will respect locked assignments
  return generateRoster(params);
}

/**
 * Validate roster against rules (server-side validation)
 * 
 * @param {Object} roster - Roster object with assignmentsByDate
 * @param {Array} surveyors - List of surveyors
 * @param {Object} weekendHistory - Weekend work history
 * @returns {Promise<Object>} Validation result with issues array
 */
export async function validateRosterAPI(roster, surveyors, weekendHistory = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/roster/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        roster,
        surveyors: surveyors.filter((s) => s.active),
        weekend_history: weekendHistory,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to validate roster");
    }

    const data = await response.json();
    return {
      success: true,
      issues: data.issues || [],
      valid: data.valid || false,
    };
  } catch (error) {
    console.error("Error validating roster:", error);
    return {
      success: false,
      error: error.message,
      issues: [],
      valid: false,
    };
  }
}

/**
 * Health check for API
 */
export async function checkAPIHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.ok;
  } catch (error) {
    return false;
  }
}

