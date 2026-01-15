import React, { useState, useEffect, useRef, useCallback } from "react";
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
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { usePathname, useRouter, useLocalSearchParams } from "expo-router";
import { saveSurveyors, loadSurveyors } from "../lib/storage-hybrid";
import TopNav from "../components/TopNav";
import { Ionicons } from "@expo/vector-icons";
import { format, parseISO, isValid, addDays, eachDayOfInterval, parse, differenceInCalendarDays, startOfDay } from "date-fns";
import { Calendar } from "react-native-calendars";
import * as ImagePicker from "expo-image-picker";
import { uploadSurveyorImage, deleteSurveyorImage } from "../lib/s3-upload";
import { useAuth } from "../contexts/AuthContext";
import { linkUserToSurveyor, unlinkUserFromSurveyor } from "../lib/db";

export default function SurveyorsScreen() {
  const { user, role, refreshRole } = useAuth();
  const router = useRouter();
  const [surveyors, setSurveyors] = useState([]);
  const [editModal, setEditModal] = useState(null); // { surveyor } or null
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhotoUrl, setNewPhotoUrl] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const uploadInProgressRef = useRef(false); // Track upload state with ref to prevent race conditions
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
  const [saving, setSaving] = useState(false); // Loading state for save operations
  const [savingShiftPreference, setSavingShiftPreference] = useState(false);
  const [savingAreaPreference, setSavingAreaPreference] = useState(false);
  const [savingNonAvailability, setSavingNonAvailability] = useState(false);

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

  const pathname = usePathname();
  const params = useLocalSearchParams();
  
  // Check if user is supervisor OR if they're editing their own profile
  useEffect(() => {
    // Allow access if:
    // 1. User is a supervisor (full access)
    // 2. User is editing their own profile (params.action and params.id match their surveyor)
    if (role !== "supervisor") {
      if (!params.action || !params.id) {
        // If no action params, this is general access - only supervisors allowed
        Alert.alert(
          "Access Denied",
          "Only supervisors can access the surveyors page.",
          [{ text: "OK", onPress: () => router.replace("/profile") }]
        );
      }
      // If they have action params, we'll check in the render logic if it's their own profile
    }
  }, [role, params.action, params.id]);

  // Handle action from profile page (for both supervisors and surveyors editing their own profile)
  useEffect(() => {
    if (params.action && params.id && surveyors.length > 0) {
      const surveyor = surveyors.find(s => s.id === params.id);
      if (surveyor) {
        console.log("[SURVEYORS] Action handler - surveyor found:", { id: surveyor.id, name: surveyor.name, user_id: surveyor.user_id });
        console.log("[SURVEYORS] Action handler - user:", user ? { id: user.id } : "not loaded");
        
        // Check if user is supervisor OR if they're editing their own profile
        const isOwnProfile = user && surveyor.user_id === user.id;
        const isSupervisor = role === "supervisor";
        
        console.log("[SURVEYORS] Action handler - isOwnProfile:", isOwnProfile, "isSupervisor:", isSupervisor);
        
        if (isSupervisor || isOwnProfile) {
          setTimeout(() => {
            if (params.action === "edit") {
              openEdit(surveyor);
            } else if (params.action === "shift") {
              openShiftPreference(surveyor);
            } else if (params.action === "area") {
              openAreaPreference(surveyor);
            } else if (params.action === "availability") {
              openNonAvailability(surveyor);
            } else if (params.action === "toggle") {
              // Only supervisors can toggle active status
              if (isSupervisor) {
                handleToggleActive(surveyor);
              } else {
                Alert.alert("Access Denied", "Only supervisors can activate/deactivate surveyors.");
              }
            }
          }, 100); // Reduced delay for faster modal opening
        } else if (user) {
          // Only show alert if user is loaded (to avoid showing alert during initial load)
          console.log("[SURVEYORS] Access denied in action handler - not own profile");
          Alert.alert(
            "Access Denied",
            "You can only edit your own profile. Please make sure your surveyor profile is linked to your account.",
            [{ text: "OK", onPress: () => router.replace("/profile") }]
          );
        } else {
          console.log("[SURVEYORS] User not loaded yet, waiting...");
        }
      } else if (params.action && params.id) {
        // Surveyor not found - might still be loading
        console.log("[SURVEYORS] Surveyor not found for action:", params.id);
      }
    }
  }, [params.action, params.id, surveyors.length, role, user]);

  async function loadData() {
    try {
      console.log("[SURVEYORS] Loading data...");
      const saved = await loadSurveyors();
      if (saved && saved.length > 0) {
        setSurveyors(saved);
        console.log(`[SURVEYORS] Loaded ${saved.length} surveyors`);
      } else {
        // Only use default surveyors if database is empty and not configured
        // If database is configured, it should return empty array, not null
        setSurveyors([]);
        console.log("[SURVEYORS] No surveyors found");
      }
    } catch (error) {
      console.error("Error loading surveyors:", error);
      setSurveyors([]);
    }
  }

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  // Reload data when screen comes into focus (navigation)
  useFocusEffect(
    useCallback(() => {
      console.log("[SURVEYORS] Screen focused, reloading data...");
      loadData();
    }, [])
  );

  // Also reload when pathname changes (fallback for web)
  useEffect(() => {
    if (pathname === "/surveyors") {
      console.log("[SURVEYORS] Pathname changed to /surveyors, reloading data...");
      loadData();
    }
  }, [pathname]);

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
        
        // Revoke old blob URL if it exists (on web) - but only if not currently uploading
        if (!uploadingImage && Platform.OS === "web" && newPhotoUrl && newPhotoUrl.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(newPhotoUrl);
            console.log("[SURVEYOR] Revoked old blob URL when picking new image");
          } catch (e) {
            // Ignore errors
          }
        }
        
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

    if (saving) return; // Prevent double-save
    setSaving(true);
    
    try {
      const trimmedName = newName.trim();
      const trimmedEmail = newEmail.trim();
      let finalPhotoUrl = newPhotoUrl.trim();

      // Prevent multiple simultaneous uploads
      if (uploadingImage) {
        showToast("info", "Please wait", "An image upload is already in progress");
        setSaving(false);
        return;
      }

      // Check if photoUrl is a local file URI or blob URL that needs to be uploaded
      const isLocalUri = finalPhotoUrl && (
        finalPhotoUrl.startsWith("file://") || 
        finalPhotoUrl.startsWith("content://") || 
        finalPhotoUrl.startsWith("ph://") ||
        finalPhotoUrl.startsWith("blob:")
      );

      // If photoUrl is a local file URI or blob URL, upload it to S3
      if (isLocalUri) {
      // Store the blob URL before upload so we can revoke it later
      const blobUrlToRevoke = Platform.OS === "web" && finalPhotoUrl.startsWith("blob:") ? finalPhotoUrl : null;
      
      setUploadingImage(true);
      uploadInProgressRef.current = true; // Set ref to prevent concurrent uploads
      let uploadSuccess = false;
      try {
        showToast("info", "Uploading", "Uploading image to S3...");
        
        // Add timeout for upload (30 seconds)
        const uploadPromise = uploadSurveyorImage(finalPhotoUrl, trimmedName);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Upload timeout - please try again")), 30000)
        );
        
        const uploadResult = await Promise.race([uploadPromise, timeoutPromise]);
        
        if (uploadResult.success && uploadResult.url) {
          finalPhotoUrl = uploadResult.url;
          uploadSuccess = true;
          console.log(`[SURVEYOR] Image uploaded successfully: ${finalPhotoUrl}`);
          
          // Revoke blob URL after successful upload (on web) - use the stored reference
          if (blobUrlToRevoke) {
            try {
              URL.revokeObjectURL(blobUrlToRevoke);
              console.log("[SURVEYOR] Revoked blob URL after successful upload");
            } catch (e) {
              console.warn("[SURVEYOR] Error revoking blob URL:", e);
            }
          }
          
          showToast("success", "Uploaded", "Image uploaded successfully");
        } else {
          showToast("error", "Upload Failed", uploadResult.error || "Failed to upload image");
          setUploadingImage(false);
          setSaving(false);
          return; // Don't save if upload fails
        }
      } catch (error) {
        console.error("Error uploading image:", error);
        const errorMessage = error.message || "Failed to upload image";
        showToast("error", "Upload Error", errorMessage);
        setUploadingImage(false);
        setSaving(false);
        return;
      } finally {
        // Only reset if upload didn't succeed (success case continues to save)
        if (!uploadSuccess) {
          setUploadingImage(false);
        }
      }
    }

    const updated = [...surveyors];

    if (editModal.id) {
      const idx = updated.findIndex((s) => s.id === editModal.id);
      if (idx >= 0) {
          // If updating and old photo was from S3, delete it if we're uploading a new one
          const oldPhotoUrl = updated[idx].photoUrl;
          const isOldPhotoFromS3 = oldPhotoUrl && (
            oldPhotoUrl.includes("supabase.co/storage") || 
            oldPhotoUrl.includes("surveyorimages")
          );
          
          // Delete old photo if it's from S3 and we're uploading a new one
          if (isOldPhotoFromS3 && finalPhotoUrl && finalPhotoUrl !== oldPhotoUrl && isLocalUri) {
            try {
              await deleteSurveyorImage(oldPhotoUrl);
              console.log(`[SURVEYOR] Deleted old image: ${oldPhotoUrl}`);
            } catch (error) {
              console.warn("Error deleting old image (non-critical):", error);
              // Don't fail the save if deletion fails
            }
          }
          
        updated[idx] = {
          ...updated[idx],
            name: trimmedName,
            email: trimmedEmail || updated[idx].email,
            photoUrl: finalPhotoUrl || updated[idx].photoUrl,
        };
      }

        setSurveyors(updated);
        const saveResult = await saveSurveyors(updated);
        
        // Reload surveyors to get updated IDs from database
        await loadData();
        
        // Auto-link if email matches authenticated user's email
        if (user && trimmedEmail && trimmedEmail.toLowerCase() === user.email?.toLowerCase()) {
          // Find the surveyor by email (after reload, it will have the database ID)
          const reloadedSurveyors = await loadSurveyors();
          const surveyorToLink = reloadedSurveyors?.find(s => 
            (s.id === editModal.id || s.email?.toLowerCase() === trimmedEmail.toLowerCase()) && 
            !s.user_id
          );
          if (surveyorToLink) {
            console.log(`[AUTO-LINK] Email matches auth user, auto-linking surveyor ${surveyorToLink.id} to user ${user.id}`);
            try {
              const linkResult = await linkUserToSurveyor(user.id, surveyorToLink.id);
              if (linkResult.success) {
                console.log("[AUTO-LINK] Successfully auto-linked surveyor to user");
                // Reload data to reflect the link
                await loadData();
                // Refresh role in AuthContext
                await refreshRole();
                showToast("info", "Auto-Linked", "Surveyor automatically linked to your account");
              } else {
                console.warn("[AUTO-LINK] Failed to auto-link:", linkResult.error);
              }
            } catch (error) {
              console.error("[AUTO-LINK] Error auto-linking:", error);
            }
          }
        }

        // Reset uploading state and clear photo URL after successful save
        setUploadingImage(false);
        uploadInProgressRef.current = false;
        // Clear the photo URL from state since it's now saved as S3 URL
        if (finalPhotoUrl && !finalPhotoUrl.startsWith("blob:") && !finalPhotoUrl.startsWith("file://") && !finalPhotoUrl.startsWith("content://") && !finalPhotoUrl.startsWith("ph://")) {
          setNewPhotoUrl(finalPhotoUrl); // Update to S3 URL
    } else {
          setNewPhotoUrl(""); // Clear if it was a local/blob URL
        }
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
    
    // Reload surveyors to get updated IDs from database (new surveyors get UUIDs)
    await loadData();

        // Auto-link if email matches authenticated user's email
        if (user && trimmedEmail && trimmedEmail.toLowerCase() === user.email?.toLowerCase()) {
          // Find the surveyor by email (after reload, it will have the database UUID)
          const reloadedSurveyors = await loadSurveyors();
          const surveyorToLink = reloadedSurveyors?.find(s => 
            s.email?.toLowerCase() === trimmedEmail.toLowerCase() && 
            !s.user_id
          );
          if (surveyorToLink) {
            console.log(`[AUTO-LINK] Email matches auth user, auto-linking new surveyor ${surveyorToLink.id} to user ${user.id}`);
            try {
              const linkResult = await linkUserToSurveyor(user.id, surveyorToLink.id);
              if (linkResult.success) {
                console.log("[AUTO-LINK] Successfully auto-linked new surveyor to user");
                // Reload data to reflect the link
                await loadData();
                // Refresh role in AuthContext
                await refreshRole();
                showToast("info", "Auto-Linked", "Surveyor automatically linked to your account");
              } else {
                console.warn("[AUTO-LINK] Failed to auto-link:", linkResult.error);
              }
            } catch (error) {
              console.error("[AUTO-LINK] Error auto-linking:", error);
            }
          }
        }

        // Reset uploading state and clear photo URL after successful save
        setUploadingImage(false);
        uploadInProgressRef.current = false;
        // Clear the photo URL from state since it's now saved as S3 URL
        if (finalPhotoUrl && !finalPhotoUrl.startsWith("blob:") && !finalPhotoUrl.startsWith("file://") && !finalPhotoUrl.startsWith("content://") && !finalPhotoUrl.startsWith("ph://")) {
          setNewPhotoUrl(finalPhotoUrl); // Update to S3 URL
        } else {
          setNewPhotoUrl(""); // Clear if it was a local/blob URL
        }
        showToast("success", "Added", `Created ${trimmedName}`);
      }

      // Revoke blob URL if it exists (on web) before clearing - but only if not uploading
      if (!uploadingImage && !uploadInProgressRef.current && Platform.OS === "web" && newPhotoUrl && newPhotoUrl.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(newPhotoUrl);
          console.log("[SURVEYOR] Revoked blob URL on modal close");
        } catch (e) {
          // Ignore errors
        }
      }
      
      // Keep modal open briefly to show toast, then close and redirect
      setTimeout(() => {
    setEditModal(null);
    setNewName("");
        setNewEmail("");
    setNewPhotoUrl("");
    setNewShiftPreference(null);
    setNewAreaPreference(null);
        setNameError("");
        setEmailError("");
        setUploadingImage(false); // Ensure upload state is reset
        uploadInProgressRef.current = false; // Reset ref
        setSaving(false); // Reset saving state
        
        // Delay redirect to allow toast to show
        if (role !== "supervisor" && params.action && params.id) {
          setTimeout(() => {
            router.replace("/profile");
          }, 100); // Small delay after closing modal
        }
      }, 1500); // Wait for toast to display (reduced from 2200ms)
    } catch (error) {
      console.error("Error saving surveyor:", error);
      setSaving(false);
      showToast("error", "Error", "Failed to save surveyor");
    }
  }

  // Helper function to close modals and redirect non-supervisors back to profile
  function handleModalClose() {
    // If user is not a supervisor and came from profile page, redirect back
    if (role !== "supervisor" && params.action && params.id) {
      router.replace("/profile");
    }
  }

  function closeEdit() {
    // Revoke blob URL if it exists (on web) before clearing - but only if not uploading
    if (!uploadingImage && !uploadInProgressRef.current && Platform.OS === "web" && newPhotoUrl && newPhotoUrl.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(newPhotoUrl);
        console.log("[SURVEYOR] Revoked blob URL on modal close");
      } catch (e) {
        // Ignore errors
      }
    }
    
    setEditModal(null);
    setNewName("");
    setNewEmail("");
    setNewPhotoUrl("");
    setNewShiftPreference(null);
    setNewAreaPreference(null);
    setNameError("");
    setEmailError("");
    setUploadingImage(false); // Ensure upload state is reset
    uploadInProgressRef.current = false; // Reset ref
    handleModalClose();
  }

  function closeShiftPreference() {
    setShiftPreferenceModal(null);
    setShiftPreference(null);
    handleModalClose();
  }

  async function handleSaveShiftPreference() {
    if (!shiftPreferenceModal) return;
    if (savingShiftPreference) return; // Prevent double-save

    setSavingShiftPreference(true);
    try {
    const updated = surveyors.map((s) =>
        s.id === shiftPreferenceModal.id ? { ...s, shiftPreference } : s
    );

    setSurveyors(updated);
    await saveSurveyors(updated);

      showToast(
        "success",
        "Shift preference saved",
        `${shiftPreferenceModal.name}: ${shiftPreference || "No preference"}`
      );

      // Keep modal open briefly to show toast, then close and redirect
      setTimeout(() => {
    setShiftPreferenceModal(null);
    setShiftPreference(null);
        
        // Delay redirect to allow toast to show
        if (role !== "supervisor" && params.action && params.id) {
          setTimeout(() => {
            router.replace("/profile");
          }, 100); // Small delay after closing modal
        }
      }, 1500); // Wait for toast to display (reduced from 2200ms)
    } finally {
      setSavingShiftPreference(false);
    }
  }

  function closeNonAvailability() {
    setNonAvailabilityModal(null);
    setNonAvailability([]);
    setNonAvailabilityInput("");
    setRangeStart(null);
    handleModalClose();
  }

  async function handleSaveNonAvailability() {
    if (!nonAvailabilityModal) return;
    if (savingNonAvailability) return; // Prevent double-save

    setSavingNonAvailability(true);
    try {
      // Store surveyor name before closing modal
      const surveyorName = nonAvailabilityModal.name;
      const daysCount = nonAvailability.length;

    const updated = surveyors.map((s) =>
        s.id === nonAvailabilityModal.id ? { ...s, nonAvailability } : s
    );

    setSurveyors(updated);
    await saveSurveyors(updated);

      // Close modal immediately
    setNonAvailabilityModal(null);
    setNonAvailability([]);
    setNonAvailabilityInput("");
      setRangeStart(null);

      // Show toast after modal closes (toast will still be visible)
      showToast(
        "success",
        "Availability saved",
        `${surveyorName}: ${daysCount} day(s) selected`
      );

      // Redirect if needed (for non-supervisors)
      if (role !== "supervisor" && params.action && params.id) {
        setTimeout(() => {
          router.replace("/profile");
        }, 100);
      }
    } finally {
      setSavingNonAvailability(false);
    }
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

  function closeAreaPreference() {
    setAreaPreferenceModal(null);
    setAreaPreference(null);
    handleModalClose();
  }

  async function handleSaveAreaPreference() {
    if (!areaPreferenceModal) return;
    if (savingAreaPreference) return; // Prevent double-save

    setSavingAreaPreference(true);
    try {
    const updated = surveyors.map((s) =>
        s.id === areaPreferenceModal.id ? { ...s, areaPreference } : s
    );

    setSurveyors(updated);
    await saveSurveyors(updated);

      showToast(
        "success",
        "Area preference saved",
        `${areaPreferenceModal.name}: ${areaPreference === "SOUTH" ? "STSP" : areaPreference === "NORTH" ? "NTNP" : "No preference"}`
      );

      // Keep modal open briefly to show toast, then close and redirect
      setTimeout(() => {
    setAreaPreferenceModal(null);
    setAreaPreference(null);
        
        // Delay redirect to allow toast to show
        if (role !== "supervisor" && params.action && params.id) {
          setTimeout(() => {
            router.replace("/profile");
          }, 100); // Small delay after closing modal
        }
      }, 1500); // Wait for toast to display (reduced from 2200ms)
    } finally {
      setSavingAreaPreference(false);
    }
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

  // Check if user is editing their own profile
  const hasActionParams = params.action && params.id;
  const isEditingOwnProfile = hasActionParams && user;
  let ownSurveyor = null;
  if (isEditingOwnProfile && user && surveyors.length > 0) {
    ownSurveyor = surveyors.find(s => s.id === params.id && s.user_id === user.id);
  }
  
  // Allow access if:
  // 1. User is supervisor (full access)
  // 2. User has action params (editing profile) - we'll verify it's their own once data loads
  const hasAccess = role === "supervisor" || hasActionParams;
  
  // If they have action params but surveyors are loaded and user is loaded, verify ownership
  if (hasActionParams && surveyors.length > 0 && user && role !== "supervisor") {
    const targetSurveyor = surveyors.find(s => s.id === params.id);
    console.log("[SURVEYORS] Access check - targetSurveyor:", targetSurveyor ? { id: targetSurveyor.id, name: targetSurveyor.name, user_id: targetSurveyor.user_id } : "not found");
    console.log("[SURVEYORS] Access check - user.id:", user.id);
    
    if (targetSurveyor) {
      // If surveyor is found but not linked to this user, deny access
      if (targetSurveyor.user_id && targetSurveyor.user_id !== user.id) {
        console.log("[SURVEYORS] Access denied - surveyor belongs to different user");
        return (
          <View style={{ flex: 1, backgroundColor: "#ffffff", justifyContent: "center", alignItems: "center" }}>
            <TopNav />
            <Text style={{ fontSize: 16, color: "#666666" }}>Access Denied</Text>
            <Text style={{ fontSize: 14, color: "#999999", marginTop: 8 }}>You can only edit your own profile</Text>
          </View>
        );
      }
      // If surveyor is found but has no user_id, they're not linked - allow access for now
      // (they might be in the process of linking, or the check might be premature)
      if (!targetSurveyor.user_id) {
        console.log("[SURVEYORS] Warning - surveyor not linked to any user, but allowing access");
        // Don't deny access here - let the useEffect handle it
      }
    } else {
      // If targetSurveyor is not found yet, allow access - data might still be loading
      console.log("[SURVEYORS] Target surveyor not found yet, allowing access (data may still be loading)");
    }
  }
  
  if (!hasAccess) {
    return (
      <View style={{ flex: 1, backgroundColor: "#ffffff", justifyContent: "center", alignItems: "center" }}>
        <TopNav />
        <Text style={{ fontSize: 16, color: "#666666" }}>Access Denied</Text>
        <Text style={{ fontSize: 14, color: "#999999", marginTop: 8 }}>Only supervisors can access this page</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
      <TopNav />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ flex: 1, padding: Platform.OS === "web" ? 16 : 12, gap: Platform.OS === "web" ? 16 : 12, paddingTop: Platform.OS === "web" ? 70 : 80 }}>
          {/* Only show Add Surveyor button for supervisors */}
          {role === "supervisor" && (
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
          )}

          {/* Color Legend - Only show for supervisors */}
          {role === "supervisor" && (
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
          )}

          {/* Only show surveyor list for supervisors */}
          {role === "supervisor" && (
            <>
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
            </>
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
                  padding: Platform.OS === "web" ? 12 : 14,
                  borderColor: nameError ? "#dc2626" : "#e5e5e5",
                  backgroundColor: "#ffffff",
                  color: "#000000",
                  fontSize: Platform.OS === "web" ? 14 : 16, // Larger font for mobile
                  minHeight: Platform.OS === "web" ? "auto" : 48, // Minimum touch target for mobile
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
                  padding: Platform.OS === "web" ? 12 : 14,
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
                    padding: Platform.OS === "web" ? 12 : 14,
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
                  padding: Platform.OS === "web" ? 12 : 14,
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
                      padding: Platform.OS === "web" ? 12 : 14,
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
                      padding: Platform.OS === "web" ? 12 : 14,
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
                      padding: Platform.OS === "web" ? 12 : 14,
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
                      padding: Platform.OS === "web" ? 12 : 14,
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

            {/* Link to Account Button - Only show when editing and user is authenticated */}
            {editModal?.id && user && (
              <View style={{ marginTop: 16, marginBottom: 8 }}>
                <Pressable
                  onPress={async () => {
                    try {
                      // Check if this surveyor is already linked to a user
                      const currentSurveyor = surveyors.find(s => s.id === editModal.id);
                      if (currentSurveyor?.user_id) {
                        if (currentSurveyor.user_id === user.id) {
                          Alert.alert("Already Linked", "This surveyor is already linked to your account.");
                          return;
                        } else {
                          Alert.alert(
                            "Already Linked",
                            "This surveyor is already linked to another user account. Please contact a supervisor to change the link.",
                            [{ text: "OK" }]
                          );
                          return;
                        }
                      }

                      // Check if user is already linked to another surveyor
                      const userLinkedSurveyor = surveyors.find(s => s.user_id === user.id);
                      if (userLinkedSurveyor) {
                        Alert.alert(
                          "Already Linked",
                          `Your account is already linked to "${userLinkedSurveyor.name}". Would you like to unlink from that surveyor and link to this one instead?`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Unlink & Link",
                              onPress: async () => {
                                try {
                                  // Unlink from old surveyor
                                  await unlinkUserFromSurveyor(user.id);
                                  // Link to new surveyor
                                  const result = await linkUserToSurveyor(user.id, editModal.id);
                                  if (result.success) {
                                    showToast("success", "Linked", "Surveyor linked to your account successfully");
                                    // Reload data to reflect the change
                                    await loadData();
                                    // Small delay to ensure database propagation
                                    await new Promise(resolve => setTimeout(resolve, 300));
                                    // Refresh role in AuthContext to update permissions
                                    await refreshRole();
                                    // Redirect to profile page to see the linked surveyor
                                    router.push("/profile");
                                  } else {
                                    showToast("error", "Error", result.error || "Failed to link surveyor");
                                  }
                                } catch (error) {
                                  console.error("Error linking surveyor:", error);
                                  showToast("error", "Error", "Failed to link surveyor");
                                }
                              },
                            },
                          ]
                        );
                        return;
                      }

                      // Link the surveyor to the current user
                      const result = await linkUserToSurveyor(user.id, editModal.id);
                      if (result.success) {
                        showToast("success", "Linked", "Surveyor linked to your account successfully");
                        // Reload data to reflect the change
                        await loadData();
                        // Small delay to ensure database propagation
                        await new Promise(resolve => setTimeout(resolve, 300));
                        // Refresh role in AuthContext to update permissions
                        await refreshRole();
                        // Redirect to profile page to see the linked surveyor
                        router.push("/profile");
                      } else {
                        showToast("error", "Error", result.error || "Failed to link surveyor");
                      }
                    } catch (error) {
                      console.error("Error linking surveyor:", error);
                      showToast("error", "Error", "Failed to link surveyor");
                    }
                  }}
                  style={{
                    padding: Platform.OS === "web" ? 12 : 14,
                    borderWidth: 1,
                    borderRadius: 12,
                    alignItems: "center",
                    borderColor: "#fbbf24",
                    backgroundColor: "rgba(251, 191, 36, 0.1)",
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="link-outline" size={18} color="#000000" />
                    <Text style={{ fontWeight: "700", color: "#000000" }}>
                      {surveyors.find(s => s.id === editModal.id)?.user_id === user.id
                        ? "Linked to My Account"
                        : "Link to My Account"}
                    </Text>
                  </View>
                </Pressable>
              </View>
            )}

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => closeEdit()}
                style={{
                  padding: Platform.OS === "web" ? 12 : 14,
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
                  padding: Platform.OS === "web" ? 12 : 14,
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
        onRequestClose={() => closeShiftPreference()}
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
                onPress={() => closeShiftPreference()}
                style={{
                  padding: Platform.OS === "web" ? 12 : 14,
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
                disabled={savingShiftPreference}
                style={{
                  padding: Platform.OS === "web" ? 12 : 14,
                  borderWidth: 1,
                  borderRadius: 12,
                  flex: 1,
                  alignItems: "center",
                  backgroundColor: savingShiftPreference ? "#666666" : "#000000",
                  borderColor: savingShiftPreference ? "#666666" : "#000000",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                {savingShiftPreference && (
                  <ActivityIndicator size="small" color="#ffffff" />
                )}
                <Text style={{ fontWeight: "800", color: "#ffffff" }}>
                  {savingShiftPreference ? "Saving..." : "Save"}
                </Text>
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
                onPress={() => closeAreaPreference()}
                style={{
                  padding: Platform.OS === "web" ? 12 : 14,
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
                  padding: Platform.OS === "web" ? 12 : 14,
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
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: Platform.OS === "web" ? "rgba(0,0,0,0.5)" : "#ffffff",
          }}
          edges={Platform.OS === "web" ? [] : ["top", "bottom", "left", "right"]}
        >
          <View
            style={{
              flex: 1,
              justifyContent: Platform.OS === "web" ? "center" : "flex-start",
              alignItems: "center",
              backgroundColor: Platform.OS === "web" ? "rgba(0,0,0,0.5)" : "transparent",
            }}
          >
            <View
              style={{
                backgroundColor: "#ffffff",
                borderRadius: Platform.OS === "web" ? 18 : 0,
                padding: Platform.OS === "web" ? 24 : 16,
                width: Platform.OS === "web" ? "95%" : "100%",
                height: Platform.OS === "web" ? undefined : "100%",
                maxWidth: 1000,
                maxHeight: Platform.OS === "web" ? "90%" : "100%",
                borderWidth: Platform.OS === "web" ? 1 : 0,
                borderColor: "#e5e5e5",
              }}
            >
              <ScrollView showsVerticalScrollIndicator={true} style={{ flex: 1 }}>
              <Text style={{ 
                fontWeight: "800", 
                fontSize: Platform.OS === "web" ? 18 : 16, 
                color: "#000000", 
                marginBottom: Platform.OS === "web" ? 20 : 16 
              }}>
                Non-Availability - {nonAvailabilityModal?.name}
              </Text>

              {/* Calendar Picker */}
              <View style={{ marginBottom: Platform.OS === "web" ? 20 : 16 }}>
                <Text style={{ 
                  fontWeight: "600", 
                  color: "#000000", 
                  fontSize: Platform.OS === "web" ? 14 : 13, 
                  marginBottom: Platform.OS === "web" ? 10 : 8 
                }}>
                  Select Dates (Tap to toggle, or tap two dates for range)
                </Text>
                {rangeStart && (
                  <Text style={{ 
                    fontSize: Platform.OS === "web" ? 12 : 11, 
                    color: "#666666", 
                    marginBottom: Platform.OS === "web" ? 8 : 6 
                  }}>
                    Range start: {format(parse(rangeStart, "yyyy-MM-dd", new Date()), "d MMM yyyy")} - Tap another date to select range
                  </Text>
                )}
                <View style={{ 
                  flexDirection: Platform.OS === "web" ? "row" : "column", 
                  gap: Platform.OS === "web" ? 16 : 12, 
                  justifyContent: "space-between", 
                  alignItems: "flex-start", 
                  width: "100%" 
                }}>
                <View style={{ 
                  flex: 1, 
                  minWidth: Platform.OS === "web" ? 300 : undefined, 
                  maxWidth: Platform.OS === "web" ? "48%" : "100%",
                  width: "100%"
                }}>
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
                    textDayFontSize: Platform.OS === "web" ? 14 : 12,
                    textMonthFontSize: Platform.OS === "web" ? 16 : 14,
                    textDayHeaderFontSize: Platform.OS === "web" ? 13 : 11,
                  }}
                  style={{
                    borderWidth: 1,
                    borderColor: "#e5e5e5",
                    borderRadius: 10,
                    padding: Platform.OS === "web" ? 8 : 4,
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
                <View style={{ 
                  flex: 1, 
                  minWidth: Platform.OS === "web" ? 300 : undefined, 
                  maxWidth: Platform.OS === "web" ? "48%" : "100%",
                  width: "100%"
                }}>
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
                    textDayFontSize: Platform.OS === "web" ? 14 : 12,
                    textMonthFontSize: Platform.OS === "web" ? 16 : 14,
                    textDayHeaderFontSize: Platform.OS === "web" ? 13 : 11,
                  }}
                  style={{
                    borderWidth: 1,
                    borderColor: "#e5e5e5",
                    borderRadius: 10,
                    padding: Platform.OS === "web" ? 8 : 4,
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

              <View style={{ gap: Platform.OS === "web" ? 10 : 8, marginBottom: Platform.OS === "web" ? 20 : 16 }}>
                <Text style={{ 
                  fontWeight: "600", 
                  color: "#000000", 
                  fontSize: Platform.OS === "web" ? 14 : 13 
                }}>Or Add Date Manually</Text>
                <View style={{ flexDirection: "row", gap: Platform.OS === "web" ? 8 : 6 }}>
                  <TextInput
                    value={nonAvailabilityInput}
                    onChangeText={setNonAvailabilityInput}
                    placeholder="YYYY-MM-DD or date"
                    placeholderTextColor="#999999"
                    style={{ 
                      flex: 1,
                      borderWidth: 1, 
                      borderRadius: 10, 
                      padding: Platform.OS === "web" ? 12 : 12,
                      borderColor: "#e5e5e5",
                      backgroundColor: "#ffffff",
                      color: "#000000",
                      fontSize: Platform.OS === "web" ? 14 : 13,
                      minHeight: Platform.OS === "web" ? undefined : 44,
                    }}
                  />
                  <Pressable
                    onPress={addNonAvailabilityDate}
                    style={{
                      paddingHorizontal: Platform.OS === "web" ? 16 : 14,
                      paddingVertical: Platform.OS === "web" ? 12 : 12,
                      borderRadius: 10,
                      backgroundColor: "#fbbf24",
                      borderWidth: 1,
                      borderColor: "#e5e5e5",
                      minHeight: Platform.OS === "web" ? undefined : 44,
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ 
                      fontWeight: "700", 
                      color: "#000000", 
                      fontSize: Platform.OS === "web" ? 14 : 13 
                    }}>Add</Text>
                  </Pressable>
                </View>
              </View>

              {nonAvailability.length > 0 && (
                <View style={{ 
                  marginBottom: Platform.OS === "web" ? 20 : 16, 
                  padding: Platform.OS === "web" ? 12 : 10, 
                  backgroundColor: "rgba(251, 191, 36, 0.1)", 
                  borderRadius: 10, 
                  borderWidth: 1, 
                  borderColor: "#fbbf24" 
                }}>
                  <Text style={{ 
                    fontWeight: "600", 
                    color: "#000000", 
                    fontSize: Platform.OS === "web" ? 14 : 13, 
                    marginBottom: Platform.OS === "web" ? 8 : 6 
                  }}>
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
                        <View key={idx} style={{ 
                          flexDirection: "row", 
                          alignItems: "center", 
                          justifyContent: "space-between", 
                          marginBottom: idx < ranges.length - 1 ? (Platform.OS === "web" ? 8 : 6) : 0 
                        }}>
                          <Text style={{ 
                            color: "#000000", 
                            fontSize: Platform.OS === "web" ? 14 : 12, 
                            fontWeight: "600",
                            flex: 1,
                            marginRight: 8
                          }}>
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
                            <Ionicons name="close-circle" size={Platform.OS === "web" ? 20 : 18} color="#cc0000" />
                          </Pressable>
                        </View>
                      );
                    });
                  })()}
                </View>
              )}

              <View style={{ 
                flexDirection: "row", 
                gap: Platform.OS === "web" ? 10 : 8,
                marginTop: Platform.OS === "web" ? 0 : 8,
                paddingTop: Platform.OS === "web" ? 0 : 8,
                borderTopWidth: Platform.OS === "web" ? 0 : 1,
                borderTopColor: Platform.OS === "web" ? "transparent" : "#e5e5e5"
              }}>
                <Pressable
                  onPress={() => closeNonAvailability()}
                  style={{
                    padding: Platform.OS === "web" ? 12 : 14,
                    borderWidth: 1,
                    borderRadius: 12,
                    flex: 1,
                    alignItems: "center",
                    borderColor: "#e5e5e5",
                    backgroundColor: "#ffffff",
                    minHeight: Platform.OS === "web" ? undefined : 48,
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ 
                    fontWeight: "700", 
                    color: "#000000",
                    fontSize: Platform.OS === "web" ? 14 : 14
                  }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveNonAvailability}
                  disabled={savingNonAvailability}
                  style={{
                    padding: Platform.OS === "web" ? 12 : 14,
                    borderWidth: 1,
                    borderRadius: 12,
                    flex: 1,
                    alignItems: "center",
                    backgroundColor: savingNonAvailability ? "#666666" : "#000000",
                    borderColor: savingNonAvailability ? "#666666" : "#000000",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: 8,
                    minHeight: Platform.OS === "web" ? undefined : 48,
                  }}
                >
                  {savingNonAvailability && (
                    <ActivityIndicator size="small" color="#ffffff" />
                  )}
                  <Text style={{ 
                    fontWeight: "800", 
                    color: "#ffffff",
                    fontSize: Platform.OS === "web" ? 14 : 14
                  }}>
                    {savingNonAvailability ? "Saving..." : "Save"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
        </SafeAreaView>
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
  // Check if there are any future non-availability dates (today or later)
  const hasFutureNonAvailability = surveyor.nonAvailability && surveyor.nonAvailability.length > 0 && 
    surveyor.nonAvailability.some(dateKey => {
      try {
        const date = parseISO(dateKey);
        const today = startOfDay(new Date());
        const nonAvailDate = startOfDay(date);
        // Check if date is today or in the future (not in the past)
        // Compare dates directly: if nonAvailDate >= today, it's today or future
        return nonAvailDate.getTime() >= today.getTime();
      } catch (e) {
        return false; // Invalid date, ignore
      }
    });
  
  const isMobile = Platform.OS !== "web";
  
  return (
    <View
      style={{
        flexDirection: isMobile ? "column" : "row", // Column for mobile (buttons below), row for web (buttons on right)
        alignItems: isMobile ? "stretch" : "center",
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: isMobile ? 0 : 1 }}>
        {surveyor.photoUrl ? (
          <Image
            source={{ uri: surveyor.photoUrl }}
            style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: "#e5e5e5" }}
          />
        ) : (
          <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: "#e5e5e5", backgroundColor: "#fbbf24", justifyContent: "center", alignItems: "center" }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: "#000000" }}>
              {surveyor.name?.charAt(0)?.toUpperCase() || "?"}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", fontSize: 16, color: "#000000" }}>{surveyor.name}</Text>
          <Text style={{ fontSize: 13, color: "#666666", marginTop: 2 }}>
            {surveyor.active ? "Active" : "Inactive"}
          </Text>
        </View>
      </View>
      <View style={{ 
        flexDirection: isMobile ? "column" : "row", 
        gap: 8, 
        flexWrap: isMobile ? "nowrap" : "wrap",
        alignItems: isMobile ? "stretch" : "center",
        flexShrink: 0, // Prevent buttons from shrinking
        width: isMobile ? "100%" : "auto", // Full width on mobile, auto on web
      }}>
        {isMobile ? (
          <>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={onEdit}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderRadius: 8,
                  borderColor: "#e5e5e5",
                  backgroundColor: "#ffffff",
                  minHeight: 44,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#000000" }}>Edit</Text>
              </Pressable>
              <Pressable
                onPress={onShiftPreference}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderRadius: 8,
                  borderColor: surveyor.shiftPreference ? (surveyor.shiftPreference === "DAY" ? "#fbbf24" : "#1E3A5F") : "#e5e5e5",
                  backgroundColor: surveyor.shiftPreference ? (surveyor.shiftPreference === "DAY" ? "rgba(251, 191, 36, 0.1)" : "rgba(30, 58, 95, 0.1)") : "#ffffff",
                  minHeight: 44,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#000000", textAlign: "center" }} numberOfLines={2}>Shift Preference</Text>
              </Pressable>
              <Pressable
                onPress={onAreaPreference}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderRadius: 8,
                  borderColor: surveyor.areaPreference ? (surveyor.areaPreference === "SOUTH" ? "#10b981" : "#8b5cf6") : "#e5e5e5",
                  backgroundColor: surveyor.areaPreference ? (surveyor.areaPreference === "SOUTH" ? "rgba(16, 185, 129, 0.1)" : "rgba(139, 92, 246, 0.1)") : "#ffffff",
                  minHeight: 44,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#000000", textAlign: "center" }} numberOfLines={2}>Area Preference</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={onNonAvailability}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderRadius: 8,
                  borderColor: hasFutureNonAvailability ? "#fbbf24" : "#e5e5e5",
                  backgroundColor: hasFutureNonAvailability ? "rgba(251, 191, 36, 0.1)" : "#ffffff",
                  minHeight: 44,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#000000", textAlign: "center" }} numberOfLines={2}>Update Availability</Text>
              </Pressable>
              <Pressable
                onPress={onToggleActive}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderRadius: 8,
                  borderColor: "#e5e5e5",
                  backgroundColor: surveyor.active ? "rgba(251, 191, 36, 0.2)" : "#e5e5e5",
                  minHeight: 44,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#000000", textAlign: "center" }} numberOfLines={2}>
                  {surveyor.active ? "Deactivate" : "Activate"}
                </Text>
              </Pressable>
              <Pressable
                onPress={onDelete}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderRadius: 8,
                  borderColor: "#e5e5e5",
                  backgroundColor: "rgba(255, 0, 0, 0.1)",
                  minHeight: 44,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#cc0000", textAlign: "center" }} numberOfLines={2}>Delete</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
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
                borderColor: hasFutureNonAvailability ? "#fbbf24" : "#e5e5e5",
                backgroundColor: hasFutureNonAvailability ? "rgba(251, 191, 36, 0.1)" : "#ffffff",
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
          </>
        )}
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
