import React, { useState, useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import {
  View,
  Text,
  Image,
  Pressable,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { saveSurveyors, loadSurveyors } from "../lib/storage-hybrid";
import TopNav from "../components/TopNav";
import { Ionicons } from "@expo/vector-icons";
import { format, parseISO, isValid, addDays, eachDayOfInterval, parse, differenceInCalendarDays } from "date-fns";
import { Calendar } from "react-native-calendars";
import * as ImagePicker from "expo-image-picker";
import { uploadSurveyorImage } from "../lib/s3-upload";

const DEFAULT_SURVEYORS = [
  { id: "s1", name: "Surveyor 1", photoUrl: "https://i.pravatar.cc/100?img=1", active: true },
  { id: "s2", name: "Surveyor 2", photoUrl: "https://i.pravatar.cc/100?img=2", active: true },
  { id: "s3", name: "Surveyor 3", photoUrl: "https://i.pravatar.cc/100?img=3", active: true },
  { id: "s4", name: "Surveyor 4", photoUrl: "https://i.pravatar.cc/100?img=4", active: true },
  { id: "s5", name: "Surveyor 5", photoUrl: "https://i.pravatar.cc/100?img=5", active: true },
  { id: "s6", name: "Surveyor 6", photoUrl: "https://i.pravatar.cc/100?img=6", active: true },
  { id: "s7", name: "Surveyor 7", photoUrl: "https://i.pravatar.cc/100?img=7", active: true },
  { id: "s8", name: "Surveyor 8", photoUrl: "https://i.pravatar.cc/100?img=8", active: true },
  { id: "s9", name: "Surveyor 9", photoUrl: "https://i.pravatar.cc/100?img=9", active: true },
];

export default function SurveyorsScreen() {
  const [surveyors, setSurveyors] = useState([]);
  const [editModal, setEditModal] = useState(null); // { surveyor } or null
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhotoUrl, setNewPhotoUrl] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [newShiftPreference, setNewShiftPreference] = useState(null); // "DAY" | "NIGHT" | null
  const [newAreaPreference, setNewAreaPreference] = useState(null); // "SOUTH" | "NORTH" | null
  const [shiftPreferenceModal, setShiftPreferenceModal] = useState(null); // { surveyor } or null
  const [shiftPreference, setShiftPreference] = useState(null); // "DAY" | "NIGHT" | null
  const [areaPreferenceModal, setAreaPreferenceModal] = useState(null); // { surveyor } or null
  const [areaPreference, setAreaPreference] = useState(null); // "SOUTH" | "NORTH" | null
  const [nonAvailabilityModal, setNonAvailabilityModal] = useState(null); // { surveyor } or null
  const [nonAvailability, setNonAvailability] = useState([]); // Array of date strings "yyyy-MM-dd"
  const [nonAvailabilityInput, setNonAvailabilityInput] = useState(""); // Temporary input for adding dates
  const [rangeStart, setRangeStart] = useState(null); // Start date for range selection
  const [leftCalendarMonth, setLeftCalendarMonth] = useState(new Date()); // Current month for left calendar
  const [rightCalendarMonth, setRightCalendarMonth] = useState(addDays(new Date(), 30)); // Current month for right calendar
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name } | null

  const [toast, setToast] = useState({
    visible: false,
    type: "success", // "success" | "error" | "info"
    title: "",
    message: "",
    duration: 2200,
  });

  const showToast = (type, title, message, duration = 2200) => {
    // reset first so repeating same toast still shows
    setToast({ visible: false, type, title, message, duration });
    setTimeout(() => {
      setToast({ visible: true, type, title, message, duration });
    }, 20);
  };

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const saved = await loadSurveyors();
      if (saved && saved.length > 0) {
        setSurveyors(saved);
      } else {
        // Only use default surveyors if database is empty and not configured
        // If database is configured, it should return empty array, not null
        setSurveyors([]);
      }
    } catch (error) {
      console.error("Error loading surveyors:", error);
      setSurveyors([]);
    }
  }

  async function handlePickImage() {
    try {
      // Request permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "We need camera roll permissions to upload images.");
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const imageUri = result.assets[0].uri;
        setNewPhotoUrl(imageUri); // Set local URI temporarily - will upload when saving
        showToast("success", "Image Selected", "Image will be uploaded when you save");
      }
    } catch (error) {
      console.error("Error picking image:", error);
      showToast("error", "Error", "Failed to pick image");
    }
  }

  async function handleSave() {
    // Validate before saving
    const nameValidationError = validateName(newName);
    const emailValidationError = validateEmail(newEmail);

    if (nameValidationError) {
      setNameError(nameValidationError);
      showToast("error", "Validation error", nameValidationError);
      return;
    }

    if (emailValidationError) {
      setEmailError(emailValidationError);
      showToast("error", "Validation error", emailValidationError);
      return;
    }

    const trimmedName = newName.trim();
    const trimmedEmail = newEmail.trim();
    let finalPhotoUrl = newPhotoUrl.trim();

    // If photoUrl is a local file URI (starts with file:// or content://), upload it to S3
    if (finalPhotoUrl && (finalPhotoUrl.startsWith("file://") || finalPhotoUrl.startsWith("content://") || finalPhotoUrl.startsWith("ph://"))) {
      setUploadingImage(true);
      try {
        showToast("info", "Uploading", "Uploading image to S3...");
        const uploadResult = await uploadSurveyorImage(finalPhotoUrl, trimmedName);
        
        if (uploadResult.success && uploadResult.url) {
          finalPhotoUrl = uploadResult.url;
          console.log(`[SURVEYOR] Image uploaded successfully: ${finalPhotoUrl}`);
        } else {
          showToast("error", "Upload Failed", uploadResult.error || "Failed to upload image");
          setUploadingImage(false);
          return; // Don't save if upload fails
        }
      } catch (error) {
        console.error("Error uploading image:", error);
        showToast("error", "Upload Error", error.message || "Failed to upload image");
        setUploadingImage(false);
        return;
      } finally {
        setUploadingImage(false);
      }
    }

    const updated = [...surveyors];

    if (editModal.id) {
      const idx = updated.findIndex((s) => s.id === editModal.id);
      if (idx >= 0) {
        // If updating and old photo was from S3, optionally delete it
        const oldPhotoUrl = updated[idx].photoUrl;
        const isOldPhotoFromS3 = oldPhotoUrl && (
          oldPhotoUrl.includes("supabase.co/storage") || 
          oldPhotoUrl.includes("surveyorimages")
        );
        
        // Only delete old photo if it's from S3 and we're uploading a new one
        if (isOldPhotoFromS3 && finalPhotoUrl && finalPhotoUrl !== oldPhotoUrl) {
          // Optionally delete old image (commented out to prevent accidental deletion)
          // await deleteSurveyorImage(oldPhotoUrl);
        }
        
        updated[idx] = {
          ...updated[idx],
          name: trimmedName,
          email: trimmedEmail || updated[idx].email,
          photoUrl: finalPhotoUrl || updated[idx].photoUrl,
        };
      }

      setSurveyors(updated);
      await saveSurveyors(updated);

      showToast("success", "Saved", `Updated ${trimmedName}`);
    } else {
      const newId = `s${Date.now()}`;
      updated.push({
        id: newId,
        name: trimmedName,
        email: trimmedEmail || null,
        photoUrl: finalPhotoUrl || `https://i.pravatar.cc/100?img=${updated.length + 1}`,
        active: true,
        shiftPreference: newShiftPreference || null,
        areaPreference: newAreaPreference || null,
        nonAvailability: [],
      });

      setSurveyors(updated);
      await saveSurveyors(updated);

      showToast("success", "Added", `Created ${trimmedName}`);
    }

    setEditModal(null);
    setNewName("");
    setNewEmail("");
    setNewPhotoUrl("");
    setNewShiftPreference(null);
    setNewAreaPreference(null);
    setNameError("");
    setEmailError("");
  }


  async function handleSaveShiftPreference() {
    if (!shiftPreferenceModal) return;

    const updated = surveyors.map((s) =>
      s.id === shiftPreferenceModal.id ? { ...s, shiftPreference } : s
    );

    setSurveyors(updated);
    await saveSurveyors(updated);

    showToast(
      "success",
      "Shift saved",
      `${shiftPreferenceModal.name}: ${shiftPreference || "No preference"}`
    );

    setShiftPreferenceModal(null);
    setShiftPreference(null);
  }

  async function handleSaveNonAvailability() {
    if (!nonAvailabilityModal) return;

    const updated = surveyors.map((s) =>
      s.id === nonAvailabilityModal.id ? { ...s, nonAvailability } : s
    );

    setSurveyors(updated);
    await saveSurveyors(updated);

    showToast(
      "success",
      "Availability saved",
      `${nonAvailabilityModal.name}: ${nonAvailability.length} day(s) selected`
    );

    setNonAvailabilityModal(null);
    setNonAvailability([]);
    setNonAvailabilityInput("");
    setRangeStart(null);
  }


  async function handleToggleActive(surveyor) {
    const willBeActive = !surveyor.active;

    const updated = surveyors.map((s) =>
      s.id === surveyor.id ? { ...s, active: willBeActive } : s
    );

    setSurveyors(updated);
    await saveSurveyors(updated);

    showToast(
      "info",
      "Status updated",
      `${surveyor.name} is now ${willBeActive ? "Active" : "Inactive"}`
    );
  }


