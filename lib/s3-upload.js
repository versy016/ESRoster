/**
 * S3/Supabase Storage upload utility for surveyor images
 * Uses Supabase Storage API (S3-compatible)
 */

import { supabase } from "./supabase";
import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";

const BUCKET_NAME = "ESRoster";
const FOLDER_NAME = "surveyorimages";

/**
 * Upload an image file to S3/Supabase Storage
 * @param {string} fileUri - Local file URI (from image picker)
 * @param {string} surveyorName - Surveyor name for filename (will be sanitized)
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
export async function uploadSurveyorImage(fileUri, surveyorName) {
  try {
    // Generate a unique filename
    const timestamp = Date.now();
    const sanitizedFileName = (surveyorName || "surveyor")
      .replace(/[^a-zA-Z0-9.-]/g, "_")
      .toLowerCase();
    
    // Get file extension from URI or default to jpg
    let fileExtension = "jpg";
    if (fileUri.includes(".")) {
      const ext = fileUri.split(".").pop()?.toLowerCase();
      if (ext && ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
        fileExtension = ext === "jpeg" ? "jpg" : ext;
      }
    }
    
    const uniqueFileName = `${sanitizedFileName}_${timestamp}.${fileExtension}`;
    const filePath = `${FOLDER_NAME}/${uniqueFileName}`;

    console.log(`[S3-UPLOAD] Uploading image: ${filePath}`);

    // Read the file based on platform
    let fileData;
    let contentType = `image/${fileExtension === "jpg" ? "jpeg" : fileExtension}`;
    
    if (Platform.OS === "web") {
      // For web, fetch and convert to blob
      // Handle both blob URLs and regular URLs
      let response;
      try {
        response = await fetch(fileUri);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
      } catch (fetchError) {
        console.error("[S3-UPLOAD] Error fetching blob URL:", fetchError);
        // If it's a blob URL that failed, it might be revoked
        if (fileUri.startsWith("blob:")) {
          throw new Error("Blob URL is no longer valid. Please select the image again.");
        }
        throw fetchError;
      }
      
      const blob = await response.blob();
      // Convert blob to ArrayBuffer for Supabase
      fileData = await blob.arrayBuffer();
      
      // NOTE: Do NOT revoke blob URLs here - let the component handle it after successful save
      // Revoking here can cause issues if the upload fails or if the blob is still needed
    } else {
      // For mobile, read as base64 and convert to ArrayBuffer
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      // Convert base64 to ArrayBuffer (required by Supabase Storage)
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      fileData = bytes.buffer; // Use ArrayBuffer, not Uint8Array
    }

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, fileData, {
        contentType: contentType,
        upsert: false, // Don't overwrite existing files
      });

    if (error) {
      console.error("[S3-UPLOAD] Upload error:", error);
      return { success: false, error: error.message };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;
    console.log(`[S3-UPLOAD] Upload successful: ${publicUrl}`);

    return { success: true, url: publicUrl };
  } catch (error) {
    console.error("[S3-UPLOAD] Unexpected error:", error);
    return { success: false, error: error.message || "Upload failed" };
  }
}

/**
 * Delete an image from S3/Supabase Storage
 * @param {string} imageUrl - Full URL of the image to delete
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteSurveyorImage(imageUrl) {
  try {
    // Extract file path from URL
    // URL format: https://[project].supabase.co/storage/v1/object/public/ESRoster/surveyorimages/filename.jpg
    const urlParts = imageUrl.split("/");
    const fileNameIndex = urlParts.indexOf(FOLDER_NAME);
    
    if (fileNameIndex === -1) {
      console.warn("[S3-UPLOAD] Could not extract file path from URL:", imageUrl);
      return { success: false, error: "Invalid image URL" };
    }

    const filePath = urlParts.slice(fileNameIndex).join("/");
    console.log(`[S3-UPLOAD] Deleting image: ${filePath}`);

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) {
      console.error("[S3-UPLOAD] Delete error:", error);
      return { success: false, error: error.message };
    }

    console.log(`[S3-UPLOAD] Delete successful: ${filePath}`);
    return { success: true };
  } catch (error) {
    console.error("[S3-UPLOAD] Unexpected delete error:", error);
    return { success: false, error: error.message || "Delete failed" };
  }
}
