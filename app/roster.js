// app/roster.js
import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  Modal,
  TextInput,
  ScrollView,
  FlatList,
  Platform,
  Alert,
  Share,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { DraxProvider, DraxView } from "react-native-drax";
import { Calendar } from "react-native-calendars";
import TopNav from "../components/TopNav";
import {
  format,
  startOfWeek,
  addDays,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  parseISO,
  isToday,
  isSameDay,
  isPast,
  startOfDay,
} from "date-fns";
import { validateRoster, canAssign, SHIFT } from "../lib/rules";
import {
  loadSurveyors,
  saveRoster,
  loadRoster,
  loadAllRosters,
  loadRosterForDate,
  deleteRosterFromStorage,
  loadWeekendHistory,
  updateWeekendHistoryFromRoster,
  exportRosterToCSV,
  exportRosterToJSON,
  loadDemand,
} from "../lib/storage-hybrid";
import { exportRosterToPDF } from "../lib/pdf-export";
import { autoPopulateRoster } from "../lib/auto-populate";
import { useUnsavedChanges } from "../contexts/UnsavedChangesContext";
import { useAuth } from "../contexts/AuthContext";

export default function RosterScreen() {
  // All hooks must be called before any conditional returns
  const [authTimeout, setAuthTimeout] = useState(false);
  
  // Wrap useAuth in try-catch to prevent crashes if auth context fails
  let role, authLoading, authError, user;
  try {
    const auth = useAuth();
    role = auth.role;
    authLoading = auth.loading;
    user = auth.user;
  } catch (error) {
    console.error("[ROSTER] Error accessing auth context:", error);
    authError = error;
    role = "surveyor"; // Default to most restrictive role
    authLoading = false; // Don't wait for auth if it fails
  }
  
  // Show loading state while auth is loading (with timeout)
  useEffect(() => {
    if (authLoading) {
      const timeout = setTimeout(() => {
        console.warn("[ROSTER] Auth loading timeout - proceeding anyway");
        setAuthTimeout(true);
      }, 5000); // 5 second timeout
      return () => clearTimeout(timeout);
    } else {
      setAuthTimeout(false); // Reset timeout when auth finishes
    }
  }, [authLoading]);
  
  const isSurveyor = role === "surveyor";
  
  // Show loading state while auth is loading (with timeout)
  // After timeout, proceed anyway to prevent infinite loading
  if (authLoading && !authTimeout) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#ffffff" }}>
        <ActivityIndicator size="large" color="#fbbf24" />
        <Text style={{ marginTop: 12, fontSize: 14, color: "#666666" }}>
          Loading...
        </Text>
        {Platform.OS === "web" && (
          <Pressable
            onPress={() => {
              window.location.reload();
            }}
            style={{
              marginTop: 20,
              backgroundColor: "#fbbf24",
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: "#000000", fontWeight: "600", fontSize: 14 }}>
              Refresh Page
            </Text>
          </Pressable>
        )}
      </View>
    );
  }
  
  // Show error state if auth completely failed
  if (authError) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#ffffff", padding: 20 }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: "#dc2626", marginBottom: 12, textAlign: "center" }}>
          Authentication Error
        </Text>
        <Text style={{ fontSize: 14, color: "#666666", marginBottom: 20, textAlign: "center" }}>
          {authError.message || "Unable to load authentication. Please refresh the page."}
        </Text>
        {Platform.OS === "web" && (
          <Pressable
            onPress={() => {
              window.location.reload();
            }}
            style={{
              backgroundColor: "#fbbf24",
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderRadius: 8,
            }}
          >
            <Text style={{ color: "#000000", fontWeight: "600", fontSize: 14 }}>
              Refresh Page
            </Text>
          </Pressable>
        )}
      </View>
    );
  }
  const [viewMode, setViewMode] = useState(Platform.OS === "web" ? "FORTNIGHT" : "MONTH"); // FORTNIGHT | MONTH
  const [area, setArea] = useState("SOUTH"); // SOUTH | NORTH (internal app values)
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [surveyors, setSurveyors] = useState([]);
  const [weekendHistory, setWeekendHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [areaLoading, setAreaLoading] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterLoadError, setRosterLoadError] = useState(null);
  const loadAbortControllerRef = useRef(null);

  // { "YYYY-MM-DD": [ {id, surveyorId, shift, breakMins, confirmed} ] }
  const [byDate, setByDate] = useState({});
  const [initialByDate, setInitialByDate] = useState({}); // Track initial state for change detection
  const [currentRosterId, setCurrentRosterId] = useState(null); // Store the current roster ID
  const [rosterStartDate, setRosterStartDate] = useState(null); // Store the roster's actual start date for validation
  const [currentRosterStatus, setCurrentRosterStatus] = useState(null); // Track current roster status: "draft", "confirmed", "published"
  const isDeletingRef = useRef(false); // Flag to prevent loading during deletion
  const [edit, setEdit] = useState(null); // { dateKey, assignment }
  
  // Find the logged-in surveyor's ID by matching email (must be after surveyors state declaration)
  const currentUserSurveyorId = useMemo(() => {
    if (!user?.email || !surveyors || !Array.isArray(surveyors) || surveyors.length === 0) return null;
    const matchingSurveyor = surveyors.find(s => s.email && s.email.toLowerCase() === user.email.toLowerCase());
    return matchingSurveyor?.id || null;
  }, [user?.email, surveyors]);
  const [validationIssues, setValidationIssues] = useState([]);
  const [ignoredIssues, setIgnoredIssues] = useState(new Set()); // Track ignored validation issues
  const [showValidationIssues, setShowValidationIssues] = useState(true); // Show/hide validation panel
  const [webAssignMode, setWebAssignMode] = useState(null); // { dateKey } for web tap-to-assign
  const [mobileAssignMode, setMobileAssignMode] = useState(null); // { dateKey } for mobile tap-to-assign
  const [shiftSelectMode, setShiftSelectMode] = useState(null); // { dateKey, surveyorId } for shift selection after drop
  const [otherAreaAssignments, setOtherAreaAssignments] = useState({}); // { dateKey: { surveyorId: { area, shift } } } - tracks assignments in other area
  const [loadingOtherArea, setLoadingOtherArea] = useState(false); // Loading state for other area assignments
  const [autoPopulateConfirm, setAutoPopulateConfirm] = useState(false); // Show confirmation modal
  const [autoPopulating, setAutoPopulating] = useState(false); // Loading state
  const [rosterManagementModal, setRosterManagementModal] = useState(false); // Show roster management modal
  const [savedRosters, setSavedRosters] = useState([]); // List of saved rosters
  const [rosterListKey, setRosterListKey] = useState(0); // Key to force re-render of roster list
  const [rosterExistsForFortnight, setRosterExistsForFortnight] = useState(false); // Track if roster exists for current fortnight
  const [confirmRosterModal, setConfirmRosterModal] = useState(false); // Show confirmation modal before saving
  const [confirmingRoster, setConfirmingRoster] = useState(false); // Loading state for confirming roster
  const [unsavedChangesModal, setUnsavedChangesModal] = useState(false); // Show unsaved changes modal when switching areas
  const [pendingAreaSwitch, setPendingAreaSwitch] = useState(null); // Store the area the user wants to switch to
  const [showLeftArrow, setShowLeftArrow] = useState(false); // Show left arrow for surveyor navigation
  const [showRightArrow, setShowRightArrow] = useState(false); // Show right arrow for surveyor navigation
  const surveyorScrollRef = useRef(null); // Ref for surveyor horizontal scroll
  const [unavailabilityModal, setUnavailabilityModal] = useState(null); // { surveyorName, date } for unavailability modal
  const [crossAreaConflictModal, setCrossAreaConflictModal] = useState(null); // { surveyorName, otherAreaName, date } for cross-area conflict modal
  const { hasUnsavedChanges: contextHasUnsavedChanges, setHasUnsavedChanges } = useUnsavedChanges();

  useEffect(() => {
    console.log("[ROSTER] Component mounted, loading data...");
    
    // Add timeout to prevent infinite loading
    const loadTimeout = setTimeout(() => {
      if (loading) {
        console.warn("[ROSTER] LoadData timeout - forcing completion");
        setLoading(false);
        Alert.alert(
          "Loading Timeout",
          "The page is taking longer than expected to load. Some data may not be available. Please try refreshing.",
          [{ text: "OK" }]
        );
      }
    }, 15000); // 15 second timeout
    
    loadData()
      .catch((error) => {
        console.error("[ROSTER] Error loading data:", error);
        setLoading(false);
        // Show error to user
        Alert.alert(
          "Error Loading Data",
          error.message || "Failed to load roster data. Please check your connection and try again.",
          [{ text: "OK" }]
        );
      })
      .finally(() => {
        clearTimeout(loadTimeout);
      });
    
    return () => {
      clearTimeout(loadTimeout);
    };
  }, []);

  // Check initial scroll state for surveyor strip
  useEffect(() => {
    const checkScrollability = () => {
      if (surveyorScrollRef.current && surveyors.filter((s) => s.active).length > 0) {
        if (Platform.OS === "web") {
          // On web, access the underlying DOM element
          const element = surveyorScrollRef.current;
          if (element) {
            // React Native Web ref structure
            let domElement = null;
            if (element._component) {
              domElement = element._component.getNode ? element._component.getNode() : element._component;
            } else if (element.getNode) {
              domElement = element.getNode();
            } else if (element.scrollWidth !== undefined) {
              domElement = element;
            }
            
            if (domElement) {
              const scrollWidth = domElement.scrollWidth || 0;
              const clientWidth = domElement.clientWidth || 0;
              const scrollLeft = domElement.scrollLeft || 0;
              
              // Only show arrows if content is actually scrollable
              const needsScrolling = scrollWidth > clientWidth + 5; // Add small buffer
              if (needsScrolling) {
                setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
                setShowLeftArrow(scrollLeft > 10);
              } else {
                setShowRightArrow(false);
                setShowLeftArrow(false);
              }
            }
          }
        }
      }
    };
    
    // Check multiple times to ensure layout is complete
    checkScrollability();
    const timeout1 = setTimeout(checkScrollability, 100);
    const timeout2 = setTimeout(checkScrollability, 500);
    
    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
    };
  }, [surveyors]);

  // Load roster when anchor date or view mode changes
  useEffect(() => {
    // Only load if:
    // 1. Initial data loading is complete
    // 2. Area is set
    // 3. Auth has finished loading (role may be null, but that's ok - it means not undefined)
    // Note: We proceed even if role is null (user not linked to surveyor) to allow page to render
    if (!loading && !authLoading && area) {
      loadRosterForFortnight().catch((error) => {
        console.error("[ROSTER] Error loading roster:", error);
        setRosterLoadError(error.message || "Failed to load roster");
      });
    }
    // Cleanup: abort any in-flight requests when dependencies change
    return () => {
      if (loadAbortControllerRef.current) {
        loadAbortControllerRef.current.abort();
        loadAbortControllerRef.current = null;
      }
    };
  }, [anchorDate, loading, authLoading, surveyors.length, viewMode, role, area]);

  // Load roster when area changes (with loading indicator)
  useEffect(() => {
    // Only load if auth has finished loading and initial load is complete
    // Note: We proceed even if role is null to allow page to render
    if (!loading && !authLoading && area) {
      setAreaLoading(true);
      loadRosterForFortnight()
        .catch((error) => {
          console.error("[ROSTER] Error loading roster for area:", error);
          setRosterLoadError(error.message || "Failed to load roster");
        })
        .finally(() => {
        setAreaLoading(false);
      });
    }
    // Cleanup: abort any in-flight requests when area changes
    return () => {
      if (loadAbortControllerRef.current) {
        loadAbortControllerRef.current.abort();
        loadAbortControllerRef.current = null;
      }
    };
  }, [area, loading, authLoading]);


  // Re-validate when roster changes
  // Only validate if there are assignments (roster exists)
  useEffect(() => {
    const hasAssignments = Object.keys(byDate).some(dateKey => 
      byDate[dateKey] && byDate[dateKey].length > 0
    );
    
    if (surveyors.length > 0 && hasAssignments) {
      // Determine the actual date range for validation
      // Use roster's startDate if available, otherwise calculate from assignments or use anchorDate
      let validationStartDate = anchorDate;
      if (rosterStartDate) {
        // Use the roster's actual start date - ensure it's the Monday of that week
        validationStartDate = startOfWeek(rosterStartDate, { weekStartsOn: 1 });
        console.log(`[VALIDATION] Using roster's startDate: ${format(rosterStartDate, "yyyy-MM-dd")} (Monday: ${format(validationStartDate, "yyyy-MM-dd")}) instead of anchorDate: ${format(anchorDate, "yyyy-MM-dd")}`);
      } else {
        // Calculate from assignments - find the earliest date key
        const dateKeys = Object.keys(byDate).filter(key => 
          byDate[key] && byDate[key].length > 0
        );
        if (dateKeys.length > 0) {
          const sortedKeys = dateKeys.sort();
          const earliestDate = parseISO(sortedKeys[0]);
          // Ensure we use the Monday of that week
          validationStartDate = startOfWeek(earliestDate, { weekStartsOn: 1 });
          console.log(`[VALIDATION] Calculated startDate from assignments: ${sortedKeys[0]} (Monday: ${format(validationStartDate, "yyyy-MM-dd")})`);
        } else {
          // Fallback: use Monday of anchorDate week
          validationStartDate = startOfWeek(anchorDate, { weekStartsOn: 1 });
          console.log(`[VALIDATION] No assignments found, using Monday of anchorDate week: ${format(validationStartDate, "yyyy-MM-dd")}`);
        }
      }
      
      // Load demand for validation
      loadDemand(area).then(async demandData => {
        // Load rosters from both areas to count shifts across areas
        const otherArea = area === "SOUTH" ? "NORTH" : "SOUTH";
        let otherAreaByDate = {};
        
        try {
          // Use the validation start date for loading other area roster
          const otherAreaRoster = await loadRosterForDate(validationStartDate, otherArea, role || "surveyor");
          if (otherAreaRoster && otherAreaRoster.assignmentsByDate) {
            otherAreaByDate = otherAreaRoster.assignmentsByDate;
            console.log(`[VALIDATION] Loaded ${Object.keys(otherAreaByDate).length} days from ${otherArea === "SOUTH" ? "STSP" : "NTNP"} roster for cross-area shift counting`);
          }
        } catch (error) {
          console.warn(`[VALIDATION] Could not load ${otherArea === "SOUTH" ? "STSP" : "NTNP"} roster for cross-area validation:`, error);
        }
        
        // Validate with all surveyors (not just active) to check area preferences correctly
        // Area preference validation needs to check all surveyors to catch mismatches
        // Use the roster's actual start date for validation, not the current anchorDate
        const issues = validateRoster({
          surveyors: surveyors, // Include all surveyors for area preference validation
          byDate,
          anchorDate: validationStartDate, // Use roster's start date instead of current anchorDate
          area: area, // Pass area to validation so it can check area preferences (SOUTH for STSP, NORTH for NTNP)
          fortnightDays: 14,
          weekendHistoryDays: 21,
          weekendHistory,
          otherAreaByDate: otherAreaByDate, // Pass other area assignments for cross-area shift counting
          demand: demandData?.demand || {}, // Pass demand for demand matching validation
          demandTemplate: demandData?.template || null, // Pass template to use when specific demand is missing
        });
        setValidationIssues(issues);
        // Clear ignored issues when validation issues change
        setIgnoredIssues(new Set());
      }).catch(async err => {
        console.error("Error loading demand for validation:", err);
        
        // Determine the actual date range for validation
        let validationStartDate = anchorDate;
        if (rosterStartDate) {
          // Use the roster's actual start date - ensure it's the Monday of that week
          validationStartDate = startOfWeek(rosterStartDate, { weekStartsOn: 1 });
          console.log(`[VALIDATION ERROR HANDLER] Using roster's startDate: ${format(rosterStartDate, "yyyy-MM-dd")} (Monday: ${format(validationStartDate, "yyyy-MM-dd")})`);
        } else {
          // Calculate from assignments
          const dateKeys = Object.keys(byDate).filter(key => 
            byDate[key] && byDate[key].length > 0
          );
          if (dateKeys.length > 0) {
            const sortedKeys = dateKeys.sort();
            const earliestDate = parseISO(sortedKeys[0]);
            // Ensure we use the Monday of that week
            validationStartDate = startOfWeek(earliestDate, { weekStartsOn: 1 });
            console.log(`[VALIDATION ERROR HANDLER] Calculated startDate from assignments: ${sortedKeys[0]} (Monday: ${format(validationStartDate, "yyyy-MM-dd")})`);
          } else {
            // Fallback: use Monday of anchorDate week
            validationStartDate = startOfWeek(anchorDate, { weekStartsOn: 1 });
          }
        }
        
        // Still load other area roster for cross-area shift counting
        const otherArea = area === "SOUTH" ? "NORTH" : "SOUTH";
        let otherAreaByDate = {};
        
        try {
          const otherAreaRoster = await loadRosterForDate(validationStartDate, otherArea, role || "surveyor");
          if (otherAreaRoster && otherAreaRoster.assignmentsByDate) {
            otherAreaByDate = otherAreaRoster.assignmentsByDate;
          }
        } catch (error) {
          console.warn(`[VALIDATION] Could not load ${otherArea === "SOUTH" ? "STSP" : "NTNP"} roster:`, error);
        }
        
        // Still validate without demand - use roster's start date
        const issues = validateRoster({
          surveyors: surveyors,
          byDate,
          anchorDate: validationStartDate, // Use roster's start date instead of current anchorDate
          area: area,
          fortnightDays: 14,
          weekendHistoryDays: 21,
          weekendHistory,
          otherAreaByDate: otherAreaByDate,
          demand: {},
        });
        setValidationIssues(issues);
        // Clear ignored issues when validation issues change
        setIgnoredIssues(new Set());
      });
    } else {
      // Clear validation issues if no roster exists
      setValidationIssues([]);
      // Clear ignored issues when validation issues are cleared
      setIgnoredIssues(new Set());
    }
  }, [byDate, anchorDate, surveyors, weekendHistory, area, rosterStartDate]);

  async function loadData() {
    try {
      console.log("[ROSTER] Starting loadData...");
      setLoading(true);
      
      // Add individual timeouts for each operation to prevent hanging
      const surveyorsTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Surveyors load timeout")), 10000)
      );
      
      console.log("[ROSTER] Loading surveyors...");
      let loadedSurveyors;
      try {
        loadedSurveyors = await Promise.race([
          loadSurveyors(),
          surveyorsTimeout,
        ]);
      } catch (surveyorError) {
        console.error("[ROSTER] Error loading surveyors:", surveyorError);
        loadedSurveyors = []; // Fallback to empty array
      }
      
      if (loadedSurveyors && loadedSurveyors.length > 0) {
        console.log(`[ROSTER] ✅ Loaded ${loadedSurveyors.length} surveyors from database`);
        setSurveyors(loadedSurveyors);
      } else {
        console.warn("[ROSTER] ⚠️ No surveyors found in database. Check:");
        console.warn("  1. Are surveyors inserted in Supabase Table Editor?");
        console.warn("  2. Are Row Level Security (RLS) policies configured?");
        console.warn("  3. Is user authenticated?");
        setSurveyors([]);
      }
      
      // Load weekend history with timeout
      const historyTimeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Weekend history load timeout")), 5000)
      );
      
      console.log("[ROSTER] Loading weekend history...");
      try {
        const history = await Promise.race([
          loadWeekendHistory(),
          historyTimeout,
        ]);
        setWeekendHistory(history || {});
      } catch (historyError) {
        console.error("[ROSTER] Error loading weekend history:", historyError);
        setWeekendHistory({}); // Fallback to empty object
      }
      
      // Don't load roster here - let the useEffect handle it after role is loaded
      // This prevents race conditions and ensures role is available
      console.log("[ROSTER] loadData completed (roster will load after role is available)");
    } catch (error) {
      console.error("[ROSTER] ❌ Error loading data:", error);
      console.error("[ROSTER] Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
      setSurveyors([]);
      setWeekendHistory({});
      setRosterLoadError("Failed to initialize roster data. Please refresh the page.");
    } finally {
      console.log("[ROSTER] loadData completed");
      setLoading(false);
    }
  }

  async function loadRosterForFortnight() {
    // Don't load if we're in the middle of a deletion
    if (isDeletingRef.current) {
      console.log(`[LOAD ROSTER] Skipping load - deletion in progress`);
      return;
    }
    
    // Cancel any previous load request
    if (loadAbortControllerRef.current) {
      loadAbortControllerRef.current.abort();
    }
    
    // Create new abort controller for this request
    const abortController = new AbortController();
    loadAbortControllerRef.current = abortController;
    
    try {
      setRosterLoading(true);
      setRosterLoadError(null);
      
      // Determine the date range to load based on view mode
      let daysToLoad = [];
      if (viewMode === "MONTH") {
        // For month view, load all days in the month
        const start = startOfMonth(anchorDate);
        const end = endOfMonth(anchorDate);
        daysToLoad = eachDayOfInterval({ start, end });
        console.log(`[LOAD ROSTER] Month view: Loading ${daysToLoad.length} days from ${format(start, "yyyy-MM-dd")} to ${format(end, "yyyy-MM-dd")}`);
      } else {
        // For fortnight view, load the 14 days starting from Monday
        const ws = startOfWeek(anchorDate, { weekStartsOn: 1 });
        daysToLoad = Array.from({ length: 14 }, (_, i) => addDays(ws, i));
        console.log(`[LOAD ROSTER] Fortnight view: Loading 14 days from ${format(ws, "yyyy-MM-dd")}`);
      }
      
      // Create a timeout mechanism (60 seconds for month view, 30 for fortnight)
      const timeoutDuration = viewMode === "MONTH" ? 60000 : 30000;
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          if (!abortController.signal.aborted) {
            reject(new Error("Roster load timeout - request took too long. Please try again."));
          }
        }, timeoutDuration);
      });
      
      // Load rosters for all days in parallel (similar to surveyor-view.js)
      // Pass role to filter out draft rosters for surveyors (use "surveyor" as default if role is null/undefined)
      const effectiveRole = role || "surveyor"; // Default to surveyor if role not loaded yet
      const rosterPromises = daysToLoad.map(day => loadRosterForDate(day, area, effectiveRole));
      
      // Race between loading all rosters and timeout
      let rosterResults;
      try {
        rosterResults = await Promise.race([
          Promise.all(rosterPromises),
          timeoutPromise,
        ]);
        // Clear timeout if request completed successfully
        if (timeoutId) clearTimeout(timeoutId);
      } catch (raceError) {
        // Clear timeout if request failed
        if (timeoutId) clearTimeout(timeoutId);
        throw raceError;
      }
      
      // Check if request was aborted
      if (abortController.signal.aborted) {
        console.log(`[LOAD ROSTER] Request aborted`);
        return;
      }
      
      // Merge all rosters into a single assignmentsByDate object
      const mergedAssignments = {};
      let foundRoster = false;
      let latestRosterId = null;
      let latestRosterStartDate = null;
      const processedRosterIds = new Set(); // Track which rosters we've already processed
      const assignmentKeys = new Set(); // Track unique assignments by composite key: dateKey|surveyorId|shift
      
      // Process all roster results and merge assignments
      for (let i = 0; i < rosterResults.length; i++) {
        const roster = rosterResults[i];
      if (roster && roster.assignmentsByDate && Object.keys(roster.assignmentsByDate).length > 0) {
          // Skip if we've already processed this roster (same roster returned for multiple days)
          if (processedRosterIds.has(roster.id)) {
            console.log(`[LOAD ROSTER] Skipping roster ${roster.id} - already processed`);
            continue;
          }
          
          // Verify the roster's area matches the current area
        const rosterAreaFromDb = roster.area || "SOUTH";
        if (rosterAreaFromDb !== area) {
            console.log(`[LOAD ROSTER] Skipping roster ${roster.id} - area mismatch: ${rosterAreaFromDb} !== ${area}`);
            continue;
          }
          
          // Mark this roster as processed
          processedRosterIds.add(roster.id);
          
          foundRoster = true;
          // Track the latest roster ID and start date (for saving updates)
          if (!latestRosterId || (roster.startDate && (!latestRosterStartDate || parseISO(roster.startDate) > latestRosterStartDate))) {
            latestRosterId = roster.id;
            if (roster.startDate) {
              latestRosterStartDate = parseISO(roster.startDate);
            }
          }
          
          // Merge assignments from this roster
          Object.keys(roster.assignmentsByDate).forEach((dateKey) => {
            if (!mergedAssignments[dateKey]) {
              mergedAssignments[dateKey] = [];
            }
            // Add assignments, avoiding duplicates using composite key
            roster.assignmentsByDate[dateKey].forEach((assignment) => {
              // Create a unique key for this assignment: dateKey|surveyorId|shift
              // This ensures we don't add the same assignment twice even if it comes from different rosters
              const assignmentKey = `${dateKey}|${assignment.surveyorId}|${assignment.shift}`;
              
              if (!assignmentKeys.has(assignmentKey)) {
                assignmentKeys.add(assignmentKey);
                mergedAssignments[dateKey].push(assignment);
              } else {
                console.log(`[LOAD ROSTER] Skipping duplicate assignment: ${assignment.surveyorId} on ${dateKey} for ${assignment.shift} shift (key: ${assignmentKey})`);
              }
            });
          });
        }
      }
      
      // Find the latest roster to get its status
      let latestRosterStatus = null;
      if (foundRoster && latestRosterId) {
        const latestRosterResult = rosterResults.find(r => r && r.id === latestRosterId);
        if (latestRosterResult && latestRosterResult.status) {
          latestRosterStatus = latestRosterResult.status;
          console.log(`[ROSTER] Loaded roster ${latestRosterId} with status: ${latestRosterStatus}`);
        }
      }
      
      if (foundRoster && Object.keys(mergedAssignments).length > 0) {
        console.log(`Loaded and merged rosters for ${viewMode === "MONTH" ? "month" : "fortnight"}`);
        console.log(`Found ${Object.keys(mergedAssignments).length} days with assignments`);
        setByDate(mergedAssignments);
        // Store initial state for change tracking (deep copy)
        setInitialByDate(JSON.parse(JSON.stringify(mergedAssignments)));
        // Store the latest roster ID so we can update it later (or create new if needed)
        setCurrentRosterId(latestRosterId);
        // Store the roster status
        setCurrentRosterStatus(latestRosterStatus || "draft");
        // Mark that a roster exists for this period
        setRosterExistsForFortnight(true);
        // Store the roster's actual start date for validation
        if (latestRosterStartDate) {
          setRosterStartDate(latestRosterStartDate);
          console.log(`[ROSTER] Using roster's startDate for validation: ${format(latestRosterStartDate, "yyyy-MM-dd")}`);
        } else {
          // Calculate from assignments - find the earliest date key
          const dateKeys = Object.keys(mergedAssignments).filter(key => 
            mergedAssignments[key] && mergedAssignments[key].length > 0
          );
          if (dateKeys.length > 0) {
            const sortedKeys = dateKeys.sort();
            const actualStartDate = parseISO(sortedKeys[0]);
            setRosterStartDate(actualStartDate);
            console.log(`[ROSTER] Calculated startDate from assignments: ${sortedKeys[0]}`);
          } else {
            // Fallback to first day of period
            const firstDay = daysToLoad[0];
            setRosterStartDate(firstDay);
          }
        }
      } else {
        const searchDate = viewMode === "MONTH" ? startOfMonth(anchorDate) : startOfWeek(anchorDate, { weekStartsOn: 1 });
        console.log(`No roster found for ${viewMode === "MONTH" ? "month" : "fortnight"} starting ${format(searchDate, "yyyy-MM-dd")}`);
        // Mark that no roster exists for this fortnight
        setRosterExistsForFortnight(false);
        // Only clear if we're loading for the first time (no existing assignments)
        // This prevents clearing user's unsaved changes when navigating fortnights
        const newByDate = (() => {
          const prev = byDate;
          if (Object.keys(prev).length === 0) {
            return {};
          }
          return prev;
        })();
        setByDate(newByDate);
        // Store initial state (empty or current) - deep copy
        setInitialByDate(JSON.parse(JSON.stringify(newByDate)));
        // Clear roster ID if no roster found
        setCurrentRosterId(null);
        // Clear roster status
        setCurrentRosterStatus(null);
        // Clear roster start date
        setRosterStartDate(null);
        // Clear roster status
        setCurrentRosterStatus(null);
      }
    } catch (error) {
      // Check if request was aborted
      if (abortController.signal.aborted) {
        console.log(`[LOAD ROSTER] Request aborted`);
        return;
      }
      
      console.error("Error loading roster for fortnight:", error);
      setRosterLoadError(error.message || "Failed to load roster. Please try refreshing the page.");
      
      // Don't clear existing assignments on error, but show error to user
      if (Platform.OS === "web") {
        // On web, show error in console and set error state (could show banner)
        console.error("[ROSTER LOAD ERROR]", error);
      }
    } finally {
      // Only clear loading state if this request wasn't aborted
      if (!abortController.signal.aborted) {
        setRosterLoading(false);
        loadAbortControllerRef.current = null;
      }
    }
  }

  const fortnightDays = useMemo(() => {
    const ws = startOfWeek(anchorDate, { weekStartsOn: 1 }); // Monday
    return Array.from({ length: 14 }, (_, i) => addDays(ws, i));
  }, [anchorDate]);

  const monthDays = useMemo(() => {
    const start = startOfMonth(anchorDate);
    const end = endOfMonth(anchorDate);
    return eachDayOfInterval({ start, end });
  }, [anchorDate]);

  // Load assignments from the other area for a specific date
  // Returns the loaded assignments map for the dateKey (to avoid race conditions with state updates)
  async function loadOtherAreaAssignments(dateKey) {
    try {
      setLoadingOtherArea(true);
      const otherArea = area === "SOUTH" ? "NORTH" : "SOUTH";
      const dateObj = parseISO(dateKey);
      const otherAreaRoster = await loadRosterForDate(dateObj, otherArea, role || "surveyor");
      
      let otherAreaMap = {};
      if (otherAreaRoster && otherAreaRoster.assignmentsByDate && otherAreaRoster.assignmentsByDate[dateKey]) {
        const assignments = otherAreaRoster.assignmentsByDate[dateKey];
        assignments.forEach(a => {
          if (a.shift === "DAY" || a.shift === "NIGHT") {
            otherAreaMap[a.surveyorId] = {
              area: otherArea === "SOUTH" ? "STSP" : "NTNP",
              shift: a.shift,
            };
          }
        });
      }
      
      // Update state (async, but we return the data directly to avoid race conditions)
      setOtherAreaAssignments(prev => ({
        ...prev,
        [dateKey]: otherAreaMap,
      }));
      
      // Return the loaded data directly to avoid race condition with state updates
      return otherAreaMap;
    } catch (error) {
      console.warn(`[CROSS-AREA] Could not load ${area === "SOUTH" ? "NTNP" : "STSP"} roster for date ${dateKey}:`, error);
      const emptyMap = {};
      setOtherAreaAssignments(prev => ({
        ...prev,
        [dateKey]: emptyMap,
      }));
      // Return empty map on error
      return emptyMap;
    } finally {
      setLoadingOtherArea(false);
    }
  }

  async function checkForConflictingAssignment(surveyor, dateKey, currentArea) {
    // If surveyor has area preference and we're assigning them to a different area,
    // check if they already have a shift in their preferred area on this date
    if (!surveyor.areaPreference || surveyor.areaPreference === currentArea) {
      return null; // No conflict possible
    }

    const preferredArea = surveyor.areaPreference;
    const preferredAreaName = preferredArea === "SOUTH" ? "STSP" : "NTNP";
    
    try {
      // Load roster from the preferred area for this date
      const dateObj = parseISO(dateKey);
      const roster = await loadRosterForDate(dateObj, preferredArea, role || "surveyor");
      
      if (roster && roster.assignmentsByDate && roster.assignmentsByDate[dateKey]) {
        const assignments = roster.assignmentsByDate[dateKey];
        const hasShift = assignments.some(a => 
          a.surveyorId === surveyor.id && (a.shift === "DAY" || a.shift === "NIGHT")
        );
        
        if (hasShift) {
          return {
            hasConflict: true,
            area: preferredAreaName,
            date: format(dateObj, "d MMM yyyy")
          };
        }
      }
    } catch (error) {
      console.error(`[CONFLICT CHECK] Error checking for conflicts:`, error);
      // Don't block assignment if we can't check - allow it to proceed
    }
    
    return null; // No conflict found
  }

  async function addAssignment(dateKey, surveyorId, shift = null) {
    // Prevent surveyors from adding assignments
    if (isSurveyor) {
      return;
    }
    // Prevent adding assignments to past dates
    const assignmentDate = parseISO(dateKey);
    const today = startOfDay(new Date());
    const assignmentDateStart = startOfDay(assignmentDate);
    
    if (isPast(assignmentDateStart) && !isSameDay(assignmentDate, today)) {
      Alert.alert("Cannot Assign", "You cannot assign shifts to past dates.");
      return;
    }
    
    // Check if surveyor is already assigned in the other area
    // Load other area assignments if not already loaded
    // Use the returned value directly to avoid race condition with state updates
    let loadedAssignments = otherAreaAssignments[dateKey];
    if (!loadedAssignments) {
      loadedAssignments = await loadOtherAreaAssignments(dateKey);
    }
    
    const otherAreaAssignment = loadedAssignments?.[surveyorId];
    if (otherAreaAssignment) {
      const otherAreaName = otherAreaAssignment.area;
      const surveyor = surveyors.find(s => s.id === surveyorId);
      const assignmentDate = parseISO(dateKey);
      setCrossAreaConflictModal({
        surveyorName: surveyor?.name || "This surveyor",
        otherAreaName: otherAreaName,
        date: format(assignmentDate, "d MMM yyyy"),
      });
      return;
    }
    
    // Allow manual assignment regardless of area preference
    // Area preference is only enforced in auto-populate, not manual assignments
    const surveyor = surveyors.find((s) => s.id === surveyorId);
    
    // Check if surveyor is unavailable on this date
    if (surveyor) {
      const nonAvailability = surveyor.nonAvailability || [];
      if (nonAvailability.includes(dateKey)) {
        setUnavailabilityModal({
          surveyorName: surveyor.name,
          date: format(assignmentDate, "d MMM yyyy"),
        });
        return;
      }
    }
    const areaName = area === "SOUTH" ? "STSP" : "NTNP";

    if (surveyor) {
      const surveyorAreaName = surveyor.areaPreference ? (surveyor.areaPreference === "SOUTH" ? "STSP" : "NTNP") : "No preference";
      
      // Check for conflicting assignment in preferred area
      const conflict = await checkForConflictingAssignment(surveyor, dateKey, area);
      if (conflict && conflict.hasConflict) {
        Alert.alert(
          "Conflicting Assignment",
          `${surveyor.name} is already assigned to work in ${conflict.area} on ${conflict.date}. They cannot work in both areas on the same day.`
        );
        return; // Block the assignment
      }
      
      if (surveyor.areaPreference && surveyor.areaPreference !== area) {
        console.log(`[MANUAL ASSIGNMENT] Manual override: ${surveyor.name} (${surveyorAreaName}) manually assigned to ${areaName} roster on ${dateKey}`);
      } else {
        console.log(`[MANUAL ASSIGNMENT] ${surveyor.name} (${surveyorAreaName}) assigned to ${areaName} roster on ${dateKey}`);
      }
    } else {
      console.warn(`[MANUAL ASSIGNMENT] Surveyor ${surveyorId} not found in surveyors list`);
    }

    const check = canAssign({ byDate, dateKey, surveyorId });
    if (!check.ok) {
      Alert.alert("Cannot Assign", check.message);
      return;
    }

    // If shift is not provided, show shift selection modal
    if (shift === null) {
      setShiftSelectMode({ dateKey, surveyorId });
      return;
    }

    const newA = {
      id: `${dateKey}_${surveyorId}_${Math.random().toString(16).slice(2)}`,
      surveyorId,
      shift: shift || SHIFT.DAY,
      breakMins: 30,
      confirmed: false,
    };

    setByDate((prev) => {
      const list = prev[dateKey] ? [...prev[dateKey]] : [];
      list.push(newA);
      const updatedByDate = { ...prev, [dateKey]: list };
      
      // Auto-save to database
      setTimeout(() => {
        const roster = {
          id: `roster_${format(anchorDate, "yyyy-MM-dd")}`,
          startDate: format(startOfWeek(anchorDate, { weekStartsOn: 1 }), "yyyy-MM-dd"),
          endDate: format(addDays(startOfWeek(anchorDate, { weekStartsOn: 1 }), 13), "yyyy-MM-dd"),
          area: area,
          assignmentsByDate: updatedByDate,
          createdAt: new Date().toISOString(),
        };
        saveRoster(roster).catch(err => console.error("Auto-save error:", err));
      }, 100);
      
      return updatedByDate;
    });

    // Don't open edit modal after assignment - user already selected shift from SELECT SHIFT modal
    // Edit modal should only open when user explicitly clicks/taps on an existing assignment
  }

  function handleShiftSelect(shift) {
    if (!shiftSelectMode) return;
    const { dateKey, surveyorId } = shiftSelectMode;
    setShiftSelectMode(null);
    addAssignment(dateKey, surveyorId, shift);
  }

  function updateAssignment(dateKey, assignmentId, patch) {
    // If shift is set to OFF, remove the assignment entirely
    if (patch.shift === SHIFT.OFF) {
      setByDate((prev) => {
        const list = prev[dateKey] ? [...prev[dateKey]] : [];
        const filtered = list.filter((a) => a.id !== assignmentId);
        const updatedByDate = { ...prev, [dateKey]: filtered };
        
        // Auto-save to database after state update
        setTimeout(() => {
          const roster = {
            id: `roster_${format(anchorDate, "yyyy-MM-dd")}`,
            startDate: format(startOfWeek(anchorDate, { weekStartsOn: 1 }), "yyyy-MM-dd"),
            endDate: format(addDays(startOfWeek(anchorDate, { weekStartsOn: 1 }), 13), "yyyy-MM-dd"),
            area: area,
            assignmentsByDate: updatedByDate,
            createdAt: new Date().toISOString(),
          };
          saveRoster(roster).catch(err => console.error("Auto-save error:", err));
        }, 100);
        
        return updatedByDate;
      });
      return; // Exit early - assignment removed
    }
    
    // Allow manual assignment updates regardless of area preference
    // Area preference is only enforced in auto-populate, not manual assignments
    if (patch.surveyorId) {
      const surveyor = surveyors.find((s) => s.id === patch.surveyorId);
      const areaName = area === "SOUTH" ? "STSP" : "NTNP";

      if (surveyor) {
        const surveyorAreaName = surveyor.areaPreference ? (surveyor.areaPreference === "SOUTH" ? "STSP" : "NTNP") : "No preference";
        if (surveyor.areaPreference && surveyor.areaPreference !== area) {
          console.log(`[UPDATE ASSIGNMENT] Manual override: ${surveyor.name} (${surveyorAreaName}) manually updated to ${areaName} roster on ${dateKey}`);
        } else {
          console.log(`[UPDATE ASSIGNMENT] ${surveyor.name} (${surveyorAreaName}) updated to ${areaName} roster on ${dateKey}`);
        }
      } else {
        console.warn(`[UPDATE ASSIGNMENT] Surveyor ${patch.surveyorId} not found in surveyors list`);
        Alert.alert("Error", "Surveyor not found");
        return; // Block the update if surveyor not found
      }
    }
    
    setByDate((prev) => {
      const list = prev[dateKey] ? [...prev[dateKey]] : [];
      const idx = list.findIndex((a) => a.id === assignmentId);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...patch };
        // Auto-save to database after state update
        setTimeout(() => {
          const updatedByDate = { ...prev, [dateKey]: list };
          const roster = {
            id: `roster_${format(anchorDate, "yyyy-MM-dd")}`,
            startDate: format(startOfWeek(anchorDate, { weekStartsOn: 1 }), "yyyy-MM-dd"),
            endDate: format(addDays(startOfWeek(anchorDate, { weekStartsOn: 1 }), 13), "yyyy-MM-dd"),
            area: area,
            assignmentsByDate: updatedByDate,
            createdAt: new Date().toISOString(),
          };
          saveRoster(roster).catch(err => console.error("Auto-save error:", err));
        }, 100);
      }
      return { ...prev, [dateKey]: list };
    });
  }

  function getName(id) {
    return surveyors.find((s) => s.id === id)?.name ?? id;
  }

  // Check if roster has been modified
  const hasChanges = useMemo(() => {
    const currentStr = JSON.stringify(byDate);
    const initialStr = JSON.stringify(initialByDate);
    return currentStr !== initialStr;
  }, [byDate, initialByDate]);

  // Update unsaved changes context
  useEffect(() => {
    console.log("Roster hasChanges:", hasChanges);
    setHasUnsavedChanges(hasChanges);
  }, [hasChanges, setHasUnsavedChanges]);

  function handleConfirmRosterClick() {
    setConfirmRosterModal(true);
  }

  function handleDiscardChanges() {
    // Discard changes and switch to pending area
    setByDate({});
    setInitialByDate({});
    setCurrentRosterId(null);
    setCurrentRosterStatus(null);
    setHasUnsavedChanges(false);
    if (pendingAreaSwitch) {
      setArea(pendingAreaSwitch);
    }
    setUnsavedChangesModal(false);
    setPendingAreaSwitch(null);
  }

  function handleCancelAreaSwitch() {
    // Cancel the area switch
    setUnsavedChangesModal(false);
    setPendingAreaSwitch(null);
  }

  async function onConfirmRoster() {
    // Set loading state immediately to prevent multiple clicks
    setConfirmingRoster(true);
    
    try {
      // Save roster (ignoring validation issues for now)
      // Use existing roster ID if available, otherwise generate one
      const rosterId = currentRosterId || `roster_${format(anchorDate, "yyyy-MM-dd")}`;
      // Use roster's start date if available, otherwise calculate from anchorDate
      const rosterStart = rosterStartDate || startOfWeek(anchorDate, { weekStartsOn: 1 });
      const roster = {
        id: rosterId,
        startDate: format(rosterStart, "yyyy-MM-dd"),
        endDate: format(addDays(rosterStart, 13), "yyyy-MM-dd"),
        area: area, // Preserve the current area (SOUTH or NORTH)
        assignmentsByDate: byDate,
        createdAt: new Date().toISOString(),
        status: "confirmed",
      };
      
      // Update rosterStartDate state to match the saved roster
      setRosterStartDate(rosterStart);

      console.log(`Confirming roster with area: ${area} (${area === "SOUTH" ? "STSP" : "NTNP"})`);
      const saveResult = await saveRoster(roster);
      if (saveResult.success) {
        // Update initial state to reflect saved changes
        setInitialByDate(JSON.parse(JSON.stringify(byDate)));

        // Update the roster ID if a new one was created
        if (saveResult.data && saveResult.data.id) {
          setCurrentRosterId(saveResult.data.id);
        }
        
        // Update roster status to confirmed
        setCurrentRosterStatus("confirmed");
        
        // Clear unsaved changes flag
        setHasUnsavedChanges(false);
        setRosterExistsForFortnight(true); // Roster was confirmed, so it exists
        
        // If there was a pending area switch, execute it now
        if (pendingAreaSwitch) {
          setArea(pendingAreaSwitch);
          setByDate({});
          setInitialByDate({});
          setCurrentRosterId(null);
          setCurrentRosterStatus(null);
          setRosterExistsForFortnight(false); // Area switched, need to check new area
          setPendingAreaSwitch(null);
        }
        
        // Update weekend history
        await updateWeekendHistoryFromRoster(byDate, anchorDate);
        const updatedHistory = await loadWeekendHistory();
        setWeekendHistory(updatedHistory);
        
        // Calculate roster statistics for current week only (7 days)
        const weekStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
        const weekDateKeys = Array.from({ length: 7 }, (_, i) => 
          format(addDays(weekStart, i), "yyyy-MM-dd")
        );
        
        // Filter byDate to only include current week dates
        const weekAssignments = {};
        weekDateKeys.forEach(dateKey => {
          if (byDate[dateKey]) {
            weekAssignments[dateKey] = byDate[dateKey];
          }
        });
        
        const totalAssignments = Object.values(weekAssignments).reduce((sum, assignments) => sum + assignments.length, 0);
        const dayShifts = Object.values(weekAssignments).reduce((sum, assignments) => 
          sum + assignments.filter(a => a.shift === SHIFT.DAY).length, 0
        );
        const nightShifts = Object.values(weekAssignments).reduce((sum, assignments) => 
          sum + assignments.filter(a => a.shift === SHIFT.NIGHT).length, 0
        );
        const confirmedCount = Object.values(weekAssignments).reduce((sum, assignments) => 
          sum + assignments.filter(a => a.confirmed).length, 0
        );

        const weekEndDate = addDays(weekStart, 6);

        const visibleIssues = validationIssues.filter((_, idx) => !ignoredIssues.has(idx));
        
        // Close modal before showing success alert
        setConfirmRosterModal(false);
        setConfirmingRoster(false);
        
        Alert.alert(
          "Roster Confirmed & Saved ✅",
          `The roster has been successfully saved to the database.\n\n` +
          `📊 Roster Summary (This Week):\n` +
          `• Total Assignments: ${totalAssignments}\n` +
          `• Day Shifts: ${dayShifts}\n` +
          `• Night Shifts: ${nightShifts}\n` +
          `• Confirmed: ${confirmedCount}\n` +
          `• Period: ${format(weekStart, "d MMM yyyy")} - ${format(weekEndDate, "d MMM yyyy")}\n\n` +
          `${visibleIssues.length > 0 ? `⚠️ Note: ${visibleIssues.length} validation issue(s) detected.` : "✓ All validations passed."}`,
          [{ text: "OK" }]
        );
      } else {
        setConfirmingRoster(false);
        Alert.alert("Error", saveResult.error || "Failed to save roster", [
          { text: "OK" }
        ]);
      }
    } catch (error) {
      console.error("Error confirming roster:", error);
      setConfirmingRoster(false);
      Alert.alert("Error", `An error occurred while saving the roster: ${error.message || "Unknown error"}`, [
        { text: "OK" }
      ]);
    } finally {
      // Ensure confirmingRoster is always reset, even if there was an early return
      // Note: We set it to false in success/error cases above, but this ensures cleanup
      setConfirmingRoster(false);
      // Only close modal if it wasn't already closed in success case
      setConfirmRosterModal(false);
    }
  }

  async function handleAutoPopulate() {
    // Check if demand is set for the current fortnight
    try {
      const fortnightStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
      const fortnightDays = Array.from({ length: 14 }, (_, i) => addDays(fortnightStart, i));
      const dateKeys = fortnightDays.map((d) => format(d, "yyyy-MM-dd"));
      
      const demandData = await loadDemand(area);
      const demand = demandData?.demand || {};
      const template = demandData?.template;
      
      // Check if demand is set for any date in the fortnight
      let hasDemand = false;
      for (const dateKey of dateKeys) {
        if (demand[dateKey] && (demand[dateKey].day > 0 || demand[dateKey].night > 0)) {
          hasDemand = true;
          break;
        }
      }
      
      // Also check if template exists (which can be used as fallback)
      const hasTemplate = template && (template.monFriDay > 0 || template.satDay > 0 || template.night > 0);
      
      if (!hasDemand && !hasTemplate) {
        Alert.alert(
          "Demand Not Set",
          "Please set and save demand for this fortnight before auto-populating the roster.\n\nGo to the 'Demand' tab to set demand requirements.",
          [
            { text: "OK" }
          ]
        );
        return;
      }
      
      setAutoPopulateConfirm(true);
    } catch (error) {
      console.error("Error checking demand:", error);
      Alert.alert("Error", "Failed to check demand settings. Please try again.");
    }
  }

  async function handleManageRosters() {
    try {
      const allRosters = await loadAllRosters();
      // Filter rosters by current area
      const filteredRosters = (allRosters || []).filter((r) => (r.area || "SOUTH") === area);
      setSavedRosters(filteredRosters);
      setRosterManagementModal(true);
    } catch (error) {
      console.error("Error loading rosters:", error);
      Alert.alert("Error", "Failed to load rosters");
    }
  }

  async function handleLoadRoster(rosterId) {
    try {
      const roster = await loadRoster(rosterId);
      if (roster) {
        setByDate(roster.assignmentsByDate || {});
        setInitialByDate(JSON.parse(JSON.stringify(roster.assignmentsByDate || {})));
        // Store the roster ID so we can update it later
        setCurrentRosterId(roster.id);
        // Store the roster status
        setCurrentRosterStatus(roster.status || "draft");
        // Store the roster's actual start date for validation
        if (roster.startDate) {
          const rosterStart = parseISO(roster.startDate);
          setRosterStartDate(rosterStart);
          setAnchorDate(rosterStart);
          console.log(`[ROSTER] Loaded roster with startDate: ${roster.startDate}, using for validation`);
        } else {
          // Calculate from assignments if startDate not available
          const dateKeys = Object.keys(roster.assignmentsByDate || {}).filter(key => 
            roster.assignmentsByDate[key] && roster.assignmentsByDate[key].length > 0
          );
          if (dateKeys.length > 0) {
            const sortedKeys = dateKeys.sort();
            const actualStartDate = parseISO(sortedKeys[0]);
            setRosterStartDate(actualStartDate);
            setAnchorDate(actualStartDate);
            console.log(`[ROSTER] Calculated startDate from assignments: ${sortedKeys[0]}`);
          } else {
            setRosterStartDate(null);
          }
        }
        // Update area if the loaded roster is for a different area
        if (roster.area && roster.area !== area) {
          setArea(roster.area);
        }
        // Refresh the roster list for the current area
        const allRosters = await loadAllRosters();
        const filteredRosters = (allRosters || []).filter((r) => (r.area || "SOUTH") === (roster.area || area));
        setSavedRosters(filteredRosters);
        setRosterManagementModal(false);
        Alert.alert("Success", "Roster loaded successfully! ✅");
      } else {
        Alert.alert("Error", "Failed to load roster");
      }
    } catch (error) {
      console.error("Error loading roster:", error);
      Alert.alert("Error", "An error occurred while loading the roster");
    }
  }

  async function handleDeleteRoster(rosterId) {
    // Get the roster's area before deleting to refresh the correct area's list
    const allRosters = await loadAllRosters();
    const rosterToDelete = allRosters.find((r) => r.id === rosterId);
    const rosterArea = rosterToDelete?.area || area;
    const rosterStartDate = rosterToDelete?.startDate;
    const rosterEndDate = rosterToDelete?.endDate;
    
    console.log(`[DELETE ROSTER] Deleting roster ${rosterId}, area: ${rosterArea}, date range: ${rosterStartDate} to ${rosterEndDate}`);
    console.log(`[DELETE ROSTER] Current view - area: ${area}, currentRosterId: ${currentRosterId}, anchorDate: ${format(anchorDate, "yyyy-MM-dd")}`);
    
    // Check if the deleted roster matches the current view (same area and date range)
    const fortnightStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
    const fortnightStartStr = format(fortnightStart, "yyyy-MM-dd");
    const fortnightEndStr = format(addDays(fortnightStart, 13), "yyyy-MM-dd");
    
    // Check if date ranges overlap (more lenient than exact match)
    const dateOverlaps = rosterStartDate && rosterEndDate && 
                         rosterStartDate <= fortnightEndStr && 
                         rosterEndDate >= fortnightStartStr;
    
    const matchesCurrentView = (rosterArea === area || (!rosterArea && area === "SOUTH")) && dateOverlaps;
    
    const performDelete = async () => {
      try {
        // OPTIMISTIC UPDATE: Immediately remove the deleted roster from the savedRosters list
        // This ensures the UI updates instantly before the database operation completes
        const previousRosters = [...savedRosters]; // Create a copy for rollback
        const filtered = savedRosters.filter((r) => r.id !== rosterId);
        console.log(`[DELETE ROSTER] Optimistic update: ${savedRosters.length} -> ${filtered.length} rosters`);
        setSavedRosters(filtered);
        setRosterListKey((prev) => prev + 1); // Force re-render by changing key
        
        // Perform the actual deletion
        const result = await deleteRosterFromStorage(rosterId);
        if (result.success) {
          // IMMEDIATELY clear the roster from screen if it's in the current area
          // Normalize area comparison - rosterArea should already be in app format (SOUTH/NORTH) from loadAllRosters
          const normalizedRosterArea = rosterArea || "SOUTH";
          const isCurrentRoster = currentRosterId === rosterId;
          const isCurrentArea = normalizedRosterArea === area;
          
          console.log(`[DELETE ROSTER] Checking if should clear: isCurrentRoster=${isCurrentRoster}, isCurrentArea=${isCurrentArea}, matchesCurrentView=${matchesCurrentView}, normalizedRosterArea=${normalizedRosterArea}, currentArea=${area}`);
          
          // Always clear if it's the current roster ID, OR if it's in the current area and dates overlap
          // This ensures the roster disappears immediately when deleted
          if (isCurrentRoster || (isCurrentArea && dateOverlaps)) {
            console.log(`[DELETE ROSTER] ✅ CLEARING roster from screen (ID: ${rosterId})`);
            // Set deletion flag to prevent race conditions
            isDeletingRef.current = true;
            
            // Clear all roster state immediately - use empty object to ensure it's truly cleared
            const emptyByDate = {};
            setByDate(emptyByDate);
            setInitialByDate(emptyByDate);
            setCurrentRosterId(null);
            setCurrentRosterStatus(null);
            setRosterStartDate(null);
            setHasUnsavedChanges(false);
            setRosterExistsForFortnight(false); // Roster was deleted, so it no longer exists
            // Clear validation issues since roster is gone
            setValidationIssues([]);
            
            // Force reload roster for current fortnight (will show empty if no other roster exists)
            // Use a small delay to ensure state updates are processed and prevent race conditions
            setTimeout(async () => {
              try {
                // Explicitly pass the current area to ensure we don't load the wrong area's roster
                const fortnightStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
                const roster = await loadRosterForDate(fortnightStart, area, role || "surveyor");
                
                // Only set the roster if it exists AND matches the current area
                if (roster && roster.assignmentsByDate && Object.keys(roster.assignmentsByDate).length > 0) {
                  const rosterAreaFromDb = roster.area || "SOUTH";
                  if (rosterAreaFromDb === area) {
                    console.log(`[DELETE ROSTER] ✅ Reloaded roster ${roster.id} for area ${area} after deletion`);
                    setByDate(roster.assignmentsByDate);
                    setInitialByDate(JSON.parse(JSON.stringify(roster.assignmentsByDate)));
                    setCurrentRosterId(roster.id);
                    setCurrentRosterStatus(roster.status || "draft");
                    if (roster.startDate) {
                      setRosterStartDate(parseISO(roster.startDate));
                    }
                  } else {
                    console.log(`[DELETE ROSTER] ⚠️ Found roster but wrong area (${rosterAreaFromDb} vs ${area}), keeping empty`);
                    // Keep empty - don't load wrong area's roster
                  }
                } else {
                  console.log(`[DELETE ROSTER] ✅ No roster found for area ${area}, keeping empty`);
                  // Keep empty - no roster exists for this area
                }
              } catch (err) {
                console.error("Error reloading roster after deletion:", err);
                // On error, keep empty state
              } finally {
                // Clear deletion flag after reload completes
                isDeletingRef.current = false;
              }
            }, 100);
          } else {
            console.log(`[DELETE ROSTER] ⚠️ NOT clearing - roster not in current view (different area or date range)`);
          }
          
          // Refresh from database after a short delay to ensure deletion is committed
          // Keep the modal open so user can see the roster disappear
          setTimeout(async () => {
            try {
              // Explicitly refresh rosters from database (fresh fetch, no cache)
              const updatedRosters = await loadAllRosters();
              console.log(`[DELETE ROSTER] Refreshed ${updatedRosters.length} rosters from database`);
              // Filter rosters by the deleted roster's area (or current area if not found)
              const filteredRosters = (updatedRosters || []).filter((r) => {
                const rArea = r.area || "SOUTH";
                return rArea === rosterArea;
              });
              setSavedRosters(filteredRosters);
              setRosterListKey((prev) => prev + 1); // Force re-render after database refresh
              console.log(`[DELETE ROSTER] Updated savedRosters to ${filteredRosters.length} rosters for area ${rosterArea}`);
            } catch (refreshError) {
              console.error("Error refreshing roster list:", refreshError);
              // If refresh fails, at least the optimistic update already removed it from the list
            }
          }, 500); // Small delay to ensure database deletion completes
          
          // Show success message but don't close modal immediately - let user see the roster disappear
          Alert.alert("Success", "Roster deleted successfully! ✅");
        } else {
          // If deletion failed, restore the roster to the list
          console.warn(`[DELETE ROSTER] Deletion failed, restoring roster to list`);
          setSavedRosters(previousRosters);
          setRosterListKey((prev) => prev + 1); // Force re-render
          Alert.alert("Error", result.error || "Failed to delete roster");
        }
      } catch (error) {
        console.error("Error deleting roster:", error);
        // If deletion failed, restore the roster to the list
        setSavedRosters(previousRosters);
        setRosterListKey((prev) => prev + 1); // Force re-render
        Alert.alert("Error", "An error occurred while deleting the roster");
      }
    };
    
    if (Platform.OS === "web") {
      // Web: Use confirm dialog
      if (window.confirm("Are you sure you want to delete this roster? This action cannot be undone.")) {
        await performDelete();
      }
    } else {
      // Mobile: Use Alert
      Alert.alert(
        "Delete Roster",
        "Are you sure you want to delete this roster? This action cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: performDelete,
          },
        ]
      );
    }
  }

  async function confirmAutoPopulate() {
    setAutoPopulateConfirm(false);
    setAutoPopulating(true);

    try {
      // Determine the correct start date for roster generation
      // Use roster's actual start date if available, otherwise use anchorDate
      let generationStartDate = anchorDate;
      if (rosterStartDate) {
        // Use the roster's actual start date (should already be a Monday)
        generationStartDate = startOfWeek(rosterStartDate, { weekStartsOn: 1 });
        console.log(`[GENERATE ROSTER] Using roster's startDate: ${format(rosterStartDate, "yyyy-MM-dd")} (Monday: ${format(generationStartDate, "yyyy-MM-dd")}) instead of anchorDate: ${format(anchorDate, "yyyy-MM-dd")}`);
      } else {
        // Use Monday of anchorDate week
        generationStartDate = startOfWeek(anchorDate, { weekStartsOn: 1 });
        console.log(`[GENERATE ROSTER] Using Monday of anchorDate week: ${format(generationStartDate, "yyyy-MM-dd")}`);
      }

      // Check for overlapping rosters before generating
      const generationStartStr = format(generationStartDate, "yyyy-MM-dd");
      const generationEndStr = format(addDays(generationStartDate, 13), "yyyy-MM-dd");
      
      try {
        const allRosters = await loadAllRosters();
        const overlappingRoster = (allRosters || []).find((r) => {
          if ((r.area || "SOUTH") !== area) return false; // Different area, no overlap
          if (!r.startDate || !r.endDate) return false; // Missing dates, skip
          
          // Check if date ranges overlap
          const rStart = parseISO(r.startDate);
          const rEnd = parseISO(r.endDate);
          const genStart = parseISO(generationStartStr);
          const genEnd = parseISO(generationEndStr);
          
          // Overlap exists if: rStart <= genEnd && rEnd >= genStart
          return rStart <= genEnd && rEnd >= genStart;
        });

        if (overlappingRoster && overlappingRoster.id !== currentRosterId) {
          const overlapStart = format(parseISO(overlappingRoster.startDate), "d MMM yyyy");
          const overlapEnd = format(parseISO(overlappingRoster.endDate), "d MMM yyyy");
          Alert.alert(
            "Overlapping Roster",
            `A roster already exists for ${overlapStart} - ${overlapEnd}.\n\nGenerating a new roster would create an overlap. Please delete the existing roster first or load it to modify.`,
            [{ text: "OK", onPress: () => {
              setAutoPopulating(false);
            }}]
          );
          return;
        }
      } catch (error) {
        console.warn("[GENERATE ROSTER] Could not check for overlapping rosters:", error);
        // Continue with generation if check fails
      }

      // Load demand settings for the current area
      const demandData = await loadDemand(area);
      const demand = demandData?.demand || {};

      const result = await autoPopulateRoster({
        surveyors,
        anchorDate: generationStartDate, // Use the determined start date
        weekendHistory,
        existingAssignments: byDate,
        area: area,
        demand: demand,
      });

      if (result.success) {
        // Apply the generated assignments
        setByDate(result.assignments);

        // Auto-save the populated roster using the determined start date
        const roster = {
          id: currentRosterId || `roster_${format(generationStartDate, "yyyy-MM-dd")}`,
          startDate: generationStartStr,
          endDate: generationEndStr,
          area: area, // Include area to ensure correct area is saved
          assignmentsByDate: result.assignments,
          createdAt: new Date().toISOString(),
          status: "draft",
        };
        
        // Update rosterStartDate state to match the generated roster
        setRosterStartDate(generationStartDate);
        if (!currentRosterId) {
          // New roster - set the ID
          setCurrentRosterId(roster.id);
        }
        
        const saveResult = await saveRoster(roster);
        
        // Update roster status to draft
        setCurrentRosterStatus("draft");
        
        // Show results
        if (saveResult.success) {
          if (result.issues && result.issues.length > 0) {
            Alert.alert(
              "Generate Rosters Complete",
              `Roster generated and saved as draft! ✅\n\nNote: ${result.issues.length} issue(s) detected:\n${result.issues.slice(0, 3).join("\n")}${result.issues.length > 3 ? `\n...and ${result.issues.length - 3} more` : ""}\n\n⚠️ Remember to confirm the roster to publish it.`,
              [{ text: "OK" }]
            );
          } else {
            Alert.alert("Success", "Roster generated and saved as draft! ✅\n\n⚠️ Remember to confirm the roster to publish it.");
          }
        } else {
          Alert.alert(
            "Partial Success",
            `Roster populated but failed to save.\n\nError: ${saveResult.error || "Unknown error"}`,
            [{ text: "OK" }]
          );
        }
      } else {
        Alert.alert("Error", result.error || "Failed to generate roster");
      }
    } catch (error) {
      console.error("Error auto-populating roster:", error);
      Alert.alert("Error", "An error occurred while generating the roster");
    } finally {
      setAutoPopulating(false);
    }
  }

  async function handleExport(exportFormat = "csv") {
    try {
      const activeSurveyors = surveyors.filter((s) => s.active);
      if (activeSurveyors.length === 0) {
        Alert.alert("Error", "No active surveyors to export");
      return;
    }

      // Check if there are any assignments
      const hasAssignments = Object.keys(byDate).some(dateKey => byDate[dateKey] && byDate[dateKey].length > 0);
      if (!hasAssignments) {
        Alert.alert("Info", "No assignments to export. Please add assignments to the roster first.");
        return;
      }

      const roster = {
        id: `roster_${format(anchorDate, "yyyy-MM-dd")}`,
        startDate: format(startOfWeek(anchorDate, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        endDate: format(addDays(startOfWeek(anchorDate, { weekStartsOn: 1 }), 13), "yyyy-MM-dd"),
        area: area,
        assignmentsByDate: byDate,
        createdAt: new Date().toISOString(),
      };

      // Handle PDF export
      if (exportFormat === "pdf") {
        try {
          await exportRosterToPDF(roster, activeSurveyors, area, anchorDate, Platform.OS);
          Alert.alert("Success", "Roster exported to PDF successfully");
        } catch (error) {
          console.error("Error exporting PDF:", error);
          Alert.alert("Error", `Failed to export PDF: ${error.message || "Unknown error"}`);
        } finally {
        }
        return;
      }

      let content, filename;
      if (exportFormat === "csv") {
        content = exportRosterToCSV(roster, activeSurveyors);
        filename = `roster_${format(anchorDate, "yyyy-MM-dd")}.csv`;
      } else {
        content = exportRosterToJSON(roster);
        filename = `roster_${format(anchorDate, "yyyy-MM-dd")}.json`;
      }

      if (!content || content.trim().length === 0) {
        Alert.alert("Error", "Failed to generate export content. No data available.");
        return;
      }

      if (Platform.OS === "web") {
        // Web: download file
        try {
          const blob = new Blob([content], { type: exportFormat === "csv" ? "text/csv;charset=utf-8;" : "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.style.display = "none";
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 100);
          Alert.alert("Success", `Exported ${filename} successfully`);
        } catch (error) {
          console.error("Error downloading file:", error);
          Alert.alert("Error", `Failed to download file: ${error.message}`);
        }
      } else {
        // Mobile: share
        try {
          const result = await Share.share({
            message: content,
            title: filename,
          });
          if (result.action === Share.sharedAction) {
            Alert.alert("Success", "Roster exported successfully");
          }
        } catch (error) {
          console.error("Error sharing:", error);
          Alert.alert("Error", `Failed to share file: ${error.message}`);
        }
      }
    } catch (error) {
      console.error("Error exporting roster:", error);
      Alert.alert("Error", `Failed to export roster: ${error.message || "Unknown error"}`);
    }
  }

  const isWeb = Platform.OS === "web";
  const Container = isWeb ? View : LinearGradient;
  const containerProps = isWeb
    ? { style: [styles.container, { backgroundColor: "#ffffff" }] }
    : {
        colors: ["#ffffff", "#fff8f0", "#fffbf5"],
        style: styles.container,
      };
  
  // Create RosterContent
  const RosterContent = (
    <Container {...containerProps}>
      <TopNav />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={[styles.content, { paddingTop: Platform.OS === "web" ? 56 : 60 }]}>
        {/* Office Tabs + Content Wrapper with Borders */}
        <View style={styles.tabsAndContentWrapper}>
          {/* Office Tabs */}
          <View style={styles.tabBarContainer}>
            <View style={styles.tabBar}>
              {/* Draft Badge - Positioned absolutely on the right */}
              {currentRosterStatus === "draft" && role !== "surveyor" && (
                <View style={{
                  position: "absolute",
                  right: 12,
                  top: Platform.OS === "web" ? 8 : 10,
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  backgroundColor: "#fff3cd",
                  borderWidth: 1,
                  borderColor: "#fbbf24",
                  borderRadius: 6,
                  zIndex: 10,
                }}>
                  <Text style={{
                    fontSize: 12,
                    fontWeight: "700",
                    color: "#856404",
                    textTransform: "uppercase",
                  }}>
                    Draft - Not Published
                  </Text>
                </View>
              )}
              {/* Tabs on the left */}
              <OfficeTab
                label="STSP"
                active={area === "SOUTH"}
                isFirst={true}
                onPress={() => {
                  if (area !== "SOUTH") {
                    // Check if there are unsaved changes
                    if (hasChanges) {
                      setPendingAreaSwitch("SOUTH");
                      setUnsavedChangesModal(true);
                    } else {
                      setArea("SOUTH");
                      setByDate({});
                      setInitialByDate({});
                      setCurrentRosterId(null);
                      setCurrentRosterStatus(null);
                    }
                  }
                }}
              />
              <OfficeTab
                label="NTNP"
                active={area === "NORTH"}
                isFirst={false}
                onPress={() => {
                  if (area !== "NORTH") {
                    // Check if there are unsaved changes (use both local and context for reliability)
                    if (hasChanges || contextHasUnsavedChanges) {
                      console.log(`[AREA SWITCH] Unsaved changes detected - hasChanges: ${hasChanges}, contextHasUnsavedChanges: ${contextHasUnsavedChanges}`);
                      setPendingAreaSwitch("NORTH");
                      setUnsavedChangesModal(true);
                    } else {
                      console.log(`[AREA SWITCH] No unsaved changes - switching to NTNP`);
                      setArea("NORTH");
                      setByDate({});
                      setInitialByDate({});
                      setCurrentRosterId(null);
                      setCurrentRosterStatus(null);
                    }
                  }
                }}
              />
              {/* Heading with date below it - only on web */}
              {Platform.OS === "web" && (
                <View style={styles.officeTabHeadingContainer}>
                  <Text style={styles.officeTabHeading}>
                    {area === "SOUTH" ? "STSP ROSTER" : "NTNP ROSTER"}
                  </Text>
                  <View style={styles.monthSlider}>
                    <Chip
                      label="◀"
                      onPress={() =>
                        setAnchorDate((d) => addDays(d, viewMode === "FORTNIGHT" ? -14 : -30))
                      }
                    />
                    <View style={{ width: 12 }} />
                    <Text style={styles.dateText}>{format(anchorDate, "MMM yyyy")}</Text>
                    <View style={{ width: 12 }} />
                    <Chip
                      label="▶"
                      onPress={() =>
                        setAnchorDate((d) => addDays(d, viewMode === "FORTNIGHT" ? 14 : 30))
                      }
                    />
                  </View>
                </View>
              )}
            </View>
          </View>

          {/* Content Area - All content below tabs */}
          <View style={styles.tabContentContainer}>
          {/* Area Loading Overlay */}
          {(areaLoading || rosterLoading) && (
            <View style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(255, 255, 255, 0.9)",
              zIndex: 1000,
              justifyContent: "center",
              alignItems: "center",
              borderRadius: 12,
            }}>
              <ActivityIndicator size="large" color="#fbbf24" />
              <Text style={{ marginTop: 12, fontSize: 14, color: "#666666", fontWeight: "600" }}>
                {areaLoading ? `Loading ${area === "SOUTH" ? "STSP" : "NTNP"} roster...` : "Loading roster data..."}
              </Text>
            </View>
          )}
          
          {/* Roster Load Error */}
          {rosterLoadError && !rosterLoading && (
            <View style={{
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              borderWidth: 1,
              borderColor: "rgba(239, 68, 68, 0.3)",
              borderRadius: 8,
              padding: 16,
              margin: 16,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#dc2626", fontWeight: "600", fontSize: 14, marginBottom: 4 }}>
                  Failed to load roster
                </Text>
                <Text style={{ color: "#666666", fontSize: 12 }}>
                  {rosterLoadError}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setRosterLoadError(null);
                  loadRosterForFortnight();
                }}
                style={{
                  backgroundColor: "#fbbf24",
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 6,
                  marginLeft: 12,
                }}
              >
                <Text style={{ color: "#000000", fontWeight: "600", fontSize: 13 }}>
                  Retry
                </Text>
              </Pressable>
            </View>
          )}
          {/* Toggle + heading (mobile) + month slider + action buttons */}
          <View style={styles.controlsRow}>
            {Platform.OS === "web" && (
            <View style={styles.chipContainer}>
              <Chip
                active={viewMode === "FORTNIGHT"}
                onPress={() => setViewMode("FORTNIGHT")}
                label="Fortnight"
              />
                <View style={{ width: Platform.OS === "web" ? 6 : 8 }} />
              <Chip
                active={viewMode === "MONTH"}
                onPress={() => setViewMode("MONTH")}
                label="Month"
              />
            </View>
            )}

            {/* Mobile: Heading below tabs, aligned vertically with month navigation */}
            {Platform.OS !== "web" && (
              <View style={styles.mobileHeadingContainer}>
                <Text style={styles.officeTabHeading}>
                  {area === "SOUTH" ? "STSP ROSTER" : "NTNP ROSTER"}
                </Text>
              </View>
            )}

            {/* Month slider - only on mobile (on web it's under the heading) */}
            {Platform.OS !== "web" && (
              <View style={styles.monthSlider}>
              <Chip
                label="◀"
                onPress={() =>
                  setAnchorDate((d) => addDays(d, viewMode === "FORTNIGHT" ? -14 : -30))
                }
              />
              <View style={{ width: 12 }} />
              <Text style={styles.dateText}>{format(anchorDate, "MMM yyyy")}</Text>
              <View style={{ width: 12 }} />
              <Chip
                label="▶"
                onPress={() =>
                  setAnchorDate((d) => addDays(d, viewMode === "FORTNIGHT" ? 14 : 30))
                }
              />
            </View>
            )}

            <View style={[styles.actionButtons, { justifyContent: "flex-end", gap: Platform.OS === "web" ? 6 : 6 }]}>
            {!isSurveyor && (
              <>
            <Pressable
              onPress={handleAutoPopulate}
              style={[
                styles.actionButton,
                (autoPopulating || loading || rosterExistsForFortnight) && { opacity: 0.5 },
              ]}
              disabled={autoPopulating || loading || rosterExistsForFortnight}
            >
                  <Text style={styles.actionButtonText} numberOfLines={Platform.OS === "web" ? 1 : 2} adjustsFontSizeToFit={false} ellipsizeMode="tail">
                    {autoPopulating ? "Generating..." : Platform.OS === "web" ? "Generate Rosters" : "Generate\nRosters"}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleManageRosters}
              style={styles.actionButton}
            >
                  <Text style={styles.actionButtonText} numberOfLines={Platform.OS === "web" ? 1 : 2} adjustsFontSizeToFit={false} ellipsizeMode="tail">
                    {Platform.OS === "web" ? "Manage Rosters" : "Manage\nRosters"}
              </Text>
            </Pressable>
              </>
            )}
            {/* Export PDF button - only show on web in controlsRow */}
            {Platform.OS === "web" && (
            <Pressable
              onPress={() => handleExport("pdf")}
              style={styles.actionButton}
            >
                <Text style={styles.actionButtonText} numberOfLines={1} adjustsFontSizeToFit={false} ellipsizeMode="tail">
                Export PDF
              </Text>
            </Pressable>
            )}
            {!isSurveyor && ((hasChanges || currentRosterStatus === "draft") ? (
              <Pressable
                onPress={handleConfirmRosterClick}
                style={[
                  styles.actionButton,
                  styles.confirmButtonGlow,
                  currentRosterStatus === "draft" && {
                    backgroundColor: "#fbbf24",
                    borderWidth: 2,
                    borderColor: "#f59e0b",
                  },
                ]}
              >
                <Text style={[
                  styles.actionButtonText,
                  styles.confirmButtonTextGlow,
                  currentRosterStatus === "draft" && { fontWeight: "700", color: "#000000" },
                ]} numberOfLines={Platform.OS === "web" ? 1 : 2} adjustsFontSizeToFit={false} ellipsizeMode="tail">
                  {Platform.OS === "web" ? "Confirm Roster" : "Confirm\nRoster"}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                disabled={true}
                style={[
                  styles.actionButton,
                  { opacity: 0.3 },
                ]}
              >
                <Text style={[
                  styles.actionButtonText,
                  { opacity: 0.5 },
                ]} numberOfLines={Platform.OS === "web" ? 1 : 2} adjustsFontSizeToFit={false} ellipsizeMode="tail">
                  {Platform.OS === "web" ? "Confirm Roster" : "Confirm\nRoster"}
                </Text>
              </Pressable>
            ))}
          </View>
          </View>

          {/* Active surveyors strip - Hidden on mobile */}
        {Platform.OS === "web" && (
          <View style={[styles.surveyorStrip, { marginTop: Platform.OS === "web" ? 6 : 8, marginBottom: Platform.OS === "web" ? 6 : 8 }]}>
          <View style={styles.surveyorHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
              <Text style={styles.surveyorHeaderText}>
                ACTIVE SURVEYORS
              </Text>
              <View style={{ width: Platform.OS === "web" ? 6 : 8 }} />
              <Text style={styles.surveyorCount}>
                ({surveyors.filter((s) => s.active).length})
              </Text>
            </View>
          </View>
          
          <View style={{ position: "relative", flexDirection: "row", alignItems: "center", width: "100%" }}>
            {/* Left Arrow - Only show when scrolled right */}
            {showLeftArrow && (
              <Pressable
                onPress={() => {
                  if (isWeb && surveyorScrollRef.current) {
                    const element = surveyorScrollRef.current;
                    let domElement = null;
                    if (element._component) {
                      domElement = element._component.getNode ? element._component.getNode() : element._component;
                    } else if (element.getNode) {
                      domElement = element.getNode();
                    } else if (element.scrollBy) {
                      domElement = element;
                    }
                    if (domElement && domElement.scrollBy) {
                      domElement.scrollBy({ left: -200, behavior: "smooth" });
                    }
                  } else {
                    surveyorScrollRef.current?.scrollTo({ x: Math.max(0, (surveyorScrollRef.current?.contentOffset?.x || 0) - 200), animated: true });
                  }
                }}
                style={styles.surveyorNavArrow}
              >
                <Text style={styles.surveyorNavArrowText}>◀</Text>
              </Pressable>
            )}
            
            <ScrollView
              ref={surveyorScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ maxHeight: Platform.OS === "web" ? 60 : 70, flex: 1 }}
              onLayout={(event) => {
                // Check scrollability after layout
                if (isWeb && surveyorScrollRef.current) {
                  setTimeout(() => {
                    const element = surveyorScrollRef.current;
                    if (element) {
                      let domElement = null;
                      if (element._component) {
                        domElement = element._component.getNode ? element._component.getNode() : element._component;
                      } else if (element.getNode) {
                        domElement = element.getNode();
                      } else if (element.scrollWidth !== undefined) {
                        domElement = element;
                      }
                      
                      if (domElement) {
                        const scrollWidth = domElement.scrollWidth || 0;
                        const clientWidth = domElement.clientWidth || 0;
                        const scrollLeft = domElement.scrollLeft || 0;
                        
                        // Only show arrows if content is actually scrollable
                        const needsScrolling = scrollWidth > clientWidth + 5; // Add small buffer
                        if (needsScrolling) {
                          setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
                          setShowLeftArrow(scrollLeft > 10);
                        } else {
                          setShowRightArrow(false);
                          setShowLeftArrow(false);
                        }
                      }
                    }
                  }, 100);
                } else {
                  // Native: use layout measurements
                  const { width } = event.nativeEvent.layout;
                  const estimatedContentWidth = surveyors.filter((s) => s.active).length * 152; // 140 width + 12 margin
                  const needsScrolling = estimatedContentWidth > width + 5;
                  setShowRightArrow(needsScrolling);
                  setShowLeftArrow(false); // Will be updated on scroll
                }
              }}
              onScroll={(event) => {
                if (isWeb) {
                  const element = surveyorScrollRef.current;
                  if (element) {
                    let domElement = null;
                    if (element._component) {
                      domElement = element._component.getNode ? element._component.getNode() : element._component;
                    } else if (element.getNode) {
                      domElement = element.getNode();
                    } else if (element.scrollLeft !== undefined) {
                      domElement = element;
                    }
                    
                    if (domElement) {
                      const scrollLeft = domElement.scrollLeft || 0;
                      const scrollWidth = domElement.scrollWidth || 0;
                      const containerWidth = domElement.clientWidth || 0;
                      
                      // Only show arrows if content is actually scrollable
                      const needsScrolling = scrollWidth > containerWidth + 5;
                      if (needsScrolling) {
                        setShowLeftArrow(scrollLeft > 10);
                        setShowRightArrow(scrollLeft < scrollWidth - containerWidth - 10);
                      } else {
                        setShowLeftArrow(false);
                        setShowRightArrow(false);
                      }
                    }
                  }
                } else {
                  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                  const scrollLeft = contentOffset.x;
                  const scrollWidth = contentSize.width;
                  const containerWidth = layoutMeasurement.width;
                  
                  // Only show arrows if content is actually scrollable
                  const needsScrolling = scrollWidth > containerWidth + 5;
                  if (needsScrolling) {
                    setShowLeftArrow(scrollLeft > 10);
                    setShowRightArrow(scrollLeft < scrollWidth - containerWidth - 10);
                  } else {
                    setShowLeftArrow(false);
                    setShowRightArrow(false);
                  }
                }
              }}
              onScrollEndDrag={(event) => {
                if (isWeb) {
                  const element = surveyorScrollRef.current;
                  if (element) {
                    const scrollElement = element._component || element;
                    const domElement = scrollElement?.getNode ? scrollElement.getNode() : scrollElement;
                    
                    if (domElement) {
                      const scrollLeft = domElement.scrollLeft || 0;
                      const scrollWidth = domElement.scrollWidth || 0;
                      const containerWidth = domElement.clientWidth || 0;
                      
                      setShowLeftArrow(scrollLeft > 0);
                      setShowRightArrow(scrollLeft < scrollWidth - containerWidth - 10);
                    }
                  }
                }
              }}
              scrollEventThrottle={16}
            >
              <View style={{ flexDirection: "row" }}>
              {loading ? (
                <Text style={{ color: "#666666", fontSize: 14, padding: 20 }}>Loading surveyors...</Text>
              ) : surveyors.filter((s) => s.active).length === 0 ? (
                <Text style={{ color: "#666666", fontSize: 14, padding: 20 }}>No active surveyors found</Text>
              ) : (
                surveyors.filter((s) => s.active).map((s, idx) => {
                  // Check if surveyor is assigned in other area for the current date being edited
                  const currentDateKey = webAssignMode?.dateKey;
                  const otherAreaAssignment = currentDateKey ? otherAreaAssignments[currentDateKey]?.[s.id] : null;
                  const isAssignedInOtherArea = !!otherAreaAssignment;
                  const otherAreaName = otherAreaAssignment?.area || (area === "SOUTH" ? "NTNP" : "STSP");
                  
                  // Check if surveyor is on leave for the current date
                  const nonAvailability = s.nonAvailability || [];
                  const isOnLeave = currentDateKey ? nonAvailability.includes(currentDateKey) : false;
                  
                  return (
                  <View key={s.id} style={{ marginLeft: idx > 0 ? 8 : 0 }}>
                    <DraggableSurveyor
                      surveyor={s}
                      onPress={
                        isWeb && webAssignMode
                          ? () => {
                                  if (!isSurveyor) {
                              addAssignment(webAssignMode.dateKey, s.id);
                                  }
                              setWebAssignMode(null);
                            }
                          : undefined
                      }
                        isAssignedInOtherArea={isAssignedInOtherArea}
                        otherAreaName={otherAreaName}
                        currentDateKey={currentDateKey}
                        otherAreaAssignments={otherAreaAssignments}
                        area={area}
                        isOnLeave={isOnLeave}
                    />
                  </View>
                  );
                })
              )}
          </View>
        </ScrollView>

          {/* Right Arrow - Only show when there's more content to scroll */}
          {showRightArrow && (
            <Pressable
              onPress={() => {
                if (isWeb && surveyorScrollRef.current) {
                  const element = surveyorScrollRef.current;
                  let domElement = null;
                  if (element._component) {
                    domElement = element._component.getNode ? element._component.getNode() : element._component;
                  } else if (element.getNode) {
                    domElement = element.getNode();
                  } else if (element.scrollBy) {
                    domElement = element;
                  }
                  if (domElement && domElement.scrollBy) {
                    domElement.scrollBy({ left: 200, behavior: "smooth" });
                  }
                } else {
                  surveyorScrollRef.current?.scrollTo({ x: (surveyorScrollRef.current?.contentOffset?.x || 0) + 200, animated: true });
                }
              }}
              style={styles.surveyorNavArrow}
            >
              <Text style={styles.surveyorNavArrowText}>▶</Text>
            </Pressable>
          )}
            </View>
          </View>
        )}

          {/* Middle: calendar */}
          {(viewMode === "FORTNIGHT" && Platform.OS === "web") ? (
            <WeekGrid
              days={fortnightDays}
              byDate={byDate}
              surveyors={surveyors}
              validationIssues={validationIssues}
              onDrop={async (dateKey, surveyorId) => {
                // Load other area assignments if not already loaded
                if (!otherAreaAssignments[dateKey]) {
                  await loadOtherAreaAssignments(dateKey);
                }
                addAssignment(dateKey, surveyorId);
              }}
              onEdit={(dateKey, a) => {
                if (!isSurveyor) {
                  setEdit({ dateKey, assignment: a });
                }
              }}
              onWebAssign={async (dateKey) => {
                if (!isSurveyor) {
                  setWebAssignMode({ dateKey });
                  // Load other area assignments for this date
                  await loadOtherAreaAssignments(dateKey);
                }
              }}
              rosterStartDate={rosterStartDate}
              ignoredIssues={ignoredIssues}
              onIgnoreIssue={(idx) => {
                setIgnoredIssues(prev => new Set([...prev, idx]));
              }}
              showValidationIssues={showValidationIssues}
              onToggleValidationIssues={() => setShowValidationIssues(prev => !prev)}
              isSurveyor={isSurveyor}
              otherAreaAssignments={otherAreaAssignments}
              area={area}
              loadOtherAreaAssignments={loadOtherAreaAssignments}
              setCrossAreaConflictModal={setCrossAreaConflictModal}
              addAssignment={addAssignment}
              setEdit={setEdit}
              setUnavailabilityModal={setUnavailabilityModal}
              currentUserSurveyorId={currentUserSurveyorId}
            />
          ) : (
            <MonthGrid
              days={monthDays}
              byDate={byDate}
              surveyors={surveyors}
              onDrop={async (dateKey, surveyorId) => {
                // Load other area assignments if not already loaded
                if (!otherAreaAssignments[dateKey]) {
                  await loadOtherAreaAssignments(dateKey);
                }
                addAssignment(dateKey, surveyorId);
              }}
              onEdit={(dateKey, a) => {
                if (!isSurveyor) {
                  setEdit({ dateKey, assignment: a });
                }
              }}
              onWebAssign={async (dateKey) => {
                if (!isSurveyor) {
                  setWebAssignMode({ dateKey });
                  // Load other area assignments for this date
                  await loadOtherAreaAssignments(dateKey);
                }
              }}
              isSurveyor={isSurveyor}
              otherAreaAssignments={otherAreaAssignments}
              area={area}
              loadOtherAreaAssignments={loadOtherAreaAssignments}
              setCrossAreaConflictModal={setCrossAreaConflictModal}
              addAssignment={addAssignment}
              setEdit={setEdit}
              setUnavailabilityModal={setUnavailabilityModal}
              currentUserSurveyorId={currentUserSurveyorId}
            />
          )}
          </View>
          
          {/* Mobile: Export PDF button below calendar */}
          {Platform.OS !== "web" && (
            <View style={{ alignItems: "center", marginTop: 12, marginBottom: 8 }}>
              <Pressable
                onPress={() => handleExport("pdf")}
                style={[styles.actionButton, { marginLeft: 0 }]}
              >
                <Text style={styles.actionButtonText} numberOfLines={2} adjustsFontSizeToFit={false} ellipsizeMode="tail">
                  Export PDF
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Web: Surveyor selection modal */}
        {isWeb && webAssignMode && (() => {
          // Explicitly capture setCrossAreaConflictModal to ensure it's in scope
          const showCrossAreaConflict = setCrossAreaConflictModal;
          const dateKey = webAssignMode.dateKey;
          const assignmentsForDay = byDate[dateKey] || [];
          
          // Get assigned surveyor IDs for this day
          const assignedSurveyorIds = new Set(assignmentsForDay.map(a => a.surveyorId));
          
          // Create a map of surveyor ID to their assignment for quick lookup
          const assignmentMap = {};
          assignmentsForDay.forEach(a => {
            assignmentMap[a.surveyorId] = a;
          });
          
          return (
            <Modal
              visible={!!webAssignMode}
              transparent
              animationType="fade"
              onRequestClose={() => setWebAssignMode(null)}
            >
              <Pressable
                style={styles.modalOverlayCentered}
                onPress={() => setWebAssignMode(null)}
              >
                <View
                  style={[styles.modalContentCentered, { maxWidth: 600, width: "90%", backgroundColor: "#ffffff" }]}
                  onStartShouldSetResponder={() => true}
                >
                  <Text style={styles.modalTitle}>
                    Assign/Edit Surveyors
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    {format(parseISO(dateKey), "d MMM yyyy")}
                  </Text>
                  <Text style={{ color: "#666666", fontSize: 13, marginBottom: 16, textAlign: "center" }}>
                    Tap a surveyor to assign or edit their shift
                  </Text>
                  <ScrollView style={{ maxHeight: 500 }} showsVerticalScrollIndicator={true}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start", gap: 12 }}>
                      {surveyors
                        .filter((s) => s.active) // Show all active surveyors for manual assignment
                        .map((s) => {
                          const isAssigned = assignedSurveyorIds.has(s.id);
                          const assignment = assignmentMap[s.id];
                          
                          // Check if surveyor is assigned in the other area
                          const otherAreaAssignment = otherAreaAssignments[dateKey]?.[s.id];
                          const isAssignedInOtherArea = !!otherAreaAssignment;
                          const otherAreaName = otherAreaAssignment?.area || (area === "SOUTH" ? "NTNP" : "STSP");
                          
                          // Check if surveyor is on leave for this date
                          const nonAvailability = s.nonAvailability || [];
                          const isOnLeave = nonAvailability.includes(dateKey);
                          
                          const isNightShift = isAssigned && assignment && assignment.shift === "NIGHT";
                          const isDisabled = (isAssignedInOtherArea && !isAssigned) || isOnLeave; // Disable if assigned in other area or on leave
                          
                          const cardBorderColor = isAssigned 
                            ? (isNightShift ? NIGHT_SHIFT_COLOR : "#fbbf24")
                            : isDisabled
                            ? "#d1d5db"
                            : "#e5e5e5";
                          const cardBackgroundColor = isAssigned
                            ? (isNightShift ? "rgba(30, 58, 95, 0.08)" : "rgba(251, 191, 36, 0.08)")
                            : isDisabled
                            ? "#f9fafb"
                            : "#ffffff";
                          const imageBorderColor = isAssigned
                            ? (isNightShift ? NIGHT_SHIFT_COLOR : "#fbbf24")
                            : isDisabled
                            ? "#d1d5db"
                            : "#e5e5e5";
                          const textColor = isDisabled ? "#9ca3af" : "#000000";
                          
                          return (
                            <View key={s.id} style={{ width: "30%", minWidth: 150, maxWidth: 180 }}>
                            <Pressable
                              onPress={() => {
                                  if (isDisabled) {
                                    if (isOnLeave) {
                                      // Show unavailability modal for on leave
                                      const assignmentDate = parseISO(dateKey);
                                      setUnavailabilityModal({
                                        surveyorName: s.name,
                                        date: format(assignmentDate, "d MMM yyyy"),
                                      });
                                    } else if (isAssignedInOtherArea) {
                                      // Show modal that surveyor is already assigned in other area
                                      const assignmentDate = parseISO(dateKey);
                                      showCrossAreaConflict({
                                        surveyorName: s.name,
                                        otherAreaName: otherAreaName,
                                        date: format(assignmentDate, "d MMM yyyy"),
                                      });
                                    }
                                    return;
                                  }
                                  // If surveyor already has an assignment, open edit modal
                                  if (isAssigned && assignment) {
                                    setEdit({ dateKey, assignment: assignment });
                                    setWebAssignMode(null);
                                  } else {
                                // Allow manual assignment regardless of area preference
                                addAssignment(dateKey, s.id);
                                setWebAssignMode(null);
                                  }
                              }}
                                disabled={isDisabled}
                              style={[
                                {
                                    padding: 14,
                                  borderRadius: 12,
                                    borderWidth: isDisabled ? 1.5 : 2,
                                  borderColor: cardBorderColor,
                                  backgroundColor: cardBackgroundColor,
                                  alignItems: "center",
                                    opacity: isDisabled ? 0.6 : 1,
                                    shadowColor: isDisabled ? "transparent" : "#000",
                                    shadowOffset: { width: 0, height: 1 },
                                    shadowOpacity: isDisabled ? 0 : 0.05,
                                    shadowRadius: 2,
                                    elevation: isDisabled ? 0 : 1,
                                }
                              ]}
                            >
                              <Image
                                source={{ uri: s.photoUrl }}
                                style={{ 
                                  width: 64, 
                                  height: 64, 
                                  borderRadius: 32, 
                                  borderWidth: 2.5, 
                                  borderColor: imageBorderColor,
                                  marginBottom: 10,
                                  backgroundColor: "#f3f4f6"
                                }}
                              />
                              <Text 
                                style={{ 
                                  color: textColor, 
                                  fontWeight: "600", 
                                  fontSize: 13,
                                  textAlign: "center",
                                  marginBottom: 6,
                                  lineHeight: 18
                                }}
                                numberOfLines={2}
                              >
                                {s.name}
                              </Text>
                              {isAssigned && assignment && (
                                <View style={{ 
                                  marginTop: 2,
                                  paddingHorizontal: 10,
                                  paddingVertical: 5,
                                  borderRadius: 8,
                                  backgroundColor: isNightShift ? "rgba(30, 58, 95, 0.15)" : "rgba(251, 191, 36, 0.15)",
                                  borderWidth: 1.5,
                                  borderColor: isNightShift ? NIGHT_SHIFT_COLOR : "#fbbf24",
                                  minWidth: 80
                                }}>
                                  <Text style={{ 
                                    color: isNightShift ? NIGHT_SHIFT_COLOR : "#d97706", 
                                    fontWeight: "700", 
                                    fontSize: 11,
                                    textAlign: "center",
                                    letterSpacing: 0.5
                                  }}>
                                    {assignment.shift} SHIFT
                                  </Text>
                                </View>
                              )}
                              {isDisabled && !isAssigned && (
                                <View style={{ 
                                  marginTop: 2,
                                  paddingHorizontal: 10,
                                  paddingVertical: 5,
                                  borderRadius: 8,
                                  backgroundColor: isOnLeave ? "#fef2f2" : "#f3f4f6",
                                  borderWidth: 1.5,
                                  borderColor: isOnLeave ? "#fca5a5" : "#d1d5db",
                                  minWidth: 100
                                }}>
                                  <Text style={{ 
                                    color: isOnLeave ? "#dc2626" : "#6b7280", 
                                    fontWeight: "600", 
                                    fontSize: 10,
                                    textAlign: "center",
                                    letterSpacing: 0.3
                                  }}>
                                    {isOnLeave ? "🏖️ On Leave" : `⚠️ Rostered in ${otherAreaName}`}
                                  </Text>
                                </View>
                              )}
                            </Pressable>
                            </View>
                          );
                        })}
                    </View>
                  </ScrollView>
                  <Pressable
                    onPress={() => setWebAssignMode(null)}
                    style={styles.modalCloseButton}
                  >
                    <Text style={styles.modalCloseText}>CANCEL</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Modal>
          );
        })()}

        {/* Auto-populate confirmation modal */}
        {autoPopulateConfirm && (
          <Modal
            visible={!!autoPopulateConfirm}
            transparent
            animationType="fade"
            onRequestClose={() => setAutoPopulateConfirm(false)}
          >
            <Pressable
              style={styles.modalOverlayCentered}
              onPress={() => setAutoPopulateConfirm(false)}
            >
              <View
                style={[styles.modalContentCentered, { maxWidth: 400, width: "90%", backgroundColor: "#ffffff" }]}
                onStartShouldSetResponder={() => true}
              >
                <Text style={styles.modalTitle}>
                  GENERATE ROSTERS
                </Text>
                <Text style={styles.modalSubtitle}>
                  This will automatically assign surveyors to meet demand requirements.
                </Text>
                <Text style={{ color: "#000000", fontSize: 12, marginBottom: 20, lineHeight: 18 }}>
                  • Existing assignments will be preserved{'\n'}
                  • Surveyors will be assigned to meet demand{'\n'}
                  • All business rules will be respected{'\n'}
                  • Each surveyor will get approximately 9 shifts per fortnight
                </Text>
                
                <View style={{ flexDirection: "row", marginTop: 20 }}>
                  <Pressable
                    onPress={() => setAutoPopulateConfirm(false)}
                    style={[styles.modalButton, styles.modalButtonSecondary, { flex: 1, marginRight: 8 }]}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={confirmAutoPopulate}
                    style={[styles.modalButton, styles.modalButtonPrimary, { flex: 1, marginLeft: 8 }]}
                  >
                    <Text style={[styles.modalButtonText, styles.modalButtonTextPrimary]}>
                      Auto-Populate
                    </Text>
                  </Pressable>
                </View>
              </View>
            </Pressable>
          </Modal>
        )}

        {/* Shift selection modal */}
        {shiftSelectMode && (
          <Modal
            visible={!!shiftSelectMode}
            transparent
            animationType="fade"
            onRequestClose={() => setShiftSelectMode(null)}
          >
            <Pressable
              style={styles.modalOverlayCentered}
              onPress={() => setShiftSelectMode(null)}
            >
              <View
                style={[styles.modalContentCentered, { maxWidth: 350, width: "90%", backgroundColor: "#ffffff" }]}
                onStartShouldSetResponder={() => true}
              >
                <Text style={styles.modalTitle}>
                  SELECT SHIFT
                </Text>
                <Text style={styles.modalSubtitle}>
                  {format(new Date(shiftSelectMode.dateKey), "EEE d MMM yyyy")}
                </Text>
                <Text style={{ color: "#000000", fontSize: 12, marginBottom: 20 }}>
                  {getName(shiftSelectMode.surveyorId)}
                </Text>
                
                <View style={{ marginBottom: 20 }}>
                  <Pressable
                    onPress={() => handleShiftSelect(SHIFT.DAY)}
                    style={[styles.shiftButton, { marginBottom: 12 }]}
                  >
                    <Text style={styles.shiftButtonText}>DAY SHIFT</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleShiftSelect(SHIFT.NIGHT)}
                    style={[styles.shiftButton, { marginBottom: 12 }]}
                  >
                    <Text style={styles.shiftButtonText}>NIGHT SHIFT</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleShiftSelect(SHIFT.OFF)}
                    style={styles.shiftButton}
                  >
                    <Text style={styles.shiftButtonText}>OFF</Text>
                  </Pressable>
                </View>

                <Pressable
                  onPress={() => setShiftSelectMode(null)}
                  style={styles.modalCloseButton}
                >
                  <Text style={styles.modalCloseText}>CANCEL</Text>
                </Pressable>
              </View>
            </Pressable>
          </Modal>
        )}

        {/* Unavailability Modal */}
        {unavailabilityModal && (
          <Modal
            visible={!!unavailabilityModal}
            transparent
            animationType="fade"
            onRequestClose={() => setUnavailabilityModal(null)}
          >
            <Pressable
              style={styles.modalOverlayCentered}
              onPress={() => setUnavailabilityModal(null)}
            >
              <View
                style={[styles.modalContentCentered, { maxWidth: 400, width: "90%", backgroundColor: "#ffffff" }]}
                onStartShouldSetResponder={() => true}
              >
                <Text style={styles.modalTitle}>
                  Cannot Assign
                </Text>
                <Text style={styles.modalSubtitle}>
                  {unavailabilityModal.surveyorName} cannot be rostered due to unavailability on {unavailabilityModal.date}.
                </Text>
                
                <View style={{ marginTop: 20 }}>
                  <Pressable
                    onPress={() => setUnavailabilityModal(null)}
                    style={[styles.modalButton, styles.modalButtonPrimary, { width: "100%" }]}
                  >
                    <Text style={[styles.modalButtonText, styles.modalButtonTextPrimary]}>
                      OK
                    </Text>
                  </Pressable>
                </View>
              </View>
            </Pressable>
          </Modal>
        )}

        {/* Cross-Area Conflict Modal */}
        {crossAreaConflictModal && (
          <Modal
            visible={!!crossAreaConflictModal}
            transparent
            animationType="fade"
            onRequestClose={() => setCrossAreaConflictModal(null)}
          >
            <Pressable
              style={styles.modalOverlayCentered}
              onPress={() => setCrossAreaConflictModal(null)}
            >
              <View
                style={[styles.modalContentCentered, { maxWidth: 400, width: "90%", backgroundColor: "#ffffff" }]}
                onStartShouldSetResponder={() => true}
              >
                <Text style={styles.modalTitle}>
                  Cannot Assign
                </Text>
                <Text style={styles.modalSubtitle}>
                  {crossAreaConflictModal.surveyorName} is already rostered in {crossAreaConflictModal.otherAreaName} on {crossAreaConflictModal.date}. They cannot work in both areas on the same day.
                </Text>
                
                <View style={{ marginTop: 20 }}>
                  <Pressable
                    onPress={() => setCrossAreaConflictModal(null)}
                    style={[styles.modalButton, styles.modalButtonPrimary, { width: "100%" }]}
                  >
                    <Text style={[styles.modalButtonText, styles.modalButtonTextPrimary]}>
                      OK
                    </Text>
                  </Pressable>
                </View>
              </View>
            </Pressable>
          </Modal>
        )}

        {/* Unsaved Changes Modal */}
        {unsavedChangesModal && (
          <Modal
            visible={!!unsavedChangesModal}
            transparent
            animationType="fade"
            onRequestClose={handleCancelAreaSwitch}
          >
            <Pressable
              style={styles.modalOverlayCentered}
              onPress={handleCancelAreaSwitch}
            >
              <View
                style={[styles.modalContentCentered, { maxWidth: 450, width: "90%", backgroundColor: "#ffffff" }]}
                onStartShouldSetResponder={() => true}
              >
                <Text style={styles.modalTitle}>
                  UNSAVED CHANGES
                </Text>
                <Text style={styles.modalSubtitle}>
                  You have unsaved changes to the roster. What would you like to do?
                </Text>

                <View style={{ marginVertical: 20 }}>
                  <Text style={{ color: "#000000", fontSize: 14, lineHeight: 20, textAlign: "center" }}>
                    Switching to {pendingAreaSwitch === "SOUTH" ? "STSP" : "NTNP"} will discard your current unsaved changes.
                  </Text>
                </View>

                <View style={{ flexDirection: "row", marginTop: 20 }}>
                  <Pressable
                    onPress={handleCancelAreaSwitch}
                    style={[styles.modalButton, styles.modalButtonSecondary, { flex: 1, marginRight: 8 }]}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      // Close unsaved changes modal and open confirm modal
                      // The area switch will happen after roster is confirmed (handled in onConfirmRoster)
                      setUnsavedChangesModal(false);
                      handleConfirmRosterClick();
                    }}
                    style={[styles.modalButton, styles.modalButtonPrimary, { flex: 1, marginRight: 8 }]}
                  >
                    <Text style={[styles.modalButtonText, styles.modalButtonTextPrimary]}>
                      Save & Switch
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleDiscardChanges}
                    style={[styles.modalButton, { flex: 1, marginLeft: 8, backgroundColor: "#ef4444", borderColor: "#dc2626" }]}
                  >
                    <Text style={[styles.modalButtonText, { color: "#ffffff" }]}>
                      Discard & Switch
                    </Text>
                  </Pressable>
                </View>
              </View>
            </Pressable>
          </Modal>
        )}

        {/* Confirm Roster Modal */}
        {confirmRosterModal && (
          <Modal
            visible={!!confirmRosterModal}
            transparent
            animationType="fade"
            onRequestClose={() => {
              setConfirmRosterModal(false);
            }}
          >
            <Pressable
              style={styles.modalOverlayCentered}
              onPress={() => {
                setConfirmRosterModal(false);
              }}
            >
              <View
                style={[styles.modalContentCentered, { maxWidth: 450, width: "90%", backgroundColor: "#ffffff" }]}
                onStartShouldSetResponder={() => true}
              >
                <Text style={styles.modalTitle}>
                  CONFIRM ROSTER
                </Text>
                <Text style={styles.modalSubtitle}>
                  Review roster details before confirming
                </Text>
                
                <View style={{ marginVertical: 20 }}>
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ color: "#000000", fontWeight: "600", fontSize: 14, marginBottom: 4 }}>
                      Period:
                    </Text>
                    <Text style={{ color: "#000000", fontSize: 13 }}>
                      {format(startOfWeek(anchorDate, { weekStartsOn: 1 }), "d MMM yyyy")} - {format(addDays(startOfWeek(anchorDate, { weekStartsOn: 1 }), 6), "d MMM yyyy")}
                    </Text>
                  </View>

                  {(() => {
                    // Calculate week date keys (7 days only)
                    const weekStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
                    const weekDateKeys = Array.from({ length: 7 }, (_, i) => 
                      format(addDays(weekStart, i), "yyyy-MM-dd")
                    );
                    
                    // Filter byDate to only include current week dates
                    const weekAssignments = {};
                    weekDateKeys.forEach(dateKey => {
                      if (byDate[dateKey]) {
                        weekAssignments[dateKey] = byDate[dateKey];
                      }
                    });
                    
                    const totalAssignments = Object.values(weekAssignments).reduce((sum, assignments) => sum + assignments.length, 0);
                    const dayShifts = Object.values(weekAssignments).reduce((sum, assignments) => 
                      sum + assignments.filter(a => a.shift === SHIFT.DAY).length, 0
                    );
                    const nightShifts = Object.values(weekAssignments).reduce((sum, assignments) => 
                      sum + assignments.filter(a => a.shift === SHIFT.NIGHT).length, 0
                    );
                    const confirmedCount = Object.values(weekAssignments).reduce((sum, assignments) => 
                      sum + assignments.filter(a => a.confirmed).length, 0
                    );

                    return (
                      <View>
                        <Text style={{ color: "#000000", fontWeight: "600", fontSize: 14, marginBottom: 8 }}>
                          Summary:
                        </Text>
                        <Text style={{ color: "#000000", fontSize: 13, marginBottom: 4 }}>
                          • Total Assignments: {totalAssignments}
                        </Text>
                        <Text style={{ color: "#000000", fontSize: 13, marginBottom: 4 }}>
                          • Day Shifts: {dayShifts}
                        </Text>
                        <Text style={{ color: "#000000", fontSize: 13, marginBottom: 4 }}>
                          • Night Shifts: {nightShifts}
                        </Text>
                        <Text style={{ color: "#000000", fontSize: 13, marginBottom: 4 }}>
                          • Confirmed: {confirmedCount}
                        </Text>
                      </View>
                    );
                  })()}

                  {(() => {
                    const visibleIssues = validationIssues.filter((_, idx) => !ignoredIssues.has(idx));
                    return visibleIssues.length > 0 && showValidationIssues && (
                      <View style={{ marginTop: 12, padding: 12, backgroundColor: "rgba(251, 191, 36, 0.1)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(251, 191, 36, 0.3)" }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <Text style={{ color: "#000000", fontWeight: "600", fontSize: 13 }}>
                            ⚠️ Validation Issues ({visibleIssues.length}):
                          </Text>
                          <Pressable
                            onPress={() => setShowValidationIssues(false)}
                            style={{ padding: 2 }}
                          >
                            <Text style={{ color: "#fbbf24", fontWeight: "600", fontSize: 12 }}>
                              Hide
                            </Text>
                          </Pressable>
                        </View>
                        <ScrollView style={{ maxHeight: 100 }}>
                          {visibleIssues.slice(0, 3).map((issue, idx) => {
                            const originalIdx = validationIssues.indexOf(issue);
                            return (
                              <View key={originalIdx} style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 4, gap: 4 }}>
                                <Text style={{ color: "#000000", fontSize: 12 }}>
                                  • {issue}
                                </Text>
                                <Pressable
                                  onPress={() => setIgnoredIssues(prev => new Set([...prev, originalIdx]))}
                                  style={{ padding: 2 }}
                                >
                                  <Text style={{ color: "#999", fontSize: 11 }}>
                                    Ignore
                                  </Text>
                                </Pressable>
                              </View>
                            );
                          })}
                          {visibleIssues.length > 3 && (
                            <Text style={{ color: "#000000", fontSize: 12, fontStyle: "italic" }}>
                              ... and {visibleIssues.length - 3} more
                            </Text>
                          )}
                        </ScrollView>
                      </View>
                    );
                  })()}
                  {(() => {
                    const visibleIssues = validationIssues.filter((_, idx) => !ignoredIssues.has(idx));
                    return visibleIssues.length > 0 && !showValidationIssues && (
                      <Pressable
                        onPress={() => setShowValidationIssues(true)}
                        style={{ marginTop: 12, padding: 12, backgroundColor: "rgba(251, 191, 36, 0.1)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(251, 191, 36, 0.3)", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                      >
                        <Text style={{ color: "#000000", fontWeight: "600", fontSize: 13 }}>
                          ⚠️ Validation Issues ({visibleIssues.length}) - Hidden
                        </Text>
                        <Text style={{ color: "#fbbf24", fontWeight: "600", fontSize: 12 }}>
                          Show
                        </Text>
                      </Pressable>
                    );
                  })()}
                </View>

                <View style={{ flexDirection: "row", marginTop: 20 }}>
                  <Pressable
                    onPress={() => {
                      setConfirmRosterModal(false);
                    }}
                    style={[styles.modalButton, styles.modalButtonSecondary, { flex: 1, marginRight: 8 }]}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      console.log("[CONFIRM ROSTER] Button clicked");
                      if (!confirmingRoster) {
                        onConfirmRoster();
                      }
                    }}
                    disabled={confirmingRoster}
                    style={[
                      styles.modalButton, 
                      styles.modalButtonPrimary, 
                      { flex: 1, marginLeft: 8 },
                      confirmingRoster && { opacity: 0.6 }
                    ]}
                  >
                    {confirmingRoster ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={[styles.modalButtonText, styles.modalButtonTextPrimary]}>
                        Confirm & Save
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </Pressable>
          </Modal>
        )}

        {/* Roster Management Modal */}
        {rosterManagementModal && (
          <Modal
            visible={!!rosterManagementModal}
            transparent
            animationType="fade"
            onRequestClose={() => setRosterManagementModal(false)}
          >
            <Pressable
              style={styles.modalOverlayCentered}
              onPress={() => setRosterManagementModal(false)}
            >
              <View
                style={[styles.modalContentCentered, { maxWidth: 500, width: "90%", backgroundColor: "#ffffff", maxHeight: "80%" }]}
                onStartShouldSetResponder={() => true}
              >
                <Text style={styles.modalTitle}>
                  MANAGE ROSTERS
                </Text>
                <Text style={styles.modalSubtitle}>
                  {area === "SOUTH" ? "STSP" : "NTNP"} rosters - Load or delete saved rosters
                </Text>
                
                <ScrollView key={rosterListKey} style={{ maxHeight: 400, marginVertical: 20 }}>
                  {savedRosters.length === 0 ? (
                    <Text style={{ color: "#666666", textAlign: "center", padding: 20 }}>
                      No saved rosters found
                    </Text>
                  ) : (
                    savedRosters.map((roster, index) => (
                      <View
                        key={`${roster.id}-${rosterListKey}-${index}`}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: 12,
                          borderWidth: 1,
                          borderColor: "#e5e5e5",
                          borderRadius: 8,
                          marginBottom: 8,
                          backgroundColor: "#f9f9f9",
                        }}
                        onStartShouldSetResponder={() => true}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: "#000000", fontWeight: "600", fontSize: 14 }}>
                            {format(parseISO(roster.startDate || roster.createdAt), "d MMM yyyy")} - {format(parseISO(roster.endDate || roster.createdAt), "d MMM yyyy")}
                          </Text>
                          <Text style={{ color: "#666666", fontSize: 12, marginTop: 4 }}>
                            {roster.area === "NORTH" ? "NTNP" : "STSP"} • Status: {roster.status || "draft"} • Created: {format(parseISO(roster.createdAt), "d MMM yyyy")}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              handleLoadRoster(roster.id);
                            }}
                            style={{
                              padding: 8,
                              borderRadius: 6,
                              backgroundColor: "rgba(251, 191, 36, 0.2)",
                              borderWidth: 1,
                              borderColor: "#fbbf24",
                            }}
                          >
                            <Text style={{ color: "#000000", fontWeight: "600", fontSize: 12 }}>
                              Load
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              handleDeleteRoster(roster.id);
                            }}
                            style={{
                              padding: 8,
                              borderRadius: 6,
                              backgroundColor: "rgba(255, 0, 0, 0.1)",
                              borderWidth: 1,
                              borderColor: "#cc0000",
                            }}
                          >
                            <Text style={{ color: "#cc0000", fontWeight: "600", fontSize: 12 }}>
                              Delete
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ))
                  )}
                </ScrollView>

                <Pressable
                  onPress={() => setRosterManagementModal(false)}
                  style={styles.modalCloseButton}
                >
                  <Text style={styles.modalCloseText}>Close</Text>
                </Pressable>
              </View>
            </Pressable>
          </Modal>
        )}

        {/* Edit modal */}
        <EditModal
          visible={!!edit}
          assignment={edit?.assignment}
          surveyorName={edit ? getName(edit.assignment.surveyorId) : ""}
          dateKey={edit?.dateKey}
          onClose={() => setEdit(null)}
          onSave={(patch) => {
            updateAssignment(edit.dateKey, edit.assignment.id, patch);
            setEdit(null);
          }}
        />
      </View>
      </ScrollView>
    </Container>
  );

  // Web fallback: wrap in regular View instead of DraxProvider
  if (isWeb) {
    return RosterContent;
  }

  // Native: use DraxProvider for drag and drop
  return <DraxProvider>{RosterContent}</DraxProvider>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    zIndex: 1,
  },
  content: {
    padding: Platform.OS === "web" ? 8 : 6,
    paddingTop: Platform.OS === "web" ? 56 : 60,
    paddingBottom: Platform.OS === "web" ? 8 : 6,
  },
  surveyorStrip: {
    marginBottom: 8,
  },
  surveyorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Platform.OS === "web" ? 6 : 8,
    paddingHorizontal: Platform.OS === "web" ? 10 : 12,
    borderRadius: 8,
    backgroundColor: "#f9f9f9",
    borderWidth: 1.5,
    borderColor: "#e5e5e5",
    marginBottom: Platform.OS === "web" ? 4 : 6,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  surveyorHeaderText: {
    color: "#000000",
    fontSize: Platform.OS === "web" ? 13 : 14,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  surveyorCount: {
    color: "#000000",
    fontSize: Platform.OS === "web" ? 12 : 13,
    fontWeight: "700",
  },
  surveyorNavArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fbbf24",
    borderWidth: 2,
    borderColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 8,
    zIndex: 100,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    minWidth: 40,
    minHeight: 40,
  },
  surveyorNavArrowText: {
    color: "#000000",
    fontSize: 20,
    fontWeight: "700",
  },
  surveyorCard: {
    width: Platform.OS === "web" ? 120 : 110,
    backgroundColor: "#ffffff",
        borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 6,
    paddingVertical: Platform.OS === "web" ? 4 : 6,
    paddingHorizontal: Platform.OS === "web" ? 6 : 8,
        flexDirection: "row",
        alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
    minHeight: Platform.OS === "web" ? 44 : 50,
    maxHeight: Platform.OS === "web" ? 44 : 50,
  },
  tabsAndContentWrapper: {
    marginTop: Platform.OS === "web" ? 16 : 12,
    marginBottom: 6,
    flexDirection: "column",
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderTopWidth: 0,
    borderColor: "#dadce0",
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: "#ffffff",
    overflow: "visible",
  },
  tabBarContainer: {
    marginTop: 0,
    marginBottom: 0,
    flexDirection: "column",
    paddingLeft: 0,
    paddingRight: 0,
  },
  tabBar: {
    flexDirection: "row",
    alignItems: "flex-end", // Align tabs to bottom to eliminate gap with border
    gap: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomWidth: 1,
    borderColor: "#dadce0",
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: "transparent",
    paddingLeft: 0,
    paddingRight: 0,
    paddingBottom: 0, // Ensure no padding below tabs
    marginLeft: 0,
    marginRight: 0,
    marginBottom: 0, // Ensure no margin below tabs
    overflow: "visible",
    position: "relative",
  },
  officeTabHeadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Platform.OS === "web" ? 16 : 12,
    paddingTop: 0, // No top padding
    paddingBottom: Platform.OS === "web" ? 12 : 10,
    flexDirection: Platform.OS === "web" ? "column" : "row",
    gap: Platform.OS === "web" ? 8 : 0,
  },
  officeTabHeading: {
    fontSize: Platform.OS === "web" ? 18 : 16,
    fontWeight: "700",
    color: "#3c4043",
    textAlign: "center",
    letterSpacing: 0.5,
  },
  officeTab: {
    paddingTop: Platform.OS === "web" ? 12 : 10,
    paddingBottom: Platform.OS === "web" ? 12 : 10, // Keep padding for text, but border will be flush
    paddingHorizontal: Platform.OS === "web" ? 20 : 12,
    backgroundColor: "rgba(251, 191, 36, 0.1)",
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 1,
    borderBottomWidth: 0,
    borderColor: "#dadce0",
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginBottom: 0, // Ensure no margin below tabs
    overflow: "hidden",
  },
  officeTabFirst: {
    borderLeftWidth: 1,
  },
  officeTabActive: {
    backgroundColor: "rgb(251, 191, 36)",
    borderTopWidth: 1,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderColor: "#dadce0",
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginBottom: -1, // Overlap the border line below to hide it
    overflow: "hidden",
  },
  officeTabText: {
    color: "#3c4043",
    fontWeight: "500",
    fontSize: 14,
    letterSpacing: 0.25,
  },
  officeTabTextActive: {
    color: "#000000",
    fontWeight: "700",
    fontSize: 14,
    letterSpacing: 0.25,
  },
  tabContentContainer: {
    flexDirection: "column",
    backgroundColor: "#ffffff",
    padding: Platform.OS === "web" ? 8 : 6,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopWidth: 0,
    marginBottom: 0,
    marginTop: 0,
    marginLeft: 0,
    marginRight: 0,
    position: "relative",
  },
  controlsContainer: {
    flexDirection: "column",
    backgroundColor: "#ffffff",
    padding: Platform.OS === "web" ? 6 : 6,
    paddingTop: Platform.OS === "web" ? 6 : 6,
    borderWidth: 0,
  },
  controlsRow: {
    flexDirection: Platform.OS === "web" ? "row" : "row",
    justifyContent: Platform.OS === "web" ? "space-between" : "center",
    alignItems: Platform.OS === "web" ? "center" : "center",
    gap: Platform.OS === "web" ? 0 : 12,
    flexWrap: Platform.OS === "web" ? "nowrap" : "wrap",
  },
  mobileHeadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginRight: Platform.OS !== "web" ? 12 : 0,
    flexShrink: 0,
    width: Platform.OS !== "web" ? "100%" : "auto",
  },
  monthSlider: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: Platform.OS === "web" ? "auto" : "100%",
    marginTop: Platform.OS === "web" ? 4 : 0,
  },
  chipContainer: {
    flexDirection: "row",
  },
  chip: {
    paddingVertical: Platform.OS === "web" ? 6 : 8,
    paddingHorizontal: Platform.OS === "web" ? 12 : 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#ffffff",
    minHeight: Platform.OS === "web" ? "auto" : 40,
    justifyContent: "center",
    alignItems: "center",
  },
  chipActive: {
    backgroundColor: "rgba(251, 191, 36, 0.1)",
    borderWidth: 1,
    borderColor: "#fbbf24",
  },
  chipText: {
    color: "#000000",
    fontWeight: "600",
    fontSize: Platform.OS === "web" ? 11 : 12,
  },
  chipTextActive: {
    color: "#000000",
  },
  dateText: {
    color: "#000000",
    fontWeight: "700",
    fontSize: Platform.OS === "web" ? 14 : 14,
    letterSpacing: 0.5,
    paddingHorizontal: Platform.OS === "web" ? 0 : 8,
  },
  calendarContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: Platform.OS === "web" ? 6 : 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  validationWarning: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: "rgba(251, 191, 36, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.4)",
  },
  validationTitle: {
    color: "#000000",
    fontWeight: "700",
    marginBottom: 8,
    fontSize: 14,
  },
  validationText: {
    color: "#000000",
    fontSize: 12,
  },
  actionButtons: {
    flexDirection: "row",
    marginBottom: Platform.OS === "web" ? 0 : 16,
  },
  actionButton: {
    paddingVertical: Platform.OS === "web" ? 8 : 10,
    paddingHorizontal: Platform.OS === "web" ? 16 : 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: Platform.OS === "web" ? 8 : 6,
    minHeight: Platform.OS === "web" ? "auto" : 50,
    minWidth: Platform.OS === "web" ? 160 : 90,
    flex: Platform.OS === "web" ? 0 : 1,
    flexShrink: 0,
    flexGrow: 0,
  },
  actionButtonActive: {
    backgroundColor: "rgba(251, 191, 36, 0.2)",
    borderColor: "#fbbf24",
    borderWidth: 2,
  },
  actionButtonTextActive: {
    color: "#000000",
    fontWeight: "700",
  },
  actionButtonText: {
    color: "#000000",
    fontWeight: "600",
    fontSize: Platform.OS === "web" ? 13 : 11,
    textAlign: "center",
    lineHeight: Platform.OS === "web" ? 20 : 14,
    flexShrink: 0,
  },
  confirmButtonGlow: {
    backgroundColor: "#fbbf24",
    borderColor: "#fbbf24",
    borderWidth: 2,
    shadowColor: "#fbbf24",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },
  confirmButtonTextGlow: {
    color: "#000000",
    fontWeight: "700",
  },
  confirmButton: {
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    backgroundColor: "rgba(251, 191, 36, 0.2)",
    borderWidth: 2,
    borderColor: "#fbbf24",
    shadowColor: "#22d3ee",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  confirmButtonDisabled: {
    backgroundColor: "rgba(100, 100, 100, 0.2)",
    borderColor: "rgba(100, 100, 100, 0.5)",
  },
  confirmButtonText: {
    color: "#000000",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 1,
  },
  dayCell: {
    flex: 1,
    minHeight: Platform.OS === "web" ? 70 : 80,
    backgroundColor: "#fafafa",
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 6,
    padding: Platform.OS === "web" ? 6 : 6,
  },
  dayCellDraggingOver: {
    backgroundColor: "rgba(251, 191, 36, 0.2)",
    borderColor: "#fbbf24",
    borderWidth: 2,
  },
  dayCellToday: {
    backgroundColor: "rgba(251, 191, 36, 0.15)",
    borderColor: "#fbbf24",
    borderWidth: 2,
  },
  dayCellSurveyorAssigned: {
    backgroundColor: "rgba(34, 197, 94, 0.2)",
    borderColor: "#22c55e",
    borderWidth: 2,
  },
  dayCellSurveyorNotAssigned: {
    opacity: 0.4,
  },
  dayCellLarge: {
    minHeight: Platform.OS === "web" ? 280 : 260,
  },
  dayCellHeader: {
    color: "#000000",
    fontWeight: "700",
    fontSize: Platform.OS === "web" ? 12 : 11,
    marginBottom: Platform.OS === "web" ? 2 : 4,
  },
  dayCellHeaderToday: {
    color: "#d97706",
    fontWeight: "800",
  },
  dayCellHint: {
    color: "#666666",
    fontSize: Platform.OS === "web" ? 9 : 9,
    fontStyle: "italic",
    lineHeight: Platform.OS === "web" ? 11 : 11,
  },
  assignmentCard: {
    padding: Platform.OS === "web" ? 4 : 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#ffffff",
    marginBottom: Platform.OS === "web" ? 3 : 4,
  },
  assignmentCardSideBySide: {
    flex: 1,
    padding: 4,
    minWidth: 0, // Allows flex to work properly
  },
  assignmentCardConfirmed: {
    borderColor: "#fbbf24",
    backgroundColor: "rgba(251, 191, 36, 0.05)",
  },
  assignmentShift: {
    color: "#000000",
    fontWeight: "700",
    fontSize: Platform.OS === "web" ? 10 : 11,
  },
  assignmentName: {
    color: "#000000",
    fontSize: Platform.OS === "web" ? 9 : 10,
    opacity: 0.9,
  },
  assignmentBreak: {
    color: "#000000",
    fontSize: 10,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalOverlayCentered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Platform.OS === "web" ? 24 : 20,
    borderTopWidth: 2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.3)",
    backgroundColor: "#fff8f0",
  },
  modalContentCentered: {
    borderRadius: 16,
    padding: Platform.OS === "web" ? 24 : 20,
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.3)",
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    maxWidth: Platform.OS === "web" ? 500 : "95%",
    width: Platform.OS === "web" ? "90%" : "95%",
  },
  modalTitle: {
    color: "#000000",
    fontWeight: "800",
    fontSize: Platform.OS === "web" ? 20 : 18,
    letterSpacing: 1,
    marginBottom: Platform.OS === "web" ? 8 : 6,
  },
  modalSubtitle: {
    color: "#000000",
    fontSize: 14,
    marginBottom: 20,
  },
  inputLabel: {
    color: "#000000",
    fontWeight: "600",
    fontSize: 14,
  },
  textInput: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 6,
    padding: 12,
    backgroundColor: "#ffffff",
    color: "#000000",
    fontSize: 16,
  },
  modalButton: {
    padding: Platform.OS === "web" ? 14 : 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 6,
    backgroundColor: "#ffffff",
    alignItems: "center",
    minHeight: Platform.OS === "web" ? "auto" : 44, // Minimum touch target for mobile
    justifyContent: "center",
  },
  modalButtonActive: {
    backgroundColor: "rgba(251, 191, 36, 0.1)",
    borderColor: "#fbbf24",
  },
  modalButtonPrimary: {
    backgroundColor: "rgba(251, 191, 36, 0.1)",
    borderColor: "#fbbf24",
  },
  modalButtonText: {
    color: "#000000",
    fontWeight: "600",
    fontSize: 14,
  },
  modalButtonTextActive: {
    color: "#000000",
  },
  modalButtonTextPrimary: {
    color: "#000000",
  },
  modalCloseButton: {
    padding: 12,
    alignItems: "center",
    marginTop: 12,
  },
  modalCloseText: {
    color: "#000000",
    fontWeight: "600",
    fontSize: 12,
    letterSpacing: 0.5,
  },
  shiftButton: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#e5e5e5",
    backgroundColor: "#f9f9f9",
    alignItems: "center",
  },
  shiftButtonText: {
    color: "#000000",
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: 1,
  },
  // Mobile calendar grid styles
  mobileDayCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    padding: 6,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    minHeight: 60,
  },
  mobileDayCellToday: {
    borderColor: "#fbbf24",
    borderWidth: 2,
  },
  mobileDayName: {
    color: "#666666",
    fontWeight: "500",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  mobileDayNumber: {
    color: "#000000",
  },
  mobileDayBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "#fbbf24",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  mobileDayBadgeText: {
    color: "#000000",
    fontSize: 10,
    fontWeight: "700",
  },
  // Mobile day details modal
  mobileModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  mobileModalContent: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    paddingBottom: Platform.OS === "web" ? 0 : 20,
    width: "100%",
    flexDirection: "column",
    justifyContent: "flex-start",
  },
  mobileModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  mobileModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#000000",
    flex: 1,
  },
  mobileModalClose: {
    padding: 4,
    borderRadius: 8,
    minWidth: 36,
    minHeight: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  mobileModalBody: {
    padding: 16,
    paddingBottom: 16,
    flexGrow: 1,
  },
  gridRow: {
    justifyContent: "space-between",
    marginBottom: 12,
  },
  mobileAssignmentCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    marginBottom: 10,
    minHeight: 70,
    justifyContent: "center",
  },
  mobileAssignmentCardGrid: {
    width: "48%",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 120,
  },
  mobileAssignmentCardCurrentUser: {
    borderWidth: 3,
    borderColor: "#22c55e", // Green border for current user
    backgroundColor: "rgba(34, 197, 94, 0.1)", // Light green background
  },
  mobileAssignmentName: {
    fontSize: 16,
    fontWeight: "600",
  },
  mobileAssignmentShift: {
    fontSize: 14,
    marginTop: 2,
  },
  mobileModalFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
  },
  mobileModalButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fbbf24",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    gap: 8,
  },
  mobileModalButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000000",
  },
});