function handleDelete(surveyor) {
  // open confirm modal instead of Alert.alert
  setConfirmDelete({ id: surveyor.id, name: surveyor.name });
}

async function confirmDeleteNow() {
  if (!confirmDelete) return;

  const { id, name } = confirmDelete;

  const updated = surveyors.filter((s) => s.id !== id);
            setSurveyors(updated);
            await saveSurveyors(updated);

  setConfirmDelete(null);
  showToast("success", "Deleted", `${name} removed`);
}


  // Validation functions
  const validateName = (name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return "Name is required";
    }
    if (trimmed.length < 2) {
      return "Name must be at least 2 characters";
    }
    if (trimmed.length > 100) {
      return "Name must be less than 100 characters";
    }
    // Check for duplicate (excluding current surveyor being edited)
    const duplicate = surveyors.find(
      (s) => s.name.toLowerCase() === trimmed.toLowerCase() && s.id !== editModal?.id
    );
    if (duplicate) {
      return `A surveyor named "${trimmed}" already exists`;
    }
    return "";
  };

  const validateEmail = (email) => {
    const trimmed = email.trim();
    if (!trimmed) {
      return ""; // Email is optional
    }
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      return "Please enter a valid email address";
  }
    // Check for duplicate (excluding current surveyor being edited)
    const duplicate = surveyors.find(
      (s) => s.email && s.email.toLowerCase() === trimmed.toLowerCase() && s.id !== editModal?.id
    );
    if (duplicate) {
      return `A surveyor with email "${trimmed}" already exists`;
    }
    return "";
  };

  function openEdit(surveyor = null) {
    // Clear errors when opening modal
    setNameError("");
    setEmailError("");
    
    if (surveyor) {
      setNewName(surveyor.name);
      setNewEmail(surveyor.email || "");
      setNewPhotoUrl(surveyor.photoUrl || "");
      setNewShiftPreference(null); // Edit modal doesn't change shift preference
      setEditModal(surveyor);
    } else {
      setNewName("");
      setNewEmail("");
      setNewPhotoUrl("");
      setNewShiftPreference(null);
      setNewAreaPreference(null);
      setEditModal({ id: null });
    }
  }

  function openShiftPreference(surveyor) {
    setShiftPreference(surveyor.shiftPreference || null);
    setShiftPreferenceModal(surveyor);
  }

  function openAreaPreference(surveyor) {
    setAreaPreference(surveyor.areaPreference || null);
    setAreaPreferenceModal(surveyor);
  }

  async function handleSaveAreaPreference() {
    if (!areaPreferenceModal) return;

    const updated = surveyors.map((s) =>
      s.id === areaPreferenceModal.id ? { ...s, areaPreference } : s
    );

    setSurveyors(updated);
    await saveSurveyors(updated);

    showToast(
      "success",
      "Area saved",
      `${areaPreferenceModal.name}: ${areaPreference || "No preference"}`
    );

    setAreaPreferenceModal(null);
    setAreaPreference(null);
  }


  function openNonAvailability(surveyor) {
    const now = new Date();
    setNonAvailability(surveyor.nonAvailability || []);
    setNonAvailabilityInput("");
    setRangeStart(null);
    setLeftCalendarMonth(now);
    setRightCalendarMonth(addDays(now, 30));
    setNonAvailabilityModal(surveyor);
  }
  
  // Check if left calendar can go to previous month (must be >= current month)
  const canGoLeftPrevious = () => {
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);
    const leftMonth = new Date(leftCalendarMonth);
    leftMonth.setDate(1);
    leftMonth.setHours(0, 0, 0, 0);
    return leftMonth.getTime() > currentMonth.getTime();
  };
  
  // Check if left calendar can go to next month (must not equal right calendar month)
  const canGoLeftNext = () => {
    const leftMonth = new Date(leftCalendarMonth);
    leftMonth.setDate(1);
    leftMonth.setHours(0, 0, 0, 0);
    const rightMonth = new Date(rightCalendarMonth);
    rightMonth.setDate(1);
    rightMonth.setHours(0, 0, 0, 0);
    const nextLeftMonth = new Date(leftMonth);
    nextLeftMonth.setMonth(nextLeftMonth.getMonth() + 1);
    return nextLeftMonth.getTime() < rightMonth.getTime();
  };
  
  // Check if right calendar can go to previous month (must not equal left calendar month)
  const canGoRightPrevious = () => {
    const leftMonth = new Date(leftCalendarMonth);
    leftMonth.setDate(1);
    leftMonth.setHours(0, 0, 0, 0);
    const rightMonth = new Date(rightCalendarMonth);
    rightMonth.setDate(1);
    rightMonth.setHours(0, 0, 0, 0);
    const prevRightMonth = new Date(rightMonth);
    prevRightMonth.setMonth(prevRightMonth.getMonth() - 1);
    return prevRightMonth.getTime() > leftMonth.getTime();
  };
  
  // Check if right calendar can go to next month (no restriction, but we can add one if needed)
  const canGoRightNext = () => {
    return true; // Right calendar can always go forward
  };

  function addNonAvailabilityDate() {
    if (!nonAvailabilityInput.trim()) return;
    
    // Try to parse the date
    const dateStr = nonAvailabilityInput.trim();
    let dateKey = dateStr;
    
    // If it's not already in yyyy-MM-dd format, try to parse it
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const parsed = new Date(dateStr);
      if (isValid(parsed)) {
        dateKey = format(parsed, "yyyy-MM-dd");
      } else {
        Alert.alert("Error", "Invalid date format. Please use YYYY-MM-DD or a valid date string.");
        return;
      }
    }
    
    if (!nonAvailability.includes(dateKey)) {
      setNonAvailability([...nonAvailability, dateKey].sort());
      setNonAvailabilityInput("");
    } else {
      Alert.alert("Info", "This date is already in the non-availability list.");
    }
  }

  function removeNonAvailabilityDate(dateKey) {
    setNonAvailability(nonAvailability.filter(d => d !== dateKey));
  }

  const activeSurveyors = surveyors.filter((s) => s.active);
  const inactiveSurveyors = surveyors.filter((s) => !s.active);

  return (
    <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
      <TopNav />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ flex: 1, padding: 16, gap: 16, paddingTop: 70 }}>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", marginBottom: 8, marginTop: 12 }}>
            <Pressable
              onPress={() => openEdit(null)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 20,
                borderWidth: 1,
                borderRadius: 8,
                borderColor: "#e5e5e5",
                backgroundColor: "#fbbf24",
              }}
            >
              <Text style={{ fontWeight: "700", color: "#000000", fontSize: 14 }}>+ Add Surveyor</Text>
            </Pressable>
          </View>

          {/* Color Legend */}
          <View style={{
            padding: 12,
            backgroundColor: "#f9fafb",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#e5e5e5",
            marginBottom: 8,
            alignSelf: "flex-end",
          }}>
            <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              {/* Shift Preference Section */}
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: "#666666" }}>Shift</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      borderWidth: 2,
                      borderColor: "#fbbf24",
                      backgroundColor: "rgba(251, 191, 36, 0.1)",
                    }} />
                    <Text style={{ fontSize: 11, color: "#000000" }}>Day</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      borderWidth: 2,
                      borderColor: "#1E3A5F",
                      backgroundColor: "rgba(30, 58, 95, 0.1)",
                    }} />
                    <Text style={{ fontSize: 11, color: "#000000" }}>Night</Text>
                  </View>
                </View>
              </View>

              {/* Area Preference Section */}
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: "#666666" }}>Area</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      borderWidth: 2,
                      borderColor: "#10b981",
                      backgroundColor: "rgba(16, 185, 129, 0.1)",
                    }} />
                    <Text style={{ fontSize: 11, color: "#000000" }}>STSP</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      borderWidth: 2,
                      borderColor: "#8b5cf6",
                      backgroundColor: "rgba(139, 92, 246, 0.1)",
                    }} />
                    <Text style={{ fontSize: 11, color: "#000000" }}>NTNP</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* Active Surveyors */}
          {activeSurveyors.length > 0 && (
            <View style={{ gap: 12, marginBottom: 20 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#000000" }}>Active Surveyors</Text>
              <View style={{ gap: 12 }}>
                {activeSurveyors.map((s) => (
                  <SurveyorCard
                    key={s.id}
                    surveyor={s}
                    onEdit={() => openEdit(s)}
                    onShiftPreference={() => openShiftPreference(s)}
                    onAreaPreference={() => openAreaPreference(s)}
                    onNonAvailability={() => openNonAvailability(s)}
                    onToggleActive={() => handleToggleActive(s)}
                    onDelete={() => handleDelete(s)}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Inactive Surveyors */}
          {inactiveSurveyors.length > 0 && (
            <View style={{ gap: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#000000" }}>Inactive Surveyors</Text>
              <View style={{ gap: 12 }}>
                {inactiveSurveyors.map((s) => (
                  <SurveyorCard
                    key={s.id}
                    surveyor={s}
                    onEdit={() => openEdit(s)}
                    onShiftPreference={() => openShiftPreference(s)}
                    onAreaPreference={() => openAreaPreference(s)}
                    onNonAvailability={() => openNonAvailability(s)}
                    onToggleActive={() => handleToggleActive(s)}
                    onDelete={() => handleDelete(s)}
                  />
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Edit/Add Modal */}
      <Modal
        visible={!!editModal}
        animationType="slide"
        onRequestClose={() => setEditModal(null)}
        transparent
      >
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "rgba(0,0,0,0.25)",
          }}
        >
          <ScrollView
            style={{
              maxHeight: "80%",
            }}
            showsVerticalScrollIndicator={true}
          >
          <View
            style={{
              padding: 20,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              borderWidth: 1,
              gap: 16,
              backgroundColor: "#ffffff",
              borderColor: "#e5e5e5",
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 18, color: "#000000" }}>
              {editModal?.id ? "Edit Surveyor" : "Add Surveyor"}
            </Text>

            <View style={{ gap: 10 }}>
              <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>Name *</Text>
              <TextInput
                value={newName}
                onChangeText={(text) => {
                  setNewName(text);
                  // Validate on change
                  const error = validateName(text);
                  setNameError(error);
                }}
                onBlur={() => {
                  // Re-validate on blur
                  const error = validateName(newName);
                  setNameError(error);
                }}
                placeholder="Enter name"
                placeholderTextColor="#999999"
                style={{ 
                  borderWidth: 1, 
                  borderRadius: 10, 
                  padding: 12,
                  borderColor: nameError ? "#dc2626" : "#e5e5e5",
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  fontSize: 14,
                }}
              />
              {nameError ? (
                <Text style={{ color: "#dc2626", fontSize: 12, marginTop: -4 }}>
                  {nameError}
                </Text>
              ) : null}
            </View>

            <View style={{ gap: 10 }}>
              <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>Email (optional)</Text>
              <TextInput
                value={newEmail}
                onChangeText={(text) => {
                  setNewEmail(text);
                  // Validate on change
                  const error = validateEmail(text);
                  setEmailError(error);
                }}
                onBlur={() => {
                  // Re-validate on blur
                  const error = validateEmail(newEmail);
                  setEmailError(error);
                }}
                placeholder="Enter email"
                placeholderTextColor="#999999"
                keyboardType="email-address"
                autoCapitalize="none"
                style={{ 
                  borderWidth: 1, 
                  borderRadius: 10, 
                  padding: 12,
                  borderColor: emailError ? "#dc2626" : "#e5e5e5",
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  fontSize: 14,
                }}
              />
              {emailError ? (
                <Text style={{ color: "#dc2626", fontSize: 12, marginTop: -4 }}>
                  {emailError}
                </Text>
              ) : null}
            </View>

            <View style={{ gap: 10 }}>
              <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>Photo (optional)</Text>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Pressable
                  onPress={handlePickImage}
                  disabled={uploadingImage}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: "#e5e5e5",
                    backgroundColor: uploadingImage ? "#f5f5f5" : "#ffffff",
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <Ionicons 
                    name={uploadingImage ? "hourglass-outline" : "image-outline"} 
                    size={20} 
                    color={uploadingImage ? "#999999" : "#000000"} 
                  />
                  <Text style={{ 
                    color: uploadingImage ? "#999999" : "#000000", 
                    fontSize: 14,
                    fontWeight: "600"
                  }}>
                    {uploadingImage ? "Uploading..." : "Pick Image"}
                  </Text>
                </Pressable>
                {newPhotoUrl && (
                  <Image
                    source={{ uri: newPhotoUrl }}
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 25,
                      borderWidth: 2,
                      borderColor: "#e5e5e5",
                    }}
                  />
                )}
              </View>
              <TextInput
                value={newPhotoUrl}
                onChangeText={setNewPhotoUrl}
                placeholder="Or enter image URL manually..."
                placeholderTextColor="#999999"
                style={{
                  borderWidth: 1,
                  borderRadius: 10,
                  padding: 12,
                  borderColor: "#e5e5e5",
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  fontSize: 14,
                  marginTop: 8,
                }}
              />
            </View>

            {newPhotoUrl && (
              <View style={{ alignItems: "center", padding: 8 }}>
                <Image
                  source={{ uri: newPhotoUrl }}
                  style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: "#e5e5e5" }}
                />
              </View>
            )}

            {/* Shift Preference - Only show when adding new surveyor */}
            {!editModal?.id && (
              <View style={{ gap: 10 }}>
                <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>Shift Preference (optional)</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => setNewShiftPreference(newShiftPreference === "DAY" ? null : "DAY")}
                    style={{
                      flex: 1,
                      padding: 12,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: newShiftPreference === "DAY" ? "#fbbf24" : "#e5e5e5",
                      backgroundColor: newShiftPreference === "DAY" ? "rgba(251, 191, 36, 0.1)" : "#ffffff",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>Day</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setNewShiftPreference(newShiftPreference === "NIGHT" ? null : "NIGHT")}
                    style={{
                      flex: 1,
                      padding: 12,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: newShiftPreference === "NIGHT" ? "#1E3A5F" : "#e5e5e5",
                      backgroundColor: newShiftPreference === "NIGHT" ? "rgba(30, 58, 95, 0.1)" : "#ffffff",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>Night</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* Area Preference - Only show when adding new surveyor */}
            {!editModal?.id && (
              <View style={{ gap: 10 }}>
                <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>Area Preference (optional)</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => setNewAreaPreference(newAreaPreference === "SOUTH" ? null : "SOUTH")}
                    style={{
                      flex: 1,
                      padding: 12,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: newAreaPreference === "SOUTH" ? "#10b981" : "#e5e5e5",
                      backgroundColor: newAreaPreference === "SOUTH" ? "rgba(16, 185, 129, 0.1)" : "#ffffff",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>STSP</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setNewAreaPreference(newAreaPreference === "NORTH" ? null : "NORTH")}
                    style={{
                      flex: 1,
                      padding: 12,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: newAreaPreference === "NORTH" ? "#8b5cf6" : "#e5e5e5",
                      backgroundColor: newAreaPreference === "NORTH" ? "rgba(139, 92, 246, 0.1)" : "#ffffff",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>NTNP</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => setEditModal(null)}
                style={{
                  padding: 12,
                  borderWidth: 1,
                  borderRadius: 12,
                  flex: 1,
                  alignItems: "center",
                  borderColor: "#e5e5e5",
                  backgroundColor: "#ffffff",
                }}
              >
                <Text style={{ fontWeight: "700", color: "#000000" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                style={{
                  padding: 12,
                  borderWidth: 1,
                  borderRadius: 12,
                  flex: 1,
                  alignItems: "center",
                  backgroundColor: "#000000",
                  borderColor: "#000000",
                }}
              >
                <Text style={{ fontWeight: "800", color: "#ffffff" }}>Save</Text>
              </Pressable>
            </View>
          </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Shift Preference Modal */}
      <Modal
        visible={!!shiftPreferenceModal}
        animationType="slide"
        onRequestClose={() => setShiftPreferenceModal(null)}
        transparent
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(0,0,0,0.5)",
          }}
        >
          <View
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 18,
              padding: 24,
              width: "90%",
              maxWidth: 400,
              borderWidth: 1,
              borderColor: "#e5e5e5",
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 18, color: "#000000", marginBottom: 20 }}>
              Shift Preference - {shiftPreferenceModal?.name}
            </Text>

            <View style={{ gap: 10, marginBottom: 20 }}>
              <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>Select Preference</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => setShiftPreference(shiftPreference === "DAY" ? null : "DAY")}
                  style={{
                    flex: 1,
                    padding: 16,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: shiftPreference === "DAY" ? "#fbbf24" : "#e5e5e5",
                    backgroundColor: shiftPreference === "DAY" ? "rgba(251, 191, 36, 0.1)" : "#ffffff",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "700", color: "#000000", fontSize: 16 }}>Day</Text>
                </Pressable>
                <Pressable
                  onPress={() => setShiftPreference(shiftPreference === "NIGHT" ? null : "NIGHT")}
                  style={{
                    flex: 1,
                    padding: 16,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: shiftPreference === "NIGHT" ? "#1E3A5F" : "#e5e5e5",
                    backgroundColor: shiftPreference === "NIGHT" ? "rgba(30, 58, 95, 0.1)" : "#ffffff",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "700", color: "#000000", fontSize: 16 }}>Night</Text>
                </Pressable>
              </View>
              {shiftPreference && (
                <Text style={{ fontSize: 12, color: "#666666", marginTop: 4 }}>
                  Current: {shiftPreference === "DAY" ? "Day Shift" : "Night Shift"}
                </Text>
              )}
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => {
                  setShiftPreferenceModal(null);
                  setShiftPreference(null);
                }}
                style={{
                  padding: 12,
                  borderWidth: 1,
                  borderRadius: 12,
                  flex: 1,
                  alignItems: "center",
                  borderColor: "#e5e5e5",
                  backgroundColor: "#ffffff",
                }}
              >
                <Text style={{ fontWeight: "700", color: "#000000" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveShiftPreference}
                style={{
                  padding: 12,
                  borderWidth: 1,
                  borderRadius: 12,
                  flex: 1,
                  alignItems: "center",
                  backgroundColor: "#000000",
                  borderColor: "#000000",
                }}
              >
                <Text style={{ fontWeight: "800", color: "#ffffff" }}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Area Preference Modal */}
      <Modal
        visible={!!areaPreferenceModal}
        animationType="slide"
        onRequestClose={() => setAreaPreferenceModal(null)}
        transparent
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(0,0,0,0.5)",
          }}
        >
          <View
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 18,
              padding: 24,
              width: "90%",
              maxWidth: 400,
              borderWidth: 1,
              borderColor: "#e5e5e5",
            }}
          >
            <Text style={{ fontWeight: "800", fontSize: 18, color: "#000000", marginBottom: 20 }}>
              Area Preference - {areaPreferenceModal?.name}
            </Text>

            <View style={{ gap: 10, marginBottom: 20 }}>
              <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>Select Preference</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => setAreaPreference(areaPreference === "SOUTH" ? null : "SOUTH")}
                  style={{
                    flex: 1,
                    padding: 16,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: areaPreference === "SOUTH" ? "#10b981" : "#e5e5e5",
                    backgroundColor: areaPreference === "SOUTH" ? "rgba(16, 185, 129, 0.1)" : "#ffffff",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "700", color: "#000000", fontSize: 16 }}>STSP</Text>
                </Pressable>
                <Pressable
                  onPress={() => setAreaPreference(areaPreference === "NORTH" ? null : "NORTH")}
                  style={{
                    flex: 1,
                    padding: 16,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: areaPreference === "NORTH" ? "#8b5cf6" : "#e5e5e5",
                    backgroundColor: areaPreference === "NORTH" ? "rgba(139, 92, 246, 0.1)" : "#ffffff",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "700", color: "#000000", fontSize: 16 }}>NTNP</Text>
                </Pressable>
              </View>
              {areaPreference && (
                <Text style={{ fontSize: 12, color: "#666666", marginTop: 4 }}>
                  Current: {areaPreference === "SOUTH" ? "STSP" : "NTNP"}
                </Text>
              )}
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => {
                  setAreaPreferenceModal(null);
                  setAreaPreference(null);
                }}
                style={{
                  padding: 12,
                  borderWidth: 1,
                  borderRadius: 12,
                  flex: 1,
                  alignItems: "center",
                  borderColor: "#e5e5e5",
                  backgroundColor: "#ffffff",
                }}
              >
                <Text style={{ fontWeight: "700", color: "#000000" }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveAreaPreference}
                style={{
                  padding: 12,
                  borderWidth: 1,
                  borderRadius: 12,
                  flex: 1,
                  alignItems: "center",
                  backgroundColor: "#000000",
                  borderColor: "#000000",
                }}
              >
                <Text style={{ fontWeight: "800", color: "#ffffff" }}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Non-Availability Modal */}
      <Modal
        visible={!!nonAvailabilityModal}
        animationType="slide"
        onRequestClose={() => setNonAvailabilityModal(null)}
        transparent
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(0,0,0,0.5)",
          }}
        >
          <View
            style={{
              backgroundColor: "#ffffff",
              borderRadius: 18,
              padding: 24,
              width: "95%",
              maxWidth: 1000,
              maxHeight: "90%",
              borderWidth: 1,
              borderColor: "#e5e5e5",
            }}
          >
            <ScrollView showsVerticalScrollIndicator={true}>
              <Text style={{ fontWeight: "800", fontSize: 18, color: "#000000", marginBottom: 20 }}>
                Non-Availability - {nonAvailabilityModal?.name}
              </Text>

              {/* Calendar Picker */}
              <View style={{ marginBottom: 20 }}>
                <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14, marginBottom: 10 }}>
                  Select Dates (Tap to toggle, or tap two dates for range)
                </Text>
                {rangeStart && (
                  <Text style={{ fontSize: 12, color: "#666666", marginBottom: 8 }}>
                    Range start: {format(parse(rangeStart, "yyyy-MM-dd", new Date()), "d MMM yyyy")} - Tap another date to select range
                  </Text>
                )}
                <View style={{ flexDirection: "row", gap: 16, justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
                <View style={{ flex: 1, minWidth: 300, maxWidth: "48%" }}>
                <Calendar
                  onDayPress={(day) => {
                    const dateKey = day.dateString; // Format: "YYYY-MM-DD"
                    
                    // If a range was already completed and user clicks any date, reset
                    if (!rangeStart && nonAvailability.length > 0) {
                      // Reset all selections
                      setNonAvailability([]);
                      setRangeStart(dateKey);
                      setNonAvailability([dateKey]);
                      return;
                    }
                    
                    // If clicking on an already selected date, remove it
                    if (nonAvailability.includes(dateKey)) {
                      removeNonAvailabilityDate(dateKey);
                      setRangeStart(null);
                      return;
                    }
                    
                    // Range selection logic
                    if (!rangeStart) {
                      // First click - set as range start
                      setRangeStart(dateKey);
                      // Also add this single date
                      setNonAvailability([...nonAvailability, dateKey].sort());
                    } else {
                      // Second click - add all dates in range
                      const start = parse(rangeStart, "yyyy-MM-dd", new Date());
                      const end = parse(dateKey, "yyyy-MM-dd", new Date());
                      
                      // Swap if end is before start
                      const actualStart = start <= end ? start : end;
                      const actualEnd = start <= end ? end : start;
                      
                      // Generate all dates in range
                      const rangeDates = eachDayOfInterval({ start: actualStart, end: actualEnd });
                      const rangeDateKeys = rangeDates.map(d => format(d, "yyyy-MM-dd"));
                      
                      // Add all dates in range (avoid duplicates)
                      const updated = [...new Set([...nonAvailability, ...rangeDateKeys])].sort();
                      setNonAvailability(updated);
                      setRangeStart(null);
                    }
                  }}
                  markedDates={(() => {
                    // Convert sorted dates to find consecutive ranges
                    const sortedDates = [...nonAvailability].sort();
                    const marked = {};
                    
                    // Group consecutive dates into ranges
                    let rangeStartDate = null;
                    let rangeEndDate = null;
                    
                    sortedDates.forEach((dateKey, index) => {
                      const currentDate = parse(dateKey, "yyyy-MM-dd", new Date());
                      const prevDate = index > 0 ? parse(sortedDates[index - 1], "yyyy-MM-dd", new Date()) : null;
                      
                      if (!prevDate || differenceInCalendarDays(currentDate, prevDate) === 1) {
                        // Consecutive date
                        if (!rangeStartDate) {
                          rangeStartDate = dateKey;
                        }
                        rangeEndDate = dateKey;
                      } else {
                        // Break in sequence - mark previous range
                        if (rangeStartDate && rangeEndDate) {
                          if (rangeStartDate === rangeEndDate) {
                            // Single date
                            marked[rangeStartDate] = {
                              selected: true,
                              selectedColor: "#fbbf24",
                              selectedTextColor: "#000000",
                            };
                          } else {
                            // Range
                            const start = parse(rangeStartDate, "yyyy-MM-dd", new Date());
                            const end = parse(rangeEndDate, "yyyy-MM-dd", new Date());
                            const rangeDates = eachDayOfInterval({ start, end });
                            rangeDates.forEach((d, idx) => {
                              const dKey = format(d, "yyyy-MM-dd");
                              marked[dKey] = {
                                startingDay: idx === 0,
                                endingDay: idx === rangeDates.length - 1,
                                color: "#fbbf24",
                                textColor: "#000000",
                              };
                            });
                          }
                        }
                        rangeStartDate = dateKey;
                        rangeEndDate = dateKey;
                      }
                    });
                    
                    // Mark the last range
                    if (rangeStartDate && rangeEndDate) {
                      if (rangeStartDate === rangeEndDate) {
                        marked[rangeStartDate] = {
                          selected: true,
                          selectedColor: "#fbbf24",
                          selectedTextColor: "#000000",
                        };
                      } else {
                        const start = parse(rangeStartDate, "yyyy-MM-dd", new Date());
                        const end = parse(rangeEndDate, "yyyy-MM-dd", new Date());
                        const rangeDates = eachDayOfInterval({ start, end });
                        rangeDates.forEach((d, idx) => {
                          const dKey = format(d, "yyyy-MM-dd");
                          marked[dKey] = {
                            startingDay: idx === 0,
                            endingDay: idx === rangeDates.length - 1,
                            color: "#fbbf24",
                            textColor: "#000000",
                          };
                        });
                      }
                    }
                    
                    // Highlight range start if in progress - make it more visible
                    if (rangeStart) {
                      if (marked[rangeStart]) {
                        // If already marked, enhance it with special highlighting
                        marked[rangeStart] = {
                          ...marked[rangeStart],
                          startingDay: true,
                          color: "#fbbf24",
                          textColor: "#000000",
                          customStyles: {
                            container: {
                              backgroundColor: "#fbbf24",
                              borderRadius: 16,
                              borderWidth: 3,
                              borderColor: "#000000",
                              elevation: 4,
                              shadowColor: "#000000",
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.3,
                              shadowRadius: 4,
                            },
                            text: {
                              color: "#000000",
                              fontWeight: "bold",
                              fontSize: 16,
                            },
                          },
                        };
                      } else {
                        // If not yet in marked dates, add it with special highlighting
                        marked[rangeStart] = {
                          startingDay: true,
                          color: "#fbbf24",
                          textColor: "#000000",
                          customStyles: {
                            container: {
                              backgroundColor: "#fbbf24",
                              borderRadius: 16,
                              borderWidth: 3,
                              borderColor: "#000000",
                              elevation: 4,
                              shadowColor: "#000000",
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.3,
                              shadowRadius: 4,
                            },
                            text: {
                              color: "#000000",
                              fontWeight: "bold",
                              fontSize: 16,
                            },
                          },
                        };
                      }
                    }
                    
                    return marked;
                  })()}
                  markingType="period"
                  theme={{
                    backgroundColor: "#ffffff",
                    calendarBackground: "#ffffff",
                    textSectionTitleColor: "#000000",
                    selectedDayBackgroundColor: "#fbbf24",
                    selectedDayTextColor: "#000000",
                    todayTextColor: "#fbbf24",
                    dayTextColor: "#000000",
                    textDisabledColor: "#cccccc",
                    dotColor: "#fbbf24",
                    selectedDotColor: "#000000",
                    arrowColor: "#fbbf24",
                    monthTextColor: "#000000",
                    indicatorColor: "#fbbf24",
                    textDayFontWeight: "600",
                    textMonthFontWeight: "700",
                    textDayHeaderFontWeight: "600",
                    textDayFontSize: 14,
                    textMonthFontSize: 16,
                    textDayHeaderFontSize: 13,
                  }}
                  style={{
                    borderWidth: 1,
                    borderColor: "#e5e5e5",
                    borderRadius: 10,
                    padding: 8,
                  }}
                  current={format(leftCalendarMonth, "yyyy-MM-dd")}
                  minDate={format(new Date(), "yyyy-MM-dd")}
                  enableSwipeMonths={false}
                  hideExtraDays={false}
                  firstDay={1}
                  onMonthChange={(month) => {
                    const newMonth = parse(month.dateString, "yyyy-MM-dd", new Date());
                    setLeftCalendarMonth(newMonth);
                  }}
                  onPressArrowLeft={(subtractMonth) => {
                    if (canGoLeftPrevious()) {
                      const newMonth = new Date(leftCalendarMonth);
                      newMonth.setMonth(newMonth.getMonth() - 1);
                      setLeftCalendarMonth(newMonth);
                      subtractMonth();
                    }
                  }}
                  onPressArrowRight={(addMonth) => {
                    if (canGoLeftNext()) {
                      const newMonth = new Date(leftCalendarMonth);
                      newMonth.setMonth(newMonth.getMonth() + 1);
                      setLeftCalendarMonth(newMonth);
                      addMonth();
                    }
                  }}
                  renderArrow={(direction) => {
                    const isLeft = direction === "left";
                    const isDisabled = isLeft ? !canGoLeftPrevious() : !canGoLeftNext();
                    return (
                      <View style={{ opacity: isDisabled ? 0.3 : 1 }}>
                        <Ionicons 
                          name={isLeft ? "chevron-back" : "chevron-forward"} 
                          size={20} 
                          color={isDisabled ? "#cccccc" : "#fbbf24"} 
                        />
                      </View>
                    );
                  }}
                />
                </View>
                {/* Second Month Calendar */}
                <View style={{ flex: 1, minWidth: 300, maxWidth: "48%" }}>
                <Calendar
                  onDayPress={(day) => {
                    const dateKey = day.dateString; // Format: "YYYY-MM-DD"
                    
                    // If a range was already completed and user clicks any date, reset
                    if (!rangeStart && nonAvailability.length > 0) {
                      // Reset all selections
                      setNonAvailability([]);
                      setRangeStart(dateKey);
                      setNonAvailability([dateKey]);
                      return;
                    }
                    
                    // If clicking on an already selected date, remove it
                    if (nonAvailability.includes(dateKey)) {
                      removeNonAvailabilityDate(dateKey);
                      setRangeStart(null);
                      return;
                    }
                    
                    // Range selection logic
                    if (!rangeStart) {
                      // First click - set as range start
                      setRangeStart(dateKey);
                      // Also add this single date
                      setNonAvailability([...nonAvailability, dateKey].sort());
                    } else {
                      // Second click - add all dates in range
                      const start = parse(rangeStart, "yyyy-MM-dd", new Date());
                      const end = parse(dateKey, "yyyy-MM-dd", new Date());
                      
                      // Swap if end is before start
                      const actualStart = start <= end ? start : end;
                      const actualEnd = start <= end ? end : start;
                      
                      // Generate all dates in range
                      const rangeDates = eachDayOfInterval({ start: actualStart, end: actualEnd });
                      const rangeDateKeys = rangeDates.map(d => format(d, "yyyy-MM-dd"));
                      
                      // Add all dates in range (avoid duplicates)
                      const updated = [...new Set([...nonAvailability, ...rangeDateKeys])].sort();
                      setNonAvailability(updated);
                      setRangeStart(null);
                    }
                  }}
                  markedDates={(() => {
                    // Convert sorted dates to find consecutive ranges
                    const sortedDates = [...nonAvailability].sort();
                    const marked = {};
                    
                    // Group consecutive dates into ranges
                    let rangeStartDate = null;
                    let rangeEndDate = null;
                    
                    sortedDates.forEach((dateKey, index) => {
                      const currentDate = parse(dateKey, "yyyy-MM-dd", new Date());
                      const prevDate = index > 0 ? parse(sortedDates[index - 1], "yyyy-MM-dd", new Date()) : null;
                      
                      if (!prevDate || differenceInCalendarDays(currentDate, prevDate) === 1) {
                        // Consecutive date
                        if (!rangeStartDate) {
                          rangeStartDate = dateKey;
                        }
                        rangeEndDate = dateKey;
                      } else {
                        // Break in sequence - mark previous range
                        if (rangeStartDate && rangeEndDate) {
                          if (rangeStartDate === rangeEndDate) {
                            // Single date
                            marked[rangeStartDate] = {
                              selected: true,
                              selectedColor: "#fbbf24",
                              selectedTextColor: "#000000",
                            };
                          } else {
                            // Range
                            const start = parse(rangeStartDate, "yyyy-MM-dd", new Date());
                            const end = parse(rangeEndDate, "yyyy-MM-dd", new Date());
                            const rangeDates = eachDayOfInterval({ start, end });
                            rangeDates.forEach((d, idx) => {
                              const dKey = format(d, "yyyy-MM-dd");
                              marked[dKey] = {
                                startingDay: idx === 0,
                                endingDay: idx === rangeDates.length - 1,
                                color: "#fbbf24",
                                textColor: "#000000",
                              };
                            });
                          }
                        }
                        rangeStartDate = dateKey;
                        rangeEndDate = dateKey;
                      }
                    });
                    
                    // Mark the last range
                    if (rangeStartDate && rangeEndDate) {
                      if (rangeStartDate === rangeEndDate) {
                        marked[rangeStartDate] = {
                          selected: true,
                          selectedColor: "#fbbf24",
                          selectedTextColor: "#000000",
                        };
                      } else {
                        const start = parse(rangeStartDate, "yyyy-MM-dd", new Date());
                        const end = parse(rangeEndDate, "yyyy-MM-dd", new Date());
                        const rangeDates = eachDayOfInterval({ start, end });
                        rangeDates.forEach((d, idx) => {
                          const dKey = format(d, "yyyy-MM-dd");
                          marked[dKey] = {
                            startingDay: idx === 0,
                            endingDay: idx === rangeDates.length - 1,
                            color: "#fbbf24",
                            textColor: "#000000",
                          };
                        });
                      }
                    }
                    
                    // Highlight range start if in progress - make it more visible
                    if (rangeStart) {
                      if (marked[rangeStart]) {
                        // If already marked, enhance it with special highlighting
                        marked[rangeStart] = {
                          ...marked[rangeStart],
                          startingDay: true,
                          color: "#fbbf24",
                          textColor: "#000000",
                          customStyles: {
                            container: {
                              backgroundColor: "#fbbf24",
                              borderRadius: 16,
                              borderWidth: 3,
                              borderColor: "#000000",
                              elevation: 4,
                              shadowColor: "#000000",
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.3,
                              shadowRadius: 4,
                            },
                            text: {
                              color: "#000000",
                              fontWeight: "bold",
                              fontSize: 16,
                            },
                          },
                        };
                      } else {
                        // If not yet in marked dates, add it with special highlighting
                        marked[rangeStart] = {
                          startingDay: true,
                          color: "#fbbf24",
                          textColor: "#000000",
                          customStyles: {
                            container: {
                              backgroundColor: "#fbbf24",
                              borderRadius: 16,
                              borderWidth: 3,
                              borderColor: "#000000",
                              elevation: 4,
                              shadowColor: "#000000",
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.3,
                              shadowRadius: 4,
                            },
                            text: {
                              color: "#000000",
                              fontWeight: "bold",
                              fontSize: 16,
                            },
                          },
                        };
                      }
                    }
                    
                    return marked;
                  })()}
                  markingType="period"
                  theme={{
                    backgroundColor: "#ffffff",
                    calendarBackground: "#ffffff",
                    textSectionTitleColor: "#000000",
                    selectedDayBackgroundColor: "#fbbf24",
                    selectedDayTextColor: "#000000",
                    todayTextColor: "#fbbf24",
                    dayTextColor: "#000000",
                    textDisabledColor: "#cccccc",
                    dotColor: "#fbbf24",
                    selectedDotColor: "#000000",
                    arrowColor: "#fbbf24",
                    monthTextColor: "#000000",
                    indicatorColor: "#fbbf24",
                    textDayFontWeight: "600",
                    textMonthFontWeight: "700",
                    textDayHeaderFontWeight: "600",
                    textDayFontSize: 14,
                    textMonthFontSize: 16,
                    textDayHeaderFontSize: 13,
                  }}
                  style={{
                    borderWidth: 1,
                    borderColor: "#e5e5e5",
                    borderRadius: 10,
                    padding: 8,
                    width: "100%",
                  }}
                  current={format(rightCalendarMonth, "yyyy-MM-dd")}
                  minDate={format(new Date(), "yyyy-MM-dd")}
                  enableSwipeMonths={false}
                  hideExtraDays={false}
                  firstDay={1}
                  onMonthChange={(month) => {
                    const newMonth = parse(month.dateString, "yyyy-MM-dd", new Date());
                    setRightCalendarMonth(newMonth);
                  }}
                  onPressArrowLeft={(subtractMonth) => {
                    if (canGoRightPrevious()) {
                      const newMonth = new Date(rightCalendarMonth);
                      newMonth.setMonth(newMonth.getMonth() - 1);
                      setRightCalendarMonth(newMonth);
                      subtractMonth();
                    }
                  }}
                  onPressArrowRight={(addMonth) => {
                    if (canGoRightNext()) {
                      const newMonth = new Date(rightCalendarMonth);
                      newMonth.setMonth(newMonth.getMonth() + 1);
                      setRightCalendarMonth(newMonth);
                      addMonth();
                    }
                  }}
                  renderArrow={(direction) => {
                    const isLeft = direction === "left";
                    const isDisabled = isLeft ? !canGoRightPrevious() : !canGoRightNext();
                    return (
                      <View style={{ opacity: isDisabled ? 0.3 : 1 }}>
                        <Ionicons 
                          name={isLeft ? "chevron-back" : "chevron-forward"} 
                          size={20} 
                          color={isDisabled ? "#cccccc" : "#fbbf24"} 
                        />
                      </View>
                    );
                  }}
                />
                </View>
                </View>
              </View>

              <View style={{ gap: 10, marginBottom: 20 }}>
                <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14 }}>Or Add Date Manually</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput
                    value={nonAvailabilityInput}
                    onChangeText={setNonAvailabilityInput}
                    placeholder="YYYY-MM-DD or date"
                    placeholderTextColor="#999999"
                    style={{ 
                      flex: 1,
                      borderWidth: 1, 
                      borderRadius: 10, 
                      padding: 12,
                      borderColor: "#e5e5e5",
                      backgroundColor: "#ffffff",
                      color: "#000000",
                      fontSize: 14,
                    }}
                  />
                  <Pressable
                    onPress={addNonAvailabilityDate}
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      borderRadius: 10,
                      backgroundColor: "#fbbf24",
                      borderWidth: 1,
                      borderColor: "#e5e5e5",
                    }}
                  >
                    <Text style={{ fontWeight: "700", color: "#000000", fontSize: 14 }}>Add</Text>
                  </Pressable>
                </View>
              </View>

              {nonAvailability.length > 0 && (
                <View style={{ marginBottom: 20, padding: 12, backgroundColor: "rgba(251, 191, 36, 0.1)", borderRadius: 10, borderWidth: 1, borderColor: "#fbbf24" }}>
                  <Text style={{ fontWeight: "600", color: "#000000", fontSize: 14, marginBottom: 8 }}>
                    Selected Range{nonAvailability.length > 1 ? "s" : ""}:
                  </Text>
                  {(() => {
                    // Group dates into ranges for display
                    const sortedDates = [...nonAvailability].sort();
                    const ranges = [];
                    let rangeStart = null;
                    let rangeEnd = null;
                    
                    sortedDates.forEach((dateKey, index) => {
                      const currentDate = parse(dateKey, "yyyy-MM-dd", new Date());
                      const prevDate = index > 0 ? parse(sortedDates[index - 1], "yyyy-MM-dd", new Date()) : null;
                      
                      if (!prevDate || differenceInCalendarDays(currentDate, prevDate) === 1) {
                        if (!rangeStart) rangeStart = dateKey;
                        rangeEnd = dateKey;
                      } else {
                        if (rangeStart && rangeEnd) {
                          ranges.push({ start: rangeStart, end: rangeEnd });
                        }
                        rangeStart = dateKey;
                        rangeEnd = dateKey;
                      }
                    });
                    
                    if (rangeStart && rangeEnd) {
                      ranges.push({ start: rangeStart, end: rangeEnd });
                    }
                    
                    return ranges.map((range, idx) => {
                      const startDate = parse(range.start, "yyyy-MM-dd", new Date());
                      const endDate = parse(range.end, "yyyy-MM-dd", new Date());
                      const isSingleDate = range.start === range.end;
                      
                      return (
                        <View key={idx} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: idx < ranges.length - 1 ? 8 : 0 }}>
                          <Text style={{ color: "#000000", fontSize: 14, fontWeight: "600" }}>
                            {isSingleDate 
                              ? format(startDate, "d MMM yyyy")
                              : `${format(startDate, "d MMM yyyy")} - ${format(endDate, "d MMM yyyy")}`
                            }
                          </Text>
                          <Pressable
                            onPress={() => {
                              // Remove all dates in this range
                              const rangeDates = eachDayOfInterval({ start: startDate, end: endDate });
                              const rangeDateKeys = rangeDates.map(d => format(d, "yyyy-MM-dd"));
                              setNonAvailability(nonAvailability.filter(d => !rangeDateKeys.includes(d)));
                            }}
                            style={{ padding: 4 }}
                          >
                            <Ionicons name="close-circle" size={20} color="#cc0000" />
                          </Pressable>
                        </View>
                      );
                    });
                  })()}
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable
                  onPress={() => {
                    setNonAvailabilityModal(null);
                    setNonAvailability([]);
                    setNonAvailabilityInput("");
                    setRangeStart(null);
                  }}
                  style={{
                    padding: 12,
                    borderWidth: 1,
                    borderRadius: 12,
                    flex: 1,
                    alignItems: "center",
                    borderColor: "#e5e5e5",
                    backgroundColor: "#ffffff",
                  }}
                >
                  <Text style={{ fontWeight: "700", color: "#000000" }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveNonAvailability}
                  style={{
                    padding: 12,
                    borderWidth: 1,
                    borderRadius: 12,
                    flex: 1,
                    alignItems: "center",
                    backgroundColor: "#000000",
                    borderColor: "#000000",
                  }}
                >
                  <Text style={{ fontWeight: "800", color: "#ffffff" }}>Save</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
           
        </View>
      </Modal>
      {/* Confirm Delete Modal */}
      <Modal
        visible={!!confirmDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDelete(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            justifyContent: "center",
            alignItems: "center",
            padding: 18,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 420,
              backgroundColor: "#fff",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#e5e5e5",
              padding: 18,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <Ionicons name="warning" size={22} color="#cc0000" />
              <Text style={{ fontSize: 16, fontWeight: "800", color: "#000" }}>
                Delete surveyor?
              </Text>
            </View>

            <Text style={{ color: "#111", fontSize: 14, lineHeight: 20 }}>
              You’re about to permanently delete{" "}
              <Text style={{ fontWeight: "800" }}>{confirmDelete?.name}</Text>. This cannot be undone.
            </Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={() => setConfirmDelete(null)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#e5e5e5",
                  backgroundColor: "#fff",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "800", color: "#000" }}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={confirmDeleteNow}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#cc0000",
                  backgroundColor: "#cc0000",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "800", color: "#fff" }}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Toast
              toast={toast}
              onHide={() => setToast((t) => ({ ...t, visible: false }))}
            />
    </View>
  );
}

