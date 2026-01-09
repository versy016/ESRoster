import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../contexts/AuthContext";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import TopNav from "../components/TopNav";
import { supabase } from "../lib/supabase";
import { loadSurveyors } from "../lib/storage-hybrid";
import { updateSurveyor, linkUserToSurveyor } from "../lib/db";

export default function ProfileScreen() {
  const { user, session, refreshRole, role: authRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState(null);
  const [surveyor, setSurveyor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allSurveyors, setAllSurveyors] = useState([]);
  const [promotingSurveyorId, setPromotingSurveyorId] = useState(null);
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [surveyorToPromote, setSurveyorToPromote] = useState(null);

  async function loadProfile() {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      console.log("[PROFILE] Loading profile for user:", user.id);
      setLoading(true);
      
      // Load surveyor record linked to this user (contains user_id and role)
      const { data: surveyorData, error: surveyorError } = await supabase
        .from("surveyors")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (surveyorError) {
        console.error("Error loading surveyor:", surveyorError);
      } else if (surveyorData) {
        setSurveyor(surveyorData);
        // Create a profile object from the surveyor data for compatibility
        setProfile({
          role: surveyorData.role || "surveyor",
          surveyor_id: surveyorData.id,
        });
        console.log("[PROFILE] Profile loaded successfully");
      } else {
        // User not linked to a surveyor yet - check if there's an unlinked surveyor with matching email
        if (user.email) {
          console.log("[PROFILE] No linked surveyor found, checking for auto-link by email:", user.email);
          const { data: matchingSurveyor, error: matchError } = await supabase
            .from("surveyors")
            .select("*")
            .eq("email", user.email.toLowerCase())
            .is("user_id", null) // Only unlinked surveyors
            .maybeSingle();
          
          if (!matchError && matchingSurveyor) {
            console.log("[PROFILE] Found unlinked surveyor with matching email, auto-linking:", matchingSurveyor.id);
            try {
              const linkResult = await linkUserToSurveyor(user.id, matchingSurveyor.id);
              if (linkResult.success) {
                console.log("[PROFILE] Successfully auto-linked surveyor to user");
                // Reload profile to show the linked surveyor
                await loadProfile();
                // Refresh role in AuthContext
                if (refreshRole) {
                  await refreshRole();
                }
                return; // Exit early since loadProfile will be called again
              } else {
                console.warn("[PROFILE] Failed to auto-link:", linkResult.error);
              }
            } catch (error) {
              console.error("[PROFILE] Error auto-linking:", error);
            }
          }
        }
        
        // User not linked to a surveyor yet
        setProfile({ role: "surveyor" });
        console.log("[PROFILE] User not linked to surveyor");
      }
    } catch (error) {
      console.error("Error loading profile:", error);
    } finally {
      setLoading(false);
    }
  }

  // Load all surveyors if user is supervisor
  async function loadAllSurveyors() {
    if (profile?.role === "supervisor") {
      try {
        const surveyors = await loadSurveyors();
        console.log("[PROMOTE] Loaded surveyors:", surveyors?.length, "surveyors");
        console.log("[PROMOTE] Surveyor roles:", surveyors?.map(s => ({ name: s.name, role: s.role })));
        setAllSurveyors(surveyors || []);
      } catch (error) {
        console.error("Error loading surveyors:", error);
        setAllSurveyors([]);
      }
    } else {
      console.log("[PROMOTE] Not a supervisor, skipping load");
    }
  }

  // Load profile when user changes
  useEffect(() => {
    loadProfile();
  }, [user]);

  // Load all surveyors when profile role is supervisor
  useEffect(() => {
    if (profile?.role === "supervisor") {
      loadAllSurveyors();
    }
  }, [profile?.role]);

  // Reload profile when screen comes into focus (navigation)
  useFocusEffect(
    useCallback(() => {
      console.log("[PROFILE] Screen focused, reloading profile...");
      loadProfile();
    }, [user])
  );

  // Also reload when pathname changes (fallback for web)
  useEffect(() => {
    if (pathname === "/profile") {
      console.log("[PROFILE] Pathname changed to /profile, reloading profile...");
      loadProfile();
    }
  }, [pathname, user]);
  
  // Reload profile when role changes in AuthContext (e.g., after promotion)
  useEffect(() => {
    if (authRole && pathname === "/profile") {
      console.log("[PROFILE] AuthContext role changed, reloading profile...", authRole);
      loadProfile();
    }
  }, [authRole, pathname]);

  const handleLinkSurveyor = () => {
    Alert.alert(
      "Link Surveyor",
      "This will link your account to a surveyor profile. You can do this from the Surveyors page by editing a surveyor and linking it to your account.",
      [{ text: "OK" }]
    );
  };

  function handlePromoteToSupervisor(surveyor) {
    console.log("[PROMOTE] Button clicked for:", surveyor.name);
    if (promotingSurveyorId) {
      console.log("[PROMOTE] Already promoting, ignoring click");
      return; // Prevent double-clicks
    }
    
    console.log("[PROMOTE] Opening confirmation modal");
    setSurveyorToPromote(surveyor);
    setShowPromoteModal(true);
  }

  async function confirmPromotion() {
    if (!surveyorToPromote) return;
    
    console.log("[PROMOTE] User confirmed, starting promotion...");
    setShowPromoteModal(false);
    setPromotingSurveyorId(surveyorToPromote.id);
    
    try {
      console.log("[PROMOTE] Calling updateSurveyor with:", surveyorToPromote.id, "role: supervisor");
      const result = await updateSurveyor(surveyorToPromote.id, {
        role: "supervisor",
      });
      
      console.log("[PROMOTE] Update result:", result);
      if (result.success) {
        console.log("[PROMOTE] Success! Reloading data...");
        Alert.alert("Success", `${surveyorToPromote.name} has been promoted to supervisor.`);
        // Reload surveyors list
        await loadAllSurveyors();
        // Reload profile in case the promoted surveyor is the current user
        await loadProfile();
        // Refresh role in AuthContext to update permissions immediately
        await refreshRole();
      } else {
        console.error("[PROMOTE] Failed:", result.error);
        Alert.alert("Error", result.error || "Failed to promote surveyor.");
      }
    } catch (error) {
      console.error("[PROMOTE] Exception:", error);
      Alert.alert("Error", "An error occurred while promoting the surveyor.");
    } finally {
      setPromotingSurveyorId(null);
      setSurveyorToPromote(null);
    }
  }

  function cancelPromotion() {
    console.log("[PROMOTE] User cancelled");
    setShowPromoteModal(false);
    setSurveyorToPromote(null);
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <TopNav />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#fbbf24" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TopNav />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.avatarContainer}>
            {user?.user_metadata?.avatar_url || surveyor?.photo_url ? (
              <Image
                source={{
                  uri: user?.user_metadata?.avatar_url || surveyor?.photo_url,
                }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={48} color="#666666" />
              </View>
            )}
          </View>
          <Text style={styles.name}>
            {user?.user_metadata?.name || user?.email?.split("@")[0] || "User"}
          </Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>
              {profile?.role === "supervisor" ? "Supervisor" : "Surveyor"}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Information</Text>
          
          <View style={styles.infoRow}>
            <Ionicons name="mail-outline" size={20} color="#666666" />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{user?.email}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark-outline" size={20} color="#666666" />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Role</Text>
              <Text style={styles.infoValue}>
                {profile?.role === "supervisor" ? "Supervisor" : "Surveyor"}
              </Text>
            </View>
          </View>
        </View>

        {surveyor ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Surveyor Profile</Text>
              
              <View style={styles.infoRow}>
                <Ionicons name="person-outline" size={20} color="#666666" />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Name</Text>
                  <Text style={styles.infoValue}>{surveyor.name}</Text>
                </View>
              </View>

              {surveyor.email && (
                <View style={styles.infoRow}>
                  <Ionicons name="mail-outline" size={20} color="#666666" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Surveyor Email</Text>
                    <Text style={styles.infoValue}>{surveyor.email}</Text>
                  </View>
                </View>
              )}

              <View style={styles.infoRow}>
                <Ionicons name="checkmark-circle-outline" size={20} color="#666666" />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Status</Text>
                  <Text style={styles.infoValue}>
                    {surveyor.active ? "Active" : "Inactive"}
                  </Text>
                </View>
              </View>
            </View>

            {/* Profile Actions Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Actions</Text>
              <View style={styles.profileActions}>
                <Pressable
                  style={styles.profileActionButton}
                  onPress={() => router.push("/surveyors?action=edit&id=" + surveyor.id)}
                >
                  <Ionicons name="create-outline" size={20} color="#000000" />
                  <Text style={styles.profileActionText}>Edit</Text>
                  <Ionicons name="chevron-forward" size={20} color="#666666" />
                </Pressable>

                <Pressable
                  style={styles.profileActionButton}
                  onPress={() => router.push("/surveyors?action=shift&id=" + surveyor.id)}
                >
                  <Ionicons name="time-outline" size={20} color="#000000" />
                  <Text style={styles.profileActionText}>Shift Preference</Text>
                  <Ionicons name="chevron-forward" size={20} color="#666666" />
                </Pressable>

                <Pressable
                  style={styles.profileActionButton}
                  onPress={() => router.push("/surveyors?action=area&id=" + surveyor.id)}
                >
                  <Ionicons name="location-outline" size={20} color="#000000" />
                  <Text style={styles.profileActionText}>Area Preference</Text>
                  <Ionicons name="chevron-forward" size={20} color="#666666" />
                </Pressable>

                <Pressable
                  style={styles.profileActionButton}
                  onPress={() => router.push("/surveyors?action=availability&id=" + surveyor.id)}
                >
                  <Ionicons name="calendar-outline" size={20} color="#000000" />
                  <Text style={styles.profileActionText}>Update Availability</Text>
                  <Ionicons name="chevron-forward" size={20} color="#666666" />
                </Pressable>

                {/* Only show activate/deactivate option for supervisors */}
                {profile?.role === "supervisor" && (
                  <Pressable
                    style={[styles.profileActionButton, !surveyor.active && styles.profileActionButtonActive]}
                    onPress={() => {
                      Alert.alert(
                        surveyor.active ? "Deactivate Surveyor" : "Activate Surveyor",
                        `Are you sure you want to ${surveyor.active ? "deactivate" : "activate"} ${surveyor.name}?`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: surveyor.active ? "Deactivate" : "Activate",
                            style: surveyor.active ? "destructive" : "default",
                            onPress: () => router.push("/surveyors?action=toggle&id=" + surveyor.id)
                          }
                        ]
                      );
                    }}
                  >
                    <Ionicons 
                      name={surveyor.active ? "close-circle-outline" : "checkmark-circle-outline"} 
                      size={20} 
                      color={surveyor.active ? "#dc2626" : "#10b981"} 
                    />
                    <Text style={[styles.profileActionText, !surveyor.active && { color: "#10b981" }]}>
                      {surveyor.active ? "Deactivate" : "Activate"}
                    </Text>
                    <Ionicons name="chevron-forward" size={20} color="#666666" />
                  </Pressable>
                )}
              </View>
            </View>
          </>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Surveyor Profile</Text>
            <View style={styles.emptyState}>
              <Ionicons name="person-outline" size={48} color="#cccccc" />
              <Text style={styles.emptyStateText}>
                Not linked to a surveyor profile
              </Text>
              <Text style={styles.emptyStateSubtext}>
                Contact a supervisor to link your account to a surveyor profile
              </Text>
            </View>
          </View>
        )}

        {profile?.role === "supervisor" && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Supervisor Actions</Text>
              
              <Pressable
                style={styles.actionButton}
                onPress={() => router.push("/surveyors")}
              >
                <Ionicons name="people-outline" size={20} color="#000000" />
                <Text style={styles.actionButtonText}>Manage Surveyors</Text>
                <Ionicons name="chevron-forward" size={20} color="#666666" />
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Promote Surveyors</Text>
              <Text style={styles.sectionSubtitle}>
                Promote surveyors to supervisor role
              </Text>
              
              {allSurveyors.length === 0 ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator size="small" color="#fbbf24" />
                  <Text style={styles.emptyStateText}>Loading surveyors...</Text>
                </View>
              ) : (
                <View style={styles.surveyorList}>
                  {allSurveyors
                    .filter(s => s.role !== "supervisor") // Only show non-supervisors
                    .map((s) => (
                      <View key={s.id} style={styles.surveyorListItem}>
                        <View style={styles.surveyorListItemContent}>
                          {s.photoUrl ? (
                            <Image
                              source={{ uri: s.photoUrl }}
                              style={styles.surveyorListItemAvatar}
                            />
                          ) : (
                            <View style={styles.surveyorListItemAvatarPlaceholder}>
                              <Ionicons name="person" size={20} color="#666666" />
                            </View>
                          )}
                          <View style={styles.surveyorListItemInfo}>
                            <Text style={styles.surveyorListItemName}>{s.name}</Text>
                            <Text style={styles.surveyorListItemRole}>
                              {s.role === "supervisor" ? "Supervisor" : "Surveyor"}
                            </Text>
                          </View>
                        </View>
                        <Pressable
                          style={[
                            styles.promoteButton,
                            (promotingSurveyorId === s.id || s.role === "supervisor") && styles.promoteButtonDisabled,
                          ]}
                          onPress={() => {
                            console.log("[PROMOTE] Button pressed for:", s.name, "role:", s.role);
                            handlePromoteToSupervisor(s);
                          }}
                          disabled={promotingSurveyorId === s.id || s.role === "supervisor"}
                        >
                          {promotingSurveyorId === s.id ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                          ) : (
                            <>
                              <Ionicons name="arrow-up-circle-outline" size={18} color="#000000" />
                              <Text style={styles.promoteButtonText}>Promote</Text>
                            </>
                          )}
                        </Pressable>
                      </View>
                    ))}
                  {allSurveyors.filter(s => s.role !== "supervisor").length === 0 && (
                    <View style={styles.emptyState}>
                      <Ionicons name="checkmark-circle-outline" size={48} color="#cccccc" />
                      <Text style={styles.emptyStateText}>
                        All surveyors are already supervisors
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Promotion Confirmation Modal */}
      <Modal
        visible={showPromoteModal}
        transparent={true}
        animationType="fade"
        onRequestClose={cancelPromotion}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Promote to Supervisor</Text>
            <Text style={styles.modalMessage}>
              Are you sure you want to promote {surveyorToPromote?.name} to supervisor? They will have access to supervisor features.
            </Text>
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={cancelPromotion}
              >
                <Text style={styles.modalButtonTextCancel}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={confirmPromotion}
              >
                <Text style={styles.modalButtonText}>Promote</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    padding: 24,
    paddingTop: 100, // Account for TopNav
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
  },
  header: {
    alignItems: "center",
    marginBottom: 32,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: "#fbbf24",
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#fbbf24",
  },
  name: {
    fontSize: 24,
    fontWeight: "800",
    color: "#000000",
    marginBottom: 8,
  },
  roleBadge: {
    backgroundColor: "#fbbf24",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  roleText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#000000",
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#000000",
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
  },
  infoContent: {
    flex: 1,
    marginLeft: 12,
  },
  infoLabel: {
    fontSize: 12,
    color: "#666666",
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: "#000000",
    fontWeight: "500",
  },
  emptyState: {
    alignItems: "center",
    padding: 32,
    backgroundColor: "#f9f9f9",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666666",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: "#999999",
    textAlign: "center",
  },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f9f9f9",
    padding: 16,
    borderRadius: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  linkButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000000",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  actionButtonText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#000000",
    marginLeft: 12,
  },
  profileActions: {
    marginTop: 16,
    gap: 8,
  },
  profileActionButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    marginTop: 4,
  },
  profileActionButtonActive: {
    borderColor: "#10b981",
    backgroundColor: "rgba(16, 185, 129, 0.05)",
  },
  profileActionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#000000",
    marginLeft: 12,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: "#666666",
    marginBottom: 16,
  },
  surveyorList: {
    marginTop: 8,
    gap: 8,
  },
  surveyorListItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  surveyorListItemContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  surveyorListItemAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    marginRight: 12,
  },
  surveyorListItemAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  surveyorListItemInfo: {
    flex: 1,
  },
  surveyorListItemName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#000000",
    marginBottom: 2,
  },
  surveyorListItemRole: {
    fontSize: 12,
    color: "#666666",
  },
  promoteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: "#fbbf24",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fbbf24",
    zIndex: 10,
  },
  promoteButtonDisabled: {
    opacity: 0.6,
  },
  promoteButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#000000",
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
