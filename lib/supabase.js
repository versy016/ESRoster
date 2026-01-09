import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Get Supabase URL and anon key from environment variables
// For Expo, use Constants.expoConfig.extra or process.env
// On web, also check window.env if available
let supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL;
let supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// On web, also check for environment variables in window object (for some build setups)
if (Platform.OS === "web" && typeof window !== "undefined") {
  if (!supabaseUrl && window.env?.EXPO_PUBLIC_SUPABASE_URL) {
    supabaseUrl = window.env.EXPO_PUBLIC_SUPABASE_URL;
  }
  if (!supabaseAnonKey && window.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
    supabaseAnonKey = window.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  }
}

// Create AsyncStorage adapter for Supabase (React Native/Expo)
// Supabase requires a Storage-like interface, so we create an adapter that wraps AsyncStorage
const createAsyncStorageAdapter = () => {
  return {
    getItem: async (key) => {
      try {
        return await AsyncStorage.getItem(key);
      } catch (error) {
        console.error("[SUPABASE] Error getting item from AsyncStorage:", error);
        return null;
      }
    },
    setItem: async (key, value) => {
      try {
        await AsyncStorage.setItem(key, value);
      } catch (error) {
        console.error("[SUPABASE] Error setting item in AsyncStorage:", error);
      }
    },
    removeItem: async (key) => {
      try {
        await AsyncStorage.removeItem(key);
      } catch (error) {
        console.error("[SUPABASE] Error removing item from AsyncStorage:", error);
      }
    },
  };
};

// Log configuration status for debugging
console.log("[SUPABASE] Configuration check:", {
  hasUrl: !!supabaseUrl,
  hasKey: !!supabaseAnonKey,
  urlLength: supabaseUrl?.length || 0,
  keyLength: supabaseAnonKey?.length || 0,
  platform: Platform.OS,
  urlPreview: supabaseUrl ? `${supabaseUrl.substring(0, 20)}...` : "NOT SET",
  keyPreview: supabaseAnonKey ? `${supabaseAnonKey.substring(0, 20)}...` : "NOT SET",
});

if (!supabaseUrl || !supabaseAnonKey) {
  const errorMsg = 
    "⚠️ Supabase configuration missing! " +
    "Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file or app.json. " +
    "The app will not be able to fetch data from Supabase without these credentials.";
  console.error("[SUPABASE]", errorMsg);
  // Don't throw - let the app continue but log the issue clearly
}

// Create Supabase client with error handling
let supabaseClient;
try {
  supabaseClient = createClient(supabaseUrl || "", supabaseAnonKey || "", {
    auth: {
      storage: Platform.OS === "web" ? undefined : createAsyncStorageAdapter(), // Use AsyncStorage adapter for mobile session persistence
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: Platform.OS === "web", // Important for web auth redirects
      storageKey: "@esroster:supabase-auth-token", // Custom storage key for mobile
    },
  });
  console.log("[SUPABASE] Client initialized successfully with", Platform.OS === "web" ? "browser storage" : "AsyncStorage");
} catch (error) {
  console.error("[SUPABASE] Failed to initialize client:", error);
  // Create a dummy client to prevent app crashes
  supabaseClient = createClient("", "", {
    auth: {
      storage: Platform.OS === "web" ? undefined : createAsyncStorageAdapter(),
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export const supabase = supabaseClient;

