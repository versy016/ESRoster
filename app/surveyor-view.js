// app/surveyor-view.js
import React, { useState, useEffect, useMemo } from "react";
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
} from "date-fns";
import { loadSurveyors, loadRosterForDate } from "../lib/storage-hybrid";

// Helper to get initials from name
function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// STSP Day theme color (golden yellow with transparency)
const STSP_DAY_SHIFT_COLOR = "rgba(251, 191, 36, 0.4)"; // RGBA(251, 191, 36, 0.4)
// STSP Night theme color (dark blue/navy)
const STSP_NIGHT_SHIFT_COLOR = "#1E3A5F"; // Dark navy blue
// NTNP Day theme color (purple with transparency)
const NTNP_DAY_SHIFT_COLOR = "rgba(147, 51, 234, 0.4)"; // Purple with transparency
// NTNP Night theme color (darker purple)
const NTNP_NIGHT_SHIFT_COLOR = "#6B21A8"; // Dark purple

export default function SurveyorViewScreen() {
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
    if (!loading && surveyors.length > 0) {
      loadAssignments();
    }
  }, [anchorDate, viewMode, loading, surveyors.length]);

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

  async function loadAssignments() {
    try {
      setLoadingAssignments(true);
      const days = getDaysForView();
      const allAssignments = {};
      
      // Load rosters for both STSP (SOUTH) and NTNP (NORTH) areas for each day
      for (const day of days) {
        // Load STSP roster
        const stspRoster = await loadRosterForDate(day, "SOUTH");
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
        
        // Load NTNP roster
        const ntnpRoster = await loadRosterForDate(day, "NORTH");
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
      // MONTH
      const start = startOfMonth(anchorDate);
      const end = endOfMonth(anchorDate);
      return eachDayOfInterval({ start, end });
    }
  }

  function getAssignmentForSurveyor(surveyorId, dateKey) {
    const assignments = assignmentsByDate[dateKey] || [];
    return assignments.find((a) => a.surveyorId === surveyorId);
  }

  const days = useMemo(() => getDaysForView(), [anchorDate, viewMode]);
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
        <View style={[styles.content, { paddingTop: 70 }]}>
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
                  const daysToAdd =
                    viewMode === "WEEK"
                      ? -7
                      : viewMode === "FORTNIGHT"
                      ? -14
                      : -30;
                  setAnchorDate((d) => addDays(d, daysToAdd));
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
                  const daysToAdd =
                    viewMode === "WEEK"
                      ? 7
                      : viewMode === "FORTNIGHT"
                      ? 14
                      : 30;
                  setAnchorDate((d) => addDays(d, daysToAdd));
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
              {/* Header Row */}
              <View style={styles.headerRow}>
                <View style={styles.surveyorHeaderCell}>
                  <Text style={styles.headerText}>Surveyor</Text>
                </View>
                {days.map((day) => (
                  <View key={format(day, "yyyy-MM-dd")} style={styles.dateHeaderCell}>
                    <Text style={styles.dateHeaderDay}>
                      {format(day, "EEE")}
                    </Text>
                    <Text style={styles.dateHeaderDate}>
                      {format(day, "d")}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Surveyor Rows */}
              {activeSurveyors.map((surveyor) => (
                <View key={surveyor.id} style={styles.surveyorRow}>
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
                  {days.map((day) => {
                    const dateKey = format(day, "yyyy-MM-dd");
                    const assignment = getAssignmentForSurveyor(
                      surveyor.id,
                      dateKey
                    );
                    
                    // Determine colors based on area and shift
                    let backgroundColor = "#ffffff";
                    let textColor = "#000000";
                    if (assignment) {
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
                    
                    return (
                      <View
                        key={dateKey}
                        style={[
                          styles.dayCell,
                          assignment && { backgroundColor },
                        ]}
                      >
                        {assignment && (
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
                        )}
                      </View>
                    );
                  })}
                </View>
              ))}
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
    padding: 16,
  },
  controlsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    flexWrap: "wrap",
    gap: 12,
  },
  chipContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
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
  headerRow: {
    flexDirection: "row",
    backgroundColor: "#f9f9f9",
    borderBottomWidth: 2,
    borderBottomColor: "#e5e5e5",
  },
  surveyorHeaderCell: {
    width: 150,
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: "#e5e5e5",
  },
  dateHeaderCell: {
    flex: 1,
    padding: 6,
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: "#e5e5e5",
    minWidth: 60,
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
  },
  dateHeaderDate: {
    fontSize: 12,
    fontWeight: "700",
    color: "#000000",
    marginTop: 2,
  },
  surveyorRow: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: "#000000",
  },
  surveyorCell: {
    width: 150,
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: "#e5e5e5",
    backgroundColor: "#ffffff",
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
    minHeight: 45,
    padding: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderRightColor: "#e5e5e5",
    backgroundColor: "#ffffff",
    minWidth: 60,
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
});

