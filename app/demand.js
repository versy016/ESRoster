import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  Platform,
  Alert,
  StyleSheet,
} from "react-native";
import {
  format,
  startOfWeek,
  addDays,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
} from "date-fns";
import { saveDemand, loadDemand } from "../lib/storage-hybrid";
import TopNav from "../components/TopNav";

export default function DemandScreen() {
  const [viewMode, setViewMode] = useState("FORTNIGHT"); // FORTNIGHT | MONTH
  const [area, setArea] = useState("SOUTH"); // SOUTH | NORTH (internal app values)
  const [anchorDate, setAnchorDate] = useState(new Date());

  // { "2025-12-16": { day: 2, night: 1 } } - demand per shift type
  const [demand, setDemand] = useState({});
  
  // Get default template based on area
  const getDefaultTemplate = (area) => {
    if (area === "SOUTH") {
      // STSP defaults
      return {
        monFriDay: 5,
        satDay: 3,
        night: 1, // Mon-Fri nights only
      };
    } else {
      // NTNP defaults
      return {
        monFriDay: 3,
        satDay: 1,
        night: 0, // No nights for NTNP
      };
    }
  };

  // Template for Mon-Sat similar coverage
  const [template, setTemplate] = useState(getDefaultTemplate(area));

  useEffect(() => {
    loadSavedDemand(area);
  }, [area]);

  async function loadSavedDemand(targetArea = area) {
    // Clear demand first to prevent showing old area's data
    setDemand({});
    
    const saved = await loadDemand(targetArea);
    if (saved && saved.demand && Object.keys(saved.demand).length > 0) {
      setDemand(saved.demand);
      // Use saved template or default for target area
      setTemplate(saved.template || getDefaultTemplate(targetArea));
    } else {
      // No saved data, use defaults for target area
      const defaultTemplate = getDefaultTemplate(targetArea);
      setTemplate(defaultTemplate);
      // Auto-populate demand grid with defaults immediately
      const ws = startOfWeek(anchorDate, { weekStartsOn: 1 });
      const newDemand = {};
      
      // Apply to current fortnight (14 days)
      for (let i = 0; i < 14; i++) {
        const d = addDays(ws, i);
        const dateKey = format(d, "yyyy-MM-dd");
        const dow = d.getDay();
        
        if (dow >= 1 && dow <= 5) {
          // Mon-Fri
          newDemand[dateKey] = {
            day: defaultTemplate.monFriDay,
            night: defaultTemplate.night, // Mon-Fri nights (1 for STSP, 0 for NTNP)
          };
        } else if (dow === 6) {
          // Saturday
          newDemand[dateKey] = {
            day: defaultTemplate.satDay,
            night: 0, // Saturday nights always 0 for both zones
          };
        } else {
          // Sunday - no coverage
          newDemand[dateKey] = {
            day: 0,
            night: 0,
          };
        }
      }
      
      setDemand(newDemand);
    }
  }

  async function handleSave() {
    const result = await saveDemand({ demand, template, area });
    if (result.success) {
      Alert.alert("Success", "Demand settings saved");
    } else {
      Alert.alert("Error", "Failed to save demand settings");
    }
  }

  function applyTemplate() {
    const ws = startOfWeek(anchorDate, { weekStartsOn: 1 });
    const newDemand = {};
    
    // Apply to current fortnight (14 days)
    for (let i = 0; i < 14; i++) {
      const d = addDays(ws, i);
      const dateKey = format(d, "yyyy-MM-dd");
      const dow = d.getDay();
      
      if (dow >= 1 && dow <= 5) {
        // Mon-Fri
        newDemand[dateKey] = {
          day: template.monFriDay,
          night: template.night, // Mon-Fri nights (1 for STSP, 0 for NTNP)
        };
      } else if (dow === 6) {
        // Saturday
        newDemand[dateKey] = {
          day: template.satDay,
          night: 0, // Saturday nights always 0 for both zones
        };
      } else {
        // Sunday - no coverage
        newDemand[dateKey] = {
          day: 0,
          night: 0,
        };
      }
    }
    
    setDemand(newDemand);
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

  function updateDemand(dateKey, shiftType, value) {
    setDemand((prev) => {
      const current = prev[dateKey] || { day: 0, night: 0 };
      const numValue = parseInt(value) || 0;
      return {
        ...prev,
        [dateKey]: {
          ...current,
          [shiftType]: Math.max(0, numValue),
        },
      };
    });
  }

  function getDemand(dateKey, shiftType) {
    return demand[dateKey]?.[shiftType] || 0;
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
      <TopNav />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ flex: 1, padding: 12, gap: 12, paddingTop: 70 }}>
        {/* Office Heading - Outside Border */}
        <Text style={styles.officeTabHeading}>
          {area === "SOUTH" ? "STSP DEMAND" : "NTNP DEMAND"}
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
                onPress={async () => {
                  setArea("SOUTH");
                  // Clear demand immediately and load for SOUTH area
                  setDemand({});
                  await loadSavedDemand("SOUTH");
                }}
              />
              <OfficeTab
                label="NTNP"
                active={area === "NORTH"}
                isFirst={false}
                onPress={async () => {
                  setArea("NORTH");
                  // Clear demand immediately and load for NORTH area
                  setDemand({});
                  await loadSavedDemand("NORTH");
                }}
              />
            </View>
          </View>

          {/* Content Area - All content below tabs */}
          <View style={styles.tabContentContainer}>
            {/* Toggle + nav */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Chip
                  active={viewMode === "FORTNIGHT"}
                  onPress={() => setViewMode("FORTNIGHT")}
                  label="Fortnight"
                />
                <Chip
                  active={viewMode === "MONTH"}
                  onPress={() => setViewMode("MONTH")}
                  label="Month"
                />
              </View>

              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Chip
                  label="◀"
                  onPress={() =>
                    setAnchorDate((d) =>
                      addDays(d, viewMode === "FORTNIGHT" ? -14 : -30)
                    )
                  }
                />
                <Text style={{ fontWeight: "700" }}>
                  {format(anchorDate, "MMM yyyy")}
                </Text>
                <Chip
                  label="▶"
                  onPress={() =>
                    setAnchorDate((d) => addDays(d, viewMode === "FORTNIGHT" ? 14 : 30))
                  }
                />
              </View>
            </View>

            {/* Calendar */}
            {viewMode === "FORTNIGHT" ? (
              <WeekGrid
                days={fortnightDays}
                demand={demand}
                getDemand={getDemand}
                updateDemand={updateDemand}
              />
            ) : (
              <MonthGrid
                days={monthDays}
                demand={demand}
                getDemand={getDemand}
                updateDemand={updateDemand}
              />
            )}

            {/* Template Section */}
            <View
              style={{
                padding: 12,
                borderWidth: 1,
                borderRadius: 10,
                gap: 10,
                borderColor: "#e5e5e5",
                backgroundColor: "#ffffff",
                marginTop: 12,
              }}
            >
              <Text style={{ fontWeight: "700", fontSize: 14 }}>
                Fortnight Template (Mon-Sat Similar Coverage)
              </Text>
              
              <View style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ flex: 1, fontWeight: "600", fontSize: 13 }}>Mon-Fri Day:</Text>
                  <TextInput
                    value={String(template.monFriDay)}
                    onChangeText={(v) =>
                      setTemplate({ ...template, monFriDay: parseInt(v) || 0 })
                    }
                    keyboardType="numeric"
                    style={{
                      borderWidth: 1,
                      borderRadius: 6,
                      padding: 6,
                      width: 70,
                      textAlign: "center",
                      fontSize: 13,
                    }}
                  />
                </View>
                
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ flex: 1, fontWeight: "600", fontSize: 13 }}>Saturday Day:</Text>
                  <TextInput
                    value={String(template.satDay)}
                    onChangeText={(v) =>
                      setTemplate({ ...template, satDay: parseInt(v) || 0 })
                    }
                    keyboardType="numeric"
                    style={{
                      borderWidth: 1,
                      borderRadius: 6,
                      padding: 6,
                      width: 70,
                      textAlign: "center",
                      fontSize: 13,
                    }}
                  />
                </View>
                
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ flex: 1, fontWeight: "600", fontSize: 13 }}>Night (Mon-Fri only):</Text>
                  <TextInput
                    value={String(template.night)}
                    onChangeText={(v) =>
                      setTemplate({ ...template, night: parseInt(v) || 0 })
                    }
                    keyboardType="numeric"
                    style={{
                      borderWidth: 1,
                      borderRadius: 6,
                      padding: 6,
                      width: 70,
                      textAlign: "center",
                      fontSize: 13,
                    }}
                  />
                </View>
                <Text style={{ fontSize: 11, color: "#666666", fontStyle: "italic" }}>
                  Note: Saturday nights are always 0 for both zones
                </Text>
              </View>
              
              <Pressable
                onPress={applyTemplate}
                style={{
                  padding: 10,
                  borderWidth: 1,
                  borderRadius: 8,
                  alignItems: "center",
                  backgroundColor: "#fbbf24",
                  borderColor: "#e5e5e5",
                }}
              >
                <Text style={{ fontWeight: "700", color: "#000000", fontSize: 13 }}>Apply Template to Current Fortnight</Text>
              </Pressable>
            </View>

            {/* Save Button */}
            <Pressable
              onPress={handleSave}
              style={{
                padding: 12,
                borderWidth: 1,
                borderRadius: 10,
                alignItems: "center",
                backgroundColor: "#000000",
                borderColor: "#000000",
                marginTop: 12,
              }}
            >
              <Text style={{ fontWeight: "700", color: "#ffffff", fontSize: 14 }}>Save Demand Settings</Text>
            </Pressable>
          </View>
        </View>
        </View>
      </ScrollView>
    </View>
  );
}

