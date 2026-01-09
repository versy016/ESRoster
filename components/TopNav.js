import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, Alert, Modal, Image } from "react-native";
import { Link, usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useUnsavedChanges } from "../contexts/UnsavedChangesContext";
import { useAuth } from "../contexts/AuthContext";

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { hasUnsavedChanges } = useUnsavedChanges();
  const { user, signOut } = useAuth();
  const [pendingNavigation, setPendingNavigation] = useState(null); // Track pending navigation
  const [showLogoutModal, setShowLogoutModal] = useState(false); // For web logout modal

  const { role } = useAuth();

  const navItems = [
    { href: "/roster", label: "Roster", icon: "calendar-outline" },
    { href: "/surveyor-view", label: "Schedule", icon: "grid-outline" },
    // Hide Demand page from surveyors
    ...(role !== "surveyor" ? [{ href: "/demand", label: "Demand", icon: "stats-chart-outline" }] : []),
    // Only show surveyors link for supervisors
    ...(role === "supervisor" || role === "admin" ? [{ href: "/surveyors", label: "Surveyors", icon: "people-outline" }] : []),
    // Only show rules link for supervisors and admins
    ...(role === "supervisor" || role === "admin" ? [{ href: "/rules", label: "Rules", icon: "document-text-outline" }] : []),
    { href: "/profile", label: "Profile", icon: "person-circle-outline" },
  ];

  const isWeb = Platform.OS === "web";
  const isMobile = !isWeb;
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  
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
      console.log("Navigation skipped - already on target page:", href);
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
                console.log("Navigating to:", href);
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
      console.log("Navigating to:", href);
      // Use replace for same-route navigation to force reload, push for different routes
      if (href === pathname) {
        router.replace(href);
    } else {
      router.push(href);
      }
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

  const handleLogout = () => {
    if (isWeb) {
      // On web, use modal instead of Alert
      setShowLogoutModal(true);
    } else {
      // On native, use Alert
      Alert.alert(
        "Sign Out",
        "Are you sure you want to sign out?",
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Sign Out",
            style: "destructive",
            onPress: async () => {
              try {
                await signOut();
                // On web, use window.location for reliable navigation after sign out
                if (isWeb && typeof window !== "undefined") {
                  window.location.href = "/login";
                } else {
                  router.replace("/login");
                }
              } catch (error) {
                console.error("Logout error:", error);
                Alert.alert("Error", "Failed to sign out. Please try again.");
              }
            },
          },
        ]
      );
    }
  };

  const confirmLogout = async () => {
    setShowLogoutModal(false);
    try {
      await signOut();
      // On web, use window.location for reliable navigation after sign out
      if (isWeb && typeof window !== "undefined") {
        window.location.href = "/login";
      } else {
        router.replace("/login");
      }
    } catch (error) {
      console.error("Logout error:", error);
      Alert.alert("Error", "Failed to sign out. Please try again.");
    }
  };

  const cancelLogout = () => {
    setShowLogoutModal(false);
  };

  return (
    <>
      <Container {...containerProps}>
        <View style={styles.content}>
          {isMobile ? (
            // Mobile: Compact design with hamburger menu
            <View style={styles.mobileHeader}>
              <Image 
                source={require("../assets/ES_Logo.png")} 
                style={styles.mobileLogo}
                resizeMode="contain"
              />
              <Pressable
                onPress={() => setShowMobileMenu(!showMobileMenu)}
                style={styles.menuButton}
              >
                <Ionicons 
                  name={showMobileMenu ? "close" : "menu"} 
                  size={32} 
                  color="#000000" 
                />
              </Pressable>
            </View>
          ) : (
            // Web: Original design
            <>
              <View style={styles.logoContainer}>
                <Image 
                  source={require("../assets/ES_Logo.png")} 
                  style={[styles.logo, { backgroundPosition: "unset" }]}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.navContainer}>
                {navItems.map((item) => {
                  const isActive = pathname === item.href;
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
                {user && (
                  <Pressable
                    onPress={handleLogout}
                    style={styles.logoutButton}
                  >
                    <Ionicons name="log-out-outline" size={18} color="#000000" />
                    <View style={{ width: 6 }} />
                    <Text style={styles.logoutText}>Sign Out</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}
        </View>
      </Container>
      
      {/* Mobile Menu Dropdown - Using Modal for guaranteed visibility */}
      {isMobile && (
        <Modal
          visible={showMobileMenu}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowMobileMenu(false)}
        >
          <Pressable
            style={styles.mobileMenuOverlay}
            onPress={() => setShowMobileMenu(false)}
          >
            <Pressable
              style={styles.mobileMenu}
              onPress={(e) => e.stopPropagation()}
            >
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Pressable
                    key={item.href}
                    onPress={() => {
                      handleNavigation(item.href);
                      setShowMobileMenu(false);
                    }}
                    style={[styles.mobileNavItem, isActive && styles.mobileNavItemActive]}
                  >
                    <Ionicons
                      name={item.icon}
                      size={22}
                      color={isActive ? "#fbbf24" : "#000000"}
                    />
                    <Text style={[styles.mobileNavText, isActive && styles.mobileNavTextActive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
              {user && (
                <Pressable
                  onPress={() => {
                    handleLogout();
                    setShowMobileMenu(false);
                  }}
                  style={styles.mobileNavItem}
                >
                  <Ionicons name="log-out-outline" size={22} color="#000000" />
                  <Text style={styles.mobileNavText}>Sign Out</Text>
                </Pressable>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}

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

      {/* Logout Confirmation Modal for Web */}
      {isWeb && showLogoutModal && (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={cancelLogout}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Sign Out</Text>
              <Text style={styles.modalMessage}>
                Are you sure you want to sign out?
              </Text>
              <View style={styles.modalButtons}>
                <Pressable
                  style={[styles.modalButton, styles.modalButtonCancel]}
                  onPress={cancelLogout}
                >
                  <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalButton, styles.modalButtonSave]}
                  onPress={confirmLogout}
                >
                  <Text style={styles.modalButtonText}>Sign Out</Text>
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
    zIndex: 9999,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 10,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Platform.OS === "web" ? 20 : 12,
    paddingVertical: Platform.OS === "web" ? 8 : 8,
    minHeight: Platform.OS === "web" ? 48 : 44,
    position: "relative",
  },
  mobileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingHorizontal: 4,
    position: "relative",
  },
  mobileLogo: {
    height: 40,
    width: 160,
    backgroundPosition: "unset",
  },
  menuButton: {
    padding: 8,
    borderRadius: 8,
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    position: "absolute",
    right: 4,
  },
  mobileMenuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    paddingTop: 50, // Navbar height
  },
  mobileMenu: {
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 12,
    paddingVertical: 8,
  },
  mobileNavItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 50,
    gap: 12,
  },
  mobileNavItemActive: {
    backgroundColor: "rgba(251, 191, 36, 0.1)",
  },
  mobileNavText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#000000",
  },
  mobileNavTextActive: {
    color: "#000000",
    fontWeight: "700",
  },
  logoContainer: {
    position: "absolute",
    left: Platform.OS === "web" ? 20 : 12,
    alignItems: "flex-start",
    justifyContent: "center",
    zIndex: 10,
  },
  logo: {
    height: Platform.OS === "web" ? 50 : 36,
    width: Platform.OS === "web" ? 120 : 300,
    backgroundPosition: "unset",
  },
  navContainer: {
    flexDirection: "row",
    gap: 4,
    marginLeft: "auto",
  },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Platform.OS === "web" ? 16 : 12,
    paddingVertical: Platform.OS === "web" ? 8 : 10,
    borderRadius: 6,
    minHeight: 44, // Minimum touch target size for mobile
    minWidth: Platform.OS === "web" ? "auto" : 44,
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
    padding: Platform.OS === "web" ? 24 : 20,
    width: "90%",
    maxWidth: Platform.OS === "web" ? 400 : "95%",
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
    paddingHorizontal: Platform.OS === "web" ? 20 : 16,
    paddingVertical: Platform.OS === "web" ? 10 : 12,
    borderRadius: 6,
    minWidth: Platform.OS === "web" ? 80 : 60,
    minHeight: Platform.OS === "web" ? "auto" : 44, // Minimum touch target for mobile
    alignItems: "center",
    justifyContent: "center",
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
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  logoutText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#000000",
  },
});
