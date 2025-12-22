/**
 * Auto-populate roster algorithm
 * 
 * This module automatically assigns surveyors to meet demand while respecting
 * all business rules (9 shifts per fortnight, weekend rotation, etc.)
 */

import { format, startOfWeek, addDays, parseISO, differenceInCalendarDays } from "date-fns";
import { SHIFT, isWeekend, isSaturday, isSunday, isWeekday } from "./rules";
import { loadDemand } from "./storage-hybrid";

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
            day: demandTemplate.monFriDay || (area === "SOUTH" ? 5 : 3),
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

  // Night shift rotation for STSP area
  // 3 staff rotating every 2 weeks: Ethan, Barry, Changyi
  const NIGHT_ROTATION_STAFF_NAMES = ["Ethan", "Barry", "Changyi"];
  const nightRotationStaff = activeSurveyors.filter((s) =>
    NIGHT_ROTATION_STAFF_NAMES.some((name) => s.name.toLowerCase().includes(name.toLowerCase()))
  );

  // Track night shift assignments for rotation
  const nightShiftTracking = {};
  nightRotationStaff.forEach((s) => {
    nightShiftTracking[s.id] = {
      consecutiveNightWeeks: 0,
      lastNightShiftDate: null,
      nightShiftsInCurrentRotation: [],
      requiredDaysOff: [], // Track days that need to be off after 2-week rotation
    };
  });

  // Calculate which staff member should be on night rotation for STSP
  // Rotation cycles every 2 weeks (14 days), starting from the anchor date
  const getNightRotationIndex = (dateObj, startDate) => {
    const daysSinceStart = differenceInCalendarDays(dateObj, startDate);
    const weekIndex = Math.floor(daysSinceStart / 14); // Which 2-week cycle
    return weekIndex % 3; // Rotate between 3 staff
  };

  // Phase 1: Fill demand for each day
  const issues = [];
  const targetShiftsPerSurveyor = 9;

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
          dayNeeded = demandTemplate.monFriDay || (area === "SOUTH" ? 5 : 3);
          nightNeeded = demandTemplate.night !== undefined ? demandTemplate.night : (area === "SOUTH" ? 1 : 0);
        } else {
          // No template, use area-specific defaults
          dayNeeded = area === "SOUTH" ? 5 : 3;
          nightNeeded = area === "SOUTH" ? 1 : 0;
        }
      } else if (isSaturday(dateObj)) {
        if (demandTemplate) {
          dayNeeded = demandTemplate.satDay || (area === "SOUTH" ? 3 : 1);
          nightNeeded = 0;
        } else {
          // No template, use area-specific defaults
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

    const dayRemaining = Math.max(0, dayNeeded - dayAssigned);
    let nightRemaining = Math.max(0, nightNeeded - nightAssigned);

    // Assign day shifts
    for (let i = 0; i < dayRemaining; i++) {
      // Update existing to include previously assigned shifts in this loop
      const currentExisting = assignments[dateKey] || [];
      
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

    // Assign night shifts
    // Special handling for STSP area: night rotation for Mon-Sat
    if (area === "SOUTH" && nightNeeded > 0 && (isWeekday(dateObj) || isSaturday(dateObj))) {
      // For STSP, use rotation for night shifts on Mon-Sat
      const rotationIndex = getNightRotationIndex(dateObj, startDate);
      const rotationStaff = nightRotationStaff[rotationIndex];
      
      if (rotationStaff) {
        // Check if this staff member is available (not in non-availability)
        const nonAvailability = rotationStaff.nonAvailability || [];
        const isAvailable = !nonAvailability.includes(dateKey);
        
        // Check if they need 3 days off after previous night rotation
        const tracking = nightShiftTracking[rotationStaff.id];
        let canAssign = isAvailable;
        
        // Check if this date is in the required days off period
        if (tracking.requiredDaysOff && tracking.requiredDaysOff.includes(dateKey)) {
          canAssign = false;
        }
        
        if (tracking.lastNightShiftDate) {
          const lastNightDate = parseISO(tracking.lastNightShiftDate);
          const daysSinceLastNight = differenceInCalendarDays(dateObj, lastNightDate);
          
          // If they completed a 2-week rotation, they need 3 days off
          if (tracking.consecutiveNightWeeks >= 2 && daysSinceLastNight < 3) {
            canAssign = false;
          }
        }
        
        // Check if they're already assigned this day (including day shifts just assigned)
        const alreadyAssigned = updatedExisting.some((a) => a.surveyorId === rotationStaff.id);
        
        // Also check if they already have a night shift assigned (prevent duplicates)
        const alreadyHasNightShift = updatedExisting.some((a) => a.surveyorId === rotationStaff.id && a.shift === SHIFT.NIGHT);
        
        if (canAssign && !alreadyAssigned && !alreadyHasNightShift && nightNeeded > 0) {
          const assignment = {
            id: `${dateKey}_${rotationStaff.id}_${Math.random().toString(16).slice(2)}`,
            surveyorId: rotationStaff.id,
            shift: SHIFT.NIGHT,
            breakMins: 30,
            confirmed: false,
          };

          if (!assignments[dateKey]) assignments[dateKey] = [];
          assignments[dateKey].push(assignment);

          // Update the existing array to include this assignment for subsequent checks
          updatedExisting.push(assignment);

          // Update stats
          surveyorStats[rotationStaff.id].shiftsAssigned++;
          surveyorStats[rotationStaff.id].assignments.push({ dateKey, shift: SHIFT.NIGHT });
          if (isWeekend(dateObj)) {
            surveyorStats[rotationStaff.id].weekendDaysAssigned++;
            surveyorStats[rotationStaff.id].weekendDays.push(dateKey);
          }
          if (isSaturday(dateObj)) {
            surveyorStats[rotationStaff.id].saturdaysWorked.push(dateKey);
          }

          // Update night shift count
          nightAssigned++;
          // CRITICAL: Decrement nightNeeded to prevent additional assignments
          // For STSP, if demand is 1, rotation assignment should satisfy it completely
          const originalNightNeeded = nightNeeded;
          nightNeeded = Math.max(0, nightNeeded - 1); // Decrement by 1
          nightRemaining = Math.max(0, nightNeeded - nightAssigned);
          
          console.log(`[AUTO-POPULATE] Assigned night shift via rotation: ${rotationStaff.name} on ${dateKey}. Original nightNeeded=${originalNightNeeded}, Updated nightNeeded=${nightNeeded}, nightAssigned=${nightAssigned}, nightRemaining=${nightRemaining}`);

          // Update night shift tracking
          tracking.lastNightShiftDate = dateKey;
          tracking.nightShiftsInCurrentRotation.push(dateKey);
          
          // Calculate how many weeks they've been on nights in this rotation
          if (tracking.nightShiftsInCurrentRotation.length > 0) {
            const firstNightDate = parseISO(tracking.nightShiftsInCurrentRotation[0]);
            const weeksOnNights = Math.floor(differenceInCalendarDays(dateObj, firstNightDate) / 7);
            tracking.consecutiveNightWeeks = Math.min(weeksOnNights, 2);
            
            // If they've completed 2 weeks (14 days), mark next 3 days as off
            if (tracking.consecutiveNightWeeks >= 2) {
              // Check if this is the last day of their 2-week rotation (Saturday)
              if (isSaturday(dateObj)) {
                // Mark next 3 days (Sun, Mon, Tue) as unavailable
                // Note: We track this in the tracking object instead of modifying the surveyor directly
                // The non-availability check will use both the surveyor's nonAvailability and tracking
                for (let d = 1; d <= 3; d++) {
                  const offDate = addDays(dateObj, d);
                  const offDateKey = format(offDate, "yyyy-MM-dd");
                  // Store in tracking for 3-day off period
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
              }
            }
          }
        }
      }
    }

    // Assign remaining night shifts (for non-STSP or if rotation didn't cover all demand)
    // IMPORTANT: Only assign night shifts if nightNeeded > 0 (respect demand)
    // CRITICAL: Get the latest assignments array AFTER rotation assignment
    // Re-fetch to ensure we have the latest state after rotation assignment
    const latestAssignments = assignments[dateKey] || [];
    const currentNightAssigned = latestAssignments.filter((a) => a.shift === SHIFT.NIGHT).length;
    
    // For STSP, identify which rotation staff was assigned (if any) to exclude them from remaining assignments
    let rotationStaffAssignedId = null;
    if (area === "SOUTH" && currentNightAssigned >= 1) {
      // Find which rotation staff was assigned
      const rotationAssignment = latestAssignments.find((a) => 
        a.shift === SHIFT.NIGHT && 
        nightRotationStaff.some((rs) => rs.id === a.surveyorId)
      );
      if (rotationAssignment) {
        rotationStaffAssignedId = rotationAssignment.surveyorId;
        console.log(`[AUTO-POPULATE] Rotation staff assigned on ${dateKey}: ${nightRotationStaff.find(rs => rs.id === rotationStaffAssignedId)?.name || rotationStaffAssignedId}`);
      }
    }
    
    // For STSP, if rotation already assigned someone and demand is 1, we're done
    // For other cases, calculate remaining
    const currentNightRemaining = Math.max(0, nightNeeded - currentNightAssigned);
    
    console.log(`[AUTO-POPULATE] After rotation check for ${dateKey}: nightNeeded=${nightNeeded}, currentNightAssigned=${currentNightAssigned}, currentNightRemaining=${currentNightRemaining}, rotationStaffAssignedId=${rotationStaffAssignedId}`);
    
    // Only assign remaining night shifts if there's still a need
    // CRITICAL: For STSP, if rotation already assigned someone, NEVER assign more (rotation handles all night shifts)
    // This prevents duplicate night shift assignments for rotation staff
    if (area === "SOUTH" && currentNightAssigned >= 1) {
      console.log(`[AUTO-POPULATE] STSP rotation already assigned night shift for ${dateKey} (${currentNightAssigned} assigned, demand was ${nightNeeded}), skipping remaining assignment to prevent duplicates`);
    } else if (area === "SOUTH" && nightNeeded <= 0) {
      // For STSP, if nightNeeded was decremented to 0 by rotation, don't assign more
      console.log(`[AUTO-POPULATE] STSP night demand already satisfied for ${dateKey} (nightNeeded=${nightNeeded}), skipping remaining assignment`);
    } else if (nightNeeded > 0 && currentNightRemaining > 0) {
      // Recalculate latestExisting to include any rotation assignments made above
      // CRITICAL: Create a fresh reference to the current assignments array
      const latestExisting = [...(assignments[dateKey] || [])];
      
      for (let i = 0; i < currentNightRemaining; i++) {
          // Re-check current night assignments before each iteration to prevent duplicates
          // CRITICAL: Re-fetch from assignments object to get latest state
          const currentAssignmentsForDay = assignments[dateKey] || [];
          const currentNightCount = currentAssignmentsForDay.filter((a) => a.shift === SHIFT.NIGHT).length;
          if (currentNightCount >= nightNeeded) {
            console.log(`[AUTO-POPULATE] Night demand already met for ${dateKey} (${currentNightCount} >= ${nightNeeded}), stopping assignment loop`);
            break; // Stop if demand is already met
          }
          
          // Update latestExisting to current state before finding candidate
          const currentLatestExisting = [...(assignments[dateKey] || [])];
          
          // CRITICAL: For STSP, exclude rotation staff who was already assigned from remaining assignments
          const surveyorsToConsider = rotationStaffAssignedId 
            ? activeSurveyors.filter(s => s.id !== rotationStaffAssignedId)
            : activeSurveyors;
          
          const candidate = findBestCandidate({
            dateKey,
            dateObj,
            shift: SHIFT.NIGHT,
            surveyors: surveyorsToConsider, // Exclude rotation staff if they were already assigned
            surveyorStats,
            canWorkWeekend,
            existing: currentLatestExisting, // Use current assignments including rotation assignments
            dateKeys,
            area,
            nightShiftTracking, // Pass tracking to check 3-day off rule
          });

        if (candidate) {
          // CRITICAL: Double-check candidate is not already assigned a night shift on this day
          // Use the current assignments array, not the stale latestExisting
          const alreadyHasNightShift = currentAssignmentsForDay.some((a) => a.surveyorId === candidate.id && a.shift === SHIFT.NIGHT);
          if (alreadyHasNightShift) {
            console.warn(`[AUTO-POPULATE] Skipping duplicate night assignment: ${candidate.name} already has night shift on ${dateKey}`);
            continue; // Skip this iteration
          }
          
          // CRITICAL: Additional check - ensure rotation staff is not selected if they were already assigned
          if (rotationStaffAssignedId && candidate.id === rotationStaffAssignedId) {
            console.warn(`[AUTO-POPULATE] Skipping duplicate night assignment: ${candidate.name} is rotation staff already assigned on ${dateKey}`);
            continue; // Skip this iteration
          }
          
          const assignment = {
            id: `${dateKey}_${candidate.id}_${Math.random().toString(16).slice(2)}`,
            surveyorId: candidate.id,
            shift: SHIFT.NIGHT,
            breakMins: 30,
            confirmed: false,
          };

          if (!assignments[dateKey]) assignments[dateKey] = [];
          assignments[dateKey].push(assignment);

          // Note: latestExisting is now a copy, so we don't need to update it
          // The next iteration will re-fetch from assignments[dateKey]
          
          // Update night counts immediately to prevent duplicates
          nightAssigned++;
          nightNeeded--;
          
          console.log(`[AUTO-POPULATE] Assigned night shift via findBestCandidate: ${candidate.name} on ${dateKey}. Updated: nightNeeded=${nightNeeded}, nightAssigned=${nightAssigned}`);

          // Update stats
          surveyorStats[candidate.id].shiftsAssigned++;
          surveyorStats[candidate.id].assignments.push({ dateKey, shift: SHIFT.NIGHT });
          if (isWeekend(dateObj)) {
            surveyorStats[candidate.id].weekendDaysAssigned++;
            surveyorStats[candidate.id].weekendDays.push(dateKey);
          }
          if (isSaturday(dateObj)) {
            surveyorStats[candidate.id].saturdaysWorked.push(dateKey);
          }
        } else {
          issues.push(`Could not assign night shift for ${dateKey} - no available surveyors`);
        }
      }
    } else if (nightNeeded === 0 && nightRemaining > 0) {
      // If demand is 0 but we have night assignments, this shouldn't happen, but log it
      console.warn(`Night demand is 0 for ${dateKey} but nightRemaining is ${nightRemaining}`);
    }
  }

  // Phase 2: Balance shifts to reach 9 per surveyor
  // This phase distributes additional shifts to ensure each surveyor gets approximately 9 shifts
  // We iterate multiple times to ensure fair distribution
  
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
  let maxIterations = 20; // Prevent infinite loops
  let iteration = 0;
  
  while (iteration < maxIterations) {
    iteration++;
    let anyChanges = false;
    
    // Sort surveyors by current shift count (ascending) - those with fewer shifts get priority
    const sortedSurveyors = [...eligibleSurveyors].sort(
      (a, b) => surveyorStats[a.id].shiftsAssigned - surveyorStats[b.id].shiftsAssigned
    );

    for (const surveyor of sortedSurveyors) {
      const stats = surveyorStats[surveyor.id];
      let needed = targetShiftsPerSurveyor - stats.shiftsAssigned;

      if (needed <= 0) continue; // Already has enough shifts

      // Try to find days where we can add shifts
      // Shuffle date keys to avoid always assigning to the same days
      const shuffledDateKeys = [...dateKeys].sort(() => Math.random() - 0.5);
      
      for (const dateKey of shuffledDateKeys) {
        if (needed <= 0) break;

        const dateObj = parseISO(dateKey);
        const existing = assignments[dateKey] || [];
        const alreadyAssigned = existing.some((a) => a.surveyorId === surveyor.id);

        if (alreadyAssigned) continue; // Already assigned this day

        // Check non-availability
        const nonAvailability = surveyor.nonAvailability || [];
        if (nonAvailability.includes(dateKey)) {
          continue; // Surveyor is not available on this date
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

        // Check if we can add a day shift - STRICTLY respect demand limits
        const dayCount = existing.filter((a) => a.shift === SHIFT.DAY).length;
        // Get demand from settings or use template/area-specific defaults
        let dayNeeded = demandSettings[dateKey]?.day;
        if (dayNeeded === undefined || dayNeeded === null) {
          // Use template if available, otherwise area-specific defaults
          if (isWeekday(dateObj)) {
            dayNeeded = demandTemplate?.monFriDay || (area === "SOUTH" ? 5 : 3);
          } else if (isSaturday(dateObj)) {
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

        // CRITICAL: Strictly respect demand limits - NEVER exceed demand
        // Phase 2 should only assign shifts if we're below demand
        // This ensures demand is never exceeded (no more than 5 day shifts for STSP weekdays, etc.)
        if (dayCount < dayNeeded && nightCount >= nightNeeded) {
          console.log(`[AUTO-POPULATE] Phase 2: Adding day shift on ${dateKey} (${dayCount}/${dayNeeded} day shifts, ${nightCount}/${nightNeeded} night shifts)`);
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

    // Check non-availability
    const nonAvailability = s.nonAvailability || [];
    if (nonAvailability.includes(dateKey)) {
      return false; // Surveyor is not available on this date
    }

    // Check 3-day off rule after night shift rotation (for STSP area)
    if (shift === SHIFT.NIGHT && area === "SOUTH" && nightShiftTracking[s.id]) {
      const tracking = nightShiftTracking[s.id];
      // Check if this date is in the required days off period
      if (tracking.requiredDaysOff && tracking.requiredDaysOff.includes(dateKey)) {
        return false; // Still in 3-day off period
      }
      if (tracking.lastNightShiftDate) {
        const lastNightDate = parseISO(tracking.lastNightShiftDate);
        const daysSinceLastNight = differenceInCalendarDays(dateObj, lastNightDate);
        
        // If they completed a 2-week rotation, they need 3 days off
        if (tracking.consecutiveNightWeeks >= 2 && daysSinceLastNight < 3) {
          return false; // Still in 3-day off period
        }
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

    return { surveyor: s, score };
  });

  // Sort by score and return best candidate
  scored.sort((a, b) => a.score - b.score);
  return scored[0]?.surveyor || null;
}