function WeekGrid({ days, getDemand, updateDemand }) {
  // If 14 days (fortnight), split into two weeks
  if (days.length === 14) {
    const week1 = days.slice(0, 7);
    const week2 = days.slice(7, 14);
    
    return (
      <View style={{ flex: 1, borderWidth: 1, borderRadius: 12, padding: 8, borderColor: "#e5e5e5" }}>
        {/* Week 1 - Top */}
        <View style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: "#000000", marginBottom: 6, paddingLeft: 2 }}>
            Week 1
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {week1.map((d) => {
              const dateKey = format(d, "yyyy-MM-dd");
              return (
                <DemandDayCell
                  key={dateKey}
                  date={d}
                  dateKey={dateKey}
                  getDemand={getDemand}
                  updateDemand={updateDemand}
                  compact={false}
                />
              );
            })}
          </View>
        </View>
        
        {/* Week 2 - Bottom */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: "700", color: "#000000", marginBottom: 6, paddingLeft: 2 }}>
            Week 2
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {week2.map((d) => {
              const dateKey = format(d, "yyyy-MM-dd");
              return (
                <DemandDayCell
                  key={dateKey}
                  date={d}
                  dateKey={dateKey}
                  getDemand={getDemand}
                  updateDemand={updateDemand}
                  compact={false}
                />
              );
            })}
          </View>
        </View>
      </View>
    );
  }
  
  // Regular week view (7 days)
  return (
    <View style={{ flex: 1, borderWidth: 1, borderRadius: 12, padding: 8, borderColor: "#e5e5e5" }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {days.map((d) => {
          const dateKey = format(d, "yyyy-MM-dd");
          return (
            <DemandDayCell
              key={dateKey}
              date={d}
              dateKey={dateKey}
              getDemand={getDemand}
              updateDemand={updateDemand}
              compact={false}
            />
          );
        })}
      </View>
    </View>
  );
}

