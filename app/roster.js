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
  Platform,
  Alert,
  Share,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
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

export default function RosterScreen() {
  const [viewMode, setViewMode] = useState("FORTNIGHT"); // FORTNIGHT | MONTH
  const [area, setArea] = useState("SOUTH"); // SOUTH | NORTH (internal app values)
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [surveyors, setSurveyors] = useState([]);
  const [weekendHistory, setWeekendHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [areaLoading, setAreaLoading] = useState(false);

  // { "YYYY-MM-DD": [ {id, surveyorId, shift, breakMins, confirmed} ] }
  const [byDate, setByDate] = useState({});
  const [initialByDate, setInitialByDate] = useState({}); // Track initial state for change detection
  const [currentRosterId, setCurrentRosterId] = useState(null); // Store the current roster ID
  const [rosterStartDate, setRosterStartDate] = useState(null); // Store the roster's actual start date for validation
  const [edit, setEdit] = useState(null); // { dateKey, assignment }
  const [validationIssues, setValidationIssues] = useState([]);
  const [webAssignMode, setWebAssignMode] = useState(null); // { dateKey } for web tap-to-assign
  const [shiftSelectMode, setShiftSelectMode] = useState(null); // { dateKey, surveyorId } for shift selection after drop
  const [autoPopulateConfirm, setAutoPopulateConfirm] = useState(false); // Show confirmation modal
  const [autoPopulating, setAutoPopulating] = useState(false); // Loading state
  const [rosterManagementModal, setRosterManagementModal] = useState(false); // Show roster management modal
  const [savedRosters, setSavedRosters] = useState([]); // List of saved rosters
  const [rosterListKey, setRosterListKey] = useState(0); // Key to force re-render of roster list
  const [activeActionButton, setActiveActionButton] = useState(null); // Track which action button is active
  const [confirmRosterModal, setConfirmRosterModal] = useState(false); // Show confirmation modal before saving
  const [unsavedChangesModal, setUnsavedChangesModal] = useState(false); // Show unsaved changes modal when switching areas
  const [pendingAreaSwitch, setPendingAreaSwitch] = useState(null); // Store the area the user wants to switch to
  const [showLeftArrow, setShowLeftArrow] = useState(false); // Show left arrow for surveyor navigation
  const [showRightArrow, setShowRightArrow] = useState(false); // Show right arrow for surveyor navigation
  const surveyorScrollRef = useRef(null); // Ref for surveyor horizontal scroll
  const { hasUnsavedChanges: contextHasUnsavedChanges, setHasUnsavedChanges } = useUnsavedChanges();

  useEffect(() => {
    loadData();
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

  // Load roster when anchor date changes
  useEffect(() => {
    if (!loading && surveyors.length > 0) {
      loadRosterForFortnight();
    }
  }, [anchorDate, loading, surveyors.length]);

  // Load roster when area changes
  useEffect(() => {
    if (!loading && surveyors.length > 0 && area) {
      setAreaLoading(true);
      loadRosterForFortnight().finally(() => {
        setAreaLoading(false);
      });
    }
  }, [area]);


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
        validationStartDate = rosterStartDate;
        console.log(`[VALIDATION] Using roster's startDate: ${format(rosterStartDate, "yyyy-MM-dd")} instead of anchorDate: ${format(anchorDate, "yyyy-MM-dd")}`);
      } else {
        // Calculate from assignments - find the earliest date key
        const dateKeys = Object.keys(byDate).filter(key => 
          byDate[key] && byDate[key].length > 0
        );
        if (dateKeys.length > 0) {
          const sortedKeys = dateKeys.sort();
          validationStartDate = parseISO(sortedKeys[0]);
          console.log(`[VALIDATION] Calculated startDate from assignments: ${sortedKeys[0]}`);
        }
      }
      
      // Load demand for validation
      loadDemand(area).then(async demandData => {
        // Load rosters from both areas to count shifts across areas
        const otherArea = area === "SOUTH" ? "NORTH" : "SOUTH";
        let otherAreaByDate = {};
        
        try {
          // Use the validation start date for loading other area roster
          const otherAreaRoster = await loadRosterForDate(validationStartDate, otherArea);
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
        });
        setValidationIssues(issues);
      }).catch(async err => {
        console.error("Error loading demand for validation:", err);
        
        // Determine the actual date range for validation
        let validationStartDate = anchorDate;
        if (rosterStartDate) {
          validationStartDate = rosterStartDate;
        } else {
          // Calculate from assignments
          const dateKeys = Object.keys(byDate).filter(key => 
            byDate[key] && byDate[key].length > 0
          );
          if (dateKeys.length > 0) {
            const sortedKeys = dateKeys.sort();
            validationStartDate = parseISO(sortedKeys[0]);
          }
        }
        
        // Still load other area roster for cross-area shift counting
        const otherArea = area === "SOUTH" ? "NORTH" : "SOUTH";
        let otherAreaByDate = {};
        
        try {
          const otherAreaRoster = await loadRosterForDate(validationStartDate, otherArea);
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
      });
    } else {
      // Clear validation issues if no roster exists
      setValidationIssues([]);
    }
  }, [byDate, anchorDate, surveyors, weekendHistory, area]);

  async function loadData() {
    try {
      setLoading(true);
      const loadedSurveyors = await loadSurveyors();
      if (loadedSurveyors && loadedSurveyors.length > 0) {
        console.log(`Loaded ${loadedSurveyors.length} surveyors from database`);
        setSurveyors(loadedSurveyors);
      } else {
        console.log("No surveyors found in database");
        setSurveyors([]);
      }
      const history = await loadWeekendHistory();
      setWeekendHistory(history);
      
      // Load roster for current fortnight after surveyors are loaded
      await loadRosterForFortnight();
    } catch (error) {
      console.error("Error loading data:", error);
      setSurveyors([]);
      setWeekendHistory({});
    } finally {
      setLoading(false);
    }
  }

  async function loadRosterForFortnight() {
    try {
      // Calculate the fortnight start date (Monday)
      const fortnightStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
      
      // Try to load a roster that covers this fortnight for the current area
      const roster = await loadRosterForDate(fortnightStart, area);
      
      if (roster && roster.assignmentsByDate) {
        console.log(`Loaded roster ${roster.id} for fortnight starting ${format(fortnightStart, "yyyy-MM-dd")}`);
        console.log(`Found ${Object.keys(roster.assignmentsByDate).length} days with assignments`);
        setByDate(roster.assignmentsByDate);
        // Store initial state for change tracking (deep copy)
        setInitialByDate(JSON.parse(JSON.stringify(roster.assignmentsByDate)));
        // Store the roster ID so we can update it later
        setCurrentRosterId(roster.id);
        // Store the roster's actual start date for validation (use roster's startDate if available, otherwise calculate from assignments)
        if (roster.startDate) {
          setRosterStartDate(parseISO(roster.startDate));
          console.log(`[ROSTER] Using roster's startDate for validation: ${roster.startDate}`);
        } else {
          // Calculate from assignments - find the earliest date key
          const dateKeys = Object.keys(roster.assignmentsByDate).filter(key => 
            roster.assignmentsByDate[key] && roster.assignmentsByDate[key].length > 0
          );
          if (dateKeys.length > 0) {
            const sortedKeys = dateKeys.sort();
            const actualStartDate = parseISO(sortedKeys[0]);
            setRosterStartDate(actualStartDate);
            console.log(`[ROSTER] Calculated startDate from assignments: ${sortedKeys[0]}`);
          } else {
            // Fallback to calculated fortnight start
            setRosterStartDate(fortnightStart);
          }
        }
      } else {
        console.log(`No roster found for fortnight starting ${format(fortnightStart, "yyyy-MM-dd")}`);
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
        // Clear roster start date
        setRosterStartDate(null);
      }
    } catch (error) {
      console.error("Error loading roster for fortnight:", error);
      // Don't clear existing assignments on error
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
      const roster = await loadRosterForDate(dateObj, preferredArea);
      
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
    // Allow manual assignment regardless of area preference
    // Area preference is only enforced in auto-populate, not manual assignments
    const surveyor = surveyors.find((s) => s.id === surveyorId);
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
    setActiveActionButton("confirm");
    setConfirmRosterModal(true);
  }

  function handleDiscardChanges() {
    // Discard changes and switch to pending area
    setByDate({});
    setInitialByDate({});
    setCurrentRosterId(null);
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
    setConfirmRosterModal(false);
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
        
        // Clear unsaved changes flag
        setHasUnsavedChanges(false);
        
        // If there was a pending area switch, execute it now
        if (pendingAreaSwitch) {
          setArea(pendingAreaSwitch);
          setByDate({});
          setInitialByDate({});
          setCurrentRosterId(null);
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

        Alert.alert(
          "Roster Confirmed & Saved ✅",
          `The roster has been successfully saved to the database.\n\n` +
          `📊 Roster Summary (This Week):\n` +
          `• Total Assignments: ${totalAssignments}\n` +
          `• Day Shifts: ${dayShifts}\n` +
          `• Night Shifts: ${nightShifts}\n` +
          `• Confirmed: ${confirmedCount}\n` +
          `• Period: ${format(weekStart, "d MMM yyyy")} - ${format(weekEndDate, "d MMM yyyy")}\n\n` +
          `${validationIssues.length > 0 ? `⚠️ Note: ${validationIssues.length} validation issue(s) detected.` : "✓ All validations passed."}`,
          [{ text: "OK", onPress: () => setActiveActionButton(null) }]
        );
      } else {
        Alert.alert("Error", saveResult.error || "Failed to save roster", [
          { text: "OK", onPress: () => setActiveActionButton(null) }
        ]);
      }
    } catch (error) {
      console.error("Error confirming roster:", error);
      Alert.alert("Error", "An error occurred while saving the roster", [
        { text: "OK", onPress: () => setActiveActionButton(null) }
      ]);
    }
  }

  async function handleAutoPopulate() {
    setActiveActionButton("auto-populate");
    
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
            { text: "OK", onPress: () => setActiveActionButton(null) }
          ]
        );
        return;
      }
      
      setAutoPopulateConfirm(true);
    } catch (error) {
      console.error("Error checking demand:", error);
      Alert.alert("Error", "Failed to check demand settings. Please try again.");
      setActiveActionButton(null);
    }
  }

  async function handleManageRosters() {
    setActiveActionButton("manage");
    try {
      const allRosters = await loadAllRosters();
      // Filter rosters by current area
      const filteredRosters = (allRosters || []).filter((r) => (r.area || "SOUTH") === area);
      setSavedRosters(filteredRosters);
      setRosterManagementModal(true);
    } catch (error) {
      console.error("Error loading rosters:", error);
      Alert.alert("Error", "Failed to load rosters");
      setActiveActionButton(null);
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
    
    // Check if the deleted roster matches the current view (same area and date range)
    const fortnightStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
    const fortnightStartStr = format(fortnightStart, "yyyy-MM-dd");
    const fortnightEndStr = format(addDays(fortnightStart, 13), "yyyy-MM-dd");
    const matchesCurrentView = (rosterArea === area || (!rosterArea && area === "SOUTH")) &&
                                rosterStartDate === fortnightStartStr &&
                                rosterEndDate === fortnightEndStr;
    
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
          // Refresh from database after a short delay to ensure deletion is committed
          // Keep the modal open so user can see the roster disappear
          setTimeout(async () => {
            try {
              // Explicitly refresh rosters from database (fresh fetch, no cache)
              const updatedRosters = await loadAllRosters();
              console.log(`[DELETE ROSTER] Refreshed ${updatedRosters.length} rosters from database`);
              // Filter rosters by the deleted roster's area (or current area if not found)
              const filteredRosters = (updatedRosters || []).filter((r) => (r.area || "SOUTH") === rosterArea);
              setSavedRosters(filteredRosters);
              setRosterListKey((prev) => prev + 1); // Force re-render after database refresh
              console.log(`[DELETE ROSTER] Updated savedRosters to ${filteredRosters.length} rosters for area ${rosterArea}`);
              
              // If the deleted roster matches the current view, reload the roster from database
              if (matchesCurrentView) {
                setByDate({});
                setInitialByDate({});
                setCurrentRosterId(null);
                await loadRosterForFortnight();
              }
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
      // Load demand settings for the current area
      const demandData = await loadDemand(area);
      const demand = demandData?.demand || {};

      const result = await autoPopulateRoster({
        surveyors,
        anchorDate,
        weekendHistory,
        existingAssignments: byDate,
        area: area,
        demand: demand,
      });

      if (result.success) {
        // Apply the generated assignments
        setByDate(result.assignments);

        // Auto-save the populated roster
        const fortnightStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
        const roster = {
          id: `roster_${format(anchorDate, "yyyy-MM-dd")}`,
          startDate: format(fortnightStart, "yyyy-MM-dd"),
          endDate: format(addDays(fortnightStart, 13), "yyyy-MM-dd"), // 14 days total (0-13)
          area: area, // Include area to ensure correct area is saved
          assignmentsByDate: result.assignments,
          createdAt: new Date().toISOString(),
          status: "draft",
        };
        
        // Update rosterStartDate state to match the generated roster
        setRosterStartDate(fortnightStart);
        
        const saveResult = await saveRoster(roster);
        
        // Show results
        if (saveResult.success) {
          if (result.issues && result.issues.length > 0) {
            Alert.alert(
              "Generate Rosters Complete",
              `Roster generated and saved successfully! ✅\n\nNote: ${result.issues.length} issue(s) detected:\n${result.issues.slice(0, 3).join("\n")}${result.issues.length > 3 ? `\n...and ${result.issues.length - 3} more` : ""}`,
              [{ text: "OK" }]
            );
          } else {
            Alert.alert("Success", "Roster generated and saved successfully! ✅");
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
        setActiveActionButton(null);
      return;
    }

      // Check if there are any assignments
      const hasAssignments = Object.keys(byDate).some(dateKey => byDate[dateKey] && byDate[dateKey].length > 0);
      if (!hasAssignments) {
        Alert.alert("Info", "No assignments to export. Please add assignments to the roster first.");
        setActiveActionButton(null);
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
          setTimeout(() => setActiveActionButton(null), 1000);
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
        setActiveActionButton(null);
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
    } finally {
      // Reset active button after a short delay
      setTimeout(() => setActiveActionButton(null), 1000);
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
  
  const RosterContent = (
    <Container {...containerProps}>
      <TopNav />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={[styles.content, { paddingTop: 70 }]}>
        {/* Office Heading - Outside Border */}
        <Text style={styles.officeTabHeading}>
          {area === "SOUTH" ? "STSP ROSTER" : "NTNP ROSTER"}
        </Text>

        {/* Office Tabs + Content Wrapper with Borders */}
        <View style={styles.tabsAndContentWrapper}>
          {/* Office Tabs */}
          <View style={styles.tabBarContainer}>
            <View style={styles.tabBar}>
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
                    }
                  }
                }}
              />
            </View>
          </View>

          {/* Content Area - All content below tabs */}
          <View style={styles.tabContentContainer}>
          {/* Area Loading Overlay */}
          {areaLoading && (
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
                Loading {area === "SOUTH" ? "STSP" : "NTNP"} roster...
              </Text>
            </View>
          )}
          {/* Toggle + month slider + action buttons */}
          <View style={styles.controlsRow}>
            <View style={styles.chipContainer}>
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

            {/* Month slider - centered */}
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", marginLeft: 300 }}>
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

            <View style={[styles.actionButtons, { justifyContent: "flex-end", gap: 8 }]}>
            <Pressable
              onPress={() => {
                setActiveActionButton("auto-populate");
                handleAutoPopulate();
              }}
              style={[
                styles.actionButton,
                activeActionButton === "auto-populate" && styles.actionButtonActive,
              ]}
              disabled={autoPopulating || loading}
            >
              <Text style={[
                styles.actionButtonText,
                activeActionButton === "auto-populate" && styles.actionButtonTextActive,
              ]}>
                {autoPopulating ? "Generating..." : "Generate Rosters"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setActiveActionButton("manage");
                handleManageRosters();
              }}
              style={[
                styles.actionButton,
                activeActionButton === "manage" && styles.actionButtonActive,
              ]}
            >
              <Text style={[
                styles.actionButtonText,
                activeActionButton === "manage" && styles.actionButtonTextActive,
              ]}>
                Manage Rosters
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setActiveActionButton("export");
                handleExport("pdf");
              }}
              style={[
                styles.actionButton,
                activeActionButton === "export" && styles.actionButtonActive,
              ]}
            >
              <Text style={[
                styles.actionButtonText,
                activeActionButton === "export" && styles.actionButtonTextActive,
              ]}>
                Export PDF
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setActiveActionButton("export");
                handleExport("csv");
              }}
              style={[
                styles.actionButton,
                activeActionButton === "export" && styles.actionButtonTextActive,
              ]}
            >
              <Text style={[
                styles.actionButtonText,
                activeActionButton === "export" && styles.actionButtonTextActive,
              ]}>
                Export CSV
              </Text>
            </Pressable>
            {hasChanges ? (
              <Pressable
                onPress={handleConfirmRosterClick}
                style={[
                  styles.actionButton,
                  styles.confirmButtonGlow,
                  activeActionButton === "confirm" && styles.actionButtonActive,
                ]}
              >
                <Text style={[
                  styles.actionButtonText,
                  styles.confirmButtonTextGlow,
                  activeActionButton === "confirm" && styles.actionButtonTextActive,
                ]}>
                  Confirm Roster
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
                ]}>
                  Confirm Roster
                </Text>
              </Pressable>
            )}
          </View>
          </View>

          {/* Active surveyors strip */}
        <View style={[styles.surveyorStrip, { marginTop: 12, marginBottom: 12 }]}>
          <View style={styles.surveyorHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
              <Text style={styles.surveyorHeaderText}>
                ACTIVE SURVEYORS
              </Text>
              <View style={{ width: 8 }} />
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
              style={{ maxHeight: 90, flex: 1 }}
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
                surveyors.filter((s) => s.active).map((s, idx) => (
                  <View key={s.id} style={{ marginLeft: idx > 0 ? 8 : 0 }}>
                    <DraggableSurveyor
                      surveyor={s}
                      onPress={
                        isWeb && webAssignMode
                          ? () => {
                              addAssignment(webAssignMode.dateKey, s.id);
                              setWebAssignMode(null);
                            }
                          : undefined
                      }
                    />
                  </View>
                ))
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

          {/* Middle: calendar */}
          {viewMode === "FORTNIGHT" ? (
            <WeekGrid
              days={fortnightDays}
              byDate={byDate}
              surveyors={surveyors}
              validationIssues={validationIssues}
              onDrop={(dateKey, surveyorId) => addAssignment(dateKey, surveyorId)}
              onEdit={(dateKey, a) => setEdit({ dateKey, assignment: a })}
              onWebAssign={(dateKey) => setWebAssignMode({ dateKey })}
            />
          ) : (
            <MonthGrid
              days={monthDays}
              byDate={byDate}
              surveyors={surveyors}
              onDrop={(dateKey, surveyorId) => addAssignment(dateKey, surveyorId)}
              onEdit={(dateKey, a) => setEdit({ dateKey, assignment: a })}
              onWebAssign={(dateKey) => setWebAssignMode({ dateKey })}
            />
          )}
          </View>
        </View>

        {/* Web: Surveyor selection modal */}
        {isWeb && webAssignMode && (() => {
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
                  <Text style={{ color: "#000000", fontSize: 12, marginBottom: 20 }}>
                    Tap a surveyor to assign or edit their shift
                  </Text>
                  <ScrollView style={{ maxHeight: 500 }}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start" }}>
                      {surveyors
                        .filter((s) => s.active) // Show all active surveyors for manual assignment
                        .map((s) => {
                          const isAssigned = assignedSurveyorIds.has(s.id);
                          const assignment = assignmentMap[s.id];
                          
                          const isNightShift = isAssigned && assignment && assignment.shift === "NIGHT";
                          const cardBorderColor = isAssigned 
                            ? (isNightShift ? NIGHT_SHIFT_COLOR : "#fbbf24")
                            : "#e5e5e5";
                          const cardBackgroundColor = isAssigned
                            ? (isNightShift ? "rgba(30, 58, 95, 0.1)" : "rgba(251, 191, 36, 0.1)")
                            : "#ffffff";
                          const imageBorderColor = isAssigned
                            ? (isNightShift ? NIGHT_SHIFT_COLOR : "#fbbf24")
                            : "#e5e5e5";
                          const textColor = "#000000"; // Always black for better readability
                          
                          // Note: All surveyors are available for manual assignment regardless of area preference
                          // Area preference is only enforced in auto-populate, not manual assignments
                          
                          return (
                            <Pressable
                              key={s.id}
                              onPress={() => {
                                // Allow manual assignment regardless of area preference
                                addAssignment(dateKey, s.id);
                                setWebAssignMode(null);
                              }}
                              style={[
                                {
                                  width: "30%",
                                  minWidth: 140,
                                  marginRight: "3%",
                                  marginBottom: 16,
                                  padding: 12,
                                  borderRadius: 12,
                                  borderWidth: 2,
                                  borderColor: cardBorderColor,
                                  backgroundColor: cardBackgroundColor,
                                  alignItems: "center",
                                }
                              ]}
                            >
                              <Image
                                source={{ uri: s.photoUrl }}
                                style={{ 
                                  width: 60, 
                                  height: 60, 
                                  borderRadius: 30, 
                                  borderWidth: 2, 
                                  borderColor: imageBorderColor,
                                  marginBottom: 8
                                }}
                              />
                              <Text 
                                style={{ 
                                  color: textColor, 
                                  fontWeight: "600", 
                                  fontSize: 13,
                                  textAlign: "center",
                                  marginBottom: 4
                                }}
                                numberOfLines={2}
                              >
                                {s.name}
                              </Text>
                              {isAssigned && assignment && (
                                <View style={{ 
                                  marginTop: 4,
                                  paddingHorizontal: 8,
                                  paddingVertical: 4,
                                  borderRadius: 6,
                                  backgroundColor: isNightShift ? "rgba(30, 58, 95, 0.3)" : "rgba(251, 191, 36, 0.2)",
                                  borderWidth: 1,
                                  borderColor: isNightShift ? NIGHT_SHIFT_COLOR : "#fbbf24"
                                }}>
                                  <Text style={{ 
                                    color: "#000000", 
                                    fontWeight: "700", 
                                    fontSize: 11,
                                    textAlign: "center"
                                  }}>
                                    {assignment.shift} SHIFT
                                  </Text>
                                </View>
                              )}
                            </Pressable>
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
              setActiveActionButton(null);
            }}
          >
            <Pressable
              style={styles.modalOverlayCentered}
              onPress={() => {
                setConfirmRosterModal(false);
                setActiveActionButton(null);
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

                  {validationIssues.length > 0 && (
                    <View style={{ marginTop: 12, padding: 12, backgroundColor: "rgba(251, 191, 36, 0.1)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(251, 191, 36, 0.3)" }}>
                      <Text style={{ color: "#000000", fontWeight: "600", fontSize: 13, marginBottom: 6 }}>
                        ⚠️ Validation Issues ({validationIssues.length}):
                      </Text>
                      <ScrollView style={{ maxHeight: 100 }}>
                        {validationIssues.slice(0, 3).map((issue, idx) => (
                          <Text key={idx} style={{ color: "#000000", fontSize: 12, marginBottom: 4 }}>
                            • {issue}
                          </Text>
                        ))}
                        {validationIssues.length > 3 && (
                          <Text style={{ color: "#000000", fontSize: 12, fontStyle: "italic" }}>
                            ... and {validationIssues.length - 3} more
                          </Text>
                        )}
                      </ScrollView>
                    </View>
                  )}
                </View>

                <View style={{ flexDirection: "row", marginTop: 20 }}>
                  <Pressable
                    onPress={() => {
                      setConfirmRosterModal(false);
                      setActiveActionButton(null);
                    }}
                    style={[styles.modalButton, styles.modalButtonSecondary, { flex: 1, marginRight: 8 }]}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </Pressable>
        <Pressable
          onPress={onConfirmRoster}
                    style={[styles.modalButton, styles.modalButtonPrimary, { flex: 1, marginLeft: 8 }]}
        >
                    <Text style={[styles.modalButtonText, styles.modalButtonTextPrimary]}>
                      Confirm & Save
                    </Text>
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
  },
  content: {
    padding: 16,
  },
  surveyorStrip: {
    marginBottom: 8,
  },
  surveyorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#f9f9f9",
    borderWidth: 1.5,
    borderColor: "#e5e5e5",
    marginBottom: 8,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  surveyorHeaderText: {
    color: "#000000",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  surveyorCount: {
    color: "#000000",
    fontSize: 15,
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
        width: 150,
    backgroundColor: "#ffffff",
        borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
        flexDirection: "row",
        alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
    minHeight: 56,
    maxHeight: 56,
  },
  tabsAndContentWrapper: {
    marginTop: 12,
    marginBottom: 12,
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
    alignItems: "flex-end",
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
    marginLeft: 0,
    marginRight: 0,
    overflow: "hidden",
  },
  officeTabHeading: {
    fontSize: 28,
    fontWeight: "700",
    color: "#3c4043",
    marginBottom: 16,
    marginTop: 12,
    textAlign: "center",
    letterSpacing: 0.5,
  },
  officeTab: {
    paddingVertical: 12,
    paddingHorizontal: 20,
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
    marginBottom: -1,
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
    padding: 12,
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
    padding: 12,
    paddingTop: 12,
    borderWidth: 0,
  },
  controlsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  chipContainer: {
    flexDirection: "row",
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  chipActive: {
    backgroundColor: "rgba(251, 191, 36, 0.1)",
    borderWidth: 1,
    borderColor: "#fbbf24",
  },
  chipText: {
    color: "#000000",
    fontWeight: "600",
    fontSize: 13,
  },
  chipTextActive: {
    color: "#000000",
  },
  dateText: {
    color: "#000000",
    fontWeight: "700",
    fontSize: 18,
    letterSpacing: 0.5,
  },
  calendarContainer: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: 16,
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
  },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#ffffff",
    alignItems: "center",
    marginLeft: 8,
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
    fontSize: 13,
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
    minHeight: 90,
    backgroundColor: "#fafafa",
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 6,
    padding: 10,
  },
  dayCellDraggingOver: {
    backgroundColor: "rgba(251, 191, 36, 0.2)",
    borderColor: "#fbbf24",
    borderWidth: 2,
  },
  dayCellLarge: {
    minHeight: 280,
  },
  dayCellHeader: {
    color: "#000000",
    fontWeight: "700",
    fontSize: 14,
    marginBottom: 4,
  },
  dayCellHint: {
    color: "#666666",
    fontSize: 10,
    fontStyle: "italic",
  },
  assignmentCard: {
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#ffffff",
    marginBottom: 6,
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
    fontSize: 12,
  },
  assignmentName: {
    color: "#000000",
    fontSize: 11,
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
    padding: 24,
    borderTopWidth: 2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.3)",
    backgroundColor: "#fff8f0",
  },
  modalContentCentered: {
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.3)",
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle: {
    color: "#000000",
    fontWeight: "800",
    fontSize: 20,
    letterSpacing: 1,
    marginBottom: 8,
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
    padding: 14,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 6,
    backgroundColor: "#ffffff",
    alignItems: "center",
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

function DraggableSurveyor({ surveyor, onPress }) {
  const isWeb = Platform.OS === "web";
  const dragRef = useRef(null);
  
  useEffect(() => {
    if (isWeb && dragRef.current) {
      // React Native Web refs point to the underlying DOM element
      const element = dragRef.current;
      
      // Check if it's actually a DOM element
      if (element && typeof element.addEventListener === 'function') {
        const handleDragStart = (e) => {
          e.dataTransfer.setData("surveyorId", surveyor.id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", surveyor.id);
          element.style.opacity = "0.5";
        };
        
        const handleDragEnd = (e) => {
          element.style.opacity = "1";
        };
        
        element.setAttribute("draggable", "true");
        element.addEventListener("dragstart", handleDragStart);
        element.addEventListener("dragend", handleDragEnd);
        
        return () => {
          element.removeEventListener("dragstart", handleDragStart);
          element.removeEventListener("dragend", handleDragEnd);
        };
      }
    }
  }, [isWeb, surveyor.id]);
  
  if (isWeb) {
    return (
      <View
        ref={dragRef}
        style={[styles.surveyorCard, isWeb && { cursor: "grab", userSelect: "none" }]}
      >
        <Image
          source={{ uri: surveyor.photoUrl }}
          style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: "#e5e5e5" }}
        />
        <View style={{ width: 8 }} />
        <Text style={{ color: "#000000", fontWeight: "600", fontSize: 11, pointerEvents: "none", flex: 1 }} numberOfLines={2}>
          {surveyor.name}
        </Text>
      </View>
    );
  }

  // Native: use DraxView for drag and drop
  // Note: collapsable={false} helps prevent measureLayout warnings
  return (
    <DraxView
      style={styles.surveyorCard}
      draggingStyle={{ opacity: 0.3 }}
      dragPayload={{ surveyorId: surveyor.id }}
      longPressDelay={120}
      draggable
      collapsable={false}
    >
      <Image
        source={{ uri: surveyor.photoUrl }}
        style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: "#fbbf24" }}
      />
      <View style={{ width: 8 }} />
      <Text style={{ color: "#000000", fontWeight: "600", fontSize: 11, flex: 1 }} numberOfLines={2}>
        {surveyor.name}
      </Text>
    </DraxView>
  );
}

function WeekGrid({ days, byDate, surveyors, validationIssues = [], onDrop, onEdit, onWebAssign }) {
  const [showAllIssues, setShowAllIssues] = useState(false);
  
  // Check if there are any assignments in the current fortnight
  const hasAssignments = days.some(day => {
    const dateKey = format(day, "yyyy-MM-dd");
    return byDate[dateKey] && byDate[dateKey].length > 0;
  });
  
  // If 14 days (fortnight), split into two weeks
  if (days.length === 14) {
    const week1 = days.slice(0, 7);
    const week2 = days.slice(7, 14);
    
  return (
      <View style={styles.calendarContainer}>
        {/* Validation warnings - above Week 1 - only show if there are assignments */}
        {hasAssignments && validationIssues.length > 0 && (
          <View style={[styles.validationWarning, { marginBottom: 16 }]}>
            <Text style={styles.validationTitle}>
              ⚠️ Validation Issues ({validationIssues.length})
            </Text>
            <ScrollView style={{ maxHeight: showAllIssues ? 300 : 120 }}>
              {(showAllIssues ? validationIssues : validationIssues.slice(0, 5)).map((issue, idx) => (
                <Text key={idx} style={styles.validationText}>
                  • {issue}
                </Text>
              ))}
              {validationIssues.length > 5 && !showAllIssues && (
                <Pressable
                  onPress={() => setShowAllIssues(true)}
                  style={{ marginTop: 8 }}
                >
                  <Text style={[styles.validationText, { color: "#fbbf24", fontWeight: "600", textDecorationLine: "underline" }]}>
                    Click to view all {validationIssues.length} issues
                  </Text>
                </Pressable>
              )}
              {showAllIssues && validationIssues.length > 5 && (
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
        
        {/* Week 1 - Top */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#000000", marginBottom: 8, paddingLeft: 4 }}>
            Week 1: {format(week1[0], "EEE d MMM")} - {format(week1[6], "EEE d MMM")}
          </Text>
          <View style={{ flexDirection: "row" }}>
            {week1.map((d, idx) => {
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
              compact={false}
                  />
                </View>
              );
            })}
          </View>
        </View>
        
        {/* Week 2 - Bottom */}
        <View>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#000000", marginBottom: 8, paddingLeft: 4 }}>
            Week 2: {format(week2[0], "EEE d MMM")} - {format(week2[6], "EEE d MMM")}
          </Text>
          <View style={{ flexDirection: "row" }}>
            {week2.map((d, idx) => {
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
                    compact={false}
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
            <View key={dateKey} style={{ flex: 1, marginLeft: idx > 0 ? 8 : 0 }}>
            <DayCell
              date={d}
              dateKey={dateKey}
              items={byDate[dateKey] ?? []}
                surveyors={surveyors}
              onDrop={onDrop}
              onEdit={onEdit}
                onWebAssign={onWebAssign}
              compact={false}
            />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MonthGrid({ days, byDate, surveyors, onDrop, onEdit, onWebAssign }) {
  // Simple month grid (not aligned to weekday). Works as MVP.
  const rows = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));

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
              />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function DayCell({ date, dateKey, items, surveyors, onDrop, onEdit, onWebAssign, compact }) {
  const isWeb = Platform.OS === "web";
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dropRef = useRef(null);

  // Helper function to get surveyor info
  const getSurveyor = (surveyorId) => {
    return surveyors.find((s) => s.id === surveyorId);
  };

  useEffect(() => {
    if (isWeb && dropRef.current) {
      // React Native Web refs point to the underlying DOM element
      const element = dropRef.current;
      
      // Check if it's actually a DOM element
      if (element && typeof element.addEventListener === 'function') {
        const handleDragOver = (e) => {
          e.preventDefault();
          e.stopPropagation();
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
          }
        };
        
        const handleDrop = (e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingOver(false);
          
          const surveyorId = e.dataTransfer.getData("surveyorId") || e.dataTransfer.getData("text/plain");
          
          if (surveyorId) {
            onDrop(dateKey, surveyorId);
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
  }, [isWeb, dateKey, onDrop]);

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
          { cursor: "pointer" },
        ]}
      >
        <Text style={styles.dayCellHeader}>
          {format(date, compact ? "EEE d" : "EEEE d MMM")}
        </Text>
        <Text style={styles.dayCellHint}>
          {isDraggingOver ? "Drop here" : "Drag surveyor or tap to assign and edit shifts"}
        </Text>

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
            
            // Group into pairs for side-by-side display
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
                        onEdit(dateKey, a);
                      }}
                      style={[
                        styles.assignmentCard,
                        styles.assignmentCardSideBySide,
                        a.confirmed && styles.assignmentCardConfirmed,
                        { 
                          marginRight: itemIdx === 0 && pair.length === 2 ? 6 : 0,
                          backgroundColor: backgroundColor,
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

  // Native: use DraxView for drag and drop
  // Note: collapsable={false} helps prevent measureLayout warnings
  return (
    <DraxView
      style={[styles.dayCell, !compact && styles.dayCellLarge]}
      receptive
      collapsable={false}
      onReceiveDragDrop={(event) => {
        const payload = event?.dragged?.payload;
        const surveyorId = payload?.surveyorId;
        if (!surveyorId) return;
        onDrop(dateKey, surveyorId);
      }}
    >
        <Text style={styles.dayCellHeader}>
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
          
          // Group into pairs for side-by-side display
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
            onPress={() => onEdit(dateKey, a)}
                    style={[
                      styles.assignmentCard,
                      styles.assignmentCardSideBySide,
                      a.confirmed && styles.assignmentCardConfirmed,
                      { 
                        marginRight: itemIdx === 0 && pair.length === 2 ? 6 : 0,
                        backgroundColor: backgroundColor,
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
  const [breakMins, setBreakMins] = useState("30");

  React.useEffect(() => {
    if (!assignment) return;
    setShift(assignment.shift);
    setBreakMins(String(assignment.breakMins ?? 30));
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
            <View style={{ width: 8 }} />
            <Chip label="NIGHT" active={shift === SHIFT.NIGHT} onPress={() => setShift(SHIFT.NIGHT)} />
            <View style={{ width: 8 }} />
            <Chip label="OFF" active={shift === SHIFT.OFF} onPress={() => setShift(SHIFT.OFF)} />
          </View>

          <View style={{ marginTop: 16 }}>
            <Text style={styles.inputLabel}>Break time (mins)</Text>
            <View style={{ height: 8 }} />
            <TextInput
              value={breakMins}
              onChangeText={setBreakMins}
              keyboardType="numeric"
              style={styles.textInput}
              placeholderTextColor="#64748b"
            />
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
                  breakMins: Number(breakMins || 0),
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


