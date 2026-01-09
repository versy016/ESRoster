import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  Switch,
  ActivityIndicator,
  Pressable,
  Alert,
} from "react-native";
import TopNav from "../components/TopNav";
import { useAuth } from "../contexts/AuthContext";
import { useRouter, useLocalSearchParams } from "expo-router";
import { format, startOfWeek, addDays, subDays } from "date-fns";
import { loadRosterForDate, saveRoster } from "../lib/storage-hybrid";
import { createRoster } from "../lib/db";
import { updateRoster } from "../lib/db";

export default function RulesScreen() {
  const { role } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams();
  
  // Get current fortnight from params or use current date
  const { fortnightStart, fortnightEnd, area, fortnightKey, isCurrentFortnight } = useMemo(() => {
    const currentDate = params.date ? new Date(params.date) : new Date();
    const areaValue = params.area === "NORTH" ? "NORTH" : "SOUTH"; // Default to SOUTH
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    const end = addDays(start, 13);
    // Create a stable key for the dependency array
    const key = `${format(start, "yyyy-MM-dd")}-${areaValue}`;
    // Check if this is the current fortnight
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const isCurrent = format(start, "yyyy-MM-dd") === format(currentWeekStart, "yyyy-MM-dd");
    return { fortnightStart: start, fortnightEnd: end, area: areaValue, fortnightKey: key, isCurrentFortnight: isCurrent };
  }, [params.date, params.area]);
  
  const [loading, setLoading] = useState(true);
  const [currentRoster, setCurrentRoster] = useState(null);
  const [disabledRules, setDisabledRules] = useState([]);
  const [saving, setSaving] = useState(false);

  // Redirect non-supervisors away from rules page
  useEffect(() => {
    if (role !== "supervisor" && role !== "admin") {
      router.replace("/roster");
    }
  }, [role, router]);

  // Load current roster for the fortnight
  useEffect(() => {
    loadCurrentRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fortnightKey]);

  async function loadCurrentRoster() {
    try {
      setLoading(true);
      const roster = await loadRosterForDate(fortnightStart, area);
      if (roster) {
        setCurrentRoster(roster);
        // Load disabled rules from roster
        const disabled = roster.disabledRules || [];
        setDisabledRules(disabled);
      } else {
        setCurrentRoster(null);
        setDisabledRules([]);
      }
    } catch (error) {
      console.error("Error loading roster:", error);
      setCurrentRoster(null);
      setDisabledRules([]);
    } finally {
      setLoading(false);
    }
  }

  // Area switching function
  const switchArea = (newArea) => {
    router.push({
      pathname: "/rules",
      params: {
        date: format(fortnightStart, "yyyy-MM-dd"),
        area: newArea,
      },
    });
  };

  // Navigation functions
  const goToPreviousFortnight = () => {
    const prevStart = subDays(fortnightStart, 14);
    router.push({
      pathname: "/rules",
      params: {
        date: format(prevStart, "yyyy-MM-dd"),
        area: area,
      },
    });
  };

  const goToNextFortnight = () => {
    const nextStart = addDays(fortnightStart, 14);
    router.push({
      pathname: "/rules",
      params: {
        date: format(nextStart, "yyyy-MM-dd"),
        area: area,
      },
    });
  };

  const goToCurrentFortnight = () => {
    router.push({
      pathname: "/rules",
      params: {
        date: format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"),
        area: area,
      },
    });
  };

  async function toggleRule(ruleId) {
    const newDisabledRules = disabledRules.includes(ruleId)
      ? disabledRules.filter(r => r !== ruleId)
      : [...disabledRules, ruleId];
    
    setDisabledRules(newDisabledRules);
    setSaving(true);

    try {
      if (currentRoster && currentRoster.id) {
        // Update existing roster
        await updateRoster(currentRoster.id, {
          disabledRules: newDisabledRules,
        });
        // Reload to ensure we have the latest data
        await loadCurrentRoster();
      } else {
        // Create a new roster entry for this fortnight if it doesn't exist
        const rosterData = {
          startDate: format(fortnightStart, "yyyy-MM-dd"),
          endDate: format(addDays(fortnightStart, 13), "yyyy-MM-dd"),
          area: area,
          status: "draft",
          assignmentsByDate: {},
          disabledRules: newDisabledRules,
        };
        
        const saveResult = await saveRoster(rosterData);
        if (saveResult.success) {
          // Reload to get the new roster with its ID
          await loadCurrentRoster();
        } else {
          throw new Error(saveResult.error || "Failed to create roster");
        }
      }
    } catch (error) {
      console.error("Error saving disabled rules:", error);
      Alert.alert("Error", `Failed to save rules: ${error.message || "Unknown error"}`);
      // Revert on error
      setDisabledRules(disabledRules);
    } finally {
      setSaving(false);
    }
  }

  // Don't render if user is not a supervisor or admin
  if (role !== "supervisor" && role !== "admin") {
    return null;
  }

  // Rules that can be disabled for a particular fortnight
  const editableRules = [
    {
      id: "day_shift_9_shifts",
      text: "Day shift workers: Must work 9 shifts per fortnight",
    },
    {
      id: "max_1_weekend_per_fortnight",
      text: "Each surveyor can work a maximum of 1 weekend day per fortnight",
    },
    {
      id: "weekend_21_day_cooldown",
      text: "A surveyor cannot work a weekend if they worked a weekend in the last 21 days",
    },
    {
      id: "no_consecutive_saturdays",
      text: "A surveyor cannot work consecutive Saturdays",
    },
    {
      id: "max_1_saturday_in_3",
      text: "A surveyor can work a maximum of 1 Saturday in any 3-Saturday period",
    },
  ];

  const rules = [
    {
      category: "Basic Assignment Rules",
      items: [
        "Each surveyor can have a maximum of 1 shift per day (DAY or NIGHT, not both)",
        "Surveyors cannot work in both areas (STSP and NTNP) on the same day",
        "Assignments cannot be made on dates when surveyors are on leave",
      ],
    },
    {
      category: "Shift Count & Night Shift Rules",
      items: [
        "Night shift workers: Must work 10 shifts per fortnight (Mon-Fri only, no weekends)",
        "A surveyor is identified as a night shift worker if they have more night shifts than day shifts, or at least 5 night shifts",
        "Shift count is calculated across both areas if a surveyor works in both",
        "Shift count is adjusted based on non-availability days",
      ],
    },
    {
      category: "Demand & Coverage",
      items: [
        "Day shift demand must be met for each weekday (Mon-Fri)",
        "Night shift demand must be met for each weekday (Mon-Fri)",
        "Saturday day shift demand is a maximum (not strictly enforced)",
        "No coverage required on Sundays",
        "Demand can be set per date or use a weekly template",
      ],
    },
    {
      category: "Area Preferences & Availability",
      items: [
        "Surveyors can have area preferences (STSP/SOUTH or NTNP/NORTH)",
        "Manual assignments can override area preferences",
        "Auto-populate respects area preferences when possible",
        "Surveyors can mark dates as unavailable (e.g., annual leave)",
        "Unavailable dates are excluded from shift count calculations",
      ],
    },
    {
      category: "Roster Structure",
      items: [
        "Rosters are created for 14-day periods (fortnights starting Monday)",
        "Each roster is specific to an area (STSP or NTNP)",
        "Rosters can be in draft, confirmed, or published status",
      ],
    },
  ];

  return (
    <View style={styles.container}>
      <TopNav />
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Rostering Rules</Text>
            <Text style={styles.subtitle}>
              All rules and constraints that govern roster creation and validation
            </Text>
            {loading ? (
              <View style={{ marginTop: 16, alignItems: "center" }}>
                <ActivityIndicator size="small" color="#fbbf24" />
              </View>
            ) : (
              <View style={styles.fortnightInfo}>
                <View style={styles.fortnightHeader}>
                  <Pressable
                    onPress={goToPreviousFortnight}
                    style={styles.navButton}
                  >
                    <Text style={styles.navButtonText}>◀</Text>
                  </Pressable>
                  <View style={styles.fortnightTextContainer}>
                    <Text style={styles.fortnightText}>
                      {format(fortnightStart, "d MMM")} - {format(fortnightEnd, "d MMM yyyy")}
                    </Text>
                    <View style={styles.areaSelector}>
                      <Pressable
                        onPress={() => switchArea("SOUTH")}
                        style={[
                          styles.areaButton,
                          area === "SOUTH" && styles.areaButtonActive,
                        ]}
                      >
                        <Text style={[
                          styles.areaButtonText,
                          area === "SOUTH" && styles.areaButtonTextActive,
                        ]}>
                          STSP
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => switchArea("NORTH")}
                        style={[
                          styles.areaButton,
                          area === "NORTH" && styles.areaButtonActive,
                        ]}
                      >
                        <Text style={[
                          styles.areaButtonText,
                          area === "NORTH" && styles.areaButtonTextActive,
                        ]}>
                          NTNP
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                  <Pressable
                    onPress={goToNextFortnight}
                    style={styles.navButton}
                  >
                    <Text style={styles.navButtonText}>▶</Text>
                  </Pressable>
                </View>
                {!isCurrentFortnight && (
                  <Pressable
                    onPress={goToCurrentFortnight}
                    style={styles.currentButton}
                  >
                    <Text style={styles.currentButtonText}>Go to Current Fortnight</Text>
                  </Pressable>
                )}
                {!currentRoster && (
                  <Text style={styles.noRosterText}>
                    No roster exists for this fortnight. Rules will be saved when roster is created.
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Editable Rules Section */}
          <View style={styles.editableRulesSection}>
            <Text style={styles.editableSectionTitle}>Rules for the Fortnight</Text>
            <Text style={styles.editableSectionSubtitle}>
              These rules can be disabled for the selected fortnight period
            </Text>
            <View style={styles.editableRulesList}>
              {editableRules.map((rule, index) => {
                const isDisabled = disabledRules.includes(rule.id);
                return (
                  <View key={rule.id} style={styles.editableRuleItem}>
                    <View style={styles.editableRuleContent}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={[styles.editableRuleText, isDisabled && styles.disabledRuleText]}>
                        {rule.text}
                      </Text>
                    </View>
                    <View style={styles.toggleContainer}>
                      <Switch
                        value={!isDisabled}
                        onValueChange={() => toggleRule(rule.id)}
                        disabled={saving || !currentRoster}
                        trackColor={{ false: "#d1d5db", true: "#fbbf24" }}
                        thumbColor={isDisabled ? "#9ca3af" : "#ffffff"}
                      />
                      <Text style={[styles.toggleLabel, isDisabled && styles.disabledLabel]}>
                        {isDisabled ? "Disabled" : "Enabled"}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Other Rules Sections */}
          {rules.map((ruleCategory, index) => (
            <View key={index} style={styles.ruleCategory}>
              <Text style={styles.categoryTitle}>{ruleCategory.category}</Text>
              <View style={styles.ruleList}>
                {ruleCategory.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={styles.ruleItem}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.ruleText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              These rules are automatically enforced during roster validation and auto-population.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
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
    padding: Platform.OS === "web" ? 20 : 16,
    paddingTop: Platform.OS === "web" ? 80 : 70,
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: Platform.OS === "web" ? 32 : 28,
    fontWeight: "800",
    color: "#000000",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#666666",
    lineHeight: 22,
  },
  ruleCategory: {
    marginBottom: 32,
    padding: 20,
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  categoryTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#000000",
    marginBottom: 16,
  },
  ruleList: {
    gap: 12,
  },
  ruleItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  bullet: {
    fontSize: 16,
    color: "#fbbf24",
    fontWeight: "700",
    marginTop: 2,
  },
  ruleText: {
    flex: 1,
    fontSize: 15,
    color: "#333333",
    lineHeight: 22,
  },
  footer: {
    marginTop: 24,
    marginBottom: 40,
    padding: 16,
    backgroundColor: "#fff8f0",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fbbf24",
  },
  footerText: {
    fontSize: 14,
    color: "#666666",
    lineHeight: 20,
    textAlign: "center",
  },
  fortnightInfo: {
    marginTop: 16,
    padding: 16,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  fortnightHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  navButton: {
    width: Platform.OS === "web" ? 40 : 44, // Minimum touch target for mobile
    height: Platform.OS === "web" ? 40 : 44,
    borderRadius: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e5e5",
    alignItems: "center",
    justifyContent: "center",
  },
  navButtonText: {
    fontSize: 18,
    color: "#000000",
    fontWeight: "600",
  },
  fortnightTextContainer: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 12,
  },
  fortnightText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000000",
    marginBottom: 4,
  },
  fortnightAreaText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666666",
  },
  areaSelector: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
    justifyContent: "center",
  },
  areaButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  areaButtonActive: {
    backgroundColor: "#fbbf24",
    borderColor: "#fbbf24",
  },
  areaButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666666",
  },
  areaButtonTextActive: {
    color: "#000000",
  },
  currentButton: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#fbbf24",
    borderRadius: 6,
    alignSelf: "center",
  },
  currentButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#000000",
  },
  noRosterText: {
    fontSize: 12,
    color: "#999999",
    fontStyle: "italic",
    marginTop: 12,
    textAlign: "center",
  },
  toggleableRuleItem: {
    backgroundColor: "#ffffff",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    marginBottom: 8,
  },
  toggleContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 8,
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#22c55e",
  },
  disabledLabel: {
    color: "#ef4444",
  },
  disabledRuleText: {
    textDecorationLine: "line-through",
    color: "#999999",
  },
  editableRulesSection: {
    marginBottom: 32,
    padding: 20,
    backgroundColor: "#fff8f0",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#fbbf24",
  },
  editableSectionTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#000000",
    marginBottom: 8,
  },
  editableSectionSubtitle: {
    fontSize: 14,
    color: "#666666",
    marginBottom: 16,
    lineHeight: 20,
  },
  editableRulesList: {
    gap: 12,
  },
  editableRuleItem: {
    backgroundColor: "#ffffff",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  editableRuleContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },
  editableRuleText: {
    flex: 1,
    fontSize: 15,
    color: "#333333",
    lineHeight: 22,
  },
});