function SurveyorCard({ surveyor, onEdit, onShiftPreference, onAreaPreference, onNonAvailability, onToggleActive, onDelete }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderWidth: 1,
        borderRadius: 12,
        gap: 16,
        borderColor: "#e5e5e5",
        backgroundColor: "#ffffff",
        opacity: surveyor.active ? 1 : 0.7,
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
      }}
    >
      <Image
        source={{ uri: surveyor.photoUrl }}
        style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: "#e5e5e5" }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "700", fontSize: 16, color: "#000000" }}>{surveyor.name}</Text>
        <Text style={{ fontSize: 13, color: "#666666", marginTop: 2 }}>
          {surveyor.active ? "Active" : "Inactive"}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Pressable
          onPress={onEdit}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderRadius: 8,
            borderColor: "#e5e5e5",
            backgroundColor: "#ffffff",
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#000000" }}>Edit</Text>
        </Pressable>
        <Pressable
          onPress={onShiftPreference}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderRadius: 8,
            borderColor: surveyor.shiftPreference ? (surveyor.shiftPreference === "DAY" ? "#fbbf24" : "#1E3A5F") : "#e5e5e5",
            backgroundColor: surveyor.shiftPreference ? (surveyor.shiftPreference === "DAY" ? "rgba(251, 191, 36, 0.1)" : "rgba(30, 58, 95, 0.1)") : "#ffffff",
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#000000" }}>Shift Preference</Text>
        </Pressable>
        <Pressable
          onPress={onAreaPreference}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderRadius: 8,
            borderColor: surveyor.areaPreference ? (surveyor.areaPreference === "SOUTH" ? "#10b981" : "#8b5cf6") : "#e5e5e5",
            backgroundColor: surveyor.areaPreference ? (surveyor.areaPreference === "SOUTH" ? "rgba(16, 185, 129, 0.1)" : "rgba(139, 92, 246, 0.1)") : "#ffffff",
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#000000" }}>Area Preference</Text>
        </Pressable>
        <Pressable
          onPress={onNonAvailability}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderRadius: 8,
            borderColor: surveyor.nonAvailability && surveyor.nonAvailability.length > 0 ? "#fbbf24" : "#e5e5e5",
            backgroundColor: surveyor.nonAvailability && surveyor.nonAvailability.length > 0 ? "rgba(251, 191, 36, 0.1)" : "#ffffff",
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#000000" }}>Update Availability</Text>
        </Pressable>
        <Pressable
          onPress={onToggleActive}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderRadius: 8,
            borderColor: "#e5e5e5",
            backgroundColor: surveyor.active ? "rgba(251, 191, 36, 0.2)" : "#e5e5e5",
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#000000" }}>
            {surveyor.active ? "Deactivate" : "Activate"}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderWidth: 1,
            borderRadius: 8,
            borderColor: "#e5e5e5",
            backgroundColor: "rgba(255, 0, 0, 0.1)",
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "600", color: "#cc0000" }}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Toast({ toast, onHide }) {
  const anim = React.useRef(new Animated.Value(0)).current; // 0 hidden, 1 visible
  const timerRef = React.useRef(null);

  React.useEffect(() => {
    if (!toast?.visible) return;

    // animate in
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // auto hide
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      hide();
    }, toast.duration || 2200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.visible]);

  const hide = () => {
    Animated.timing(anim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onHide?.();
    });
  };

  if (!toast?.visible) return null;

  const isSuccess = toast.type === "success";
  const isError = toast.type === "error";
  const isInfo = toast.type === "info";

  const bg =
    isSuccess ? "#16a34a" : isError ? "#dc2626" : isInfo ? "#111827" : "#111827";

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [-24, 0],
  });

  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        top: 60, // below TopNav; adjust if needed
        left: 12,
        right: 12,
        zIndex: 9999,
        opacity,
        transform: [{ translateY }],
      }}
    >
      <Pressable
        onPress={hide}
        style={{
          backgroundColor: bg,
          borderRadius: 12,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.15)",
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 3 },
          elevation: 6,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>
          {toast.title || "Done"}
        </Text>
        {!!toast.message && (
          <Text style={{ color: "rgba(255,255,255,0.92)", marginTop: 2, fontSize: 13 }}>
            {toast.message}
          </Text>
        )}
        <Text style={{ color: "rgba(255,255,255,0.75)", marginTop: 6, fontSize: 11 }}>
          Tap to dismiss
        </Text>
      </Pressable>
    </Animated.View>
  );
}
