import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, Alert, Modal, Image } from "react-native";
import { Link, usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useUnsavedChanges } from "../contexts/UnsavedChangesContext";

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { hasUnsavedChanges } = useUnsavedChanges();
  const [pendingNavigation, setPendingNavigation] = useState(null); // Track pending navigation

  const navItems = [
    { href: "/roster", label: "Roster", icon: "calendar-outline" },
    { href: "/surveyor-view", label: "Surveyor View", icon: "person-outline" },
    { href: "/demand", label: "Demand", icon: "stats-chart-outline" },
    { href: "/surveyors", label: "Surveyors", icon: "people-outline" },
  ];

  const isWeb = Platform.OS === "web";
  const Container = isWeb ? View : LinearGradient;
  const containerProps = isWeb
    ? { style: [styles.container, { backgroundColor: "#ffffff" }] }
    : {
        colors: ["#ffffff", "#fff8f0", "#ffffff"],
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        style: styles.container,
      };

  const handleNavigation = (href) => {
    // Check if we're already on the target page (no need to navigate)
    if (href === pathname) {
      return; // Already on this page
    }
    
    // Debug logging
    console.log("Navigation attempt:", { pathname, href, hasUnsavedChanges });
    
    // Check if we're on roster page and have unsaved changes
    if (pathname === "/roster" && hasUnsavedChanges && href !== "/roster") {
      console.log("Blocking navigation - showing confirmation");
      // Store the pending navigation and show modal/alert
      setPendingNavigation(href);
      
      if (isWeb) {
        // On web, show custom modal (Alert.alert might not block properly)
        // Modal state is handled by pendingNavigation
      } else {
        // On native, use Alert.alert
        Alert.alert(
          "Unsaved Changes",
          "You have unsaved changes to the roster. Do you want to save them before leaving?",
          [
            {
              text: "Cancel",
              style: "cancel",
              onPress: () => setPendingNavigation(null),
            },
            {
              text: "Ignore",
              onPress: () => {
                setPendingNavigation(null);
                router.push(href);
              },
            },
            {
              text: "Save First",
              onPress: () => {
                setPendingNavigation(null);
                Alert.alert("Info", "Please click 'Confirm Roster' to save your changes before navigating.");
              },
            },
          ]
        );
      }
    } else {
      router.push(href);
    }
  };

  const handleModalCancel = () => {
    setPendingNavigation(null);
  };

  const handleModalIgnore = () => {
    const href = pendingNavigation;
    setPendingNavigation(null);
    if (href) {
      router.push(href);
    }
  };

  const handleModalSaveFirst = () => {
    setPendingNavigation(null);
    Alert.alert("Info", "Please click 'Confirm Roster' to save your changes before navigating.");
  };

  return (
    <>
      <Container {...containerProps}>
        <View style={styles.content}>
          <View style={styles.logoContainer}>
            <Image 
              source={require("../assets/ES_Logo.png")} 
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <View style={styles.navContainer}>
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              if (isWeb) {
                // Web: Use Pressable to intercept navigation
                return (
                  <Pressable
                    key={item.href}
                    onPress={() => handleNavigation(item.href)}
                    style={[styles.navButton, isActive && styles.navButtonActive]}
                  >
                    <Ionicons
                      name={item.icon}
                      size={18}
                      color={isActive ? "#fbbf24" : "#000000"}
                    />
                    <View style={{ width: 6 }} />
                    <Text style={[styles.navText, isActive && styles.navTextActive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }
              // Native: Use Pressable to intercept navigation
              return (
                <Pressable
                  key={item.href}
                  onPress={() => handleNavigation(item.href)}
                  style={[styles.navButton, isActive && styles.navButtonActive]}
                >
                  <Ionicons
                    name={item.icon}
                    size={18}
                    color={isActive ? "#fbbf24" : "#000000"}
                  />
                  <View style={{ width: 6 }} />
                  <Text style={[styles.navText, isActive && styles.navTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Container>

      {/* Custom Modal for Web - Navigation Confirmation */}
      {isWeb && pendingNavigation && (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={handleModalCancel}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Unsaved Changes</Text>
              <Text style={styles.modalMessage}>
                You have unsaved changes to the roster. Do you want to save them before leaving?
              </Text>
              <View style={styles.modalButtons}>
                <Pressable
                  style={[styles.modalButton, styles.modalButtonCancel]}
                  onPress={handleModalCancel}
                >
                  <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalButton, styles.modalButtonIgnore]}
                  onPress={handleModalIgnore}
                >
                  <Text style={styles.modalButtonText}>Ignore</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalButton, styles.modalButtonSave]}
                  onPress={handleModalSaveFirst}
                >
                  <Text style={styles.modalButtonText}>Save First</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    minHeight: 64,
    position: "relative",
  },
  logoContainer: {
    position: "absolute",
    left: 20,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  logo: {
    height: 60,
    width: 300,
  },
  navContainer: {
    flexDirection: "row",
    gap: 4,
    marginLeft: "auto",
  },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  navButtonActive: {
    backgroundColor: "rgba(251, 191, 36, 0.15)",
  },
  navText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#000000",
  },
  navTextActive: {
    color: "#000000",
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 24,
    width: "90%",
    maxWidth: 400,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#000000",
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 16,
    color: "#666666",
    marginBottom: 24,
    lineHeight: 22,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  modalButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
    minWidth: 80,
    alignItems: "center",
  },
  modalButtonCancel: {
    backgroundColor: "transparent",
  },
  modalButtonIgnore: {
    backgroundColor: "#e5e5e5",
  },
  modalButtonSave: {
    backgroundColor: "#fbbf24",
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000000",
  },
  modalButtonTextCancel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#666666",
  },
});