// Helper to get initials from name
function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

// Day theme color (golden yellow with transparency)
const DAY_SHIFT_COLOR = "rgba(251, 191, 36, 0.4)"; // RGBA(251, 191, 36, 0.4)
// Night theme color (dark blue/navy)
const NIGHT_SHIFT_COLOR = "#1E3A5F"; // Dark navy blue

function DraggableSurveyor({ surveyor, onPress, isAssignedInOtherArea = false, otherAreaName = "", currentDateKey = null, otherAreaAssignments = {}, area = "SOUTH", isOnLeave = false }) {
  const isWeb = Platform.OS === "web";
  const dragRef = useRef(null);
  const [showTooltip, setShowTooltip] = useState(false);
  
  // Check if surveyor is assigned in other area for any date (for drag and drop)
  const checkOtherAreaForDate = (dateKey) => {
    if (!dateKey || !otherAreaAssignments[dateKey]) return false;
    return !!otherAreaAssignments[dateKey][surveyor.id];
  };
  
  useEffect(() => {
    if (isWeb && dragRef.current) {
      // React Native Web refs point to the underlying DOM element
      const element = dragRef.current;
      
      // Check if it's actually a DOM element
      if (element && typeof element.addEventListener === 'function') {
        const handleDragStart = (e) => {
          // Check if surveyor is assigned in other area for the target date
          // We'll check this on drop, but we can disable drag if we know the date
          const targetDateKey = e.target.getAttribute("data-target-date");
          if (targetDateKey && checkOtherAreaForDate(targetDateKey)) {
            e.preventDefault();
            return false;
          }
          
          e.dataTransfer.setData("surveyorId", surveyor.id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", surveyor.id);
          element.style.opacity = "0.5";
        };
        
        const handleDragEnd = (e) => {
          element.style.opacity = (isAssignedInOtherArea || isOnLeave) ? "0.5" : "1";
        };
        
        // Only make draggable if not assigned in other area and not on leave (for current date)
        if (!isAssignedInOtherArea && !isOnLeave) {
        element.setAttribute("draggable", "true");
        element.addEventListener("dragstart", handleDragStart);
        element.addEventListener("dragend", handleDragEnd);
        } else {
          element.setAttribute("draggable", "false");
        }
        
        return () => {
          element.removeEventListener("dragstart", handleDragStart);
          element.removeEventListener("dragend", handleDragEnd);
        };
      }
    }
  }, [isWeb, surveyor.id, isAssignedInOtherArea, currentDateKey, isOnLeave]);
  
  if (isWeb) {
    return (
      <View
        ref={dragRef}
        style={[
          styles.surveyorCard, 
          isWeb && { cursor: (isAssignedInOtherArea || isOnLeave) ? "not-allowed" : "grab", userSelect: "none" },
          (isAssignedInOtherArea || isOnLeave) && { opacity: 0.5 }
        ]}
        onMouseEnter={() => (isAssignedInOtherArea || isOnLeave) && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {showTooltip && (isAssignedInOtherArea || isOnLeave) && (
          <View style={{
            position: "absolute",
            bottom: "100%",
            left: "50%",
            transform: [{ translateX: -50 }],
            marginBottom: 4,
            padding: 6,
            backgroundColor: "#333333",
            borderRadius: 4,
            zIndex: 1000,
          }}>
            <Text style={{ color: "#ffffff", fontSize: 11, whiteSpace: "nowrap" }}>
              {isOnLeave ? "On Leave" : `Already rostered in ${otherAreaName}`}
            </Text>
          </View>
        )}
        <Image
          source={{ uri: surveyor.photoUrl }}
          style={{ 
            width: Platform.OS === "web" ? 36 : 40, 
            height: Platform.OS === "web" ? 36 : 40, 
            borderRadius: Platform.OS === "web" ? 18 : 20, 
            borderWidth: 1.5, 
            borderColor: (isAssignedInOtherArea || isOnLeave) ? "#cccccc" : "#e5e5e5" 
          }}
        />
        <View style={{ width: Platform.OS === "web" ? 6 : 8 }} />
        <Text style={{ 
          color: (isAssignedInOtherArea || isOnLeave) ? "#999999" : "#000000", 
          fontWeight: "600", 
          fontSize: 11, 
          pointerEvents: "none", 
          flex: 1 
        }} numberOfLines={2}>
          {surveyor.name}
        </Text>
        {isOnLeave && (
          <Text style={{ 
            color: "#dc2626", 
            fontSize: 9, 
            marginTop: 2,
            textAlign: "center"
          }} numberOfLines={1}>
            On Leave
          </Text>
        )}
      </View>
    );
  }

  // Native: use DraxView for drag and drop
  // On mobile, disable DraxView to prevent measureLayout errors - use regular View instead
  // Note: This means drag-and-drop won't work on mobile, but the app won't crash
  if (Platform.OS !== "web") {
    // Mobile: use regular View (drag and drop disabled to prevent errors)
    return (
      <View
        style={[styles.surveyorCard, (isAssignedInOtherArea || isOnLeave) && { opacity: 0.5 }]}
      >
      <Image
        source={{ uri: surveyor.photoUrl }}
        style={{ 
          width: Platform.OS === "web" ? 36 : 40, 
          height: Platform.OS === "web" ? 36 : 40, 
          borderRadius: Platform.OS === "web" ? 18 : 20, 
          borderWidth: 1.5, 
          borderColor: (isAssignedInOtherArea || isOnLeave) ? "#cccccc" : "#fbbf24" 
        }}
      />
      <View style={{ width: 8 }} />
      <Text style={{ 
        color: (isAssignedInOtherArea || isOnLeave) ? "#999999" : "#000000", 
        fontWeight: "600", 
        fontSize: 11, 
        flex: 1 
      }} numberOfLines={2}>
        {surveyor.name}
      </Text>
      {isAssignedInOtherArea && (
        <Text style={{ 
          color: "#999999", 
          fontSize: 9, 
          marginTop: 2,
          textAlign: "center"
        }} numberOfLines={1}>
          In {otherAreaName}
        </Text>
      )}
      {isOnLeave && !isAssignedInOtherArea && (
        <Text style={{ 
          color: "#dc2626", 
          fontSize: 9, 
          marginTop: 2,
          textAlign: "center"
        }} numberOfLines={1}>
          On Leave
        </Text>
      )}
      </View>
    );
  }
  
  // Web: use DraxView for drag and drop
  // Add error boundary to catch measureLayout errors
  try {
  return (
    <DraxView
        style={[styles.surveyorCard, (isAssignedInOtherArea || isOnLeave) && { opacity: 0.5 }]}
      draggingStyle={{ opacity: 0.3 }}
      dragPayload={{ surveyorId: surveyor.id }}
      longPressDelay={120}
        draggable={!isAssignedInOtherArea && !isOnLeave}
      collapsable={false}
    >
      <Image
        source={{ uri: surveyor.photoUrl }}
          style={{ 
            width: Platform.OS === "web" ? 36 : 40, 
            height: Platform.OS === "web" ? 36 : 40, 
            borderRadius: Platform.OS === "web" ? 18 : 20, 
            borderWidth: 1.5, 
            borderColor: (isAssignedInOtherArea || isOnLeave) ? "#cccccc" : "#fbbf24" 
          }}
      />
        <View style={{ width: Platform.OS === "web" ? 6 : 8 }} />
        <Text style={{ 
          color: (isAssignedInOtherArea || isOnLeave) ? "#999999" : "#000000", 
          fontWeight: "600", 
          fontSize: 11, 
          flex: 1 
        }} numberOfLines={2}>
        {surveyor.name}
      </Text>
        {isAssignedInOtherArea && (
          <Text style={{ 
            color: "#999999", 
            fontSize: 9, 
            marginTop: 2,
            textAlign: "center"
          }} numberOfLines={1}>
            In {otherAreaName}
          </Text>
        )}
        {isOnLeave && !isAssignedInOtherArea && (
          <Text style={{ 
            color: "#dc2626", 
            fontSize: 9, 
            marginTop: 2,
            textAlign: "center"
          }} numberOfLines={1}>
            On Leave
          </Text>
        )}
    </DraxView>
  );
  } catch (error) {
    // Fallback to regular View if DraxView fails on web
    console.warn("[DraggableSurveyor] DraxView error, using fallback:", error);
    return (
      <View style={[styles.surveyorCard, (isAssignedInOtherArea || isOnLeave) && { opacity: 0.5 }]}>
        <Image
          source={{ uri: surveyor.photoUrl }}
          style={{ 
            width: Platform.OS === "web" ? 36 : 40, 
            height: Platform.OS === "web" ? 36 : 40, 
            borderRadius: Platform.OS === "web" ? 18 : 20, 
            borderWidth: 1.5, 
            borderColor: (isAssignedInOtherArea || isOnLeave) ? "#cccccc" : "#fbbf24" 
          }}
        />
        <View style={{ width: Platform.OS === "web" ? 6 : 8 }} />
        <Text style={{ 
          color: (isAssignedInOtherArea || isOnLeave) ? "#999999" : "#000000", 
          fontWeight: "600", 
          fontSize: 11, 
          flex: 1 
        }} numberOfLines={2}>
          {surveyor.name}
        </Text>
        {isAssignedInOtherArea && (
          <Text style={{ 
            color: "#999999", 
            fontSize: 9, 
            marginTop: 2,
            textAlign: "center"
          }} numberOfLines={1}>
            In {otherAreaName}
          </Text>
        )}
        {isOnLeave && !isAssignedInOtherArea && (
          <Text style={{ 
            color: "#dc2626", 
            fontSize: 9, 
            marginTop: 2,
            textAlign: "center"
          }} numberOfLines={1}>
            On Leave
          </Text>
        )}
      </View>
    );
  }
}

function WeekGrid({ days, byDate, surveyors, validationIssues = [], onDrop, onEdit, onWebAssign, rosterStartDate, ignoredIssues = new Set(), onIgnoreIssue, showValidationIssues = true, onToggleValidationIssues, isSurveyor = false, otherAreaAssignments = {}, area = "SOUTH", loadOtherAreaAssignments = null, setCrossAreaConflictModal = null, addAssignment = null, setEdit = null, setUnavailabilityModal = null, currentUserSurveyorId = null }) {
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null); // { dateKey, date } for mobile modal
  const [mobileAssignMode, setMobileAssignMode] = useState(null); // { dateKey } for mobile assign modal
  const isMobile = Platform.OS !== "web";
  
  // Check if there are any assignments in the current fortnight
  const hasAssignments = days.some(day => {
    const dateKey = format(day, "yyyy-MM-dd");
    return byDate[dateKey] && byDate[dateKey].length > 0;
  });
  
  // Filter out ignored issues
  const visibleIssues = validationIssues.filter((issue, idx) => !ignoredIssues.has(idx));
  
  // Mobile: Simple calendar grid with tap to view
  if (isMobile && days.length === 14) {
    const week1 = days.slice(0, 7);
    const week2 = days.slice(7, 14);
    const today = new Date();
    
    const getAssignmentCount = (dateKey) => {
      return (byDate[dateKey] || []).length;
    };
    
    const getDayColor = (date) => {
      // For mobile view, don't highlight assigned days - just use default colors
      const dateKey = format(date, "yyyy-MM-dd");
      const count = getAssignmentCount(dateKey);
      
      if (isSameDay(date, today)) {
        return "#fbbf24"; // Today - yellow
      }
      if (count > 0) {
        return "rgba(251, 191, 36, 0.3)"; // Has assignments - light yellow
      }
      return "#fafafa"; // No assignments - light gray
    };
    
    const getDayOpacity = (date) => {
      if (!isSurveyor || !currentUserSurveyorId) return 1;
      const dateKey = format(date, "yyyy-MM-dd");
      const assignments = byDate[dateKey] || [];
      const isLoggedInSurveyorAssigned = assignments.some(item => item.surveyorId === currentUserSurveyorId && (item.shift === "DAY" || item.shift === "NIGHT"));
      return isLoggedInSurveyorAssigned ? 1 : 0.4; // Dim days where surveyor is not assigned
    };
    
    return (
      <View style={styles.calendarContainer}>
        {/* Validation warnings */}
        {hasAssignments && visibleIssues.length > 0 && showValidationIssues && (
          <View style={[styles.validationWarning, { marginBottom: 12 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <Text style={[styles.validationTitle, { fontSize: 13 }]}>
                ⚠️ Issues ({visibleIssues.length})
              </Text>
              <Pressable
                onPress={onToggleValidationIssues}
                style={{ padding: 4 }}
              >
                <Text style={[styles.validationText, { color: "#fbbf24", fontWeight: "600", fontSize: 12 }]}>
                  {showValidationIssues ? "Hide" : "Show"}
                </Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 100 }}>
              {(showAllIssues ? visibleIssues : visibleIssues.slice(0, 3)).map((issue, idx) => {
                const originalIdx = validationIssues.indexOf(issue);
                return (
                  <View key={originalIdx} style={{ marginBottom: 3 }}>
                    <Text style={[styles.validationText, { fontSize: 11 }]}>
                      • {issue}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}
        
        {/* Mobile Calendar Grid */}
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: "#000000", marginBottom: 12, textAlign: "center" }}>
            {format(week1[0], "d MMM")} - {format(week2[6], "d MMM yyyy")}
          </Text>
          
          {/* Week 1 */}
          <View style={{ marginBottom: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: "#666666", marginBottom: 6, paddingLeft: 4 }}>
              Week 1
            </Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {week1.map((d) => {
                const dateKey = format(d, "yyyy-MM-dd");
                const count = getAssignmentCount(dateKey);
                const isToday = isSameDay(d, today);
                const assignments = byDate[dateKey] || [];
                const isLoggedInSurveyorAssigned = currentUserSurveyorId && assignments.some(item => item.surveyorId === currentUserSurveyorId && (item.shift === "DAY" || item.shift === "NIGHT"));
                return (
                  <Pressable
                    key={dateKey}
                    onPress={() => setSelectedDay({ dateKey, date: d })}
                    style={[
                      styles.mobileDayCell,
                      { 
                      backgroundColor: getDayColor(d),
                      opacity: getDayOpacity(d),
                      // No border highlighting for mobile - just dimming
                      },
                      isToday && styles.mobileDayCellToday,
                    ]}
                  >
                    <Text style={[styles.mobileDayName, { fontSize: 10 }]}>
                      {format(d, "EEE")}
                    </Text>
                    <Text style={[styles.mobileDayNumber, { fontSize: 16, fontWeight: isToday ? "700" : "600" }]}>
                      {format(d, "d")}
                    </Text>
                    {count > 0 && (
                      <View style={styles.mobileDayBadge}>
                        <Text style={styles.mobileDayBadgeText}>{count}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
          
          {/* Week 2 */}
          <View>
            <Text style={{ fontSize: 12, fontWeight: "600", color: "#666666", marginBottom: 6, paddingLeft: 4 }}>
              Week 2
            </Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {week2.map((d) => {
                const dateKey = format(d, "yyyy-MM-dd");
                const count = getAssignmentCount(dateKey);
                const isToday = isSameDay(d, today);
                const assignments = byDate[dateKey] || [];
                const isLoggedInSurveyorAssigned = currentUserSurveyorId && assignments.some(item => item.surveyorId === currentUserSurveyorId && (item.shift === "DAY" || item.shift === "NIGHT"));
                return (
                  <Pressable
                    key={dateKey}
                    onPress={() => setSelectedDay({ dateKey, date: d })}
                    style={[
                      styles.mobileDayCell,
                      { 
                      backgroundColor: getDayColor(d),
                      opacity: getDayOpacity(d),
                      // No border highlighting for mobile - just dimming
                      },
                      isToday && styles.mobileDayCellToday,
                    ]}
                  >
                    <Text style={[styles.mobileDayName, { fontSize: 10 }]}>
                      {format(d, "EEE")}
                    </Text>
                    <Text style={[styles.mobileDayNumber, { fontSize: 16, fontWeight: isToday ? "700" : "600" }]}>
                      {format(d, "d")}
                    </Text>
                    {count > 0 && (
                      <View style={styles.mobileDayBadge}>
                        <Text style={styles.mobileDayBadgeText}>{count}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
        
        {/* Day Details Modal */}
        {selectedDay && (
          <Modal
            visible={!!selectedDay}
            transparent={true}
            animationType="slide"
            onRequestClose={() => setSelectedDay(null)}
          >
            <Pressable
              style={styles.mobileModalOverlay}
              onPress={() => setSelectedDay(null)}
            >
              <View
                style={styles.mobileModalContent}
                onStartShouldSetResponder={() => true}
              >
                <View style={styles.mobileModalHeader}>
                  <Text style={styles.mobileModalTitle}>
                    {format(selectedDay.date, "EEEE, d MMMM yyyy")}
                  </Text>
                  <Pressable
                    onPress={() => setSelectedDay(null)}
                    style={styles.mobileModalClose}
                  >
                    <Ionicons name="close" size={24} color="#000000" />
                  </Pressable>
                </View>
                
                {(() => {
                  const items = byDate[selectedDay.dateKey] || [];
                  if (items.length === 0) {
                    return (
                      <View style={styles.mobileModalBody}>
                        <Text style={{ fontSize: 14, color: "#666666", textAlign: "center", paddingVertical: 20 }}>
                          No assignments for this day
                        </Text>
                      </View>
                    );
                  }
                  
                  // Sort: current user first (if rostered), then by shift
                  const sortedItems = [...items].sort((a, b) => {
                    // Check if either is the current user
                    const aIsCurrentUser = currentUserSurveyorId && a.surveyorId === currentUserSurveyorId;
                    const bIsCurrentUser = currentUserSurveyorId && b.surveyorId === currentUserSurveyorId;
                    
                    // Current user always comes first
                    if (aIsCurrentUser && !bIsCurrentUser) return -1;
                    if (!aIsCurrentUser && bIsCurrentUser) return 1;
                    
                    // If both or neither are current user, sort by shift
                    const order = { DAY: 1, NIGHT: 2, OFF: 3 };
                    return (order[a.shift] || 99) - (order[b.shift] || 99);
                  });
                  
                  return (
                    <FlatList
                      data={sortedItems}
                      numColumns={2}
                      columnWrapperStyle={styles.gridRow}
                      contentContainerStyle={styles.mobileModalBody}
                      showsVerticalScrollIndicator={true}
                      nestedScrollEnabled={true}
                      scrollEnabled={true}
                      bounces={true}
                      keyExtractor={(item) => item.id}
                      renderItem={({ item: a }) => {
                        const surveyor = surveyors.find((s) => s.id === a.surveyorId);
                        const isCurrentUser = currentUserSurveyorId && a.surveyorId === currentUserSurveyorId;
                        const backgroundColor = a.shift === "DAY" ? DAY_SHIFT_COLOR : a.shift === "NIGHT" ? NIGHT_SHIFT_COLOR : "#ffffff";
                        const textColor = a.shift === "NIGHT" ? "#ffffff" : "#000000";
                        
                        return (
                          <Pressable
                            onPress={() => {
                              if (!isSurveyor) {
                                onEdit(selectedDay.dateKey, a);
                              }
                              setSelectedDay(null);
                            }}
                            disabled={isSurveyor}
                            style={[
                              styles.mobileAssignmentCardGrid,
                              { backgroundColor },
                              a.confirmed && styles.assignmentCardConfirmed,
                              isCurrentUser && styles.mobileAssignmentCardCurrentUser,
                            ]}
                          >
                            {surveyor?.photoUrl && (
                              <Image
                                source={{ uri: surveyor.photoUrl }}
                                style={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: 20,
                                  borderWidth: 2,
                                  borderColor: textColor === "#ffffff" ? "#ffffff" : "#e5e5e5",
                                  marginBottom: 8,
                                }}
                              />
                            )}
                            <Text style={[styles.mobileAssignmentName, { color: textColor, fontSize: 14, fontWeight: "600" }]} numberOfLines={2}>
                              {surveyor?.name || a.surveyorId}
                            </Text>
                            <Text style={[styles.mobileAssignmentShift, { color: textColor, fontSize: 12 }]}>
                              {a.shift} {a.confirmed && "✓"}
                            </Text>
                          </Pressable>
                        );
                      }}
                    />
                  );
                })()}
                
                {!isSurveyor && (
                  <View style={styles.mobileModalFooter}>
                    <Pressable
                      onPress={async () => {
                        // Set mobile assign mode and load other area assignments
                        setMobileAssignMode({ dateKey: selectedDay.dateKey });
                        if (loadOtherAreaAssignments) {
                          await loadOtherAreaAssignments(selectedDay.dateKey);
                        }
                        setSelectedDay(null);
                      }}
                      style={styles.mobileModalButton}
                    >
                      <Ionicons name="add-circle-outline" size={20} color="#000000" />
                      <Text style={styles.mobileModalButtonText}>Add Assignment</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </Pressable>
          </Modal>
        )}
        
        {/* Mobile: Surveyor selection modal */}
        {isMobile && mobileAssignMode && (
          <Modal
            visible={!!mobileAssignMode}
            transparent={true}
            animationType="slide"
            onRequestClose={() => setMobileAssignMode(null)}
          >
            <Pressable
              style={styles.mobileModalOverlay}
              onPress={() => setMobileAssignMode(null)}
            >
              <Pressable
                style={[styles.mobileModalContent, { maxHeight: "90%" }]}
                onPress={(e) => e.stopPropagation()}
              >
                <View style={styles.mobileModalHeader}>
                  <Text style={styles.mobileModalTitle}>
                    Select Surveyor
                  </Text>
                  <Pressable
                    onPress={() => setMobileAssignMode(null)}
                    style={styles.mobileModalClose}
                  >
                    <Ionicons name="close" size={24} color="#000000" />
                  </Pressable>
                </View>
                
                <Text style={{ fontSize: 14, color: "#666666", paddingHorizontal: 16, marginBottom: 12 }}>
                  {format(parseISO(mobileAssignMode.dateKey), "EEEE, d MMMM yyyy")}
                </Text>
                
                <ScrollView style={styles.mobileModalBody}>
                  {surveyors
                    .filter((s) => s.active)
                    .map((s) => {
                      const dateKey = mobileAssignMode.dateKey;
                      const assignmentsForDay = byDate[dateKey] || [];
                      const isAssigned = assignmentsForDay.some(a => a.surveyorId === s.id);
                      const assignment = assignmentsForDay.find(a => a.surveyorId === s.id);
                      
                      // Check if surveyor is assigned in the other area
                      const otherAreaAssignment = otherAreaAssignments[dateKey]?.[s.id];
                      const isAssignedInOtherArea = !!otherAreaAssignment;
                      const otherAreaName = otherAreaAssignment?.area || (area === "SOUTH" ? "NTNP" : "STSP");
                      
                      // Check if surveyor is on leave for this date
                      const nonAvailability = s.nonAvailability || [];
                      const isOnLeave = nonAvailability.includes(dateKey);
                      
                      const isDisabled = (isAssignedInOtherArea && !isAssigned) || isOnLeave;
                      
                      return (
                        <Pressable
                          key={s.id}
                          onPress={() => {
                            if (isDisabled) {
                              if (isOnLeave && setUnavailabilityModal) {
                                setUnavailabilityModal({
                                  surveyorName: s.name,
                                  date: format(parseISO(dateKey), "d MMM yyyy"),
                                });
                              } else if (isAssignedInOtherArea && setCrossAreaConflictModal) {
                                setCrossAreaConflictModal({
                                  surveyorName: s.name,
                                  otherAreaName: otherAreaName,
                                  date: format(parseISO(dateKey), "d MMM yyyy"),
                                });
                              }
                              return;
                            }
                            // If surveyor already has an assignment, open edit modal
                            if (isAssigned && assignment && setEdit) {
                              setEdit({ dateKey, assignment: assignment });
                              setMobileAssignMode(null);
                            } else if (addAssignment) {
                              // Add new assignment
                              addAssignment(dateKey, s.id);
                              setMobileAssignMode(null);
                            }
                          }}
                          disabled={isDisabled}
                          style={[
                            styles.mobileAssignmentCard,
                            isAssigned && assignment && { backgroundColor: assignment.shift === "NIGHT" ? "rgba(30, 58, 95, 0.1)" : "rgba(251, 191, 36, 0.1)" },
                            isDisabled && { opacity: 0.5, backgroundColor: "#f9fafb" },
                          ]}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                            {s.photoUrl && (
                              <Image
                                source={{ uri: s.photoUrl }}
                                style={{
                                  width: Platform.OS === "web" ? 40 : 44,
                                  height: Platform.OS === "web" ? 40 : 44,
                                  borderRadius: Platform.OS === "web" ? 20 : 22,
                                  borderWidth: 2,
                                  borderColor: isAssigned 
                                    ? (assignment?.shift === "NIGHT" ? NIGHT_SHIFT_COLOR : "#fbbf24")
                                    : isDisabled 
                                    ? "#d1d5db" 
                                    : "#e5e5e5",
                                  marginRight: 12,
                                  backgroundColor: "#f3f4f6",
                                }}
                              />
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.mobileAssignmentName, { color: isDisabled ? "#9ca3af" : "#000000" }]}>
                                {s.name}
                              </Text>
                              {isAssigned && assignment && (
                                <Text style={[styles.mobileAssignmentShift, { color: assignment.shift === "NIGHT" ? NIGHT_SHIFT_COLOR : "#d97706" }]}>
                                  {assignment.shift} Shift
                                </Text>
                              )}
                              {isDisabled && !isAssigned && (
                                <Text style={[styles.mobileAssignmentShift, { color: isOnLeave ? "#dc2626" : "#6b7280" }]}>
                                  {isOnLeave ? "🏖️ On Leave" : `⚠️ Rostered in ${otherAreaName}`}
                                </Text>
                              )}
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>
        )}
      </View>
    );
  }
  
  // If 14 days (fortnight), split into two weeks (WEB VERSION)
  if (days.length === 14) {
    const week1 = days.slice(0, 7);
    const week2 = days.slice(7, 14);
    
  return (
      <View style={styles.calendarContainer}>
        {/* Validation warnings - above Week 1 - only show if there are assignments */}
        {hasAssignments && visibleIssues.length > 0 && showValidationIssues && (
          <View style={[styles.validationWarning, { marginBottom: 16 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <Text style={styles.validationTitle}>
                ⚠️ Validation Issues ({visibleIssues.length})
              </Text>
              <Pressable
                onPress={onToggleValidationIssues}
                style={{ padding: 2 }}
              >
                <Text style={[styles.validationText, { color: "#fbbf24", fontWeight: "600" }]}>
                  {showValidationIssues ? "Hide" : "Show"}
                </Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: showAllIssues ? 300 : 120 }}>
              {(showAllIssues ? visibleIssues : visibleIssues.slice(0, 5)).map((issue, idx) => {
                const originalIdx = validationIssues.indexOf(issue);
                return (
                  <View key={originalIdx} style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 4, gap: 4 }}>
                    <Text style={[styles.validationText, { flex: 1 }]}>
                      • {issue}
                    </Text>
                    <Pressable
                      onPress={() => onIgnoreIssue(originalIdx)}
                      style={{ padding: 2 }}
                    >
                      <Text style={[styles.validationText, { color: "#999", fontSize: 11 }]}>
                        Ignore
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
              {visibleIssues.length > 5 && !showAllIssues && (
                <Pressable
                  onPress={() => setShowAllIssues(true)}
                  style={{ marginTop: 8 }}
                >
                  <Text style={[styles.validationText, { color: "#fbbf24", fontWeight: "600", textDecorationLine: "underline" }]}>
                    Click to view all {visibleIssues.length} issues
                  </Text>
                </Pressable>
              )}
              {showAllIssues && visibleIssues.length > 5 && (
                <Pressable
                  onPress={() => setShowAllIssues(false)}
                  style={{ marginTop: 8 }}
                >
                  <Text style={[styles.validationText, { color: "#fbbf24", fontWeight: "600", textDecorationLine: "underline" }]}>
                    Show less
                  </Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
        )}
        {hasAssignments && visibleIssues.length > 0 && !showValidationIssues && (
          <Pressable
            onPress={onToggleValidationIssues}
            style={[styles.validationWarning, { marginBottom: 16, padding: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }]}
          >
            <Text style={styles.validationTitle}>
              ⚠️ Validation Issues ({visibleIssues.length}) - Hidden
            </Text>
            <Text style={[styles.validationText, { color: "#fbbf24", fontWeight: "600" }]}>
              Show
            </Text>
          </Pressable>
        )}
        
        {/* Week 1 - Top */}
        <View style={{ marginBottom: Platform.OS === "web" ? 8 : 12 }}>
          <Text style={{ fontSize: Platform.OS === "web" ? 11 : 12, fontWeight: "700", color: "#000000", marginBottom: Platform.OS === "web" ? 4 : 6, paddingLeft: 4 }}>
            Week 1: {format(week1[0], "EEE d MMM")} - {format(week1[6], "EEE d MMM")}
          </Text>
          <View style={{ flexDirection: "row" }}>
            {week1.map((d, idx) => {
          const dateKey = format(d, "yyyy-MM-dd");
          return (
                <View key={dateKey} style={{ flex: 1, marginLeft: idx > 0 ? (Platform.OS === "web" ? 4 : 6) : 0 }}>
            <DayCell
              date={d}
              dateKey={dateKey}
              items={byDate[dateKey] ?? []}
                    surveyors={surveyors}
              onDrop={onDrop}
              onEdit={onEdit}
                    onWebAssign={onWebAssign}
              compact={false}
              rosterStartDate={rosterStartDate}
              isSurveyor={isSurveyor}
              otherAreaAssignments={otherAreaAssignments}
              area={area}
              loadOtherAreaAssignments={loadOtherAreaAssignments}
              setCrossAreaConflictModal={setCrossAreaConflictModal}
              currentUserSurveyorId={currentUserSurveyorId}
                  />
                </View>
              );
            })}
          </View>
        </View>
        
        {/* Week 2 - Bottom */}
        <View>
          <Text style={{ fontSize: Platform.OS === "web" ? 11 : 12, fontWeight: "700", color: "#000000", marginBottom: Platform.OS === "web" ? 4 : 6, paddingLeft: 4 }}>
            Week 2: {format(week2[0], "EEE d MMM")} - {format(week2[6], "EEE d MMM")}
          </Text>
          <View style={{ flexDirection: "row" }}>
            {week2.map((d, idx) => {
              const dateKey = format(d, "yyyy-MM-dd");
              return (
                <View key={dateKey} style={{ flex: 1, marginLeft: idx > 0 ? (Platform.OS === "web" ? 4 : 6) : 0 }}>
                  <DayCell
                    date={d}
                    dateKey={dateKey}
                    items={byDate[dateKey] ?? []}
              surveyors={surveyors}
                    onDrop={onDrop}
                    onEdit={onEdit}
                    onWebAssign={onWebAssign}
                    compact={false}
                    isSurveyor={isSurveyor}
                    otherAreaAssignments={otherAreaAssignments}
                    area={area}
                    loadOtherAreaAssignments={loadOtherAreaAssignments}
                    setCrossAreaConflictModal={setCrossAreaConflictModal}
                    currentUserSurveyorId={currentUserSurveyorId}
            />
                </View>
          );
        })}
          </View>
      </View>
    </View>
  );
}

  // Regular week view (7 days)
  return (
    <View style={styles.calendarContainer}>
      <View style={{ flexDirection: "row" }}>
        {days.map((d, idx) => {
          const dateKey = format(d, "yyyy-MM-dd");
          return (
            <View key={dateKey} style={{ flex: 1, marginLeft: idx > 0 ? (Platform.OS === "web" ? 4 : 6) : 0 }}>
            <DayCell
              date={d}
              dateKey={dateKey}
              items={byDate[dateKey] ?? []}
                surveyors={surveyors}
              onDrop={onDrop}
              onEdit={onEdit}
                onWebAssign={onWebAssign}
              compact={false}
              rosterStartDate={rosterStartDate}
              otherAreaAssignments={otherAreaAssignments}
              area={area}
              loadOtherAreaAssignments={loadOtherAreaAssignments}
              setCrossAreaConflictModal={setCrossAreaConflictModal}
              currentUserSurveyorId={currentUserSurveyorId}
            />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MonthGrid({ days, byDate, surveyors, onDrop, onEdit, onWebAssign, rosterStartDate, isSurveyor = false, otherAreaAssignments = {}, area = "SOUTH", loadOtherAreaAssignments = null, setCrossAreaConflictModal = null, addAssignment = null, setEdit = null, setUnavailabilityModal = null, currentUserSurveyorId = null }) {
  const isMobile = Platform.OS !== "web";
  
  const [selectedDay, setSelectedDay] = useState(null); // { dateKey, date } for mobile modal
  const [mobileAssignMode, setMobileAssignMode] = useState(null); // { dateKey } for mobile assign modal

  // Debug: Log when mobileAssignMode changes
  useEffect(() => {
    if (mobileAssignMode) {
      console.log(`[MOBILE] mobileAssignMode state updated:`, mobileAssignMode);
    } else {
      console.log(`[MOBILE] mobileAssignMode state cleared`);
    }
  }, [mobileAssignMode]);

  // Mobile: Simplified calendar grid with day names and tap to view
  if (isMobile) {
    const today = new Date();
    const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    
    // Calculate which weekday the first day of the month falls on (0 = Sunday, 1 = Monday, etc.)
    // Adjust to Monday = 0, Tuesday = 1, ..., Sunday = 6
    const firstDay = days.length > 0 ? days[0] : new Date();
    const firstDayOfWeek = firstDay.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const offset = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // Convert to Monday = 0
    
    // Create calendar grid with proper alignment
    const calendarDays = [];
    // Add empty placeholders at the beginning to align first day to correct weekday
    for (let i = 0; i < offset; i++) {
      calendarDays.push(null);
    }
    // Add all days of the month
    days.forEach(day => calendarDays.push(day));
    // Pad the end to complete the last row
    while (calendarDays.length % 7 !== 0) {
      calendarDays.push(null);
    }
    
    // Split into rows of 7
  const rows = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      rows.push(calendarDays.slice(i, i + 7));
    }
    
    const getAssignmentCount = (dateKey) => {
      return (byDate[dateKey] || []).length;
    };
    
    const getDayColor = (date) => {
      // For mobile view, don't highlight assigned days - just use default colors
      const dateKey = format(date, "yyyy-MM-dd");
      const count = getAssignmentCount(dateKey);
      
      if (isSameDay(date, today)) {
        return "#fbbf24"; // Today - yellow
      }
      if (count > 0) {
        return "rgba(251, 191, 36, 0.3)"; // Has assignments - light yellow
      }
      return "#fafafa"; // No assignments - light gray
    };
    
    const getDayOpacity = (date) => {
      if (!isSurveyor || !currentUserSurveyorId) return 1;
      const dateKey = format(date, "yyyy-MM-dd");
      const assignments = byDate[dateKey] || [];
      const isLoggedInSurveyorAssigned = assignments.some(item => item.surveyorId === currentUserSurveyorId && (item.shift === "DAY" || item.shift === "NIGHT"));
      return isLoggedInSurveyorAssigned ? 1 : 0.4; // Dim days where surveyor is not assigned
    };
    
    return (
      <View style={styles.calendarContainer}>
        {/* Week day headers */}
        <View style={{ flexDirection: "row", marginBottom: 8, paddingHorizontal: 4 }}>
          {weekDays.map((day, idx) => (
            <View key={day} style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: "#666666" }}>
                {day}
              </Text>
            </View>
          ))}
        </View>
        
        {/* Calendar rows */}
        {rows.map((row, ri) => (
          <View key={ri} style={{ flexDirection: "row", marginBottom: ri < rows.length - 1 ? 8 : 0 }}>
            {row.map((d, idx) => {
              if (!d) {
                // Empty placeholder to maintain consistent sizing
                return (
                  <View 
                    key={`empty-${ri}-${idx}`} 
                    style={{ 
                      flex: 1,
                      marginLeft: idx > 0 ? 4 : 0,
                    }} 
                  />
                );
              }
              
              const dateKey = format(d, "yyyy-MM-dd");
              const count = getAssignmentCount(dateKey);
              const isToday = isSameDay(d, today);
              const assignments = byDate[dateKey] || [];
              const isLoggedInSurveyorAssigned = currentUserSurveyorId && assignments.some(item => item.surveyorId === currentUserSurveyorId && (item.shift === "DAY" || item.shift === "NIGHT"));
              
              return (
                <Pressable
                  key={dateKey}
                  onPress={() => setSelectedDay({ dateKey, date: d })}
                  style={[
                    styles.mobileDayCell,
                    { 
                      flex: 1,
                      marginLeft: idx > 0 ? 4 : 0,
                      backgroundColor: getDayColor(d),
                      opacity: getDayOpacity(d),
                      // No border highlighting for mobile - just dimming
                    },
                    isToday && styles.mobileDayCellToday,
                  ]}
                >
                  <Text style={[styles.mobileDayName, { fontSize: 10 }]}>
                    {format(d, "EEE")}
                  </Text>
                  <Text style={[styles.mobileDayNumber, { fontSize: 16, fontWeight: isToday ? "700" : "600" }]}>
                    {format(d, "d")}
                  </Text>
                  {count > 0 && (
                    <View style={styles.mobileDayBadge}>
                      <Text style={styles.mobileDayBadgeText}>{count}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
        
        {/* Day Details Modal */}
        {selectedDay && (
          <Modal
            visible={!!selectedDay}
            transparent={true}
            animationType="slide"
            onRequestClose={() => setSelectedDay(null)}
          >
            <Pressable
              style={styles.mobileModalOverlay}
              onPress={() => setSelectedDay(null)}
            >
              <View
                style={styles.mobileModalContent}
                onStartShouldSetResponder={() => true}
              >
                <View style={styles.mobileModalHeader}>
                  <Text style={styles.mobileModalTitle}>
                    {format(selectedDay.date, "EEEE, d MMMM yyyy")}
                  </Text>
                  <Pressable
                    onPress={() => setSelectedDay(null)}
                    style={styles.mobileModalClose}
                  >
                    <Ionicons name="close" size={24} color="#000000" />
                  </Pressable>
                </View>
                
                {(() => {
                  const items = byDate[selectedDay.dateKey] || [];
                  if (items.length === 0) {
                    return (
                      <View style={styles.mobileModalBody}>
                        <Text style={{ fontSize: 14, color: "#666666", textAlign: "center", paddingVertical: 20 }}>
                          No assignments for this day
                        </Text>
                      </View>
                    );
                  }
                  
                  // Sort: current user first (if rostered), then by shift
                  const sortedItems = [...items].sort((a, b) => {
                    // Check if either is the current user
                    const aIsCurrentUser = currentUserSurveyorId && a.surveyorId === currentUserSurveyorId;
                    const bIsCurrentUser = currentUserSurveyorId && b.surveyorId === currentUserSurveyorId;
                    
                    // Current user always comes first
                    if (aIsCurrentUser && !bIsCurrentUser) return -1;
                    if (!aIsCurrentUser && bIsCurrentUser) return 1;
                    
                    // If both or neither are current user, sort by shift
                    const order = { DAY: 1, NIGHT: 2, OFF: 3 };
                    return (order[a.shift] || 99) - (order[b.shift] || 99);
                  });
                  
                  return (
                    <FlatList
                      data={sortedItems}
                      numColumns={2}
                      columnWrapperStyle={styles.gridRow}
                      contentContainerStyle={styles.mobileModalBody}
                      showsVerticalScrollIndicator={true}
                      nestedScrollEnabled={true}
                      scrollEnabled={true}
                      bounces={true}
                      keyExtractor={(item) => item.id}
                      renderItem={({ item: a }) => {
                        const surveyor = surveyors.find((s) => s.id === a.surveyorId);
                        const isCurrentUser = currentUserSurveyorId && a.surveyorId === currentUserSurveyorId;
                        const backgroundColor = a.shift === "DAY" ? DAY_SHIFT_COLOR : a.shift === "NIGHT" ? NIGHT_SHIFT_COLOR : "#ffffff";
                        const textColor = a.shift === "NIGHT" ? "#ffffff" : "#000000";
                        
                        return (
                          <Pressable
                            onPress={() => {
                              if (!isSurveyor && onEdit) {
                                onEdit(selectedDay.dateKey, a);
                              }
                              setSelectedDay(null);
                            }}
                            disabled={isSurveyor}
                            style={[
                              styles.mobileAssignmentCardGrid,
                              { backgroundColor },
                              a.confirmed && styles.assignmentCardConfirmed,
                              isCurrentUser && styles.mobileAssignmentCardCurrentUser,
                            ]}
                          >
                            {surveyor?.photoUrl && (
                              <Image
                                source={{ uri: surveyor.photoUrl }}
                                style={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: 20,
                                  borderWidth: 2,
                                  borderColor: textColor === "#ffffff" ? "#ffffff" : "#e5e5e5",
                                  marginBottom: 8,
                                }}
                              />
                            )}
                            <Text style={[styles.mobileAssignmentName, { color: textColor, fontSize: 14, fontWeight: "600" }]} numberOfLines={2}>
                              {surveyor?.name || a.surveyorId}
                            </Text>
                            <Text style={[styles.mobileAssignmentShift, { color: textColor, fontSize: 12 }]}>
                              {a.shift} {a.confirmed && "✓"}
                            </Text>
                          </Pressable>
                        );
                      }}
                    />
                  );
                })()}
                
                {!isSurveyor && (
                  <View style={styles.mobileModalFooter}>
                    <Pressable
                      onPress={async () => {
                        console.log(`[MOBILE] Add Assignment button pressed for date: ${selectedDay.dateKey}`);
                        const dateKeyToUse = selectedDay.dateKey;
                        
                        // Load other area assignments first if not already loaded
                        if (loadOtherAreaAssignments && !otherAreaAssignments[dateKeyToUse]) {
                          console.log(`[MOBILE] Loading other area assignments for ${dateKeyToUse}`);
                          await loadOtherAreaAssignments(dateKeyToUse);
                        }
                        
                        // Store the dateKey to use after modal closes
                        const dateKeyToAssign = dateKeyToUse;
                        
                        // Close the day details modal first
                        console.log(`[MOBILE] Closing day details modal first`);
                        setSelectedDay(null);
                        
                        // Wait for the modal animation to complete before opening the next modal
                        // React Native modal slide animation takes ~300ms, so wait longer
                        setTimeout(() => {
                          console.log(`[MOBILE] Now opening surveyor selection modal for:`, dateKeyToAssign);
                          setMobileAssignMode({ dateKey: dateKeyToAssign });
                        }, 500);
                      }}
                      style={styles.mobileModalButton}
                    >
                      <Ionicons name="add-circle-outline" size={20} color="#000000" />
                      <Text style={styles.mobileModalButtonText}>Add Assignment</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </Pressable>
          </Modal>
        )}
        
        {/* Mobile: Surveyor selection modal - Only show when day details modal is closed */}
        {mobileAssignMode && !selectedDay && (
          <Modal
            visible={true}
            transparent={true}
            animationType="slide"
            onRequestClose={() => {
              console.log(`[MOBILE] Closing surveyor selection modal`);
              setMobileAssignMode(null);
            }}
            onShow={() => {
              console.log(`[MOBILE] ✅ Surveyor selection modal is now visible for date: ${mobileAssignMode?.dateKey}`);
            }}
          >
            <Pressable
              style={styles.mobileModalOverlay}
              onPress={() => {
                console.log(`[MOBILE] Overlay pressed, closing modal`);
                setMobileAssignMode(null);
              }}
            >
              <Pressable
                style={[styles.mobileModalContent, { maxHeight: "90%" }]}
                onPress={(e) => e.stopPropagation()}
              >
                <View style={styles.mobileModalHeader}>
                  <Text style={styles.mobileModalTitle}>
                    Select Surveyor
                  </Text>
                  <Pressable
                    onPress={() => {
                      console.log(`[MOBILE] Close button pressed`);
                      setMobileAssignMode(null);
                    }}
                    style={styles.mobileModalClose}
                  >
                    <Ionicons name="close" size={24} color="#000000" />
                  </Pressable>
                </View>
                
                {mobileAssignMode?.dateKey && (
                  <Text style={{ fontSize: 14, color: "#666666", paddingHorizontal: 16, marginBottom: 12 }}>
                    {format(parseISO(mobileAssignMode.dateKey), "EEEE, d MMMM yyyy")}
                  </Text>
                )}
                
                <ScrollView style={styles.mobileModalBody}>
                  {surveyors
                    .filter((s) => s.active)
                    .map((s) => {
                      const dateKey = mobileAssignMode.dateKey;
                      const assignmentsForDay = byDate[dateKey] || [];
                      const isAssigned = assignmentsForDay.some(a => a.surveyorId === s.id);
                      const assignment = assignmentsForDay.find(a => a.surveyorId === s.id);
                      
                      // Check if surveyor is assigned in the other area
                      const otherAreaAssignment = otherAreaAssignments[dateKey]?.[s.id];
                      const isAssignedInOtherArea = !!otherAreaAssignment;
                      const otherAreaName = otherAreaAssignment?.area || (area === "SOUTH" ? "NTNP" : "STSP");
                      
                      // Check if surveyor is on leave for this date
                      const nonAvailability = s.nonAvailability || [];
                      const isOnLeave = nonAvailability.includes(dateKey);
                      
                      const isDisabled = (isAssignedInOtherArea && !isAssigned) || isOnLeave;
                      
                      return (
                        <Pressable
                          key={s.id}
                          onPress={async () => {
                            if (isDisabled) {
                              if (isOnLeave && setUnavailabilityModal) {
                                setUnavailabilityModal({
                                  surveyorName: s.name,
                                  date: format(parseISO(dateKey), "d MMM yyyy"),
                                });
                              } else if (isAssignedInOtherArea && setCrossAreaConflictModal) {
                                setCrossAreaConflictModal({
                                  surveyorName: s.name,
                                  otherAreaName: otherAreaName,
                                  date: format(parseISO(dateKey), "d MMM yyyy"),
                                });
                              }
                              return;
                            }
                            // If surveyor already has an assignment, open edit modal
                            if (isAssigned && assignment && setEdit) {
                              console.log(`[MOBILE ASSIGN] Opening edit modal for existing assignment`);
                              setEdit({ dateKey, assignment: assignment });
                              setMobileAssignMode(null);
                            } else if (addAssignment) {
                              // Add new assignment - this will trigger shift selection modal in parent component
                              console.log(`[MOBILE ASSIGN] Calling addAssignment for ${s.name} (${s.id}) on ${dateKey}`);
                              await addAssignment(dateKey, s.id);
                              console.log(`[MOBILE ASSIGN] addAssignment completed, closing surveyor selection modal`);
                              setMobileAssignMode(null);
                            } else {
                              console.error(`[MOBILE ASSIGN] ERROR: addAssignment function is null`);
                              Alert.alert("Error", "Cannot add assignment. Please try again.");
                            }
                          }}
                          disabled={isDisabled}
                          style={[
                            styles.mobileAssignmentCard,
                            isAssigned && assignment && { backgroundColor: assignment.shift === "NIGHT" ? "rgba(30, 58, 95, 0.1)" : "rgba(251, 191, 36, 0.1)" },
                            isDisabled && { opacity: 0.5, backgroundColor: "#f9fafb" },
                          ]}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                            {s.photoUrl && (
                              <Image
                                source={{ uri: s.photoUrl }}
                                style={{
                                  width: Platform.OS === "web" ? 40 : 44,
                                  height: Platform.OS === "web" ? 40 : 44,
                                  borderRadius: Platform.OS === "web" ? 20 : 22,
                                  borderWidth: 2,
                                  borderColor: isAssigned 
                                    ? (assignment?.shift === "NIGHT" ? NIGHT_SHIFT_COLOR : "#fbbf24")
                                    : isDisabled 
                                    ? "#d1d5db" 
                                    : "#e5e5e5",
                                  marginRight: 12,
                                  backgroundColor: "#f3f4f6",
                                }}
                              />
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.mobileAssignmentName, { color: isDisabled ? "#9ca3af" : "#000000" }]}>
                                {s.name}
                              </Text>
                              {isAssigned && assignment && (
                                <Text style={[styles.mobileAssignmentShift, { color: assignment.shift === "NIGHT" ? NIGHT_SHIFT_COLOR : "#d97706" }]}>
                                  {assignment.shift} Shift
                                </Text>
                              )}
                              {isAssignedInOtherArea && !isAssigned && (
                                <Text style={[styles.mobileAssignmentShift, { color: "#ef4444", fontSize: 12 }]}>
                                  Assigned to {otherAreaName}
                                </Text>
                              )}
                              {isOnLeave && (
                                <Text style={[styles.mobileAssignmentShift, { color: "#ef4444", fontSize: 12 }]}>
                                  On Leave
                                </Text>
                              )}
                            </View>
                            {isAssigned && assignment && (
                              <Ionicons name="create-outline" size={20} color="#666666" />
                            )}
                          </View>
                        </Pressable>
                      );
                    })}
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>
        )}
      </View>
    );
  }

  // Web: Original month grid
  return (
    <View style={styles.calendarContainer}>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row", marginBottom: ri < rows.length - 1 ? 12 : 0 }}>
          {row.map((d, idx) => {
            const dateKey = format(d, "yyyy-MM-dd");
            return (
              <View key={dateKey} style={{ flex: 1, marginLeft: idx > 0 ? 8 : 0 }}>
              <DayCell
                date={d}
                dateKey={dateKey}
                items={byDate[dateKey] ?? []}
                  surveyors={surveyors}
                onDrop={onDrop}
                onEdit={onEdit}
                  onWebAssign={onWebAssign}
                compact={true}
                rosterStartDate={rosterStartDate}
                isSurveyor={isSurveyor}
                otherAreaAssignments={otherAreaAssignments}
                area={area}
                loadOtherAreaAssignments={loadOtherAreaAssignments}
                setCrossAreaConflictModal={setCrossAreaConflictModal}
              />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function DayCell({ date, dateKey, items, surveyors, onDrop, onEdit, onWebAssign, compact, rosterStartDate, isSurveyor = false, otherAreaAssignments = {}, area = "SOUTH", loadOtherAreaAssignments = null, setCrossAreaConflictModal = null, currentUserSurveyorId = null }) {
  const today = new Date();
  const dateStartOfDay = startOfDay(date);
  const todayStartOfDay = startOfDay(today);
  const isDateToday = isSameDay(date, today);
  const isDatePast = isPast(dateStartOfDay) && !isDateToday;
  // Can only edit today and future dates
  // Note: isSurveyor check is handled at the function level (addAssignment, onEdit callbacks)
  // so admins/supervisors can still edit assignments even if isSurveyor prop is passed
  const isDateEditable = !isDatePast;
  const isWeb = Platform.OS === "web";
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dropRef = useRef(null);

  // Helper function to get surveyor info
  const getSurveyor = (surveyorId) => {
    return surveyors.find((s) => s.id === surveyorId);
  };

  // Check if logged-in surveyor is assigned on this day
  const isLoggedInSurveyorAssigned = currentUserSurveyorId && items.some(item => item.surveyorId === currentUserSurveyorId && (item.shift === "DAY" || item.shift === "NIGHT"));

  useEffect(() => {
    if (isWeb && dropRef.current) {
      // React Native Web refs point to the underlying DOM element
      const element = dropRef.current;
      
      // Check if it's actually a DOM element
      if (element && typeof element.addEventListener === 'function') {
        const handleDragOver = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // Block drag over on past dates
          if (!isDateEditable) {
            e.dataTransfer.dropEffect = "none";
            return;
          }
          
          // Get the surveyor ID being dragged
          const surveyorId = e.dataTransfer.getData("surveyorId") || e.dataTransfer.getData("text/plain");
          
          if (surveyorId) {
            // Load other area assignments if not already loaded
            // Use the returned value directly to avoid race condition with state updates
            let loadedAssignments = otherAreaAssignments[dateKey];
            if (loadOtherAreaAssignments && !loadedAssignments) {
              loadedAssignments = await loadOtherAreaAssignments(dateKey);
            }
            
            // Check if surveyor is assigned in other area for this date
            // Use loadedAssignments instead of state to avoid race condition
            const otherAreaAssignment = loadedAssignments?.[surveyorId];
            if (otherAreaAssignment) {
              // Prevent drop and show alert
              e.dataTransfer.dropEffect = "none";
              setIsDraggingOver(false);
              
              const otherAreaName = otherAreaAssignment.area;
              const surveyor = getSurveyor(surveyorId);
              
              // Show modal only once per drag operation (use a flag to prevent multiple modals)
              if (!element.dataset.alertShown && setCrossAreaConflictModal) {
                element.dataset.alertShown = "true";
                const assignmentDate = parseISO(dateKey);
                setCrossAreaConflictModal({
                  surveyorName: surveyor?.name || "This surveyor",
                  otherAreaName: otherAreaName,
                  date: format(assignmentDate, "d MMM yyyy"),
                });
                // Reset flag after a delay
                setTimeout(() => {
                  if (element.dataset) {
                    element.dataset.alertShown = "false";
                  }
                }, 1000);
              }
              return;
            }
          }
          
          e.dataTransfer.dropEffect = "move";
          setIsDraggingOver(true);
        };
        
        const handleDragLeave = (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Check if we're actually leaving the element
          const rect = element.getBoundingClientRect();
          const x = e.clientX;
          const y = e.clientY;
          if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            setIsDraggingOver(false);
            // Reset alert flag when leaving
            if (element.dataset) {
              element.dataset.alertShown = "false";
            }
          }
        };
        
        const handleDrop = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingOver(false);
          
          // Reset alert flag
          if (element.dataset) {
            element.dataset.alertShown = "false";
          }
          
          // Block drops on past dates
          if (!isDateEditable) {
            return;
          }
          
          const surveyorId = e.dataTransfer.getData("surveyorId") || e.dataTransfer.getData("text/plain");
          
          if (surveyorId) {
            // Load other area assignments if not already loaded
            // Use the returned value directly to avoid race condition with state updates
            let loadedAssignments = otherAreaAssignments[dateKey];
            if (loadOtherAreaAssignments && !loadedAssignments) {
              loadedAssignments = await loadOtherAreaAssignments(dateKey);
            }
            
            // Check if surveyor is assigned in other area before allowing drop
            // Use loadedAssignments instead of state to avoid race condition
            const otherAreaAssignment = loadedAssignments?.[surveyorId];
            if (otherAreaAssignment) {
              const otherAreaName = otherAreaAssignment.area;
              const surveyor = getSurveyor(surveyorId);
              const assignmentDate = parseISO(dateKey);
              if (setCrossAreaConflictModal) {
                setCrossAreaConflictModal({
                  surveyorName: surveyor?.name || "This surveyor",
                  otherAreaName: otherAreaName,
                  date: format(assignmentDate, "d MMM yyyy"),
                });
              }
              return;
            }
            try {
              await onDrop(dateKey, surveyorId);
            } catch (error) {
              console.error("Error in onDrop handler:", error);
            }
          }
        };
        
        element.addEventListener("dragover", handleDragOver);
        element.addEventListener("dragleave", handleDragLeave);
        element.addEventListener("drop", handleDrop);
        
        return () => {
          element.removeEventListener("dragover", handleDragOver);
          element.removeEventListener("dragleave", handleDragLeave);
          element.removeEventListener("drop", handleDrop);
        };
      }
    }
  }, [isWeb, dateKey, onDrop, isDateEditable, otherAreaAssignments, loadOtherAreaAssignments, area, setCrossAreaConflictModal, surveyors]);

  if (isWeb) {
    const handleClick = () => {
      // Only trigger if not clicking on an assignment card
      if (onWebAssign) {
        onWebAssign(dateKey);
      }
    };

  return (
      <Pressable
        ref={dropRef}
        onPress={handleClick}
        style={[
          styles.dayCell,
          !compact && styles.dayCellLarge,
          isDraggingOver && styles.dayCellDraggingOver,
          isDateToday && styles.dayCellToday,
          // Only apply dimming on mobile, no highlighting
          !isLoggedInSurveyorAssigned && isSurveyor && currentUserSurveyorId && Platform.OS !== "web" && styles.dayCellSurveyorNotAssigned,
          { cursor: "pointer" },
        ]}
      >
        <Text style={[
          styles.dayCellHeader,
          isDateToday && styles.dayCellHeaderToday,
        ]}>
          {format(date, compact ? "EEE d" : "EEEE d MMM")}
        </Text>
        {!isSurveyor && (
        <Text style={styles.dayCellHint}>
          {isDraggingOver ? "Drop here" : "Drag surveyor or tap to assign and edit shifts"}
        </Text>
        )}

        <View style={{ marginTop: 4, flex: 1 }}>
          {(() => {
            // Sort items: First by shift (DAY, NIGHT, OFF), then alphabetically by surveyor name
            const sortedItems = [...items].sort((a, b) => {
              // First sort by shift type
              const order = { DAY: 1, NIGHT: 2, OFF: 3 };
              const shiftDiff = (order[a.shift] || 99) - (order[b.shift] || 99);
              if (shiftDiff !== 0) return shiftDiff;
              
              // If same shift, sort alphabetically by surveyor name
              const surveyorA = getSurveyor(a.surveyorId);
              const surveyorB = getSurveyor(b.surveyorId);
              const nameA = (surveyorA?.name || a.surveyorId || "").toUpperCase();
              const nameB = (surveyorB?.name || b.surveyorId || "").toUpperCase();
              return nameA.localeCompare(nameB);
            });
            
            // Web: Group into pairs for side-by-side display
            const pairs = [];
            for (let i = 0; i < sortedItems.length; i += 2) {
              pairs.push(sortedItems.slice(i, i + 2));
            }
            
            return pairs.map((pair, pairIdx) => (
              <View key={pairIdx} style={{ flexDirection: "row", marginBottom: 3 }}>
                {pair.map((a, itemIdx) => {
                  const surveyor = getSurveyor(a.surveyorId);
                  const backgroundColor = a.shift === "DAY" ? DAY_SHIFT_COLOR : a.shift === "NIGHT" ? NIGHT_SHIFT_COLOR : "#ffffff";
                  const textColor = a.shift === "NIGHT" ? "#ffffff" : "#000000";
                  // Use a composite key to ensure uniqueness: dateKey + surveyorId + shift + index
                  // This prevents React key warnings if duplicates somehow exist
                  const uniqueKey = `${dateKey}_${a.surveyorId}_${a.shift}_${itemIdx}`;
                  return (
                    <Pressable
                      key={uniqueKey}
                      onPress={(e) => {
                        e.stopPropagation(); // Prevent triggering parent's onPress
                        if (isDateEditable) {
                          onEdit(dateKey, a);
                        }
                      }}
                      disabled={!isDateEditable}
                      style={[
                        styles.assignmentCard,
                        styles.assignmentCardSideBySide,
                        a.confirmed && styles.assignmentCardConfirmed,
                        { 
                          marginRight: itemIdx === 0 && pair.length === 2 ? 6 : 0,
                          backgroundColor: backgroundColor,
                          opacity: isDatePast ? 0.6 : 1, // Fade past assignments
                        },
                      ]}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        {surveyor?.photoUrl && (
                          <Image
                            source={{ uri: surveyor.photoUrl }}
      style={{
                              width: 38, 
                              height: 38, 
                              borderRadius: 19, 
                              borderWidth: 2, 
                              borderColor: textColor === "#ffffff" ? "#ffffff" : "#e5e5e5",
                              marginRight: 4
                            }}
                          />
                        )}
                        <Text numberOfLines={1} style={[styles.assignmentName, { fontSize: 11, color: textColor, fontWeight: "600" }]}>
                          {getInitials(surveyor?.name || a.surveyorId)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ));
          })()}
        </View>
      </Pressable>
    );
  }

  // Native: use DraxView for drag and drop only on web to prevent measureLayout errors
  // On mobile, use regular View (drag and drop disabled)
  if (Platform.OS !== "web") {
    // Mobile: use regular View (drag and drop disabled to prevent errors)
    return (
      <View
        style={[
          styles.dayCell,
          !compact && styles.dayCellLarge,
          isDateToday && styles.dayCellToday,
        ]}
      >
        <Text style={[
          styles.dayCellHeader,
          isDateToday && styles.dayCellHeaderToday,
        ]}>
          {format(date, compact ? "EEE d" : "EEEE d MMM")}
        </Text>

        <View style={{ marginTop: 4 }}>
          {(() => {
            // Sort items: First by shift (DAY, NIGHT, OFF), then alphabetically by surveyor name
            const sortedItems = [...items].sort((a, b) => {
              // First sort by shift type
              const order = { DAY: 1, NIGHT: 2, OFF: 3 };
              const shiftDiff = (order[a.shift] || 99) - (order[b.shift] || 99);
              if (shiftDiff !== 0) return shiftDiff;
              
              // If same shift, sort alphabetically by surveyor name
              const surveyorA = getSurveyor(a.surveyorId);
              const surveyorB = getSurveyor(b.surveyorId);
              const nameA = (surveyorA?.name || a.surveyorId || "").toUpperCase();
              const nameB = (surveyorB?.name || b.surveyorId || "").toUpperCase();
              return nameA.localeCompare(nameB);
            });
            
            // Mobile: display items vertically to prevent overlapping
            return sortedItems.map((a, idx) => {
              const surveyor = getSurveyor(a.surveyorId);
              const backgroundColor = a.shift === "DAY" ? DAY_SHIFT_COLOR : a.shift === "NIGHT" ? NIGHT_SHIFT_COLOR : "#ffffff";
              const textColor = a.shift === "NIGHT" ? "#ffffff" : "#000000";
              const uniqueKey = `${dateKey}_${a.surveyorId}_${a.shift}_${idx}`;
              return (
                <Pressable
                  key={uniqueKey}
                  onPress={() => {
                    if (isDateEditable) {
                      onEdit(dateKey, a);
                    }
                  }}
                  disabled={!isDateEditable}
                  style={[
                    styles.assignmentCard,
                    a.confirmed && styles.assignmentCardConfirmed,
                    { 
                      backgroundColor: backgroundColor,
                      opacity: isDatePast ? 0.6 : 1,
                      marginBottom: 4, // Space between items on mobile
                    },
                  ]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    {surveyor?.photoUrl && (
                      <Image
                        source={{ uri: surveyor.photoUrl }}
                        style={{
                          width: 32, 
                          height: 32, 
                          borderRadius: 16, 
                          borderWidth: 2, 
                          borderColor: textColor === "#ffffff" ? "#ffffff" : "#e5e5e5",
                          marginRight: 6
                        }}
                      />
                    )}
                    <Text numberOfLines={1} style={[styles.assignmentName, { fontSize: 10, color: textColor, fontWeight: "600" }]}>
                      {getInitials(surveyor?.name || a.surveyorId)}
                    </Text>
                  </View>
                </Pressable>
              );
            });
          })()}
        </View>
      </View>
    );
  }
  
  // Web: use DraxView for drag and drop
  // Add error boundary to catch measureLayout errors
  try {
  return (
    <DraxView
      style={[
        styles.dayCell,
        !compact && styles.dayCellLarge,
        isDateToday && styles.dayCellToday,
          // Only apply dimming on mobile, no highlighting
          !isLoggedInSurveyorAssigned && isSurveyor && currentUserSurveyorId && Platform.OS !== "web" && styles.dayCellSurveyorNotAssigned,
      ]}
      receptive
      collapsable={false}
        onReceiveDragDrop={async (event) => {
        const payload = event?.dragged?.payload;
        const surveyorId = payload?.surveyorId;
        if (!surveyorId) return;
          try {
            await onDrop(dateKey, surveyorId);
          } catch (error) {
            console.error("Error in onDrop handler:", error);
          }
      }}
    >
        <Text style={[
          styles.dayCellHeader,
          isDateToday && styles.dayCellHeaderToday,
        ]}>
          {format(date, compact ? "EEE d" : "EEEE d MMM")}
        </Text>

      <View style={{ marginTop: 4 }}>
        {(() => {
          // Sort items: First by shift (DAY, NIGHT, OFF), then alphabetically by surveyor name
          const sortedItems = [...items].sort((a, b) => {
            // First sort by shift type
            const order = { DAY: 1, NIGHT: 2, OFF: 3 };
            const shiftDiff = (order[a.shift] || 99) - (order[b.shift] || 99);
            if (shiftDiff !== 0) return shiftDiff;
            
            // If same shift, sort alphabetically by surveyor name
            const surveyorA = getSurveyor(a.surveyorId);
            const surveyorB = getSurveyor(b.surveyorId);
            const nameA = (surveyorA?.name || a.surveyorId || "").toUpperCase();
            const nameB = (surveyorB?.name || b.surveyorId || "").toUpperCase();
            return nameA.localeCompare(nameB);
          });
          
            // Web: Group into pairs for side-by-side display
          const pairs = [];
          for (let i = 0; i < sortedItems.length; i += 2) {
            pairs.push(sortedItems.slice(i, i + 2));
          }
          
          return pairs.map((pair, pairIdx) => (
            <View key={pairIdx} style={{ flexDirection: "row", marginBottom: 3 }}>
              {pair.map((a, itemIdx) => {
                const surveyor = getSurveyor(a.surveyorId);
                const backgroundColor = a.shift === "DAY" ? DAY_SHIFT_COLOR : a.shift === "NIGHT" ? NIGHT_SHIFT_COLOR : "#ffffff";
                const textColor = a.shift === "NIGHT" ? "#ffffff" : "#000000";
                const uniqueKey = `${dateKey}_${a.surveyorId}_${a.shift}_${itemIdx}`;
                return (
          <Pressable
            key={uniqueKey}
                      onPress={(e) => {
                        e.stopPropagation();
              if (isDateEditable) {
                onEdit(dateKey, a);
              }
            }}
            disabled={!isDateEditable}
                    style={[
                      styles.assignmentCard,
                      styles.assignmentCardSideBySide,
                      a.confirmed && styles.assignmentCardConfirmed,
                      { 
                        marginRight: itemIdx === 0 && pair.length === 2 ? 6 : 0,
                        backgroundColor: backgroundColor,
                          opacity: isDatePast ? 0.6 : 1,
                      },
                    ]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                        {surveyor?.photoUrl && (
                          <Image
                            source={{ uri: surveyor.photoUrl }}
            style={{
                              width: 38, 
                              height: 38, 
                              borderRadius: 19, 
                              borderWidth: 2, 
                              borderColor: textColor === "#ffffff" ? "#ffffff" : "#e5e5e5",
                              marginRight: 4
                            }}
                          />
                        )}
                        <Text numberOfLines={1} style={[styles.assignmentName, { fontSize: 11, color: textColor, fontWeight: "600" }]}>
                          {getInitials(surveyor?.name || a.surveyorId)}
                        </Text>
                    </View>
          </Pressable>
                );
              })}
            </View>
          ));
        })()}
      </View>
    </DraxView>
  );
  } catch (error) {
    // Fallback to regular View if DraxView fails on web
    console.warn("[DayCell] DraxView error, using fallback:", error);
    return (
      <View
        style={[
          styles.dayCell,
          !compact && styles.dayCellLarge,
          isDateToday && styles.dayCellToday,
        ]}
      >
        <Text style={[
          styles.dayCellHeader,
          isDateToday && styles.dayCellHeaderToday,
        ]}>
          {format(date, compact ? "EEE d" : "EEEE d MMM")}
        </Text>
        <View style={{ marginTop: 4 }}>
          {items.map((a) => {
            const surveyor = getSurveyor(a.surveyorId);
            return (
              <Pressable
                key={a.id}
                onPress={() => {
                  if (isDateEditable) {
                    onEdit(dateKey, a);
                  }
                }}
                disabled={!isDateEditable}
                style={[styles.assignmentCard, a.confirmed && styles.assignmentCardConfirmed]}
              >
                <Text style={styles.assignmentShift}>{a.shift}</Text>
                <Text style={styles.assignmentName}>{surveyor?.name || a.surveyorId}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }
}

function Chip({ label, onPress, active }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function OfficeTab({ label, onPress, active, isFirst }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.officeTab,
        active && styles.officeTabActive,
        isFirst && styles.officeTabFirst,
      ]}
    >
      <Text
        style={[
          styles.officeTabText,
          active && styles.officeTabTextActive,
        ]}
      >
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

function EditModal({ visible, assignment, surveyorName, dateKey, onClose, onSave }) {
  const [shift, setShift] = useState(SHIFT.DAY);

  React.useEffect(() => {
    if (!assignment) return;
    setShift(assignment.shift);
  }, [assignment]);

  const isWeb = Platform.OS === "web";

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} transparent>
      <Pressable
        style={styles.modalOverlayCentered}
        onPress={onClose}
      >
        <View
          style={[styles.modalContentCentered, { maxWidth: 400, width: "90%", backgroundColor: "#ffffff" }]}
          onStartShouldSetResponder={() => true}
        >
          <Text style={styles.modalTitle}>EDIT SHIFT</Text>
          <Text style={styles.modalSubtitle}>
            {dateKey} — {surveyorName || assignment?.surveyorId}
          </Text>

          <View style={styles.chipContainer}>
            <Chip label="DAY" active={shift === SHIFT.DAY} onPress={() => setShift(SHIFT.DAY)} />
            <View style={{ width: Platform.OS === "web" ? 6 : 8 }} />
            <Chip label="NIGHT" active={shift === SHIFT.NIGHT} onPress={() => setShift(SHIFT.NIGHT)} />
            <View style={{ width: Platform.OS === "web" ? 6 : 8 }} />
            <Chip label="OFF" active={shift === SHIFT.OFF} onPress={() => setShift(SHIFT.OFF)} />
          </View>

          <View style={{ flexDirection: "row", marginTop: 24, gap: 12 }}>
            <Pressable
              onPress={onClose}
              style={[
                styles.modalButton,
                { flex: 1, borderWidth: 1, borderColor: "#e5e5e5", backgroundColor: "#ffffff" },
              ]}
            >
              <Text style={[styles.modalButtonText, { color: "#000000" }]}>CLOSE</Text>
            </Pressable>

            <Pressable
              onPress={() =>
                onSave({
                  shift,
                  breakMins: assignment?.breakMins ?? 30, // Keep existing break time or default to 30
                  confirmed: assignment?.confirmed || false,
                })
              }
              style={[styles.modalButton, { flex: 1, backgroundColor: "#000000" }]}
            >
              <Text style={[styles.modalButtonText, { color: "#ffffff", fontWeight: "700" }]}>SAVE</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}


