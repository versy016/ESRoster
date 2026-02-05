import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView, Platform, StyleSheet, View, ActivityIndicator } from "react-native";
import { UnsavedChangesProvider } from "../contexts/UnsavedChangesContext";
import { AuthProvider, useAuth } from "../contexts/AuthContext";
import { useRouter, useSegments } from "expo-router";
import { useEffect } from "react";

function RootLayoutNav() {
  const { session, loading, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "login" || segments[0] === "setup-password";
    const currentPath = segments[0];

    // Check if user needs to set password (invited user without password)
    // Also check if we're currently on setup-password to avoid redirect loops
    const isOnSetupPassword = currentPath === "setup-password";

    // Check if password was just set (to prevent redirect loop)
    // Check localStorage with timestamp to ensure it's recent (within last 1 hour)
    let passwordJustSet = false;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const flag = localStorage.getItem('password_just_set');
      const timestamp = localStorage.getItem('password_set_timestamp');
      if (flag === 'true' && timestamp) {
        const timeDiff = Date.now() - parseInt(timestamp, 10);
        // Flag is valid for 1 hour (longer to handle session refresh delays and re-renders)
        if (timeDiff < 60 * 60 * 1000) {
          passwordJustSet = true;
          console.log("[LAYOUT] Password just set flag found (age:", Math.round(timeDiff / 1000), "seconds)");
        } else {
          // Flag expired, remove it
          localStorage.removeItem('password_just_set');
          localStorage.removeItem('password_set_timestamp');
          console.log("[LAYOUT] Password just set flag expired, removed");
        }
      }
    }

    // Get fresh user metadata - check both user_metadata and app_metadata
    const passwordSet = session?.user?.user_metadata?.password_set || session?.user?.app_metadata?.password_set;

    console.log("[LAYOUT] Password check - passwordSet:", passwordSet, "passwordJustSet:", passwordJustSet, "isOnSetupPassword:", isOnSetupPassword);

    // Only require password setup if:
    // 1. User is authenticated
    // 2. Password is not set (in metadata) AND flag is not set
    // 3. Not already on setup-password page
    // 4. Password was not just set (to prevent redirect loop)
    const needsPasswordSetup = session?.user && !passwordSet && !isOnSetupPassword && !passwordJustSet;

    // DON'T clear the flag automatically - let it expire naturally after 1 hour
    // This ensures the session has time to refresh with the updated metadata
    // The flag will be cleared when it expires or when user explicitly sets password again
    // This prevents the redirect loop when the layout re-renders

    // Check if user came from invitation (has token in URL)
    const checkInvitationRedirect = () => {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const urlParams = new URLSearchParams(window.location.search);
        const hash = window.location.hash;

        const hasToken = urlParams.has("token") ||
          urlParams.has("confirmation_token") ||
          urlParams.has("token_hash") ||
          hash.includes("access_token") ||
          hash.includes("type=invite");

        return hasToken;
      }
      return false;
    };

    // Only redirect if we're actually on the wrong page
    if (!session && !inAuthGroup) {
      // Redirect to login if not authenticated and not already on login/setup-password page
      router.replace("/login");
    } else if (session && inAuthGroup && currentPath === "login") {
      // Redirect to home if authenticated and on login page (but allow setup-password)
      // Small delay to ensure session state is fully propagated
      const timeoutId = setTimeout(() => {
        router.replace("/");
      }, 50);
      return () => clearTimeout(timeoutId);
    } else if (session && needsPasswordSetup) {
      // User is authenticated but hasn't set password - force password setup
      // Only redirect if not already on setup-password to avoid loops
      if (currentPath !== "setup-password") {
        console.log("[LAYOUT] User needs to set password, redirecting to setup-password");
        console.log("[LAYOUT] Session user metadata:", session.user.user_metadata);
        console.log("[LAYOUT] Password set:", passwordSet);
        router.replace("/setup-password");
      }
    } else if (session && !inAuthGroup && checkInvitationRedirect()) {
      // User is authenticated and has invitation token - redirect to password setup
      console.log("[LAYOUT] Detected authenticated user with invitation token, redirecting to setup-password");
      router.replace("/setup-password");
    }
  }, [session, loading, segments, router, user]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#ffffff" }}>
        <ActivityIndicator size="large" color="#fbbf24" />
      </View>
    );
  }

  const isWeb = Platform.OS === "web";
  const screenOptions = {
    headerShown: false,
    contentStyle: { backgroundColor: "#ffffff" },
  };

  const stackScreens = (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="login" />
      <Stack.Screen name="setup-password" />
      <Stack.Screen name="roster" />
      <Stack.Screen name="demand" />
      <Stack.Screen name="surveyors" />
      <Stack.Screen name="profile" />
    </Stack>
  );

  return (
    <GestureHandlerRootView style={styles.container}>
      {!isWeb ? (
        <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
          <StatusBar style="dark" />
          {stackScreens}
        </SafeAreaView>
      ) : (
        <>
          <StatusBar style="dark" />
          {stackScreens}
        </>
      )}
    </GestureHandlerRootView>
  );
}

export default function Layout() {
  return (
    <AuthProvider>
      <UnsavedChangesProvider>
        <RootLayoutNav />
      </UnsavedChangesProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
});
