import { format, startOfWeek, addDays, parseISO, differenceInCalendarDays } from "date-fns";

export const SHIFT = { DAY: "DAY", NIGHT: "NIGHT", OFF: "OFF" };

// Helpers
export function isWeekend(dateObj) {
  const dow = dateObj.getDay(); // Sun=0 ... Sat=6
  return dow === 0 || dow === 6;
}

export function isSaturday(dateObj) {
  return dateObj.getDay() === 6;
}

export function isSunday(dateObj) {
  return dateObj.getDay() === 0;
}

export function isWeekday(dateObj) {
  const dow = dateObj.getDay();
  return dow >= 1 && dow <= 5;
}

function getAssignments(byDate, dateKey) {
  return byDate?.[dateKey] ?? [];
}

function workedOnDay(byDate, dateKey, surveyorId) {
  // working = has any assignment with shift DAY or NIGHT
  const items = getAssignments(byDate, dateKey).filter(a => a.surveyorId === surveyorId);
  return items.some(a => a.shift === SHIFT.DAY || a.shift === SHIFT.NIGHT);
}

function offOnDay(byDate, dateKey, surveyorId) {
  // off = no assignment OR only OFF assignments (no DAY/NIGHT)
  const items = getAssignments(byDate, dateKey).filter(a => a.surveyorId === surveyorId);
  if (items.length === 0) return true;
  return !items.some(a => a.shift === SHIFT.DAY || a.shift === SHIFT.NIGHT);
}

function anyDuplicateOrMultiShiftSameDay(byDate, dateKey, surveyorId) {
  // If they have >1 working shift entries (or duplicate entries), flag it.
  const items = getAssignments(byDate, dateKey).filter(a => a.surveyorId === surveyorId);
  const workingCount = items.filter(a => a.shift === SHIFT.DAY || a.shift === SHIFT.NIGHT).length;
  return workingCount > 1;
}

function normalizeDateKeysInWindow(anchorDate, daysCount) {
  const start = startOfWeek(anchorDate, { weekStartsOn: 1 }); // Monday
  return Array.from({ length: daysCount }, (_, i) => format(addDays(start, i), "yyyy-MM-dd"));
}

function withinLastNDays(dateISO, anchorISO, nDays) {
  // true if dateISO is within (anchorISO - nDays) .. anchorISO (inclusive)
  // used for weekend history checks
  const d = parseISO(dateISO);
  const a = parseISO(anchorISO);
  const diff = differenceInCalendarDays(a, d);
  return diff >= 0 && diff <= nDays;
}

/**
 * Convert an array of date strings (YYYY-MM-DD) into a readable range format
 * Groups consecutive dates into ranges (e.g., "18 Dec 2025 - 26 Dec 2025")
 * @param {string[]} dateStrings - Array of date strings in YYYY-MM-DD format
 * @returns {string} Formatted string with date ranges
 */
function formatDateRanges(dateStrings) {
  if (dateStrings.length === 0) return "";
  if (dateStrings.length === 1) {
    return format(parseISO(dateStrings[0]), "d MMM yyyy");
  }

  // Sort dates
  const sortedDates = [...dateStrings].sort();
  const ranges = [];
  let rangeStart = parseISO(sortedDates[0]);
  let rangeEnd = rangeStart;

  for (let i = 1; i < sortedDates.length; i++) {
    const currentDate = parseISO(sortedDates[i]);
    const expectedNextDate = addDays(rangeEnd, 1);

    // Check if current date is consecutive
    if (currentDate.getTime() === expectedNextDate.getTime()) {
      rangeEnd = currentDate;
    } else {
      // End current range and start a new one
      if (rangeStart.getTime() === rangeEnd.getTime()) {
        // Single date
        ranges.push(format(rangeStart, "d MMM yyyy"));
      } else {
        // Date range
        ranges.push(`${format(rangeStart, "d MMM yyyy")} - ${format(rangeEnd, "d MMM yyyy")}`);
      }
      rangeStart = currentDate;
      rangeEnd = currentDate;
    }
  }

  // Add the last range
  if (rangeStart.getTime() === rangeEnd.getTime()) {
    ranges.push(format(rangeStart, "d MMM yyyy"));
  } else {
    ranges.push(`${format(rangeStart, "d MMM yyyy")} - ${format(rangeEnd, "d MMM yyyy")}`);
  }

  return ranges.join(", ");
}

