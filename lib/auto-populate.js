/**
 * Auto-populate roster algorithm
 * 
 * This module automatically assigns surveyors to meet demand while respecting
 * all business rules (9 shifts per fortnight, weekend rotation, etc.)
 */

import { format, startOfWeek, addDays, parseISO, differenceInCalendarDays, subDays } from "date-fns";
import { SHIFT, isWeekend, isSaturday, isSunday, isWeekday } from "./rules";
import { loadDemand, loadAllRosters, loadRoster } from "./storage-hybrid";

/**
 * Auto-populate roster for a given fortnight
 * 
 * @param {Object} params
 * @param {Array} params.surveyors - Active surveyors [{id, name, active}]
 * @param {Date} params.anchorDate - Anchor date (Monday of fortnight)
 * @param {Object} params.weekendHistory - Weekend work history {surveyorId: [dates]}
 * @param {Object} params.existingAssignments - Existing assignments to preserve {dateKey: [assignments]}
 * @returns {Object} { success: boolean, assignments: {dateKey: [assignments]}, issues: string[] }
 */
export async function autoPopulateRoster({
  surveyors,
  anchorDate,
  weekendHistory = {},
  existingAssignments = {},
  area = "SOUTH",
  demand = null,
}) {
  const areaName = area === "SOUTH" ? "STSP" : "NTNP";
  console.log(`[AUTO-POPULATE] Starting auto-populate for area: ${areaName} (${area})`);
  
  const activeSurveyors = surveyors.filter((s) => s.active);
  console.log(`[AUTO-POPULATE] Total surveyors: ${surveyors.length}, Active: ${activeSurveyors.length}`);
  
  if (activeSurveyors.length === 0) {
    return {
      success: false,
      error: "No active surveyors available",
      assignments: {},
    };
  }

  // Get fortnight window (14 days starting Monday) - populate selected fortnight
  const startDate = startOfWeek(anchorDate, { weekStartsOn: 1 });
  const fortnightDays = Array.from({ length: 14 }, (_, i) => addDays(startDate, i));
  const dateKeys = fortnightDays.map((d) => format(d, "yyyy-MM-dd"));
  
  // Load previous rosters to check who worked night shifts in previous fortnights
  let previousNightShiftWorkers = new Set(); // Track who worked night shifts in previous fortnights
  let lastNightShiftDates = {}; // Track the last night shift date for each worker from previous rosters
  try {
    const allRosters = await loadAllRosters();
    const previousFortnightStart = subDays(startDate, 14);
    const previousFortnightEnd = subDays(startDate, 1);
    
    // Find rosters that overlap with the previous fortnight
    const previousRosters = allRosters.filter((r) => {
      if (!r.startDate || !r.endDate) return false;
      const rArea = r.area || "SOUTH";
      const rAreaApp = rArea === "STSP" ? "SOUTH" : rArea === "NTNP" ? "NORTH" : rArea;
      if (rAreaApp !== area) return false; // Only check rosters for the same area
      
      const rStart = parseISO(r.startDate);
      const rEnd = parseISO(r.endDate);
      // Check if roster overlaps with previous fortnight
      return rStart <= previousFortnightEnd && rEnd >= previousFortnightStart;
    });
    
    console.log(`[AUTO-POPULATE] Found ${previousRosters.length} previous rosters for night shift rotation check`);
    
    // Load assignments from previous rosters to see who worked night shifts and when
    for (const roster of previousRosters) {
      try {
        const rosterData = await loadRoster(roster.id);
        if (rosterData && rosterData.assignmentsByDate) {
          // Check all dates in the previous fortnight range
          const prevFortnightDays = Array.from({ length: 14 }, (_, i) => addDays(previousFortnightStart, i));
          for (const date of prevFortnightDays) {
            const dateKey = format(date, "yyyy-MM-dd");
            const assignments = rosterData.assignmentsByDate[dateKey] || [];
            assignments.forEach((a) => {
              if (a.shift === SHIFT.NIGHT && isWeekday(date)) {
                previousNightShiftWorkers.add(a.surveyorId);
                // Track the most recent night shift date for each worker
                if (!lastNightShiftDates[a.surveyorId] || dateKey > lastNightShiftDates[a.surveyorId]) {
                  lastNightShiftDates[a.surveyorId] = dateKey;
                }
              }
            });
          }
        }
      } catch (error) {
        console.warn(`[AUTO-POPULATE] Error loading previous roster ${roster.id}:`, error);
      }
    }
    
    console.log(`[AUTO-POPULATE] Previous night shift workers: ${Array.from(previousNightShiftWorkers).map(id => {
      const s = activeSurveyors.find(s => s.id === id);
      return s ? `${s ? s.name : id} (last night: ${lastNightShiftDates[id] || "unknown"})` : id;
    }).join(", ") || "none"}`);
  } catch (error) {
    console.warn(`[AUTO-POPULATE] Error loading previous rosters for rotation:`, error);
  }

  // Load demand settings if not provided
  let demandSettings = demand;
  let demandTemplate = null;
  if (!demandSettings) {
    const demandData = await loadDemand(area);
    demandSettings = demandData?.demand || {};
    demandTemplate = demandData?.template || null;
    
    // If we have a template but no specific demand settings, populate demand from template
    if (demandTemplate && Object.keys(demandSettings).length === 0) {
      console.log(`[AUTO-POPULATE] No specific demand settings found, using template:`, demandTemplate);
      // Populate demand for all dates in the fortnight using template
      dateKeys.forEach((dateKey) => {
        const dateObj = parseISO(dateKey);
        if (isSunday(dateObj)) {
          demandSettings[dateKey] = { day: 0, night: 0 };
        } else if (isWeekday(dateObj)) {
          demandSettings[dateKey] = {
            day: demandTemplate.monFriDay || (area === "SOUTH" ? 6 : 3),
            night: demandTemplate.night || (area === "SOUTH" ? 1 : 0),
          };
        } else if (isSaturday(dateObj)) {
          demandSettings[dateKey] = {
            day: demandTemplate.satDay || (area === "SOUTH" ? 3 : 1),
            night: 0,
          };
        }
      });
      console.log(`[AUTO-POPULATE] Populated demand from template for ${Object.keys(demandSettings).length} dates`);
    }
  }

  // Initialize assignments from existing (preserve locked assignments)
  const assignments = { ...existingAssignments };

  // Initialize tracking
  const surveyorStats = {};
  activeSurveyors.forEach((s) => {
    surveyorStats[s.id] = {
      shiftsAssigned: 0,
      weekendDaysAssigned: 0,
      weekendDays: [],
      saturdaysWorked: [],
      assignments: [],
    };
  });

  // Count existing assignments
  dateKeys.forEach((dateKey) => {
    const existing = assignments[dateKey] || [];
    existing.forEach((a) => {
      if (a.shift === SHIFT.DAY || a.shift === SHIFT.NIGHT) {
        const stats = surveyorStats[a.surveyorId];
        if (stats) {
          stats.shiftsAssigned++;
          const dateObj = parseISO(dateKey);
          if (isWeekend(dateObj)) {
            stats.weekendDaysAssigned++;
            stats.weekendDays.push(dateKey);
          }
          if (isSaturday(dateObj)) {
            stats.saturdaysWorked.push(dateKey);
          }
          stats.assignments.push({ dateKey, shift: a.shift });
        }
      }
    });
  });

  // Check weekend history constraints
  const anchorISO = format(anchorDate, "yyyy-MM-dd");
  const canWorkWeekend = {};
  activeSurveyors.forEach((s) => {
    const hist = weekendHistory[s.id] || [];
    const recentWeekend = hist.some((dt) => {
      const histDate = parseISO(dt);
      const anchor = parseISO(anchorISO);
      const diffDays = Math.floor((anchor - histDate) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= 21;
    });
    canWorkWeekend[s.id] = !recentWeekend;
  });

  // Identify night shift workers by shift preference (not hardcoded names)
  // Night shift workers are those with shiftPreference === "NIGHT" and matching area preference
  const nightShiftWorkers = activeSurveyors.filter((s) => {
    // Must have night shift preference
    if (s.shiftPreference !== "NIGHT") return false;
    // Must match area preference (or have no area preference)
    if (s.areaPreference && s.areaPreference !== area) return false;
    return true;
  });
  
  console.log(`[AUTO-POPULATE] Found ${nightShiftWorkers.length} night shift workers for ${areaName}: ${nightShiftWorkers.map(s => s.name).join(", ") || "none"}`);

  // Track night shift assignments for rotation
  const nightShiftTracking = {};
  nightShiftWorkers.forEach((s) => {
    nightShiftTracking[s.id] = {
      consecutiveNightWeeks: 0,
      lastNightShiftDate: lastNightShiftDates[s.id] || null, // Initialize with last night shift date from previous rosters
      nightShiftsInCurrentRotation: [],
      requiredDaysOff: [], // Track days that need to be off after 2-week rotation
      workedLastFortnight: previousNightShiftWorkers.has(s.id), // Track if they worked last fortnight
    };
    if (lastNightShiftDates[s.id]) {
      console.log(`[AUTO-POPULATE] Initialized ${s.name} with last night shift date: ${lastNightShiftDates[s.id]}`);
    }
  });

  // Select ONE dedicated night shift worker for this entire fortnight
  // This worker will work all 10 night shifts (Mon-Fri) for the fortnight
  const selectDedicatedNightShiftWorker = () => {
    // Filter available workers (those who didn't work last fortnight, not in 3-day off, available)
    const availableWorkers = nightShiftWorkers.filter((s) => {
      const tracking = nightShiftTracking[s.id];
      if (!tracking) return false;
      
      // Exclude if they worked last fortnight (unless they're the only worker)
      if (tracking.workedLastFortnight && nightShiftWorkers.length > 1) {
        return false;
      }
      
      // Check if they're in 3-day off period (check first weekday of fortnight)
      const firstWeekday = dateKeys.find(dk => {
        const d = parseISO(dk);
        return isWeekday(d);
      });
      if (firstWeekday) {
        const firstWeekdayDate = parseISO(firstWeekday);
        if (tracking.requiredDaysOff && tracking.requiredDaysOff.includes(firstWeekday)) {
          return false;
        }
        if (tracking.lastNightShiftDate) {
          const lastNightDate = parseISO(tracking.lastNightShiftDate);
          const daysSinceLastNight = differenceInCalendarDays(firstWeekdayDate, lastNightDate);
          if (daysSinceLastNight > 0 && daysSinceLastNight <= 3) {
            return false; // Still in 3-day off period
          }
        }
        // Check non-availability for first weekday
        const nonAvailability = s.nonAvailability || [];
        if (nonAvailability.includes(firstWeekday)) {
          return false;
        }
      }
      
      return true;
    });
    
    if (availableWorkers.length === 0) {
      // Fallback: allow workers who worked last fortnight if they're past 3-day off
      const fallbackWorkers = nightShiftWorkers.filter((s) => {
        const tracking = nightShiftTracking[s.id];
        if (!tracking) return false;
        
        const firstWeekday = dateKeys.find(dk => {
          const d = parseISO(dk);
          return isWeekday(d);
        });
        if (firstWeekday) {
          const firstWeekdayDate = parseISO(firstWeekday);
          if (tracking.requiredDaysOff && tracking.requiredDaysOff.includes(firstWeekday)) {
            return false;
          }
          if (tracking.lastNightShiftDate) {
            const lastNightDate = parseISO(tracking.lastNightShiftDate);
            const daysSinceLastNight = differenceInCalendarDays(firstWeekdayDate, lastNightDate);
            if (daysSinceLastNight > 0 && daysSinceLastNight <= 3) {
              return false;
            }
          }
          const nonAvailability = s.nonAvailability || [];
          if (nonAvailability.includes(firstWeekday)) {
            return false;
          }
        }
        return true;
      });
      
      if (fallbackWorkers.length > 0) {
        // Pick the one with the oldest last night shift date
        return fallbackWorkers.sort((a, b) => {
          const aLast = nightShiftTracking[a.id]?.lastNightShiftDate;
          const bLast = nightShiftTracking[b.id]?.lastNightShiftDate;
          if (!aLast) return -1;
          if (!bLast) return 1;
          return parseISO(aLast).getTime() - parseISO(bLast).getTime();
        })[0];
      }
      return null;
    }
    
    // Prefer workers who haven't worked last fortnight
    const preferredWorkers = availableWorkers.filter(s => !nightShiftTracking[s.id]?.workedLastFortnight);
    if (preferredWorkers.length > 0) {
      // Pick the one with the oldest last night shift date (longest rest)
      return preferredWorkers.sort((a, b) => {
        const aLast = nightShiftTracking[a.id]?.lastNightShiftDate;
        const bLast = nightShiftTracking[b.id]?.lastNightShiftDate;
        if (!aLast) return -1;
        if (!bLast) return 1;
        return parseISO(aLast).getTime() - parseISO(bLast).getTime();
      })[0];
    }
    
    // All available workers worked last fortnight, pick the one with oldest last shift
    return availableWorkers.sort((a, b) => {
      const aLast = nightShiftTracking[a.id]?.lastNightShiftDate;
      const bLast = nightShiftTracking[b.id]?.lastNightShiftDate;
      if (!aLast) return -1;
      if (!bLast) return 1;
      return parseISO(aLast).getTime() - parseISO(bLast).getTime();
    })[0];
  };
  
  // Select the dedicated night shift worker for this fortnight
  const dedicatedNightShiftWorker = selectDedicatedNightShiftWorker();
  if (dedicatedNightShiftWorker) {
    console.log(`[AUTO-POPULATE] Selected dedicated night shift worker for this fortnight: ${dedicatedNightShiftWorker.name}`);
  } else {
    console.warn(`[AUTO-POPULATE] No available night shift worker for this fortnight`);
  }

  // Function to get the next available night shift worker for fair rotation
  const getNextNightShiftWorker = (dateObj, excludeIds = []) => {
    // Filter out workers who:
    // 1. Worked last fortnight (unless they're the only one)
    // 2. Are in 3-day off period
    // 3. Are excluded (already assigned)
    // 4. Are not available on this date
    
    const availableWorkers = nightShiftWorkers.filter((s) => {
      if (excludeIds.includes(s.id)) return false;
      
      const tracking = nightShiftTracking[s.id];
      if (!tracking) return false;
      
      // Check if they worked last fortnight - exclude them unless they're the only worker
      if (tracking.workedLastFortnight && nightShiftWorkers.length > 1) {
        return false; // Skip if there are other workers available
      }
      
      // Check 3-day off period
      if (tracking.requiredDaysOff && tracking.requiredDaysOff.includes(format(dateObj, "yyyy-MM-dd"))) {
        return false;
      }
      
      if (tracking.lastNightShiftDate) {
        const lastNightDate = parseISO(tracking.lastNightShiftDate);
        const daysSinceLastNight = differenceInCalendarDays(dateObj, lastNightDate);
        if (tracking.consecutiveNightWeeks >= 2 && daysSinceLastNight < 3) {
          return false; // Still in 3-day off period
        }
      }
      
      // Check non-availability
      const nonAvailability = s.nonAvailability || [];
      if (nonAvailability.includes(format(dateObj, "yyyy-MM-dd"))) {
        return false;
      }
      
      return true;
    });
    
    if (availableWorkers.length === 0) {
      // If no workers available (all worked last fortnight or in 3-day off), 
      // allow the one who worked last fortnight if they're past the 3-day off period
      const fallbackWorkers = nightShiftWorkers.filter((s) => {
        if (excludeIds.includes(s.id)) return false;
        const tracking = nightShiftTracking[s.id];
        if (!tracking) return false;
        
        // Check 3-day off period
        if (tracking.requiredDaysOff && tracking.requiredDaysOff.includes(format(dateObj, "yyyy-MM-dd"))) {
          return false;
        }
        
        if (tracking.lastNightShiftDate) {
          const lastNightDate = parseISO(tracking.lastNightShiftDate);
          const daysSinceLastNight = differenceInCalendarDays(dateObj, lastNightDate);
          if (daysSinceLastNight < 3) {
            return false; // Still in 3-day off period
          }
        }
        
        // Check non-availability
        const nonAvailability = s.nonAvailability || [];
        if (nonAvailability.includes(format(dateObj, "yyyy-MM-dd"))) {
          return false;
        }
        
        return true;
      });
      
      if (fallbackWorkers.length > 0) {
        // Pick the one with the oldest last night shift date (longest rest)
        return fallbackWorkers.sort((a, b) => {
          const aLast = nightShiftTracking[a.id]?.lastNightShiftDate;
          const bLast = nightShiftTracking[b.id]?.lastNightShiftDate;
          if (!aLast) return -1;
          if (!bLast) return 1;
          return parseISO(aLast).getTime() - parseISO(bLast).getTime();
        })[0];
      }
      
      return null;
    }
    
    // Pick the worker who hasn't worked last fortnight, or if all worked, pick the one with oldest last shift
    const preferredWorkers = availableWorkers.filter(s => !nightShiftTracking[s.id]?.workedLastFortnight);
    if (preferredWorkers.length > 0) {
      // If multiple available, pick the one with the oldest last night shift date
      return preferredWorkers.sort((a, b) => {
        const aLast = nightShiftTracking[a.id]?.lastNightShiftDate;
        const bLast = nightShiftTracking[b.id]?.lastNightShiftDate;
        if (!aLast) return -1;
        if (!bLast) return 1;
        return parseISO(aLast).getTime() - parseISO(bLast).getTime();
      })[0];
    }
    
    // All available workers worked last fortnight, pick the one with oldest last shift
    return availableWorkers.sort((a, b) => {
      const aLast = nightShiftTracking[a.id]?.lastNightShiftDate;
      const bLast = nightShiftTracking[b.id]?.lastNightShiftDate;
      if (!aLast) return -1;
      if (!bLast) return 1;
      return parseISO(aLast).getTime() - parseISO(bLast).getTime();
    })[0];
  };

  // Helper function to count unique surveyors per week (needed for Phase 1 and Phase 2)
  const countUniqueSurveyorsPerWeek = (assignments, dateKeys) => {
    const week1Surveyors = new Set();
    const week2Surveyors = new Set();
    
    // Week 1: days 0-6 (Mon-Sun, but Sun has no coverage)
    // Week 2: days 7-13 (Mon-Sun, but Sun has no coverage)
    for (let i = 0; i < dateKeys.length; i++) {
      const dateKey = dateKeys[i];
      const dateAssignments = assignments[dateKey] || [];
      const week = i < 7 ? 1 : 2;
      
      dateAssignments.forEach(assignment => {
        if (assignment.shift === SHIFT.DAY) { // Only count day shifts for balance
          if (week === 1) {
            week1Surveyors.add(assignment.surveyorId);
          } else {
            week2Surveyors.add(assignment.surveyorId);
          }
        }
      });
    }
    
    return {
      week1: week1Surveyors.size,
      week2: week2Surveyors.size,
      week1Surveyors,
      week2Surveyors,
    };
  };

  // Phase 1: Fill demand for each day
  const issues = [];
  const targetShiftsPerSurveyor = 9;
  
  // Helper function to calculate target surveyors per day for even distribution
  const calculateEvenDistribution = (totalSurveyors, workingDays) => {
    if (workingDays === 0) return {};
    
    const basePerDay = Math.floor(totalSurveyors / workingDays);
    const remainder = totalSurveyors % workingDays;
    
    // Distribute evenly: some days get basePerDay, some get basePerDay + 1
    // The difference will be at most 1
    const distribution = {};
    let extraDays = remainder;
    
    for (let i = 0; i < workingDays.length; i++) {
      const dateKey = workingDays[i];
      distribution[dateKey] = basePerDay + (i < extraDays ? 1 : 0);
    }
    
    return distribution;
  };
  
  // Count working days (excluding Sundays)
  const workingDays = dateKeys.filter(dk => {
    const d = parseISO(dk);
    return !isSunday(d);
  });
  
  // We'll calculate target distribution after initial assignments
  // For now, proceed with Phase 1

  for (const dateKey of dateKeys) {
    const dateObj = parseISO(dateKey);
    
    // Rule: Sundays - no coverage
    if (isSunday(dateObj)) {
      // Clear any existing assignments for Sunday
      assignments[dateKey] = [];
      continue; // Skip Sunday completely
    }

    const dayDemand = demandSettings[dateKey];
    
    // Get demand from settings, or use template/defaults
    let dayNeeded = dayDemand?.day;
    let nightNeeded = dayDemand?.night;

    // If no demand specified for this date, use template or area-specific defaults
    if (dayNeeded === undefined || dayNeeded === null) {
      if (isWeekday(dateObj)) {
        if (demandTemplate) {
          dayNeeded = demandTemplate.monFriDay || (area === "SOUTH" ? 6 : 3);
          nightNeeded = demandTemplate.night !== undefined ? demandTemplate.night : (area === "SOUTH" ? 1 : 0);
        } else {
          // No template, use area-specific defaults (STSP: 6 day, 1 night; NTNP: 3 day, 0 night)
          dayNeeded = area === "SOUTH" ? 6 : 3;
          nightNeeded = area === "SOUTH" ? 1 : 0;
        }
      } else if (isSaturday(dateObj)) {
        if (demandTemplate) {
          dayNeeded = demandTemplate.satDay || (area === "SOUTH" ? 3 : 1);
          nightNeeded = 0;
        } else {
          // No template, use area-specific defaults (STSP: 3 day; NTNP: 1 day)
          dayNeeded = area === "SOUTH" ? 3 : 1;
          nightNeeded = 0;
        }
      } else {
        // Sunday - no coverage
        dayNeeded = 0;
        nightNeeded = 0;
      }
    } else {
      // Use the specified demand values (even if 0)
      dayNeeded = dayNeeded || 0;
      nightNeeded = nightNeeded !== undefined ? (nightNeeded || 0) : (demandTemplate?.night || (area === "SOUTH" ? 1 : 0));
    }
    
    console.log(`[AUTO-POPULATE] Date ${dateKey}: dayNeeded=${dayNeeded}, nightNeeded=${nightNeeded} (from ${dayDemand?.day !== undefined ? 'specific' : demandTemplate ? 'template' : 'default'})`);

    const existing = assignments[dateKey] || [];
    const dayAssigned = existing.filter((a) => a.shift === SHIFT.DAY).length;
    let nightAssigned = existing.filter((a) => a.shift === SHIFT.NIGHT).length;

    // Saturday demand is treated as MAXIMUM (not minimum)
    // Weekday demand is treated as MINIMUM
    const isSaturdayDay = isSaturday(dateObj);
    let dayRemaining;
    if (isSaturdayDay) {
      // Saturday: Don't exceed demand (maximum constraint)
      dayRemaining = Math.max(0, dayNeeded - dayAssigned);
      // But if already at or above demand, don't assign more
      if (dayAssigned >= dayNeeded) {
        dayRemaining = 0;
      }
    } else {
      // Weekday: Meet minimum demand
      dayRemaining = Math.max(0, dayNeeded - dayAssigned);
    }
    
    let nightRemaining = Math.max(0, nightNeeded - nightAssigned);

    // Check week balance before assigning day shifts
    const currentWeekBalance = countUniqueSurveyorsPerWeek(assignments, dateKeys);
    const targetSurveyorsPerWeek = 7;
    const dateWeek = dateKeys.indexOf(dateKey) < 7 ? 1 : 2;
    const week1NeedsMore = currentWeekBalance.week1 < targetSurveyorsPerWeek;
    const week2NeedsMore = currentWeekBalance.week2 < targetSurveyorsPerWeek;
    
    // Adjust dayRemaining based on week balance
    // If one week has too many surveyors, reduce assignments to that week
    let adjustedDayRemaining = dayRemaining;
    if (dateWeek === 1 && currentWeekBalance.week1 >= targetSurveyorsPerWeek && week2NeedsMore) {
      // Week 1 already has enough surveyors, week 2 needs more - reduce assignments to week 1
      // Only assign minimum needed to meet demand
      adjustedDayRemaining = Math.min(dayRemaining, dayNeeded - dayAssigned);
    } else if (dateWeek === 2 && currentWeekBalance.week2 >= targetSurveyorsPerWeek && week1NeedsMore) {
      // Week 2 already has enough surveyors, week 1 needs more - reduce assignments to week 2
      adjustedDayRemaining = Math.min(dayRemaining, dayNeeded - dayAssigned);
    }
    
    // Assign day shifts
    for (let i = 0; i < adjustedDayRemaining; i++) {
      // Update existing to include previously assigned shifts in this loop
      const currentExisting = assignments[dateKey] || [];
      
      // Update week balance for candidate selection
      const updatedWeekBalance = countUniqueSurveyorsPerWeek(assignments, dateKeys);
      
      const candidate = findBestCandidate({
        dateKey,
        dateObj,
        shift: SHIFT.DAY,
        surveyors: activeSurveyors,
        surveyorStats,
        canWorkWeekend,
        existing: currentExisting, // Use current assignments including ones just added
        dateKeys,
        area,
        nightShiftTracking, // Pass night shift tracking to check 3-day off period
        weekBalance: updatedWeekBalance, // Pass week balance for prioritization
        targetWeek: dateWeek === 1 ? (week1NeedsMore ? 1 : 2) : (week2NeedsMore ? 2 : 1), // Target week that needs more
      });

      if (candidate) {
        const assignment = {
          id: `${dateKey}_${candidate.id}_${Math.random().toString(16).slice(2)}`,
          surveyorId: candidate.id,
          shift: SHIFT.DAY,
          breakMins: 30,
          confirmed: false,
        };

        if (!assignments[dateKey]) assignments[dateKey] = [];
        assignments[dateKey].push(assignment);

        // Update stats immediately so next iteration considers this assignment
        surveyorStats[candidate.id].shiftsAssigned++;
        surveyorStats[candidate.id].assignments.push({ dateKey, shift: SHIFT.DAY });
        if (isWeekend(dateObj)) {
          surveyorStats[candidate.id].weekendDaysAssigned++;
          surveyorStats[candidate.id].weekendDays.push(dateKey);
        }
        if (isSaturday(dateObj)) {
          surveyorStats[candidate.id].saturdaysWorked.push(dateKey);
        }
      } else {
        issues.push(`Could not assign day shift for ${dateKey} - no available surveyors`);
      }
    }

    // Update existing assignments to include newly assigned day shifts before assigning night shifts
    // This prevents assigning the same person to both day and night shifts on the same day
    const updatedExisting = assignments[dateKey] || [];
    // Recalculate nightAssigned from updated existing (includes day shifts just assigned)
    let updatedNightAssigned = updatedExisting.filter((a) => a.shift === SHIFT.NIGHT).length;
    
    // Sync nightAssigned with actual count to prevent discrepancies
    nightAssigned = updatedNightAssigned;
    nightRemaining = Math.max(0, nightNeeded - nightAssigned);
    
    console.log(`[AUTO-POPULATE] Before night assignment for ${dateKey}: nightNeeded=${nightNeeded}, nightAssigned=${nightAssigned}, nightRemaining=${nightRemaining}`);

    // Assign night shifts - ONE dedicated worker for the entire fortnight
    // Night shifts are only Mon-Fri (no weekends)
    if (nightNeeded > 0 && isWeekday(dateObj)) {
      // Use the dedicated night shift worker selected for this fortnight
      if (dedicatedNightShiftWorker) {
        const tracking = nightShiftTracking[dedicatedNightShiftWorker.id];
        if (!tracking) {
          console.warn(`[AUTO-POPULATE] No tracking found for dedicated night worker ${dedicatedNightShiftWorker.name}`);
        } else {
          // Check if they're already assigned this day (including day shifts just assigned)
          const alreadyAssigned = updatedExisting.some((a) => a.surveyorId === dedicatedNightShiftWorker.id);
          
          // Also check if they already have a night shift assigned (prevent duplicates)
          const alreadyHasNightShift = updatedExisting.some((a) => a.surveyorId === dedicatedNightShiftWorker.id && a.shift === SHIFT.NIGHT);
          
          // Check if they're in 3-day off period or non-available
          const isInRequiredDaysOff = tracking.requiredDaysOff && tracking.requiredDaysOff.includes(dateKey);
          const nonAvailability = dedicatedNightShiftWorker.nonAvailability || [];
          const isNonAvailable = nonAvailability.includes(dateKey);

          if (!alreadyAssigned && !alreadyHasNightShift && !isInRequiredDaysOff && !isNonAvailable && nightNeeded > 0) {
        const assignment = {
              id: `${dateKey}_${dedicatedNightShiftWorker.id}_${Math.random().toString(16).slice(2)}`,
              surveyorId: dedicatedNightShiftWorker.id,
          shift: SHIFT.NIGHT,
          breakMins: 30,
          confirmed: false,
        };

        if (!assignments[dateKey]) assignments[dateKey] = [];
        assignments[dateKey].push(assignment);

            // Update the existing array to include this assignment for subsequent checks
            updatedExisting.push(assignment);

        // Update stats
            surveyorStats[dedicatedNightShiftWorker.id].shiftsAssigned++;
            surveyorStats[dedicatedNightShiftWorker.id].assignments.push({ dateKey, shift: SHIFT.NIGHT });

            // Update night shift count
            nightAssigned++;
            const originalNightNeeded = nightNeeded;
            nightNeeded = Math.max(0, nightNeeded - 1);
            nightRemaining = Math.max(0, nightNeeded - nightAssigned);
            
            console.log(`[AUTO-POPULATE] Assigned night shift to dedicated worker: ${dedicatedNightShiftWorker.name} on ${dateKey}. Original nightNeeded=${originalNightNeeded}, Updated nightNeeded=${nightNeeded}, nightAssigned=${nightAssigned}`);

            // Update night shift tracking
            tracking.lastNightShiftDate = dateKey;
            tracking.nightShiftsInCurrentRotation.push(dateKey);
            
            // Check if they've completed 10 night shifts (Mon-Fri over 2 weeks)
            // Night shift workers work 10 shifts per fortnight (Mon-Fri only)
            if (tracking.nightShiftsInCurrentRotation.length >= 10) {
              // Mark next 3 days off after completing 10 night shifts
              // After the last night shift (e.g., Friday night), they need Sat, Sun, Mon off (3 days)
              // This ensures they get 3 days off before they can work again
              for (let d = 1; d <= 3; d++) {
                const offDate = addDays(dateObj, d);
                const offDateKey = format(offDate, "yyyy-MM-dd");
                if (!tracking.requiredDaysOff) {
                  tracking.requiredDaysOff = [];
                }
                if (!tracking.requiredDaysOff.includes(offDateKey)) {
                  tracking.requiredDaysOff.push(offDateKey);
        }
              }
              // Reset for next rotation cycle
              tracking.nightShiftsInCurrentRotation = [];
              tracking.consecutiveNightWeeks = 0;
              tracking.workedLastFortnight = true; // Mark that they worked this fortnight
              console.log(`[AUTO-POPULATE] ${dedicatedNightShiftWorker.name} completed 10 night shifts on ${dateKey}, marking next 3 days (${format(addDays(dateObj, 1), "yyyy-MM-dd")}, ${format(addDays(dateObj, 2), "yyyy-MM-dd")}, ${format(addDays(dateObj, 3), "yyyy-MM-dd")}) off`);
            }
          } else {
            if (isInRequiredDaysOff) {
              console.warn(`[AUTO-POPULATE] Dedicated night worker ${dedicatedNightShiftWorker.name} is in required days off period for ${dateKey}`);
              issues.push(`Could not assign night shift for ${dateKey} - dedicated night worker ${dedicatedNightShiftWorker.name} is in 3-day off period`);
            } else if (isNonAvailable) {
              console.warn(`[AUTO-POPULATE] Dedicated night worker ${dedicatedNightShiftWorker.name} is not available on ${dateKey}`);
              issues.push(`Could not assign night shift for ${dateKey} - dedicated night worker ${dedicatedNightShiftWorker.name} is not available`);
            }
          }
        }
      } else {
        console.warn(`[AUTO-POPULATE] No dedicated night shift worker available for ${dateKey}`);
        issues.push(`Could not assign night shift for ${dateKey} - no dedicated night shift worker available`);
      }
    }
  }
  
  // Phase 1.5: Redistribute surveyors evenly across days
  // Ensure the gap between days is at most 1 surveyor
  console.log(`[AUTO-POPULATE] Phase 1.5: Starting even distribution across days`);
  
  // Count unique surveyors per day (not total shifts)
  const getUniqueSurveyorsPerDay = (dateKey) => {
    const dayAssignments = assignments[dateKey] || [];
    const uniqueSurveyors = new Set();
    dayAssignments.filter(a => a.shift === SHIFT.DAY).forEach(a => {
      uniqueSurveyors.add(a.surveyorId);
    });
    return uniqueSurveyors.size;
  };
  
  const weekdayKeys = dateKeys.filter(dk => {
    const d = parseISO(dk);
    return isWeekday(d);
  });
  
  if (weekdayKeys.length > 0) {
    // Get current unique surveyor counts per day
    const dayCounts = {};
    weekdayKeys.forEach(dk => {
      dayCounts[dk] = getUniqueSurveyorsPerDay(dk);
    });
    
    // Calculate total unique surveyors across all weekdays
    const allWeekdaySurveyors = new Set();
    weekdayKeys.forEach(dk => {
      const dayAssignments = assignments[dk] || [];
      dayAssignments.filter(a => a.shift === SHIFT.DAY).forEach(a => {
        allWeekdaySurveyors.add(a.surveyorId);
      });
    });
    const totalUniqueSurveyors = allWeekdaySurveyors.size;
    
    // Calculate target distribution: distribute unique surveyors evenly
    const weekdayBase = Math.floor(totalUniqueSurveyors / weekdayKeys.length);
    const weekdayRemainder = totalUniqueSurveyors % weekdayKeys.length;
    
    console.log(`[AUTO-POPULATE] Phase 1.5: Total unique weekday surveyors: ${totalUniqueSurveyors}, Weekdays: ${weekdayKeys.length}`);
    console.log(`[AUTO-POPULATE] Phase 1.5: Target per weekday: base=${weekdayBase}, remainder=${weekdayRemainder}`);
    
    // Calculate targets for each day
    const weekdayData = weekdayKeys.map((dk, idx) => ({
      dateKey: dk,
      count: dayCounts[dk] || 0,
      target: weekdayBase + (idx < weekdayRemainder ? 1 : 0)
    }));
    
    console.log(`[AUTO-POPULATE] Phase 1.5: Current distribution:`, weekdayData.map(d => `${d.dateKey}: ${d.count} (target: ${d.target})`).join(', '));
    
    // Multiple passes to redistribute: remove from high days, add to low days
    let maxRedistributionPasses = 10;
    let pass = 0;
    
    while (pass < maxRedistributionPasses) {
      pass++;
      let anyChanges = false;
      
      // Sort by count (descending) to find days with too many
      const sortedByCount = [...weekdayData].sort((a, b) => b.count - a.count);
      const minCount = Math.min(...weekdayData.map(d => d.count));
      const maxCount = Math.max(...weekdayData.map(d => d.count));
      const gap = maxCount - minCount;
      
      if (gap <= 1) {
        console.log(`[AUTO-POPULATE] Phase 1.5: ✓ Distribution balanced after ${pass} passes (gap: ${gap} ≤ 1)`);
        break;
      }
      
      console.log(`[AUTO-POPULATE] Phase 1.5: Pass ${pass} - gap: ${gap}, min: ${minCount}, max: ${maxCount}`);
      
      // Find days that are above target (have too many)
      const daysWithTooMany = sortedByCount.filter(d => d.count > d.target);
      // Find days that are below target (need more)
      const daysNeedingMore = sortedByCount.filter(d => d.count < d.target).reverse(); // Reverse to prioritize lowest
      
      // Redistribute: try to move surveyors from high days to low days
      for (const highDay of daysWithTooMany) {
        if (daysNeedingMore.length === 0) break;
        
        const dateObj = parseISO(highDay.dateKey);
        const highDayAssignments = assignments[highDay.dateKey] || [];
        const dayShiftAssignments = highDayAssignments.filter(a => a.shift === SHIFT.DAY);
        
        // Try to find a surveyor to remove from this day (prefer those who can work on low days)
        for (const assignment of dayShiftAssignments) {
          if (daysNeedingMore.length === 0) break;
          
          const surveyorId = assignment.surveyorId;
          const surveyor = activeSurveyors.find(s => s.id === surveyorId);
          if (!surveyor) continue;
          
          // Find a low day where this surveyor can be moved
          for (const lowDay of daysNeedingMore) {
            if (lowDay.count >= lowDay.target) {
              // This day no longer needs more
              continue;
            }
            
            const lowDateObj = parseISO(lowDay.dateKey);
            const lowDayAssignments = assignments[lowDay.dateKey] || [];
            
            // Check if surveyor is already assigned to low day
            const alreadyOnLowDay = lowDayAssignments.some(a => a.surveyorId === surveyorId);
            if (alreadyOnLowDay) continue;
            
            // Check if surveyor can work on low day (non-availability, etc.)
            const nonAvailability = surveyor.nonAvailability || [];
            if (nonAvailability.includes(lowDay.dateKey)) continue;
            
            // Check weekend constraints
            if (isWeekend(lowDateObj)) {
              const stats = surveyorStats[surveyorId];
              if (!canWorkWeekend[surveyorId] || stats.weekendDaysAssigned >= 1) continue;
            }
            
            // Check 3-day off rule
            let canMove = true;
            if (nightShiftTracking[surveyorId]) {
              const tracking = nightShiftTracking[surveyorId];
              if (tracking.requiredDaysOff && tracking.requiredDaysOff.includes(lowDay.dateKey)) {
                canMove = false;
              }
            }
            if (!canMove) continue;
            
            // Move the surveyor: remove from high day, add to low day
            console.log(`[AUTO-POPULATE] Phase 1.5: Moving ${surveyor.name} from ${highDay.dateKey} (${highDay.count}) to ${lowDay.dateKey} (${lowDay.count})`);
            
            // Remove from high day
            const highDayIndex = assignments[highDay.dateKey].findIndex(
              a => a.surveyorId === surveyorId && a.shift === SHIFT.DAY
            );
            if (highDayIndex >= 0) {
              assignments[highDay.dateKey].splice(highDayIndex, 1);
              highDay.count--;
              
              // Update stats
              const assignmentToRemove = surveyorStats[surveyorId].assignments.find(
                a => a.dateKey === highDay.dateKey && a.shift === SHIFT.DAY
              );
              if (assignmentToRemove) {
                const index = surveyorStats[surveyorId].assignments.indexOf(assignmentToRemove);
                if (index >= 0) {
                  surveyorStats[surveyorId].assignments.splice(index, 1);
                  surveyorStats[surveyorId].shiftsAssigned--;
                }
              }
            }
            
            // Add to low day
            const newAssignment = {
              id: `${lowDay.dateKey}_${surveyorId}_${Math.random().toString(16).slice(2)}`,
              surveyorId: surveyorId,
              shift: SHIFT.DAY,
              breakMins: 30,
              confirmed: false,
            };
            
            if (!assignments[lowDay.dateKey]) assignments[lowDay.dateKey] = [];
            assignments[lowDay.dateKey].push(newAssignment);
            lowDay.count++;
            
            // Update stats
            surveyorStats[surveyorId].shiftsAssigned++;
            surveyorStats[surveyorId].assignments.push({ dateKey: lowDay.dateKey, shift: SHIFT.DAY });
            if (isWeekend(lowDateObj)) {
              surveyorStats[surveyorId].weekendDaysAssigned++;
              surveyorStats[surveyorId].weekendDays.push(lowDay.dateKey);
            }
            
            anyChanges = true;
            
            // Update the daysNeedingMore list (remove if target reached)
            if (lowDay.count >= lowDay.target) {
              const index = daysNeedingMore.indexOf(lowDay);
              if (index >= 0) daysNeedingMore.splice(index, 1);
            }
            
            break; // Move to next high day
          }
        }
      }
      
      // If no changes made, try adding new surveyors to low days
      if (!anyChanges) {
        for (const lowDay of daysNeedingMore) {
          if (lowDay.count >= lowDay.target) continue;
          
          const dateObj = parseISO(lowDay.dateKey);
          const currentExisting = assignments[lowDay.dateKey] || [];
          
          const candidate = findBestCandidate({
            dateKey: lowDay.dateKey,
            dateObj,
            shift: SHIFT.DAY,
            surveyors: activeSurveyors,
            surveyorStats,
            canWorkWeekend,
            existing: currentExisting,
            dateKeys,
            area,
            nightShiftTracking,
            allAssignments: assignments,
            weekBalance: countUniqueSurveyorsPerWeek(assignments, dateKeys),
          });
          
          if (candidate) {
            const assignment = {
              id: `${lowDay.dateKey}_${candidate.id}_${Math.random().toString(16).slice(2)}`,
              surveyorId: candidate.id,
              shift: SHIFT.DAY,
              breakMins: 30,
              confirmed: false,
            };
            
            if (!assignments[lowDay.dateKey]) assignments[lowDay.dateKey] = [];
            assignments[lowDay.dateKey].push(assignment);
            lowDay.count++;
            
            surveyorStats[candidate.id].shiftsAssigned++;
            surveyorStats[candidate.id].assignments.push({ dateKey: lowDay.dateKey, shift: SHIFT.DAY });
            
            anyChanges = true;
            console.log(`[AUTO-POPULATE] Phase 1.5: Added ${candidate.name} to ${lowDay.dateKey}`);
          }
        }
      }
      
      if (!anyChanges) {
        console.log(`[AUTO-POPULATE] Phase 1.5: No more changes possible after ${pass} passes`);
        break;
      }
      
      // Recalculate counts
      weekdayData.forEach(d => {
        d.count = getUniqueSurveyorsPerDay(d.dateKey);
      });
    }
    
    // Log final distribution
    weekdayData.forEach(d => {
      d.count = getUniqueSurveyorsPerDay(d.dateKey);
    });
    const finalCounts = weekdayData.map(d => d.count);
    const minCount = Math.min(...finalCounts);
    const maxCount = Math.max(...finalCounts);
    const gap = maxCount - minCount;
    console.log(`[AUTO-POPULATE] Phase 1.5: Final weekday distribution - min: ${minCount}, max: ${maxCount}, gap: ${gap}`);
    console.log(`[AUTO-POPULATE] Phase 1.5: Day-by-day counts:`, weekdayData.map(d => `${d.dateKey}: ${d.count}`).join(', '));
    if (gap > 1) {
      console.warn(`[AUTO-POPULATE] Phase 1.5: Warning - gap between days is ${gap} (target: ≤1)`);
    } else {
      console.log(`[AUTO-POPULATE] Phase 1.5: ✓ Distribution balanced (gap: ${gap} ≤ 1)`);
    }
  }

  // Phase 2: Balance shifts to reach 9 per surveyor
  // This phase distributes additional shifts to ensure each surveyor gets approximately 9 shifts
  // We iterate multiple times to ensure fair distribution
  // Also balances surveyor count across weeks (7 per week for efficiency)
  
  // Filter surveyors by area preference first
  const areaPrefSummary = {
    matching: [],
    noPreference: [],
    mismatched: [],
  };
  
  activeSurveyors.forEach((s) => {
    const areaPreference = s.areaPreference;
    if (areaPreference) {
      if (areaPreference === area) {
        areaPrefSummary.matching.push(s.name);
      } else {
        areaPrefSummary.mismatched.push({ name: s.name, pref: areaPreference === "SOUTH" ? "STSP" : "NTNP" });
      }
    } else {
      areaPrefSummary.noPreference.push(s.name);
    }
  });
  
  console.log(`[AUTO-POPULATE] Area preference summary for ${areaName}:`);
  console.log(`  - Matching area preference: ${areaPrefSummary.matching.length} (${areaPrefSummary.matching.join(", ") || "none"})`);
  console.log(`  - No area preference: ${areaPrefSummary.noPreference.length} (${areaPrefSummary.noPreference.join(", ") || "none"})`);
  console.log(`  - Mismatched (will be excluded): ${areaPrefSummary.mismatched.length} (${areaPrefSummary.mismatched.map(m => `${m.name} (${m.pref})`).join(", ") || "none"})`);
  
  const eligibleSurveyors = activeSurveyors.filter((s) => {
    const areaPreference = s.areaPreference;
    if (areaPreference && areaPreference !== area) {
      const surveyorAreaName = areaPreference === "SOUTH" ? "STSP" : "NTNP";
      console.log(`[AUTO-POPULATE] Excluding ${s.name} - has area preference ${surveyorAreaName} but roster is ${areaName}`);
      return false; // Skip surveyors with area preference for different area
    }
    return true;
  });

  console.log(`[AUTO-POPULATE] Eligible surveyors after area preference filter: ${eligibleSurveyors.length} (from ${activeSurveyors.length} active)`);

  if (eligibleSurveyors.length === 0) {
    const errorMsg = `No eligible surveyors found for ${areaName} area. ${areaPrefSummary.mismatched.length} surveyors have mismatched area preferences.`;
    console.error(`[AUTO-POPULATE] ${errorMsg}`);
    issues.push(errorMsg);
    return {
      success: true,
      assignments,
      issues,
      stats: surveyorStats,
    };
  }

  // Multiple passes to balance shifts
  // First pass: Prioritize days where demand is not met
  // Second pass: Fill remaining shifts to reach 9 per surveyor
  // Also balances surveyor count across weeks (target: 7 per week)
  let maxIterations = 30; // Increased to allow more iterations for better distribution
  let iteration = 0;
  
  while (iteration < maxIterations) {
    iteration++;
    let anyChanges = false;
    
    // Check current week balance
    const currentWeekBalance = countUniqueSurveyorsPerWeek(assignments, dateKeys);
    console.log(`[AUTO-POPULATE] Phase 2 Iteration ${iteration}: Week 1 has ${currentWeekBalance.week1} unique surveyors, Week 2 has ${currentWeekBalance.week2} unique surveyors (target: 7 each)`);
    
    // Sort surveyors by current shift count (ascending) - those with fewer shifts get priority
    const sortedSurveyors = [...eligibleSurveyors].sort(
    (a, b) => surveyorStats[a.id].shiftsAssigned - surveyorStats[b.id].shiftsAssigned
  );

      // First, prioritize days where demand is not met
      // Then, fill remaining shifts to reach 9 per surveyor
      // Note: Saturday demand is MAXIMUM, so we don't prioritize it for gap filling
      const dateKeysWithDemandGaps = [];
      const dateKeysWithoutDemandGaps = [];
      
      for (const dateKey of dateKeys) {
        const dateObj = parseISO(dateKey);
        if (isSunday(dateObj)) continue;
        
        const existing = assignments[dateKey] || [];
        const dayCount = existing.filter((a) => a.shift === SHIFT.DAY).length;
        const nightCount = existing.filter((a) => a.shift === SHIFT.NIGHT).length;
        const isSaturdayDay = isSaturday(dateObj);
        
        let dayNeeded = demandSettings[dateKey]?.day;
        if (dayNeeded === undefined || dayNeeded === null) {
          if (isWeekday(dateObj)) {
            dayNeeded = demandTemplate?.monFriDay || (area === "SOUTH" ? 6 : 3);
          } else if (isSaturdayDay) {
            dayNeeded = demandTemplate?.satDay || (area === "SOUTH" ? 3 : 1);
          } else {
            dayNeeded = 0;
          }
        }
        
        let nightNeeded = demandSettings[dateKey]?.night;
        if (nightNeeded === undefined || nightNeeded === null) {
          if (isWeekday(dateObj)) {
            nightNeeded = demandTemplate?.night !== undefined ? demandTemplate.night : (area === "SOUTH" ? 1 : 0);
          } else {
            nightNeeded = 0;
          }
        }
        
        // For Saturday: demand is MAXIMUM, so we check if it's exceeded (not if it's unmet)
        // For Weekday: demand is MINIMUM, so we check if it's unmet
        if (isSaturdayDay) {
          // Saturday: Only add to gaps if below maximum (can still assign)
          if (dayCount < dayNeeded && nightCount >= nightNeeded) {
            dateKeysWithDemandGaps.push(dateKey);
          } else {
            dateKeysWithoutDemandGaps.push(dateKey);
          }
        } else {
          // Weekday: Check if minimum demand is met
          const demandMet = dayCount >= dayNeeded && nightCount >= nightNeeded;
          if (!demandMet) {
            dateKeysWithDemandGaps.push(dateKey);
          } else {
            dateKeysWithoutDemandGaps.push(dateKey);
          }
        }
      }
    
    // Process dates with demand gaps first, then dates without gaps
    const prioritizedDateKeys = [...dateKeysWithDemandGaps, ...dateKeysWithoutDemandGaps];
    
    // Check week balance before assigning
    const weekBalance = countUniqueSurveyorsPerWeek(assignments, dateKeys);
    const targetSurveyorsPerWeek = 7; // Target: 7 surveyors per week
    const week1NeedsMore = weekBalance.week1 < targetSurveyorsPerWeek;
    const week2NeedsMore = weekBalance.week2 < targetSurveyorsPerWeek;
    
    // Helper to determine which week a date belongs to
    const getWeekForDate = (dateKey) => {
      const index = dateKeys.indexOf(dateKey);
      return index < 7 ? 1 : 2;
    };
    
    // Helper to get day count
    const getDayCount = (dateKey) => {
      return (assignments[dateKey] || []).filter(a => a.shift === SHIFT.DAY).length;
    };

  for (const surveyor of sortedSurveyors) {
    const stats = surveyorStats[surveyor.id];
    let needed = targetShiftsPerSurveyor - stats.shiftsAssigned;

      if (needed <= 0) continue; // Already has enough shifts
      
      // Reorder dates to prioritize:
      // 1. Daily Balance (fill lowest count days first) - CRITICAL for equal distribution
      // 2. Week Balance (if daily counts are equal)
      
      const surveyorInWeek1 = weekBalance.week1Surveyors.has(surveyor.id);
      const surveyorInWeek2 = weekBalance.week2Surveyors.has(surveyor.id);
      
      // Reorder prioritized dates
      const reorderedDateKeys = [...prioritizedDateKeys].sort((a, b) => {
        // Primary sort: Daily Count (Ascending)
        // We want to add to days with fewer people first
        const countA = getDayCount(a);
        const countB = getDayCount(b);
        if (countA !== countB) {
          return countA - countB;
        }
        
        // Secondary sort: Week Balance
        const weekA = getWeekForDate(a);
        const weekB = getWeekForDate(b);
        
        // If surveyor is already in a week, prioritize that week for additional shifts
        if (surveyorInWeek1 && weekA === 1 && !surveyorInWeek2) return -1;
        if (surveyorInWeek2 && weekB === 2 && !surveyorInWeek1) return -1;
        if (surveyorInWeek1 && weekB === 1 && !surveyorInWeek2) return 1;
        if (surveyorInWeek2 && weekA === 2 && !surveyorInWeek1) return 1;
        
        // If surveyor is not in either week, prioritize the week that needs more surveyors
        if (!surveyorInWeek1 && !surveyorInWeek2) {
          if (weekA === 1 && week1NeedsMore && weekB === 2 && !week2NeedsMore) return -1;
          if (weekA === 2 && week2NeedsMore && weekB === 1 && !week1NeedsMore) return -1;
          if (weekA === 1 && !week1NeedsMore && weekB === 2 && week2NeedsMore) return 1;
          if (weekA === 2 && !week2NeedsMore && weekB === 1 && week1NeedsMore) return 1;
        }
        
        return 0; // Keep original order if no preference
      });

      // Try dates with demand gaps first, then other dates (reordered for balance)
    for (const dateKey of reorderedDateKeys) {
        if (needed <= 0) break;

        const dateObj = parseISO(dateKey);
        const existing = assignments[dateKey] || [];
        const alreadyAssigned = existing.some((a) => a.surveyorId === surveyor.id);

      if (alreadyAssigned) continue; // Already assigned this day
      
      // Week balancing check: prioritize assigning surveyors to weeks that need more
      const dateWeek = getWeekForDate(dateKey);
      
      // If surveyor is not in either week yet, prioritize the week that needs more surveyors
      if (!surveyorInWeek1 && !surveyorInWeek2) {
        // If one week needs more surveyors and the other doesn't, prioritize the one that needs more
        if (dateWeek === 1 && !week1NeedsMore && week2NeedsMore) {
          // Week 1 doesn't need more, but week 2 does - skip this date if it's week 1
          continue;
        }
        if (dateWeek === 2 && !week2NeedsMore && week1NeedsMore) {
          // Week 2 doesn't need more, but week 1 does - skip this date if it's week 2
          continue;
        }
      }
      
      // If surveyor is already in one week, prefer assigning additional shifts in that week
      // (but don't block assignments in the other week if needed for shift count)
      if (surveyorInWeek1 && dateWeek === 2 && week1NeedsMore && !week2NeedsMore) {
        // Surveyor is in week 1, week 1 needs more, week 2 doesn't - prefer week 1
        continue;
      }
      if (surveyorInWeek2 && dateWeek === 1 && week2NeedsMore && !week1NeedsMore) {
        // Surveyor is in week 2, week 2 needs more, week 1 doesn't - prefer week 2
        continue;
      }

        // Check non-availability
        const nonAvailability = surveyor.nonAvailability || [];
        if (nonAvailability.includes(dateKey)) {
          continue; // Surveyor is not available on this date
        }

      // Check 3-day off rule after night shift (CRITICAL: must check before assigning)
      // This applies to ALL surveyors who worked a night shift
      let lastNightShiftDate = null;
      if (nightShiftTracking[surveyor.id]) {
        const tracking = nightShiftTracking[surveyor.id];
        if (tracking.requiredDaysOff && tracking.requiredDaysOff.includes(dateKey)) {
          continue; // Still in 3-day off period
        }
        lastNightShiftDate = tracking.lastNightShiftDate;
      }
      
      // Check previous rosters for night shifts
      if (lastNightShiftDates[surveyor.id]) {
        const prevRosterNightDate = lastNightShiftDates[surveyor.id];
        if (!lastNightShiftDate || prevRosterNightDate > lastNightShiftDate) {
          lastNightShiftDate = prevRosterNightDate;
        }
      }
      
      // Check current roster for night shifts on earlier dates
      const currentDateIndex = dateKeys.indexOf(dateKey);
      if (currentDateIndex > 0) {
        for (let i = 0; i < currentDateIndex; i++) {
          const prevDateKey = dateKeys[i];
          const prevDateAssignments = assignments[prevDateKey] || [];
          const hasNightShiftOnPrevDate = prevDateAssignments.some(
            a => a.surveyorId === surveyor.id && a.shift === SHIFT.NIGHT
          );
          if (hasNightShiftOnPrevDate) {
            if (!lastNightShiftDate || prevDateKey > lastNightShiftDate) {
              lastNightShiftDate = prevDateKey;
            }
          }
        }
      }
      
      // Apply 3-day off rule
      if (lastNightShiftDate) {
        const lastNightDate = parseISO(lastNightShiftDate);
        const daysSinceLastNight = differenceInCalendarDays(dateObj, lastNightDate);
        if (daysSinceLastNight > 0 && daysSinceLastNight <= 3) {
          console.log(`[AUTO-POPULATE] Phase 2: Skipping ${surveyor.name} on ${dateKey} - only ${daysSinceLastNight} days since last night shift on ${lastNightShiftDate}, need 3 days off`);
          continue; // Still in 3-day off period
        }
      }

      // Skip Sundays (no coverage)
      if (isSunday(dateObj)) {
        continue;
      }

      // Check weekend constraints
        if (isWeekend(dateObj)) {
          if (!canWorkWeekend[surveyor.id] || stats.weekendDaysAssigned >= 1) {
          continue; // Can't work weekend or already worked one
          }
        }

      // Check Saturday constraints
      if (isSaturday(dateObj)) {
        const sats = stats.saturdaysWorked || [];
        const currentIndex = dateKeys.indexOf(dateKey);
        
        // Check consecutive Saturday rule
        if (currentIndex >= 7) {
          const prevSaturdayKey = dateKeys[currentIndex - 7];
          if (sats.includes(prevSaturdayKey)) {
            continue; // Can't work consecutive Saturdays
          }
        }
        
        // Check 3-Saturday window rule
        let prevSat1Worked = false;
        let prevSat2Worked = false;
        if (currentIndex >= 7) {
          const prevSat1Key = dateKeys[currentIndex - 7];
          if (sats.includes(prevSat1Key)) prevSat1Worked = true;
        }
        if (currentIndex >= 14) {
          const prevSat2Key = dateKeys[currentIndex - 14];
          if (sats.includes(prevSat2Key)) prevSat2Worked = true;
        }
        if (prevSat1Worked || prevSat2Worked) {
          continue; // Can't work more than 1 in any 3-Saturday window
        }
      }

      // Check if we can add a day shift
      // Saturday demand is treated as MAXIMUM (not minimum)
      // Weekday demand is treated as MINIMUM - we can exceed it to ensure 9 shifts per surveyor
      const dayCount = existing.filter((a) => a.shift === SHIFT.DAY).length;
      const isSaturdayDay = isSaturday(dateObj);
        
      // Get demand from settings or use template/area-specific defaults
      let dayNeeded = demandSettings[dateKey]?.day;
      if (dayNeeded === undefined || dayNeeded === null) {
        // Use template if available, otherwise area-specific defaults
        if (isWeekday(dateObj)) {
          dayNeeded = demandTemplate?.monFriDay || (area === "SOUTH" ? 6 : 3);
        } else if (isSaturdayDay) {
          dayNeeded = demandTemplate?.satDay || (area === "SOUTH" ? 3 : 1);
        } else {
          dayNeeded = 0; // Sunday
        }
      }
        const nightCount = existing.filter((a) => a.shift === SHIFT.NIGHT).length;
        let nightNeeded = demandSettings[dateKey]?.night;
        if (nightNeeded === undefined || nightNeeded === null) {
          // Use template if available, otherwise area-specific defaults
        if (isWeekday(dateObj)) {
            nightNeeded = demandTemplate?.night !== undefined ? demandTemplate.night : (area === "SOUTH" ? 1 : 0);
          } else {
            nightNeeded = 0; // Saturday and Sunday
          }
        }

        // For Saturday: demand is MAXIMUM - don't exceed it
        // For Weekday: demand is MINIMUM - can exceed to reach 9 shifts
        let canAssignDay = false;
        if (isSaturdayDay) {
          // Saturday: Only assign if below maximum demand
          canAssignDay = dayCount < dayNeeded && nightCount >= nightNeeded;
        } else {
          // Weekday: Priority is to meet demand, but can exceed to reach 9 shifts
          const demandMet = dayCount >= dayNeeded && nightCount >= nightNeeded;
          canAssignDay = !demandMet || (demandMet && needed > 0);
        }
        
        // Allow assignment if conditions are met
        if (canAssignDay) {
          console.log(`[AUTO-POPULATE] Phase 2: Adding day shift on ${dateKey} (${dayCount}/${dayNeeded} day shifts, ${nightCount}/${nightNeeded} night shifts, surveyor needs ${needed} more)`);
            // Add a day shift
            const assignment = {
              id: `${dateKey}_${surveyor.id}_${Math.random().toString(16).slice(2)}`,
              surveyorId: surveyor.id,
              shift: SHIFT.DAY,
              breakMins: 30,
              confirmed: false,
            };

            if (!assignments[dateKey]) assignments[dateKey] = [];
            assignments[dateKey].push(assignment);

          // Update stats
            stats.shiftsAssigned++;
            stats.assignments.push({ dateKey, shift: SHIFT.DAY });
          if (isWeekend(dateObj)) {
            stats.weekendDaysAssigned++;
            stats.weekendDays.push(dateKey);
          }
          if (isSaturday(dateObj)) {
            stats.saturdaysWorked.push(dateKey);
          }
          
            needed--;
          anyChanges = true;
          }
        }
      }
    
    // If no changes were made in this iteration, break
    if (!anyChanges) break;
  }

  // Final deduplication pass: Remove any duplicate assignments
  // This ensures no duplicate assignments exist even if logic above missed something
  const deduplicatedAssignments = {};
  const seenKeys = new Set();
  
  for (const [dateKey, dateAssignments] of Object.entries(assignments)) {
    const uniqueAssignments = [];
    for (const assignment of dateAssignments) {
      // Create a unique key: dateKey + surveyorId + shift (one person can only have one shift per day)
      const uniqueKey = `${dateKey}_${assignment.surveyorId}_${assignment.shift}`;
      if (!seenKeys.has(uniqueKey)) {
        seenKeys.add(uniqueKey);
        uniqueAssignments.push(assignment);
      } else {
        console.warn(`[AUTO-POPULATE] Removing duplicate assignment: ${uniqueKey}`);
        issues.push(`Duplicate assignment removed: ${assignment.surveyorId} on ${dateKey} for ${assignment.shift} shift`);
      }
    }
    if (uniqueAssignments.length > 0) {
      deduplicatedAssignments[dateKey] = uniqueAssignments;
    }
  }
  
  console.log(`[AUTO-POPULATE] Final deduplication: ${Object.keys(assignments).length} days with assignments, ${Object.keys(deduplicatedAssignments).length} days after deduplication`);

  return {
    success: true,
    assignments: deduplicatedAssignments,
    issues,
    stats: surveyorStats,
  };
}

/**
 * Find the best candidate surveyor for an assignment
 */
function findBestCandidate({
  dateKey,
  dateObj,
  shift,
  surveyors,
  surveyorStats,
  canWorkWeekend,
  existing,
  dateKeys, // Need all date keys to check Saturday rules
  area = "SOUTH", // Area for area preference matching
  nightShiftTracking = {}, // Track night shift rotations for 3-day off rule
  allAssignments = {}, // All assignments in current roster to check for night shifts on earlier dates
  lastNightShiftDates = {}, // Last night shift dates from previous rosters for all surveyors
  weekBalance = null, // Week balance info for balancing surveyors across weeks
  targetWeek = null, // Target week (1 or 2) that needs more surveyors
}) {
  // Filter available surveyors
  const available = surveyors.filter((s) => {
    const stats = surveyorStats[s.id];
    
    // Can't assign if already assigned this day (any shift - DAY or NIGHT)
    // CRITICAL: Check for any assignment to prevent double-assignment
    const alreadyAssigned = existing.some((a) => a.surveyorId === s.id);
    if (alreadyAssigned) {
      console.log(`[AUTO-POPULATE] findBestCandidate: Excluding ${s.name} - already assigned on ${dateKey}`);
      return false;
    }
    
    // Additional check: Can't assign night shift if already has a night shift on this day
    if (shift === SHIFT.NIGHT) {
      const alreadyHasNightShift = existing.some((a) => a.surveyorId === s.id && a.shift === SHIFT.NIGHT);
      if (alreadyHasNightShift) {
        console.log(`[AUTO-POPULATE] findBestCandidate: Excluding ${s.name} - already has night shift on ${dateKey}`);
        return false;
      }
    }

    // Enforce area preference: if surveyor has area preference, they can only be assigned to that area
    // s.areaPreference is in app format: "SOUTH" (from DB "STSP") or "NORTH" (from DB "NTNP")
    // area parameter is roster area in app format: "SOUTH" (for STSP) or "NORTH" (for NTNP)
    const areaPreference = s.areaPreference;
    
    if (areaPreference && areaPreference !== area) {
      const surveyorAreaName = areaPreference === "SOUTH" ? "STSP" : "NTNP";
      const rosterAreaName = area === "SOUTH" ? "STSP" : "NTNP";
      console.log(`[AUTO-POPULATE] findBestCandidate: ❌ Excluding ${s.name} - areaPreference="${areaPreference}" (${surveyorAreaName}) doesn't match roster area="${area}" (${rosterAreaName})`);
      return false; // Surveyor has area preference for different area, exclude from auto-populate
    } else if (areaPreference) {
      const surveyorAreaName = areaPreference === "SOUTH" ? "STSP" : "NTNP";
      const rosterAreaName = area === "SOUTH" ? "STSP" : "NTNP";
      console.log(`[AUTO-POPULATE] findBestCandidate: ✅ ${s.name} areaPreference="${areaPreference}" (${surveyorAreaName}) matches roster area="${area}" (${rosterAreaName})`);
    }

    // Week balancing: if weekBalance is provided, prioritize surveyors for the target week
    if (weekBalance && targetWeek && shift === SHIFT.DAY) {
      const dateWeek = dateKeys.indexOf(dateKey) < 7 ? 1 : 2;
      const surveyorInWeek1 = weekBalance.week1Surveyors.has(s.id);
      const surveyorInWeek2 = weekBalance.week2Surveyors.has(s.id);
      const targetWeekNeedsMore = targetWeek === 1 ? weekBalance.week1 < 7 : weekBalance.week2 < 7;
      const otherWeekNeedsMore = targetWeek === 1 ? weekBalance.week2 < 7 : weekBalance.week1 < 7;
      
      // If this date is in the target week and target week needs more surveyors
      if (dateWeek === targetWeek && targetWeekNeedsMore) {
        // Prefer surveyors not already in the other week
        if (targetWeek === 1 && surveyorInWeek2 && !surveyorInWeek1) {
          // Surveyor is in week 2, but we need week 1 - allow but lower priority
          // (will be handled in sorting)
        } else if (targetWeek === 2 && surveyorInWeek1 && !surveyorInWeek2) {
          // Surveyor is in week 1, but we need week 2 - allow but lower priority
        }
      } else if (dateWeek !== targetWeek && targetWeekNeedsMore && !otherWeekNeedsMore) {
        // This date is NOT in the target week, target week needs more, other week doesn't
        // Skip surveyors who are already in the other week (to avoid adding more to the wrong week)
        if (targetWeek === 1 && surveyorInWeek2 && !surveyorInWeek1) {
          // We need week 1, but this is week 2, and surveyor is already in week 2
          // Skip to avoid adding more to week 2
          return false;
        } else if (targetWeek === 2 && surveyorInWeek1 && !surveyorInWeek2) {
          // We need week 2, but this is week 1, and surveyor is already in week 1
          // Skip to avoid adding more to week 1
          return false;
        }
      }
    }

    // Check non-availability
    const nonAvailability = s.nonAvailability || [];
    if (nonAvailability.includes(dateKey)) {
      return false; // Surveyor is not available on this date
    }

    // Check 3-day off rule after night shift
    // This applies to BOTH day and night shifts - if ANY surveyor just worked a night shift,
    // they need 3 days off before they can work again (day or night)
    // This check applies to ALL surveyors, not just those in nightShiftTracking
    
    // First, check if there's tracking info (for dedicated night shift workers)
    let lastNightShiftDate = null;
    if (nightShiftTracking[s.id]) {
      const tracking = nightShiftTracking[s.id];
      // Check if this date is in the required days off period
      if (tracking.requiredDaysOff && tracking.requiredDaysOff.includes(dateKey)) {
        console.log(`[AUTO-POPULATE] findBestCandidate: Excluding ${s.name} - date ${dateKey} is in required days off period (3-day off after night shift)`);
        return false; // Still in 3-day off period
      }
      lastNightShiftDate = tracking.lastNightShiftDate;
    }
    
    // Check previous rosters for night shifts by this surveyor (for ALL surveyors, not just in tracking)
    if (lastNightShiftDates[s.id]) {
      const prevRosterNightDate = lastNightShiftDates[s.id];
      // Use the more recent date (from tracking or previous rosters)
      if (!lastNightShiftDate || prevRosterNightDate > lastNightShiftDate) {
        lastNightShiftDate = prevRosterNightDate;
      }
    }
    
    // Also check if there are any night shifts assigned earlier in the current roster generation
    // This handles the case where a night shift was assigned earlier in the same roster generation
    // This check applies to ALL surveyors, not just those in nightShiftTracking
    if (allAssignments && dateKeys && dateKeys.length > 0) {
      const currentDateIndex = dateKeys.indexOf(dateKey);
      if (currentDateIndex > 0) {
        // Check all previous dates in the current roster for night shifts by this surveyor
        for (let i = 0; i < currentDateIndex; i++) {
          const prevDateKey = dateKeys[i];
          const prevDateAssignments = allAssignments[prevDateKey] || [];
          const hasNightShiftOnPrevDate = prevDateAssignments.some(
            a => a.surveyorId === s.id && a.shift === SHIFT.NIGHT
          );
          if (hasNightShiftOnPrevDate) {
            // Found a night shift on an earlier date, use that date if it's more recent
            if (!lastNightShiftDate || prevDateKey > lastNightShiftDate) {
              lastNightShiftDate = prevDateKey;
            }
          }
        }
      }
    }
    
    // Apply the 3-day off rule if we found a night shift
    if (lastNightShiftDate) {
      const lastNightDate = parseISO(lastNightShiftDate);
      const daysSinceLastNight = differenceInCalendarDays(dateObj, lastNightDate);
      
      // After working a night shift, they need 3 days off before working again
      // This applies regardless of whether they completed a full rotation
      // If they worked on Jan 2nd, they need Jan 3rd, 4th, and 5th off (3 days)
      // So exclude if daysSinceLastNight is 1, 2, or 3 (inclusive)
      if (daysSinceLastNight > 0 && daysSinceLastNight <= 3) {
        console.log(`[AUTO-POPULATE] findBestCandidate: Excluding ${s.name} - only ${daysSinceLastNight} days since last night shift on ${lastNightShiftDate}, need 3 days off (checking for ${dateKey})`);
        return false; // Still in 3-day off period
      }
    }

    // Weekend constraints
    if (isWeekend(dateObj)) {
      if (!canWorkWeekend[s.id]) return false;
      if (stats.weekendDaysAssigned >= 1) return false;
    }

    // Saturday constraints
    if (isSaturday(dateObj)) {
      const sats = stats.saturdaysWorked || [];
      const currentIndex = dateKeys.indexOf(dateKey);
      
      // Rule: Cannot work consecutive Saturdays
      // Check if they worked the previous Saturday (7 days ago)
      if (currentIndex >= 7) {
        const prevSaturdayKey = dateKeys[currentIndex - 7];
        if (sats.includes(prevSaturdayKey)) {
          return false; // Can't work consecutive Saturdays
        }
      }
      
      // Rule: Can work once in every 3 Saturdays
      // In any 3 consecutive Saturdays, max 1 can be worked
      // Check the previous 2 Saturdays (if they exist in the window)
      let prevSat1Worked = false;
      let prevSat2Worked = false;
      
      // Check Saturday 1 week ago
      if (currentIndex >= 7) {
        const prevSat1Key = dateKeys[currentIndex - 7];
        if (sats.includes(prevSat1Key)) {
          prevSat1Worked = true;
        }
      }
      
      // Check Saturday 2 weeks ago
      if (currentIndex >= 14) {
        const prevSat2Key = dateKeys[currentIndex - 14];
        if (sats.includes(prevSat2Key)) {
          prevSat2Worked = true;
        }
      }
      
      // If they worked either of the previous 2 Saturdays, they can't work this one
      // (to ensure max 1 in any 3-Saturday window)
      if (prevSat1Worked || prevSat2Worked) {
        return false;
      }
    }

    // Can't exceed 9 shifts
    if (stats.shiftsAssigned >= 9) return false;

    return true;
  });

  if (available.length === 0) return null;

  // Score candidates (lower is better)
  const scored = available.map((s) => {
    const stats = surveyorStats[s.id];
    let score = stats.shiftsAssigned * 10; // Strong preference for surveyors with fewer shifts

    // Prefer surveyors with matching shift preference
    const shiftPreference = s.shiftPreference;
    if (shiftPreference) {
      if (shiftPreference === shift) {
        score -= 20; // Big bonus for matching preference
      } else {
        score += 10; // Penalty for non-matching preference
      }
    }

    // Area preference matching (for scoring - note: non-matching preferences are already filtered out above)
    const areaPreference = s.areaPreference;
    if (areaPreference && areaPreference === area) {
        score -= 15; // Big bonus for matching area preference
      }
    // Note: Surveyors with non-matching area preferences are already excluded in the filter above

    // Prefer surveyors who haven't worked weekends if this is a weekend
    if (isWeekend(dateObj) && stats.weekendDaysAssigned === 0) {
      score -= 10; // Big bonus
    }

    // Strong penalty for surveyors who worked recent days (spread out assignments)
    const recentDays = stats.assignments
      .filter((a) => {
        const aDate = parseISO(a.dateKey);
        const diff = differenceInCalendarDays(dateObj, aDate);
        return diff >= 0 && diff <= 2; // Within last 2 days
      })
      .length;
    score += recentDays * 15; // Strong penalty for working recent days (encourages distribution)

    // Penalty for working consecutive days
    const yesterdayKey = format(addDays(dateObj, -1), "yyyy-MM-dd");
    const workedYesterday = stats.assignments.some(a => a.dateKey === yesterdayKey);
    if (workedYesterday) {
      score += 10; // Penalty for consecutive days
    }

    // Prefer weekdays for balancing
    if (isWeekday(dateObj)) {
      score -= 5;
    }
    
    // Week balancing: prioritize surveyors for the target week
    if (weekBalance && targetWeek && shift === SHIFT.DAY) {
      const dateWeek = dateKeys.indexOf(dateKey) < 7 ? 1 : 2;
      const surveyorInWeek1 = weekBalance.week1Surveyors.has(s.id);
      const surveyorInWeek2 = weekBalance.week2Surveyors.has(s.id);
      const targetWeekNeedsMore = targetWeek === 1 ? weekBalance.week1 < 7 : weekBalance.week2 < 7;
      
      // If this date is in the target week and target week needs more surveyors
      if (dateWeek === targetWeek && targetWeekNeedsMore) {
        // Prefer surveyors not already in the other week
        if (targetWeek === 1 && !surveyorInWeek2 && !surveyorInWeek1) {
          score -= 30; // Big bonus for new surveyor in week 1
        } else if (targetWeek === 2 && !surveyorInWeek1 && !surveyorInWeek2) {
          score -= 30; // Big bonus for new surveyor in week 2
        } else if (targetWeek === 1 && surveyorInWeek1) {
          score -= 10; // Bonus for existing week 1 surveyor
        } else if (targetWeek === 2 && surveyorInWeek2) {
          score -= 10; // Bonus for existing week 2 surveyor
        }
      } else if (dateWeek !== targetWeek && targetWeekNeedsMore) {
        // This date is NOT in the target week, but target week needs more
        // Penalize surveyors who are already in the wrong week
        if (targetWeek === 1 && surveyorInWeek2 && !surveyorInWeek1) {
          score += 50; // Big penalty - don't add more to week 2 if week 1 needs more
        } else if (targetWeek === 2 && surveyorInWeek1 && !surveyorInWeek2) {
          score += 50; // Big penalty - don't add more to week 1 if week 2 needs more
        }
      }
    }

    return { surveyor: s, score };
  });

  // Sort by score and return best candidate
  scored.sort((a, b) => a.score - b.score);
  return scored[0]?.surveyor || null;
}


