// app/surveyor-view.js
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  Pressable,
  Image,
  ActivityIndicator,
} from "react-native";
import TopNav from "../components/TopNav";
import {
  format,
  startOfWeek,
  addDays,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  parseISO,
  startOfDay,
  isSameDay,
  isPast,
} from "date-fns";
import { loadSurveyors, loadRosterForDate } from "../lib/storage-hybrid";
import { useAuth } from "../contexts/AuthContext";

// Helper to get initials from name
function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// Surveyor Date Row Component (only date cells, for sticky name layout)
const SurveyorDateRow = React.memo(function SurveyorDateRow({
  surveyor,
  days,
  assignmentsByDate,
  getAssignmentForSurveyor,
  getConsecutiveUnavailableRanges,
  getUnavailableRangeInfo,
  STSP_DAY_SHIFT_COLOR,
  STSP_NIGHT_SHIFT_COLOR,
  NTNP_DAY_SHIFT_COLOR,
  NTNP_NIGHT_SHIFT_COLOR,
  viewMode = "FORTNIGHT",
}) {
  const [rowWidth, setRowWidth] = useState(null);
  const dateKeys = useMemo(() => days.map(d => format(d, "yyyy-MM-dd")), [days]);
  const unavailableRanges = useMemo(() => 
    getConsecutiveUnavailableRanges(surveyor, dateKeys), 
    [surveyor, dateKeys, getConsecutiveUnavailableRanges]
  );
  
  const handleLayout = useCallback((event) => {
    const { width } = event.nativeEvent.layout;
    setRowWidth((prevWidth) => {
      if (Math.abs((prevWidth || 0) - width) < 1) {
        return prevWidth;
      }
      return width;
    });
  }, []);
  
  return (
    <View 
      style={[
        styles.surveyorRow,
        { position: "relative" }
      ]}
      onLayout={handleLayout}
    >
      {days.map((day, dayIndex) => {
        const dateKey = format(day, "yyyy-MM-dd");
        const assignment = getAssignmentForSurveyor(
          surveyor.id,
          dateKey
        );
        
        const unavailableInfo = getUnavailableRangeInfo(
          surveyor,
          dateKey,
          dateKeys,
          unavailableRanges
        );
        
        let backgroundColor = "#ffffff";
        let textColor = "#000000";
        
        if (unavailableInfo) {
          backgroundColor = "#fff3cd";
          textColor = "#856404";
        } else if (assignment) {
          const isSTSP = assignment.area === "STSP";
          const isNTNP = assignment.area === "NTNP";
          
          if (assignment.shift === "DAY") {
            backgroundColor = isSTSP 
              ? STSP_DAY_SHIFT_COLOR 
              : isNTNP 
              ? NTNP_DAY_SHIFT_COLOR 
              : "#e5e5e5";
            textColor = "#000000";
          } else if (assignment.shift === "NIGHT") {
            backgroundColor = isSTSP 
              ? STSP_NIGHT_SHIFT_COLOR 
              : isNTNP 
              ? NTNP_NIGHT_SHIFT_COLOR 
              : "#e5e5e5";
            textColor = "#ffffff";
          }
        }
        
        const isToday = isSameDay(day, new Date());
        const isPastDate = isPast(startOfDay(day)) && !isToday;
        const isMobile = Platform.OS !== "web";
        const cellStyle = [
          (viewMode === "MONTH" || isMobile) ? styles.dayCellFixed : styles.dayCell,
          { backgroundColor },
          unavailableInfo && !unavailableInfo.isStart && { borderLeftWidth: 0 },
          isToday && styles.dayCellToday,
          isPastDate && styles.dayCellPast,
        ];
        
        return (
          <View
            key={dateKey}
            style={cellStyle}
          >
            {assignment ? (
              <View style={styles.shiftContainer}>
                <Text
                  style={[
                    styles.shiftText,
                    { color: textColor },
                  ]}
                >
                  {assignment.shift}
                </Text>
                {assignment.area && (
                  <Text
                    style={[
                      styles.areaText,
                      { color: textColor },
                    ]}
                  >
                    {assignment.area}
                  </Text>
                )}
              </View>
            ) : null}
          </View>
        );
      })}
      {/* Render annual leave text as absolute positioned element spanning the range */}
      {rowWidth && unavailableRanges.map((range, rangeIndex) => {
        const startDayIndex = range.startIndex;
        const span = range.endIndex - range.startIndex + 1;
        const surveyorCellWidth = 0; // No surveyor cell in this row
        const availableWidth = rowWidth - surveyorCellWidth;
        const cellWidth = availableWidth / days.length;
        const leftPosition = surveyorCellWidth + (startDayIndex * cellWidth);
        const spanWidth = span * cellWidth;
        
        return (
          <View
            key={`leave-overlay-${rangeIndex}`}
            style={{
              position: "absolute",
              left: leftPosition,
              width: spanWidth,
              height: "100%",
              justifyContent: "center",
              alignItems: "center",
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            <Text
              style={[
                styles.unavailableText,
                {
                  color: "#856404",
                  backgroundColor: "transparent",
                },
              ]}
              numberOfLines={1}
            >
              ON ANNUAL LEAVE
            </Text>
          </View>
        );
      })}
    </View>
  );
});

// Surveyor Row Component (memoized for performance)
const SurveyorRow = React.memo(function SurveyorRow({ 
  surveyor, 
  days, 
  assignmentsByDate, 
  getAssignmentForSurveyor,
  getConsecutiveUnavailableRanges,
  getUnavailableRangeInfo,
  STSP_DAY_SHIFT_COLOR,
  STSP_NIGHT_SHIFT_COLOR,
  NTNP_DAY_SHIFT_COLOR,
  NTNP_NIGHT_SHIFT_COLOR,
  viewMode = "FORTNIGHT",
  currentUserSurveyorId = null,
  isSurveyor = false,
}) {
  const [rowWidth, setRowWidth] = useState(null);
  // Memoize dateKeys to avoid recomputing on every render
  const dateKeys = useMemo(() => days.map(d => format(d, "yyyy-MM-dd")), [days]);
  const unavailableRanges = useMemo(() => 
    getConsecutiveUnavailableRanges(surveyor, dateKeys), 
    [surveyor, dateKeys, getConsecutiveUnavailableRanges]
  );
  
  // Memoize onLayout callback to avoid recreating on every render
  const handleLayout = useCallback((event) => {
    const { width } = event.nativeEvent.layout;
    // Only update if width actually changed (avoid unnecessary re-renders)
    setRowWidth((prevWidth) => {
      if (Math.abs((prevWidth || 0) - width) < 1) {
        return prevWidth; // Width hasn't meaningfully changed
      }
      return width;
    });
  }, []);
  
  const isLoggedInSurveyor = currentUserSurveyorId && surveyor.id === currentUserSurveyorId;
  
  return (
    <View 
      style={[
        styles.surveyorRow, 
        { position: "relative" },
        isLoggedInSurveyor && styles.surveyorRowHighlighted,
        // Don't dim other surveyors - just highlight the logged-in user
      ]}
      onLayout={handleLayout}
    >
      <View style={styles.surveyorCell}>
        <View style={styles.surveyorInfo}>
          {surveyor.photoUrl ? (
            <Image
              source={{ uri: surveyor.photoUrl }}
              style={styles.surveyorImage}
            />
          ) : (
            <View
              style={[
                styles.initialsCircle,
                { backgroundColor: "#fbbf24" },
              ]}
            >
              <Text style={styles.initialsText}>
                {getInitials(surveyor.name)}
              </Text>
            </View>
          )}
          <Text style={styles.surveyorName} numberOfLines={2}>
            {surveyor.name}
          </Text>
        </View>
      </View>
      {days.map((day, dayIndex) => {
        const dateKey = format(day, "yyyy-MM-dd");
        const assignment = getAssignmentForSurveyor(
          surveyor.id,
          dateKey
        );
        
        const unavailableInfo = getUnavailableRangeInfo(
          surveyor,
          dateKey,
          dateKeys,
          unavailableRanges
        );
        
        // Determine colors based on area and shift
        let backgroundColor = "#ffffff";
        let textColor = "#000000";
        
        if (unavailableInfo) {
          // Show "ON ANNUAL LEAVE" text
          backgroundColor = "#fff3cd";
          textColor = "#856404";
        } else if (assignment) {
          const isSTSP = assignment.area === "STSP";
          const isNTNP = assignment.area === "NTNP";
          
          if (assignment.shift === "DAY") {
            backgroundColor = isSTSP 
              ? STSP_DAY_SHIFT_COLOR 
              : isNTNP 
              ? NTNP_DAY_SHIFT_COLOR 
              : "#e5e5e5";
            textColor = "#000000";
          } else if (assignment.shift === "NIGHT") {
            backgroundColor = isSTSP 
              ? STSP_NIGHT_SHIFT_COLOR 
              : isNTNP 
              ? NTNP_NIGHT_SHIFT_COLOR 
              : "#e5e5e5";
            textColor = "#ffffff";
          }
        }
        
        // Check if this day is today
        const isToday = isSameDay(day, new Date());
        const isPastDate = isPast(startOfDay(day)) && !isToday;
        
        // Determine border styling for unavailable ranges
        // Remove left border for cells after the first in a range to create continuous appearance
        // Use fixed width for month view or mobile view, flex for web other views
        const isMobile = Platform.OS !== "web";
        const cellStyle = [
          (viewMode === "MONTH" || isMobile) ? styles.dayCellFixed : styles.dayCell,
          { backgroundColor },
          unavailableInfo && !unavailableInfo.isStart && { borderLeftWidth: 0 }, // Remove left border for continuity
          isToday && styles.dayCellToday, // Highlight today's column with border
          isPastDate && styles.dayCellPast, // Dim past dates
        ];
        
        return (
          <View
            key={dateKey}
            style={cellStyle}
          >
            {assignment ? (
              <View style={styles.shiftContainer}>
                <Text
                  style={[
                    styles.shiftText,
                    { color: textColor },
                  ]}
                >
                  {assignment.shift}
                </Text>
                {assignment.area && (
                  <Text
                    style={[
                      styles.areaText,
                      { color: textColor },
                    ]}
                  >
                    {assignment.area}
                  </Text>
                )}
              </View>
            ) : null}
          </View>
        );
      })}
      {/* Render annual leave text as absolute positioned element spanning the range */}
      {rowWidth && unavailableRanges.map((range, rangeIndex) => {
        const startDayIndex = range.startIndex;
        const span = range.endIndex - range.startIndex + 1;
        const surveyorCellWidth = 150;
        const availableWidth = rowWidth - surveyorCellWidth;
        const cellWidth = availableWidth / days.length;
        const leftPosition = surveyorCellWidth + (startDayIndex * cellWidth);
        const spanWidth = span * cellWidth;
        
        return (
          <View
            key={`leave-overlay-${rangeIndex}`}
            style={{
              position: "absolute",
              left: leftPosition,
              width: spanWidth,
              height: "100%",
              justifyContent: "center",
              alignItems: "center",
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            <Text
              style={[
                styles.unavailableText,
                {
                  color: "#856404",
                  backgroundColor: "transparent",
                },
              ]}
              numberOfLines={1}
            >
              ON ANNUAL LEAVE
            </Text>
          </View>
        );
      })}
    </View>
  );
});

// STSP Day theme color (golden yellow with transparency)
const STSP_DAY_SHIFT_COLOR = "rgba(251, 191, 36, 0.4)"; // RGBA(251, 191, 36, 0.4)
// STSP Night theme color (dark blue/navy)
const STSP_NIGHT_SHIFT_COLOR = "#1E3A5F"; // Dark navy blue
// NTNP Day theme color (purple with transparency)
const NTNP_DAY_SHIFT_COLOR = "rgba(147, 51, 234, 0.4)"; // Purple with transparency
// NTNP Night theme color (darker purple)
const NTNP_NIGHT_SHIFT_COLOR = "#6B21A8"; // Dark purple

export default function SurveyorViewScreen() {
  // Get user role to filter draft rosters for surveyors
  const { role, user } = useAuth();
  const [viewMode, setViewMode] = useState("FORTNIGHT"); // WEEK | FORTNIGHT | MONTH
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [surveyors, setSurveyors] = useState([]);
  const [assignmentsByDate, setAssignmentsByDate] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // Only load assignments if role is defined (auth has loaded)
    if (!loading && surveyors.length > 0 && role !== undefined) {
      loadAssignments();
    }
  }, [anchorDate, viewMode, loading, surveyors.length, role]);

  async function loadData() {
    try {
      setLoading(true);
      const loaded = await loadSurveyors();
      setSurveyors(loaded || []);
    } catch (error) {
      console.error("Error loading surveyors:", error);
      setSurveyors([]);
    } finally {
      setLoading(false);
    }
  }

  // Find the logged-in surveyor's ID by matching email
  const currentUserSurveyorId = useMemo(() => {
    if (!user?.email || !surveyors.length) return null;
    const matchingSurveyor = surveyors.find(s => s.email && s.email.toLowerCase() === user.email.toLowerCase());
    return matchingSurveyor?.id || null;
  }, [user?.email, surveyors]);

  async function loadAssignments() {
    try {
      setLoadingAssignments(true);
      const days = getDaysForView();
      const allAssignments = {};
      
      // Parallelize all roster loading calls for better performance
      // Pass role to filter out draft rosters for surveyors
      const rosterPromises = [];
      for (const day of days) {
        // Create promises for both areas simultaneously
        rosterPromises.push(loadRosterForDate(day, "SOUTH", role));
        rosterPromises.push(loadRosterForDate(day, "NORTH", role));
      }
      
      // Wait for all rosters to load in parallel
      const rosterResults = await Promise.all(rosterPromises);
      
      // Process results - alternate between STSP and NTNP
      for (let i = 0; i < days.length; i++) {
        const stspRoster = rosterResults[i * 2];
        const ntnpRoster = rosterResults[i * 2 + 1];
        
        // Process STSP roster
        if (stspRoster && stspRoster.assignmentsByDate) {
          Object.keys(stspRoster.assignmentsByDate).forEach((dateKey) => {
            if (!allAssignments[dateKey]) {
              allAssignments[dateKey] = [];
            }
            // Add area information to each assignment
            stspRoster.assignmentsByDate[dateKey].forEach((assignment) => {
              allAssignments[dateKey].push({
                ...assignment,
                area: "STSP", // Mark as STSP
              });
            });
          });
        }
        
        // Process NTNP roster
        if (ntnpRoster && ntnpRoster.assignmentsByDate) {
          Object.keys(ntnpRoster.assignmentsByDate).forEach((dateKey) => {
            if (!allAssignments[dateKey]) {
              allAssignments[dateKey] = [];
            }
            // Add area information to each assignment
            ntnpRoster.assignmentsByDate[dateKey].forEach((assignment) => {
              allAssignments[dateKey].push({
                ...assignment,
                area: "NTNP", // Mark as NTNP
              });
            });
          });
        }
      }
      
      setAssignmentsByDate(allAssignments);
    } catch (error) {
      console.error("Error loading assignments:", error);
    } finally {
      setLoadingAssignments(false);
    }
  }

  function getDaysForView() {
    if (viewMode === "WEEK") {
      const ws = startOfWeek(anchorDate, { weekStartsOn: 1 });
      return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    } else if (viewMode === "FORTNIGHT") {
      const ws = startOfWeek(anchorDate, { weekStartsOn: 1 });
      return Array.from({ length: 14 }, (_, i) => addDays(ws, i));
    } else {
      // MONTH - show ALL days of the month (28, 29, 30, or 31 days)
      const start = startOfMonth(anchorDate);
      const end = endOfMonth(anchorDate);
      const monthDays = eachDayOfInterval({ start, end });
      console.log(`[SURVEYOR VIEW] Month view: ${format(start, "d MMM yyyy")} to ${format(end, "d MMM yyyy")}, ${monthDays.length} days`);
      return monthDays;
    }
  }

  const getAssignmentForSurveyor = useCallback((surveyorId, dateKey) => {
    const assignments = assignmentsByDate[dateKey] || [];
    return assignments.find((a) => a.surveyorId === surveyorId);
  }, [assignmentsByDate]);
  
  // Helper to find consecutive unavailable days for a surveyor (memoized)
  const getConsecutiveUnavailableRanges = useCallback((surveyor, dateKeys) => {
    const nonAvailability = surveyor.nonAvailability || [];
    if (nonAvailability.length === 0) return [];
    
    // Use Set for O(1) lookup instead of O(n) array includes
    const unavailableSet = new Set(nonAvailability);
    const ranges = [];
    let currentRange = null;
    
    dateKeys.forEach((dateKey, index) => {
      const isUnavailable = unavailableSet.has(dateKey);
      
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
  }, []);
  
  // Helper to check if a date is in an unavailable range and get its position (memoized)
  const getUnavailableRangeInfo = useCallback((surveyor, dateKey, dateKeys, unavailableRanges) => {
    const index = dateKeys.indexOf(dateKey);
    if (index === -1) return null;
    
    const range = unavailableRanges.find(r => 
      index >= r.startIndex && index <= r.endIndex
    );
    
    if (!range) return null;
    
    return {
      isStart: index === range.startIndex,
      isEnd: index === range.endIndex,
      isMiddle: index > range.startIndex && index < range.endIndex,
      span: range.endIndex - range.startIndex + 1,
    };
  }, []);

  const days = useMemo(() => getDaysForView(), [anchorDate, viewMode]);
  const dateKeys = useMemo(() => days.map(d => format(d, "yyyy-MM-dd")), [days]);
  const activeSurveyors = useMemo(
    () => {
      const active = surveyors.filter((s) => s.active);
      // Sort: NTNP staff first (NORTH), then STSP staff (SOUTH), then no preference
      return active.sort((a, b) => {
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
    },
    [surveyors]
  );

  const isWeb = Platform.OS === "web";

  return (
    <View style={styles.container}>
      <TopNav />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={[styles.content, { paddingTop: Platform.OS === "web" ? 70 : 80 }]}>
          {/* View Mode Toggle */}
          <View style={[styles.controlsContainer, { marginTop: 12 }]}>
            <View style={styles.chipContainer}>
              <Chip
                active={viewMode === "WEEK"}
                onPress={() => setViewMode("WEEK")}
                label="Week"
              />
              <View style={{ width: 8 }} />
              <Chip
                active={viewMode === "FORTNIGHT"}
                onPress={() => setViewMode("FORTNIGHT")}
                label="Fortnight"
              />
              <View style={{ width: 8 }} />
              <Chip
                active={viewMode === "MONTH"}
                onPress={() => setViewMode("MONTH")}
                label="Month"
              />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Chip
                label="◀"
                onPress={() => {
                  if (viewMode === "MONTH") {
                    // Move to previous month
                    const prevMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - 1, 1);
                    setAnchorDate(prevMonth);
                  } else {
                    const daysToAdd =
                      viewMode === "WEEK"
                        ? -7
                        : -14; // FORTNIGHT
                    setAnchorDate((d) => addDays(d, daysToAdd));
                  }
                }}
              />
              <View style={{ width: 12 }} />
              <Text style={styles.dateText}>
                {viewMode === "MONTH"
                  ? format(anchorDate, "MMM yyyy")
                  : format(anchorDate, "d MMM yyyy")}
              </Text>
              <View style={{ width: 12 }} />
              <Chip
                label="▶"
                onPress={() => {
                  if (viewMode === "MONTH") {
                    // Move to next month
                    const nextMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 1);
                    setAnchorDate(nextMonth);
                  } else {
                    const daysToAdd =
                      viewMode === "WEEK"
                        ? 7
                        : 14; // FORTNIGHT
                    setAnchorDate((d) => addDays(d, daysToAdd));
                  }
                }}
              />
            </View>
          </View>

          {/* Calendar Grid */}
          {loading || loadingAssignments ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#fbbf24" />
              <Text style={styles.loadingText}>Loading surveyor data...</Text>
            </View>
          ) : activeSurveyors.length === 0 ? (
            <Text style={styles.loadingText}>No active surveyors found</Text>
          ) : (
            <View style={styles.calendarContainer}>
              {viewMode === "MONTH" ? (
                <View style={styles.stickyLayoutContainer}>
                  {/* Fixed Left Column - Surveyor Names */}
                  <View style={styles.fixedLeftColumn}>
                    {/* Header Cell */}
                    <View style={styles.surveyorHeaderCell}>
                      <Text style={styles.headerText}>Surveyor</Text>
                    </View>
                    {/* Surveyor Name Cells */}
                    {activeSurveyors.map((surveyor) => {
                      const isLoggedInSurveyor = currentUserSurveyorId && surveyor.id === currentUserSurveyorId;
                      return (
                        <View 
                          key={surveyor.id}
                          style={[
                            styles.surveyorCell,
                            isLoggedInSurveyor && styles.surveyorRowHighlighted
                          ]}
                        >
                          <View style={styles.surveyorInfo}>
                            {surveyor.photoUrl ? (
                              <Image
                                source={{ uri: surveyor.photoUrl }}
                                style={styles.surveyorImage}
                              />
                            ) : (
                              <View
                                style={[
                                  styles.initialsCircle,
                                  { backgroundColor: "#fbbf24" },
                                ]}
                              >
                                <Text style={styles.initialsText}>
                                  {getInitials(surveyor.name)}
                                </Text>
                              </View>
                            )}
                            <Text style={styles.surveyorName} numberOfLines={2}>
                              {surveyor.name}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                  
                  {/* Scrollable Right Column - Date Columns */}
                  <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={true}
                    style={styles.horizontalScrollView}
                    contentContainerStyle={styles.horizontalScrollContent}
                  >
                    <View style={styles.scrollableDateColumns}>
                      {/* Header Row */}
                      <View style={styles.headerRow}>
                        {days.map((day) => {
                          const isToday = isSameDay(day, new Date());
                          const isPastDate = isPast(startOfDay(day)) && !isToday;
                          return (
                            <View 
                              key={format(day, "yyyy-MM-dd")} 
                              style={[
                                styles.dateHeaderCellFixed,
                                isToday && styles.dateHeaderCellToday,
                                isPastDate && styles.dayCellPast
                              ]}
                            >
                              <View style={{ alignItems: "center", justifyContent: "center", gap: 0 }}>
                                <Text style={[
                                  styles.dateHeaderDay,
                                  isToday && styles.dateHeaderDayToday
                                ]}>
                                  {format(day, "EEE")}
                                </Text>
                                <Text style={[
                                  styles.dateHeaderDate,
                                  isToday && styles.dateHeaderDateToday
                                ]}>
                                  {format(day, "d")}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>

                      {/* Surveyor Date Rows */}
                      {activeSurveyors.map((surveyor) => (
                        <SurveyorDateRow
                          key={surveyor.id}
                          surveyor={surveyor}
                          days={days}
                          assignmentsByDate={assignmentsByDate}
                          getAssignmentForSurveyor={getAssignmentForSurveyor}
                          getConsecutiveUnavailableRanges={getConsecutiveUnavailableRanges}
                          getUnavailableRangeInfo={getUnavailableRangeInfo}
                          STSP_DAY_SHIFT_COLOR={STSP_DAY_SHIFT_COLOR}
                          STSP_NIGHT_SHIFT_COLOR={STSP_NIGHT_SHIFT_COLOR}
                          NTNP_DAY_SHIFT_COLOR={NTNP_DAY_SHIFT_COLOR}
                          NTNP_NIGHT_SHIFT_COLOR={NTNP_NIGHT_SHIFT_COLOR}
                          viewMode={viewMode}
                        />
                      ))}
                    </View>
                  </ScrollView>
                </View>
              ) : (
                isWeb ? (
                  <View style={styles.stickyLayoutContainer}>
                    {/* Fixed Left Column - Surveyor Names */}
                    <View style={styles.fixedLeftColumn}>
                      {/* Header Cell */}
                      <View style={styles.surveyorHeaderCell}>
                        <Text style={styles.headerText}>Surveyor</Text>
                      </View>
                      {/* Surveyor Name Cells */}
                      {activeSurveyors.map((surveyor) => {
                        const isLoggedInSurveyor = currentUserSurveyorId && surveyor.id === currentUserSurveyorId;
                        return (
                          <View 
                            key={surveyor.id}
                            style={[
                              styles.surveyorCell,
                              isLoggedInSurveyor && styles.surveyorRowHighlighted
                            ]}
                          >
                            <View style={styles.surveyorInfo}>
                              {surveyor.photoUrl ? (
                                <Image
                                  source={{ uri: surveyor.photoUrl }}
                                  style={styles.surveyorImage}
                                />
                              ) : (
                                <View
                                  style={[
                                    styles.initialsCircle,
                                    { backgroundColor: "#fbbf24" },
                                  ]}
                                >
                                  <Text style={styles.initialsText}>
                                    {getInitials(surveyor.name)}
                                  </Text>
                                </View>
                              )}
                              <Text style={styles.surveyorName} numberOfLines={2}>
                                {surveyor.name}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                    
                    {/* Scrollable Right Column - Date Columns */}
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={true}
                      style={styles.horizontalScrollView}
                      contentContainerStyle={styles.horizontalScrollContent}
                    >
                      <View style={styles.scrollableDateColumns}>
                        {/* Header Row */}
                        <View style={styles.headerRow}>
                          {days.map((day) => {
                            const isToday = isSameDay(day, new Date());
                            const isPastDate = isPast(startOfDay(day)) && !isToday;
                            return (
                              <View 
                                key={format(day, "yyyy-MM-dd")} 
                                style={[
                                  styles.dateHeaderCell,
                                  isToday && styles.dateHeaderCellToday,
                                  isPastDate && styles.dayCellPast
                                ]}
                              >
                                <Text style={[
                                  styles.dateHeaderDay,
                                  isToday && styles.dateHeaderDayToday
                                ]}>
                                  {format(day, "EEE")}
                                </Text>
                                <Text style={[
                                  styles.dateHeaderDate,
                                  isToday && styles.dateHeaderDateToday
                                ]}>
                                  {format(day, "d")}
                                </Text>
                              </View>
                            );
                          })}
                        </View>

                        {/* Surveyor Date Rows */}
                        {activeSurveyors.map((surveyor) => (
                          <SurveyorDateRow
                            key={surveyor.id}
                            surveyor={surveyor}
                            days={days}
                            assignmentsByDate={assignmentsByDate}
                            getAssignmentForSurveyor={getAssignmentForSurveyor}
                            getConsecutiveUnavailableRanges={getConsecutiveUnavailableRanges}
                            getUnavailableRangeInfo={getUnavailableRangeInfo}
                            STSP_DAY_SHIFT_COLOR={STSP_DAY_SHIFT_COLOR}
                            STSP_NIGHT_SHIFT_COLOR={STSP_NIGHT_SHIFT_COLOR}
                            NTNP_DAY_SHIFT_COLOR={NTNP_DAY_SHIFT_COLOR}
                            NTNP_NIGHT_SHIFT_COLOR={NTNP_NIGHT_SHIFT_COLOR}
                            viewMode={viewMode}
                          />
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                ) : (
                  <View style={styles.stickyLayoutContainer}>
                    {/* Fixed Left Column - Surveyor Names */}
                    <View style={styles.fixedLeftColumn}>
                      {/* Header Cell */}
                      <View style={styles.surveyorHeaderCell}>
                        <Text style={styles.headerText}>Surveyor</Text>
                      </View>
                      {/* Surveyor Name Cells */}
                      {activeSurveyors.map((surveyor) => {
                        const isLoggedInSurveyor = currentUserSurveyorId && surveyor.id === currentUserSurveyorId;
                        return (
                          <View 
                            key={surveyor.id}
                            style={[
                              styles.surveyorCell,
                              isLoggedInSurveyor && styles.surveyorRowHighlighted
                            ]}
                          >
                            <View style={styles.surveyorInfo}>
                              {surveyor.photoUrl ? (
                                <Image
                                  source={{ uri: surveyor.photoUrl }}
                                  style={styles.surveyorImage}
                                />
                              ) : (
                                <View
                                  style={[
                                    styles.initialsCircle,
                                    { backgroundColor: "#fbbf24" },
                                  ]}
                                >
                                  <Text style={styles.initialsText}>
                                    {getInitials(surveyor.name)}
                                  </Text>
                                </View>
                              )}
                              <Text style={styles.surveyorName} numberOfLines={2}>
                                {surveyor.name}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                    
                    {/* Scrollable Right Column - Date Columns */}
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={true}
                      style={styles.horizontalScrollView}
                      contentContainerStyle={styles.horizontalScrollContent}
                    >
                      <View style={styles.scrollableDateColumns}>
                        {/* Header Row */}
                        <View style={styles.headerRow}>
                          {days.map((day) => {
                            const isToday = isSameDay(day, new Date());
                            return (
                              <View 
                                key={format(day, "yyyy-MM-dd")} 
                                style={[
                                  styles.dateHeaderCellFixed,
                                  isToday && styles.dateHeaderCellToday
                                ]}
                              >
                                <Text style={[
                                  styles.dateHeaderDay,
                                  isToday && styles.dateHeaderDayToday
                                ]}>
                                  {format(day, "EEE")}
                                </Text>
                                <Text style={[
                                  styles.dateHeaderDate,
                                  isToday && styles.dateHeaderDateToday
                                ]}>
                                  {format(day, "d")}
                                </Text>
                              </View>
                            );
                          })}
                        </View>

                        {/* Surveyor Date Rows */}
                        {activeSurveyors.map((surveyor) => (
                          <SurveyorDateRow
                            key={surveyor.id}
                            surveyor={surveyor}
                            days={days}
                            assignmentsByDate={assignmentsByDate}
                            getAssignmentForSurveyor={getAssignmentForSurveyor}
                            getConsecutiveUnavailableRanges={getConsecutiveUnavailableRanges}
                            getUnavailableRangeInfo={getUnavailableRangeInfo}
                            STSP_DAY_SHIFT_COLOR={STSP_DAY_SHIFT_COLOR}
                            STSP_NIGHT_SHIFT_COLOR={STSP_NIGHT_SHIFT_COLOR}
                            NTNP_DAY_SHIFT_COLOR={NTNP_DAY_SHIFT_COLOR}
                            NTNP_NIGHT_SHIFT_COLOR={NTNP_NIGHT_SHIFT_COLOR}
                            viewMode={viewMode}
                          />
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Chip({ label, onPress, active }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        active && {
          backgroundColor: "#fbbf24",
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          active && { color: "#000000", fontWeight: "700" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Platform.OS === "web" ? 16 : 12,
  },
  controlsContainer: {
    flexDirection: Platform.OS === "web" ? "row" : "column",
    justifyContent: Platform.OS === "web" ? "space-between" : "flex-start",
    alignItems: Platform.OS === "web" ? "center" : "stretch",
    marginBottom: Platform.OS === "web" ? 20 : 16,
    flexWrap: "wrap",
    gap: Platform.OS === "web" ? 12 : 10,
  },
  chipContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: Platform.OS === "web" ? 16 : 14,
    paddingVertical: Platform.OS === "web" ? 8 : 10,
    minHeight: Platform.OS === "web" ? "auto" : 44, // Minimum touch target for mobile
    minWidth: Platform.OS === "web" ? "auto" : 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#000000",
  },
  dateText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000000",
    minWidth: 120,
    textAlign: "center",
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 60,
    gap: 16,
  },
  loadingText: {
    color: "#666666",
    fontSize: 14,
    textAlign: "center",
    padding: 40,
  },
  calendarContainer: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 8,
    overflow: "hidden",
  },
  horizontalScrollView: {
    flex: 1,
  },
  horizontalScrollContent: {
    flexGrow: 1,
  },
  stickyLayoutContainer: {
    flexDirection: "row",
    flex: 1,
  },
  fixedLeftColumn: {
    borderRightWidth: 1,
    borderRightColor: "#e5e5e5",
    backgroundColor: "#f9f9f9",
    zIndex: 10,
  },
  scrollableDateColumns: {
    flexDirection: "column",
    minWidth: "100%",
  },
  calendarGrid: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    backgroundColor: "#f9f9f9",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  surveyorHeaderCell: {
    width: Platform.OS === "web" ? 150 : 120,
    paddingVertical: Platform.OS === "web" ? 6 : 4,
    paddingHorizontal: Platform.OS === "web" ? 8 : 6,
    borderRightWidth: 1,
    borderRightColor: "#e5e5e5",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    backgroundColor: "#f9f9f9",
    height: Platform.OS === "web" ? 45 : 40,
    justifyContent: "center",
    alignItems: "center",
  },
  dateHeaderCell: {
    flex: 1,
    paddingVertical: Platform.OS === "web" ? 6 : 4,
    paddingHorizontal: Platform.OS === "web" ? 4 : 3,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: "#e5e5e5",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    minWidth: Platform.OS === "web" ? 60 : 50,
    height: Platform.OS === "web" ? 45 : 40,
  },
  dateHeaderCellFixed: {
    width: Platform.OS === "web" ? 60 : 50,
    paddingVertical: Platform.OS === "web" ? 6 : 4,
    paddingHorizontal: Platform.OS === "web" ? 4 : 3,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: "#e5e5e5",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    flexShrink: 0,
    height: Platform.OS === "web" ? 45 : 40,
  },
  headerText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#000000",
    textTransform: "uppercase",
  },
  dateHeaderDay: {
    fontSize: 10,
    fontWeight: "600",
    color: "#666666",
    textTransform: "uppercase",
    lineHeight: 11,
    height: 11,
  },
  dateHeaderDate: {
    fontSize: 12,
    fontWeight: "700",
    color: "#000000",
    marginTop: 0,
    lineHeight: 14,
    height: 14,
  },
  dateHeaderCellToday: {
    borderLeftWidth: 3,
    borderLeftColor: "#999999", // Light grey border on left side only
  },
  dateHeaderDayToday: {
    color: "#000000",
    fontWeight: "700",
  },
  dateHeaderDateToday: {
    color: "#000000",
    fontWeight: "800",
  },
  surveyorRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5", // Match date header border color
  },
  surveyorRowHighlighted: {
    backgroundColor: Platform.OS === "web" 
      ? "rgba(34, 197, 94, 0.25)" 
      : "rgba(34, 197, 94, 0.3)", // Slightly more visible on mobile
    borderLeftWidth: Platform.OS === "web" ? 5 : 6, // Thicker border on mobile
    borderLeftColor: "#16a34a", // Darker green for more contrast
    borderRightWidth: Platform.OS === "web" ? 2 : 3, // Thicker right border on mobile
    borderRightColor: "#22c55e",
    // Add shadow on mobile for extra visibility
    ...(Platform.OS !== "web" && {
      shadowColor: "#22c55e",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 4,
    }),
  },
  surveyorRowDimmed: {
    opacity: 0.4,
  },
  surveyorCell: {
    width: Platform.OS === "web" ? 150 : 120,
    paddingVertical: Platform.OS === "web" ? 6 : 4,
    paddingHorizontal: Platform.OS === "web" ? 8 : 6,
    borderRightWidth: 1,
    borderRightColor: "#e5e5e5",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5", // Match date header border color
    backgroundColor: "#ffffff",
    height: Platform.OS === "web" ? 45 : 40,
    justifyContent: "center",
  },
  surveyorInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  surveyorImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: "#e5e5e5",
  },
  initialsCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#e5e5e5",
  },
  initialsText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#000000",
  },
  surveyorName: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#000000",
  },
  dayCell: {
    flex: 1,
    height: Platform.OS === "web" ? 44 : 36,
    paddingVertical: Platform.OS === "web" ? 6 : 4,
    paddingHorizontal: Platform.OS === "web" ? 4 : 3,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: "#e5e5e5",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    backgroundColor: "#ffffff",
    minWidth: 60,
  },
  dayCellFixed: {
    width: Platform.OS === "web" ? 60 : 50,
    height: Platform.OS === "web" ? 48 : 39,
    paddingVertical: Platform.OS === "web" ? 6 : 4,
    paddingHorizontal: Platform.OS === "web" ? 4 : 3,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: "#e5e5e5",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    backgroundColor: "#ffffff",
    flexShrink: 0,
  },
  dayCellToday: {
    borderLeftWidth: 3,
    borderLeftColor: "#999999", // Light grey left border for today's column only
  },
  dayCellPast: {
    opacity: 0.4, // Dim past dates
  },
  shiftContainer: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  shiftText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#000000",
    textTransform: "uppercase",
  },
  areaText: {
    fontSize: 8,
    fontWeight: "600",
    color: "#000000",
    opacity: 0.8,
  },
  unavailableText: {
    fontSize: 9,
    fontWeight: "700",
    textAlign: "center",
    textTransform: "uppercase",
    color: "#856404",
  },
});