function MonthGrid({ days, getDemand, updateDemand }) {
  const rows = [];
  for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));

  return (
    <View
      style={{ flex: 1, borderWidth: 1, borderRadius: 12, padding: 8, gap: 6 }}
    >
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row", gap: 6 }}>
          {row.map((d) => {
            const dateKey = format(d, "yyyy-MM-dd");
            return (
              <DemandDayCell
                key={dateKey}
                date={d}
                dateKey={dateKey}
                getDemand={getDemand}
                updateDemand={updateDemand}
                compact={true}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

function DemandDayCell({ date, dateKey, getDemand, updateDemand, compact }) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: compact ? 100 : 160,
        borderWidth: 1,
        borderRadius: 8,
        padding: 8,
        gap: 6,
        borderColor: "#e5e5e5",
        backgroundColor: "#ffffff",
      }}
    >
      <Text style={{ fontWeight: "700", fontSize: compact ? 11 : 13, color: "#000000", marginBottom: 2 }}>
        {format(date, compact ? "d" : "EEE d")}
      </Text>

      <View style={{ gap: 6, flex: 1 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 10, fontWeight: "600", color: "#000000", opacity: 0.8 }}>DAY</Text>
          <TextInput
            value={String(getDemand(dateKey, "day"))}
            onChangeText={(v) => updateDemand(dateKey, "day", v)}
            keyboardType="numeric"
            style={{
              borderWidth: 1,
              borderRadius: 6,
              padding: 6,
              fontSize: 13,
              textAlign: "center",
              borderColor: "#e5e5e5",
              backgroundColor: "#ffffff",
              color: "#000000",
            }}
            placeholder="0"
            placeholderTextColor="#999999"
          />
        </View>

        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 10, fontWeight: "600", color: "#000000", opacity: 0.8 }}>NIGHT</Text>
          <TextInput
            value={String(getDemand(dateKey, "night"))}
            onChangeText={(v) => updateDemand(dateKey, "night", v)}
            keyboardType="numeric"
            style={{
              borderWidth: 1,
              borderRadius: 6,
              padding: 6,
              fontSize: 13,
              textAlign: "center",
              borderColor: "#e5e5e5",
              backgroundColor: "#ffffff",
              color: "#000000",
            }}
            placeholder="0"
            placeholderTextColor="#999999"
          />
        </View>
      </View>
    </View>
  );
}

function Chip({ label, onPress, active }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#e5e5e5",
        backgroundColor: active ? "#fbbf24" : "#ffffff",
      }}
    >
      <Text style={{ 
        fontWeight: active ? "700" : "600",
        color: "#000000",
        fontSize: 13
      }}>
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

const styles = StyleSheet.create({
  officeTabHeading: {
    fontSize: 28,
    fontWeight: "700",
    color: "#3c4043",
    marginBottom: 16,
    marginTop: 12,
    textAlign: "center",
    letterSpacing: 0.5,
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
    borderColor: "#dadce0",
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginBottom: 0,
    marginTop: 0,
  },
});

