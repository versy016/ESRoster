/**
 * PDF Export functionality for rosters
 * Uses HTML to PDF conversion for cross-platform support
 * Matches the surveyor view format: surveyors as rows, dates as columns
 */

import { format, parseISO, isWeekend, isSaturday, isSunday, startOfWeek, addDays } from "date-fns";
import { loadRosterForDate } from "./storage-hybrid";

// Color scheme matching surveyor view
const STSP_DAY_SHIFT_COLOR = "rgba(251, 191, 36, 0.4)"; // Golden yellow with transparency
const STSP_NIGHT_SHIFT_COLOR = "#1E3A5F"; // Dark navy blue
const NTNP_DAY_SHIFT_COLOR = "rgba(147, 51, 234, 0.4)"; // Purple with transparency
const NTNP_NIGHT_SHIFT_COLOR = "#6B21A8"; // Dark purple

/**
 * Generate HTML content for PDF export in surveyor view format
 */
export async function generateRosterHTML(roster, surveyors, area, anchorDate) {
  const areaName = area === "SOUTH" ? "STSP" : "NTNP";
  const startDate = startOfWeek(anchorDate, { weekStartsOn: 1 });
  
  const fortnightDays = Array.from({ length: 14 }, (_, i) => addDays(startDate, i));
  const dateKeys = fortnightDays.map((d) => format(d, "yyyy-MM-dd"));

  // Load assignments from both STSP and NTNP rosters (like surveyor view)
  const allAssignments = {};
  
  // Load STSP roster - explicitly pass "surveyor" role to get published version
  const stspRoster = await loadRosterForDate(startDate, "SOUTH", "surveyor");
  if (stspRoster && stspRoster.assignmentsByDate) {
    Object.keys(stspRoster.assignmentsByDate).forEach((dateKey) => {
      if (!allAssignments[dateKey]) {
        allAssignments[dateKey] = [];
      }
      stspRoster.assignmentsByDate[dateKey].forEach((assignment) => {
        allAssignments[dateKey].push({
          ...assignment,
          area: "STSP",
        });
      });
    });
  }
  
  // Load NTNP roster - explicitly pass "surveyor" role to get published version
  const ntnpRoster = await loadRosterForDate(startDate, "NORTH", "surveyor");
  if (ntnpRoster && ntnpRoster.assignmentsByDate) {
    Object.keys(ntnpRoster.assignmentsByDate).forEach((dateKey) => {
      if (!allAssignments[dateKey]) {
        allAssignments[dateKey] = [];
      }
      ntnpRoster.assignmentsByDate[dateKey].forEach((assignment) => {
        allAssignments[dateKey].push({
          ...assignment,
          area: "NTNP",
        });
      });
    });
  }

  // Filter to active surveyors only and sort: NTNP first, then STSP, then no preference
  const activeSurveyors = surveyors
    .filter((s) => s.active)
    .sort((a, b) => {
      const aArea = a.areaPreference || "";
      const bArea = b.areaPreference || "";
      
      // NTNP (NORTH) comes first
      if (aArea === "NORTH" && bArea !== "NORTH") return -1;
      if (bArea === "NORTH" && aArea !== "NORTH") return 1;
      
      // STSP (SOUTH) comes second
      if (aArea === "SOUTH" && bArea !== "SOUTH" && bArea !== "NORTH") return -1;
      if (bArea === "SOUTH" && aArea !== "SOUTH" && aArea !== "NORTH") return 1;
      
      // Within same area, sort by name
      return a.name.localeCompare(b.name);
    });
  
  // Helper to get assignment for a surveyor on a date
  function getAssignmentForSurveyor(surveyorId, dateKey) {
    const assignments = allAssignments[dateKey] || [];
    return assignments.find((a) => a.surveyorId === surveyorId);
  }
  
  // Helper to find consecutive unavailable days for a surveyor
  function getConsecutiveUnavailableRanges(surveyor, dateKeys) {
    const nonAvailability = surveyor.nonAvailability || [];
    if (nonAvailability.length === 0) return [];
    
    const ranges = [];
    let currentRange = null;
    
    dateKeys.forEach((dateKey, index) => {
      const isUnavailable = nonAvailability.includes(dateKey);
      
      if (isUnavailable) {
        if (currentRange === null) {
          // Start a new range
          currentRange = { startIndex: index, endIndex: index, dateKeys: [dateKey] };
        } else {
          // Continue current range
          currentRange.endIndex = index;
          currentRange.dateKeys.push(dateKey);
        }
      } else {
        // End current range if exists
        if (currentRange !== null) {
          ranges.push(currentRange);
          currentRange = null;
        }
      }
    });
    
    // Add final range if exists
    if (currentRange !== null) {
      ranges.push(currentRange);
    }
    
    return ranges;
  }
  
  // Generate HTML in surveyor view format
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: Arial, sans-serif;
          padding: 20px;
          background: white;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 3px solid #333;
          padding-bottom: 15px;
        }
        .header h1 {
          font-size: 28px;
          color: #1a1a1a;
          margin-bottom: 5px;
        }
        .header .date-range {
          font-size: 14px;
          color: #888;
        }
        .roster-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
          font-size: 10px;
          border: 1px solid #e5e5e5;
        }
        .roster-table th {
          background-color: #f9f9f9;
          border: 1px solid #e5e5e5;
          padding: 8px 6px;
          text-align: center;
          font-weight: bold;
          color: #000;
          font-size: 11px;
          text-transform: uppercase;
        }
        .roster-table td {
          border: 1px solid #e5e5e5;
          padding: 6px 4px;
          text-align: center;
          vertical-align: middle;
          min-height: 45px;
          background-color: #ffffff;
        }
        .surveyor-header-cell {
          width: 150px;
          border-right: 1px solid #e5e5e5;
        }
        .surveyor-cell {
          width: 150px;
          padding: 8px;
          border-right: 1px solid #e5e5e5;
          background-color: #ffffff;
        }
        .surveyor-name {
          font-size: 12px;
          font-weight: 600;
          color: #000;
        }
        .date-header-cell {
          min-width: 60px;
          padding: 6px;
        }
        .date-header-day {
          font-size: 10px;
          font-weight: 600;
          color: #666;
          text-transform: uppercase;
        }
        .date-header-date {
          font-size: 12px;
          font-weight: 700;
          color: #000;
          margin-top: 2px;
        }
        .day-cell {
          min-width: 60px;
          padding: 4px;
          text-align: center;
          vertical-align: middle;
        }
        .shift-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
        }
        .shift-text {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .area-text {
          font-size: 8px;
          font-weight: 600;
          opacity: 0.8;
        }
        .surveyor-row {
          border-bottom: 2px solid #000;
        }
        .footer {
          margin-top: 30px;
          text-align: center;
          font-size: 10px;
          color: #888;
          border-top: 1px solid #ddd;
          padding-top: 10px;
        }
        @media print {
          .day-cell {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            color-adjust: exact;
          }
          .shift-text, .area-text {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            color-adjust: exact;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Engineering Surveys Roster</h1>
        <div class="date-range">
          ${format(fortnightDays[0], "EEEE, d MMMM yyyy")} - ${format(fortnightDays[13], "EEEE, d MMMM yyyy")}
        </div>
      </div>
      
      <table class="roster-table">
        <thead>
          <tr>
            <th class="surveyor-header-cell">Surveyor</th>
            ${fortnightDays.map((day) => `
              <th class="date-header-cell">
                <div class="date-header-day">${format(day, "EEE")}</div>
                <div class="date-header-date">${format(day, "d")}</div>
              </th>
            `).join("")}
          </tr>
        </thead>
        <tbody>
  `;

  // Generate rows for each surveyor
  activeSurveyors.forEach((surveyor) => {
    const unavailableRanges = getConsecutiveUnavailableRanges(surveyor, dateKeys);
    const processedIndices = new Set();
    
    html += `
      <tr class="surveyor-row">
        <td class="surveyor-cell">
          <div class="surveyor-name">${surveyor.name}</div>
        </td>
    `;
    
    // Process each day
    fortnightDays.forEach((day, dayIndex) => {
      const dateKey = format(day, "yyyy-MM-dd");
      
      // Skip if this day is part of an unavailable range (will be handled by colspan)
      if (processedIndices.has(dayIndex)) {
        return;
      }
      
      // Check if this day is the start of an unavailable range
      const unavailableRange = unavailableRanges.find(r => r.startIndex === dayIndex);
      
      if (unavailableRange) {
        // This is the start of a consecutive unavailable period
        const colspan = unavailableRange.endIndex - unavailableRange.startIndex + 1;
        // Mark all indices in this range as processed
        for (let i = unavailableRange.startIndex; i <= unavailableRange.endIndex; i++) {
          processedIndices.add(i);
        }
        
        html += `
          <td class="day-cell" colspan="${colspan}" style="background-color: #fff3cd; color: #856404; text-align: center; font-weight: 700; font-size: 10px; padding: 8px;">
            ON ANNUAL LEAVE
          </td>
        `;
      } else {
        // Normal day - check for assignment
        const assignment = getAssignmentForSurveyor(surveyor.id, dateKey);
        
        // Determine colors based on area and shift (matching surveyor view)
        let backgroundColor = "#ffffff";
        let textColor = "#000000";
        let shiftText = "";
        let areaText = "";
        
        if (assignment) {
          const isSTSP = assignment.area === "STSP";
          const isNTNP = assignment.area === "NTNP";
          
          if (assignment.shift === "DAY") {
            backgroundColor = isSTSP ? STSP_DAY_SHIFT_COLOR : isNTNP ? NTNP_DAY_SHIFT_COLOR : "#e5e5e5";
            textColor = "#000000";
            shiftText = "DAY";
            areaText = assignment.area || "";
          } else if (assignment.shift === "NIGHT") {
            backgroundColor = isSTSP ? STSP_NIGHT_SHIFT_COLOR : isNTNP ? NTNP_NIGHT_SHIFT_COLOR : "#e5e5e5";
            textColor = "#ffffff";
            shiftText = "NIGHT";
            areaText = assignment.area || "";
          }
        }
        
        html += `
          <td class="day-cell" style="background-color: ${backgroundColor}; color: ${textColor};">
            ${assignment ? `
              <div class="shift-container">
                <div class="shift-text" style="color: ${textColor}; font-weight: 700;">${shiftText}</div>
                ${areaText ? `<div class="area-text" style="color: ${textColor}; opacity: 0.9;">${areaText}</div>` : ""}
              </div>
            ` : ""}
          </td>
        `;
      }
    });
    
    html += `
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      
      <div class="footer">
        Generated on ${format(new Date(), "d MMMM yyyy 'at' HH:mm")}
      </div>
    </body>
    </html>
  `;

  return html;
}

/**
 * Export roster to PDF (web version using browser print)
 */
export async function exportRosterToPDFWeb(roster, surveyors, area, anchorDate) {
  const html = await generateRosterHTML(roster, surveyors, area, anchorDate);
  
  // Create a new window with the HTML content
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("Failed to open print window. Please allow popups for this site.");
  }
  
  printWindow.document.write(html);
  printWindow.document.close();
  
  // Wait for content to load, then trigger print
  return new Promise((resolve, reject) => {
    let hasPrinted = false; // Flag to prevent duplicate print calls
    let fallbackTimeout = null;
    
    const triggerPrint = () => {
      if (hasPrinted) return; // Prevent duplicate calls
      hasPrinted = true;
      if (fallbackTimeout) {
        clearTimeout(fallbackTimeout); // Clear fallback if it exists
      }
      printWindow.print();
      resolve({ success: true });
    };
    
    printWindow.onload = () => {
      setTimeout(() => {
        triggerPrint();
      }, 250);
    };
    
    // Fallback timeout (only if onload hasn't fired)
    fallbackTimeout = setTimeout(() => {
      if (printWindow.document.readyState === "complete" && !hasPrinted) {
        triggerPrint();
      }
    }, 1000);
  });
}

/**
 * Export roster to PDF (mobile version - requires expo-print)
 */
export async function exportRosterToPDFMobile(roster, surveyors, area, anchorDate) {
  try {
    // Dynamic import to avoid errors if expo-print is not installed
    const { printToFileAsync } = await import("expo-print");
    const { shareAsync } = await import("expo-sharing");
    
    const html = await generateRosterHTML(roster, surveyors, area, anchorDate);
    
    // Generate PDF
    const { uri } = await printToFileAsync({ html });
    
    // Share the PDF
    const isAvailable = await shareAsync.isAvailableAsync();
    if (isAvailable) {
      await shareAsync.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle: "Export Roster as PDF",
      });
    } else {
      throw new Error("Sharing is not available on this device");
    }
    
    return { success: true, uri };
  } catch (error) {
    // If expo-print is not available, fall back to HTML export
    console.warn("expo-print not available, falling back to HTML:", error);
    throw new Error("PDF export requires expo-print package. Please install it: npx expo install expo-print expo-sharing");
  }
}

/**
 * Main export function that handles both web and mobile
 */
export async function exportRosterToPDF(roster, surveyors, area, anchorDate, platform) {
  if (platform === "web") {
    return await exportRosterToPDFWeb(roster, surveyors, area, anchorDate);
  } else {
    return await exportRosterToPDFMobile(roster, surveyors, area, anchorDate);
  }
}