/**
 * Full roster validation
 *
 * Inputs:
 * - surveyors: [{id,name,areaPreference,nonAvailability}]
 * - byDate: { "YYYY-MM-DD": [Assignment...] }
 * - anchorDate: Date (controls fortnight window: Mon..14 days)
 * - area: "SOUTH" | "NORTH" - The area this roster is for (STSP or NTNP)
 * - weekendHistory: { [surveyorId]: ["YYYY-MM-DD", ...] } // store actual weekend work dates
 * - demand: { "YYYY-MM-DD": {day: number, night: number} } // demand requirements per date
 * - demandTemplate: { monFriDay: number, satDay: number, night: number } // template to use when specific demand is missing
 *
 * Returns:
 * - issues: string[]
 */
export function validateRoster({
  surveyors,
  byDate,
  anchorDate,
  area = "SOUTH", // Area this roster is for (SOUTH=STSP, NORTH=NTNP)
  fortnightDays = 14,
  shiftsPerSurveyor = 9,
  weekendHistoryDays = 21,
  weekendHistory = {},
  demand = {}, // Demand requirements per date
  demandTemplate = null, // Template to use when specific demand is missing
  otherAreaByDate = {}, // Assignments from the other area (for cross-area shift counting)
}) {
  const issues = [];
  const windowKeys = normalizeDateKeysInWindow(anchorDate, fortnightDays);

  // Precompute date objects for window keys
  const windowDates = windowKeys.map(k => parseISO(k));

  // 0) Area preference validation: Suppressed for manual assignments
  // Manual assignments are allowed to override area preferences, so we don't show warnings
  // Conflict checking is handled at assignment time in the UI
  const rosterAreaName = area === "SOUTH" ? "STSP" : "NTNP";
  console.log(`[VALIDATION] Area preference validation suppressed for manual assignments in ${rosterAreaName} roster`);

  // Get list of surveyors actually assigned to this roster (have at least one assignment)
  const assignedSurveyorIds = new Set();
  for (let i = 0; i < windowKeys.length; i++) {
    const dateKey = windowKeys[i];
    const assignments = getAssignments(byDate, dateKey);
    assignments.forEach(a => {
      if (a.shift === SHIFT.DAY || a.shift === SHIFT.NIGHT) {
        assignedSurveyorIds.add(a.surveyorId);
      }
    });
  }
  
  // Only validate surveyors that are actually assigned to this roster
  const assignedSurveyors = surveyors.filter(s => assignedSurveyorIds.has(s.id));
  console.log(`[VALIDATION] Validating ${assignedSurveyors.length} assigned surveyors (out of ${surveyors.length} total surveyors)`);

  // 1) Basic integrity: no more than 1 working shift/day per surveyor
  for (let i = 0; i < windowKeys.length; i++) {
    const dateKey = windowKeys[i];
    for (const s of assignedSurveyors) {
      if (anyDuplicateOrMultiShiftSameDay(byDate, dateKey, s.id)) {
        issues.push(`${s.name}: multiple working shifts on ${dateKey} (max 1 shift/day)`);
      }
    }
  }

  // 2) Count working shifts per surveyor (DAY/NIGHT) - including shifts from both areas
  // Also identify night shift workers (those who primarily work night shifts)
  const workCount = Object.fromEntries(assignedSurveyors.map(s => [s.id, 0]));
  const nightShiftCount = Object.fromEntries(assignedSurveyors.map(s => [s.id, 0]));
  const dayShiftCount = Object.fromEntries(assignedSurveyors.map(s => [s.id, 0]));
  const weekendCountThisFortnight = Object.fromEntries(assignedSurveyors.map(s => [s.id, 0]));
  const saturdayWorkedKeys = Object.fromEntries(assignedSurveyors.map(s => [s.id, []]));
  const weekendWorkKeys = Object.fromEntries(assignedSurveyors.map(s => [s.id, []])); // Track weekend work for night shift validation

  for (let i = 0; i < windowKeys.length; i++) {
    const dateKey = windowKeys[i];
    const dObj = windowDates[i];

    for (const s of assignedSurveyors) {
      // Count shifts in current area
      const assignments = getAssignments(byDate, dateKey).filter(a => a.surveyorId === s.id);
      const hasDayShift = assignments.some(a => a.shift === SHIFT.DAY);
      const hasNightShift = assignments.some(a => a.shift === SHIFT.NIGHT);
      
      if (hasDayShift || hasNightShift) {
        workCount[s.id] += 1;
        if (hasDayShift) dayShiftCount[s.id] += 1;
        if (hasNightShift) nightShiftCount[s.id] += 1;

        if (isWeekend(dObj)) {
          weekendCountThisFortnight[s.id] += 1;
          weekendWorkKeys[s.id].push(dateKey);
        }
        if (isSaturday(dObj)) saturdayWorkedKeys[s.id].push(dateKey);
      }
      
      // Also count shifts from the other area (for cross-area assignments)
      if (otherAreaByDate && otherAreaByDate[dateKey]) {
        const otherAreaAssignments = otherAreaByDate[dateKey];
        const hasOtherAreaDayShift = otherAreaAssignments.some(a => 
          a.surveyorId === s.id && a.shift === SHIFT.DAY
        );
        const hasOtherAreaNightShift = otherAreaAssignments.some(a => 
          a.surveyorId === s.id && a.shift === SHIFT.NIGHT
        );
        if (hasOtherAreaDayShift || hasOtherAreaNightShift) {
          workCount[s.id] += 1;
          if (hasOtherAreaDayShift) dayShiftCount[s.id] += 1;
          if (hasOtherAreaNightShift) nightShiftCount[s.id] += 1;
          if (isWeekend(dObj)) {
            weekendCountThisFortnight[s.id] += 1;
            weekendWorkKeys[s.id].push(dateKey);
          }
        if (isSaturday(dObj)) saturdayWorkedKeys[s.id].push(dateKey);
      }
    }
    }
  }

  // Identify night shift workers: those who have more night shifts than day shifts
  // or those who have at least 5 night shifts (indicating they're on night rotation)
  const nightShiftWorkers = new Set();
  for (const s of assignedSurveyors) {
    const nightCount = nightShiftCount[s.id] || 0;
    const dayCount = dayShiftCount[s.id] || 0;
    // If they have more night shifts than day shifts, or at least 5 night shifts, they're a night shift worker
    if (nightCount > dayCount || nightCount >= 5) {
      nightShiftWorkers.add(s.id);
    }
  }

  // Rule: Shift count validation - different rules for night shift workers
  // Night shift workers: 10 shifts per fortnight, Mon-Fri only
  // Day shift workers: 9 shifts per fortnight
  for (const s of assignedSurveyors) {
    const c = workCount[s.id] ?? 0;
    const nonAvailability = s.nonAvailability || [];
    const isNightShiftWorker = nightShiftWorkers.has(s.id);
    
    // For night shift workers: only count Mon-Fri available days
    // For day shift workers: count all days except Sundays
    let availableDays = 0;
    for (let i = 0; i < windowKeys.length; i++) {
      const dateKey = windowKeys[i];
      const dObj = windowDates[i];
      
      // Skip Sundays (no coverage)
      if (isSunday(dObj)) continue;
      
      // Night shift workers can only work Mon-Fri
      if (isNightShiftWorker && isWeekend(dObj)) continue;
      
      // Skip non-availability days
      if (nonAvailability.includes(dateKey)) continue;
      
      availableDays++;
    }
    
    // Calculate expected shifts based on worker type and available days
    const targetShifts = isNightShiftWorker ? 10 : shiftsPerSurveyor;
    const expectedShifts = Math.min(targetShifts, availableDays);
    
    // Validate night shift workers: check for weekend work
    if (isNightShiftWorker && weekendWorkKeys[s.id].length > 0) {
      const weekendDates = weekendWorkKeys[s.id].map(dk => format(parseISO(dk), "d MMM yyyy")).join(", ");
      issues.push(`${s.name}: Night shift worker assigned to weekend (${weekendDates}). Night shift workers can only work Mon-Fri.`);
    }
    
    // Validate shift count
    if (c !== expectedShifts) {
      if (c < expectedShifts) {
        // Check if missing shifts are due to non-availability
        const missingShifts = expectedShifts - c;
        const unavailableDays = windowKeys.filter(dateKey => {
          const dObj = parseISO(dateKey);
          if (isSunday(dObj)) return false;
          if (isNightShiftWorker && isWeekend(dObj)) return false; // Weekends not available for night workers
          return nonAvailability.includes(dateKey);
        });
        
        if (unavailableDays.length > 0 && c > 0) {
          // Surveyor worked some days but is unavailable for others
          const dateRanges = formatDateRanges(unavailableDays);
          const workerType = isNightShiftWorker ? "night shift worker" : "surveyor";
          issues.push(`${s.name}: has ${c} working shifts (expected ${expectedShifts} based on ${availableDays} available days for ${workerType}). Not available from ${dateRanges}`);
        } else if (c === 0 && unavailableDays.length === 0) {
          // No shifts and no non-availability - they should be working
          const workerType = isNightShiftWorker ? "night shift worker" : "surveyor";
          issues.push(`${s.name}: has ${c} working shifts (must be ${targetShifts} for ${workerType})`);
        } else {
          // Some other reason
          const workerType = isNightShiftWorker ? "night shift worker" : "surveyor";
          issues.push(`${s.name}: has ${c} working shifts (expected ${expectedShifts} based on availability for ${workerType})`);
        }
      } else {
        // More shifts than expected (over-assigned)
        const workerType = isNightShiftWorker ? "night shift worker" : "surveyor";
        issues.push(`${s.name}: has ${c} working shifts (expected ${expectedShifts} based on availability for ${workerType})`);
      }
    }
  }
  
  // 2.5) Demand matching validation: Check if demand is met for each day
  // Check demand if we have either specific demand settings or a template
  if ((demand && Object.keys(demand).length > 0) || demandTemplate) {
    for (let i = 0; i < windowKeys.length; i++) {
      const dateKey = windowKeys[i];
      const dObj = windowDates[i];
      let dateDemand = demand[dateKey];
      
      // If no specific demand for this date, use template values
      if (!dateDemand && demandTemplate) {
        const dow = dObj.getDay();
        if (dow >= 1 && dow <= 5) {
          // Mon-Fri
          dateDemand = {
            day: demandTemplate.monFriDay || 0,
            night: demandTemplate.night || 0,
          };
        } else if (dow === 6) {
          // Saturday
          dateDemand = {
            day: demandTemplate.satDay || 0,
            night: 0, // Saturday nights always 0
          };
        } else {
          // Sunday - no demand
          dateDemand = { day: 0, night: 0 };
        }
      }
      
      // Skip if still no demand (no template and no specific demand)
      if (!dateDemand) continue;
      
      const dayDemand = dateDemand.day || 0;
      const nightDemand = dateDemand.night || 0;
      
      // Count actual assignments
      const assignments = getAssignments(byDate, dateKey);
      const dayAssigned = assignments.filter(a => a.shift === SHIFT.DAY).length;
      const nightAssigned = assignments.filter(a => a.shift === SHIFT.NIGHT).length;
      
      // Check day demand
      // Saturday demand is treated as MAXIMUM (not minimum)
      // Weekday demand is treated as MINIMUM
      const isSaturdayDay = isSaturday(dObj);
      
      if (isSaturdayDay) {
        // Saturday: Demand validation disabled - allow flexible assignment
        // Note: Saturday demand is maximum, but we don't enforce it to allow flexibility
      } else {
        // Weekday: Check if demand is met (minimum constraint)
        if (dayAssigned < dayDemand) {
          const shortfall = dayDemand - dayAssigned;
          
          // Find eligible surveyors who could fill the gap
          const eligibleSurveyors = assignedSurveyors.filter(s => {
            // Check if already assigned this day
            const alreadyAssigned = assignments.some(a => a.surveyorId === s.id);
            if (alreadyAssigned) return false;
            
            // Check area preference
            if (s.areaPreference && s.areaPreference !== area) return false;
            
            // Check non-availability
            const nonAvailability = s.nonAvailability || [];
            if (nonAvailability.includes(dateKey)) return false;
            
            // Check if they've reached shift limit
            const shiftsSoFar = workCount[s.id] || 0;
            if (shiftsSoFar >= shiftsPerSurveyor) return false;
            
            return true;
          });
          
          const dateStr = format(dObj, "EEE d MMM");
          let reason = "";
          if (eligibleSurveyors.length === 0) {
            // No eligible surveyors available
            const unavailableCount = assignedSurveyors.filter(s => {
              const nonAvailability = s.nonAvailability || [];
              return nonAvailability.includes(dateKey);
            }).length;
            
            const atLimitCount = assignedSurveyors.filter(s => {
              const shiftsSoFar = workCount[s.id] || 0;
              return shiftsSoFar >= shiftsPerSurveyor;
            }).length;
            
            reason = `No eligible surveyors available`;
            if (unavailableCount > 0) {
              reason += ` (${unavailableCount} on leave/not available)`;
            }
            if (atLimitCount > 0) {
              reason += ` (${atLimitCount} at shift limit)`;
            }
          } else {
            reason = `${eligibleSurveyors.length} eligible surveyor(s) available but not assigned`;
          }
          
          issues.push(`${dateStr}: Day demand ${dayDemand} but only ${dayAssigned} assigned (shortfall: ${shortfall}). ${reason}`);
        }
        // Note: Weekday demand is minimum, so excess is allowed (not flagged)
      }
      
      // Check night demand - UNDER demand
      if (nightAssigned < nightDemand) {
        const shortfall = nightDemand - nightAssigned;
        const dateStr = format(dObj, "EEE d MMM");
        
        // Find eligible surveyors for night shifts
        const eligibleSurveyors = assignedSurveyors.filter(s => {
          const alreadyAssigned = assignments.some(a => a.surveyorId === s.id);
          if (alreadyAssigned) return false;
          
          if (s.areaPreference && s.areaPreference !== area) return false;
          
          const nonAvailability = s.nonAvailability || [];
          if (nonAvailability.includes(dateKey)) return false;
          
          const shiftsSoFar = workCount[s.id] || 0;
          if (shiftsSoFar >= shiftsPerSurveyor) return false;
          
          return true;
        });
        
        let reason = "";
        if (eligibleSurveyors.length === 0) {
          const unavailableCount = assignedSurveyors.filter(s => {
            const nonAvailability = s.nonAvailability || [];
            return nonAvailability.includes(dateKey);
          }).length;
          
          const atLimitCount = assignedSurveyors.filter(s => {
            const shiftsSoFar = workCount[s.id] || 0;
            return shiftsSoFar >= shiftsPerSurveyor;
          }).length;
          
          reason = `No eligible surveyors available`;
          if (unavailableCount > 0) {
            reason += ` (${unavailableCount} on leave/not available)`;
          }
          if (atLimitCount > 0) {
            reason += ` (${atLimitCount} at shift limit)`;
          }
        } else {
          reason = `${eligibleSurveyors.length} eligible surveyor(s) available but not assigned`;
        }
        
        issues.push(`${dateStr}: Night demand ${nightDemand} but only ${nightAssigned} assigned (shortfall: ${shortfall}). ${reason}`);
      }
      
      // Check night demand - OVER demand
      if (nightAssigned > nightDemand) {
        const excess = nightAssigned - nightDemand;
        const dateStr = format(dObj, "EEE d MMM");
        issues.push(`${dateStr}: Night demand ${nightDemand} but ${nightAssigned} assigned (excess: ${excess}). Too many surveyors assigned.`);
      }
    }
  }

  // 3) Weekend rule: Only 1 on 3 Saturdays/Sundays
  // Implementation:
  // - In THIS fortnight: max 1 weekend day worked
  // - Plus history constraint: if they worked any weekend in last 21 days -> they cannot work weekend this fortnight
  const anchorISO = format(anchorDate, "yyyy-MM-dd");

  for (const s of assignedSurveyors) {
    const wThis = weekendCountThisFortnight[s.id] ?? 0;

    if (wThis > 1) {
      issues.push(`${s.name}: worked ${wThis} weekend days in this fortnight (max 1)`);
    }

    const hist = weekendHistory?.[s.id] ?? [];
    const recentWeekend = hist.some(dt => withinLastNDays(dt, anchorISO, weekendHistoryDays));

    if (recentWeekend && wThis > 0) {
      issues.push(`${s.name}: weekend rule violated (already worked a weekend in last ${weekendHistoryDays} days)`);
    }
  }

  // 4) Saturday rules:
  //    a) A surveyor cannot work consecutive Saturdays
  //    b) A surveyor can work once in every 3 Saturdays
  for (const s of assignedSurveyors) {
    const sats = saturdayWorkedKeys[s.id] ?? [];
    
    // Get all Saturdays in the window (not just worked ones)
    const allSaturdays = [];
    for (let i = 0; i < windowKeys.length; i++) {
      if (isSaturday(windowDates[i])) {
        allSaturdays.push({ dateKey: windowKeys[i], index: i });
      }
    }
    
    // Rule 4a: Check for consecutive Saturdays
    for (let i = 0; i < sats.length - 1; i++) {
      const sat1 = sats[i];
      const sat2 = sats[i + 1];
      const sat1Index = windowKeys.indexOf(sat1);
      const sat2Index = windowKeys.indexOf(sat2);
      
      if (sat1Index >= 0 && sat2Index >= 0) {
        // Check if they are exactly 7 days apart (consecutive Saturdays)
        const daysDiff = sat2Index - sat1Index;
        if (daysDiff === 7) {
          issues.push(`${s.name}: worked consecutive Saturdays (${sat1} and ${sat2})`);
        }
      }
    }
    
    // Rule 4b: Check that they don't work more than 1 Saturday in any 3-Saturday period
    // For each Saturday in the window, check the next 2 Saturdays
    for (let i = 0; i < allSaturdays.length; i++) {
      const sat1 = allSaturdays[i];
      const workedSatsInPeriod = [];
      
      // Check this Saturday and the next 2 Saturdays (3-Saturday window)
      for (let j = i; j < Math.min(i + 3, allSaturdays.length); j++) {
        const sat = allSaturdays[j];
        if (sats.includes(sat.dateKey)) {
          workedSatsInPeriod.push(sat.dateKey);
        }
      }
      
      if (workedSatsInPeriod.length > 1) {
        issues.push(`${s.name}: worked ${workedSatsInPeriod.length} Saturdays in a 3-Saturday period (max 1). Saturdays: ${workedSatsInPeriod.join(", ")}`);
      }
    }
  }

  return issues;
}

/**
 * Optional: use this when adding assignments to prevent duplicates early.
 * Returns { ok: boolean, message?: string }
 */
export function canAssign({ byDate, dateKey, surveyorId }) {
  const items = getAssignments(byDate, dateKey).filter(a => a.surveyorId === surveyorId);
  const alreadyWorking = items.some(a => a.shift === SHIFT.DAY || a.shift === SHIFT.NIGHT);
  if (alreadyWorking) {
    return { ok: false, message: "This surveyor already has a shift on this day." };
  }
  return { ok: true };
}
