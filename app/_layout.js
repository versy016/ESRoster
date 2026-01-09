import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView, Platform, StyleSheet, View, ActivityIndicator } from "react-native";
import { UnsavedChangesProvider } from "../contexts/UnsavedChangesContext";
import { AuthProvider, useAuth } from "../contexts/AuthContext";
import { useRouter, useSegments } from "expo-router";
import { useEffect } from "react";

function RootLayoutNav() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "login";

    // Only redirect if we're actually on the wrong page
    if (!session && !inAuthGroup) {
      // Redirect to login if not authenticated and not already on login page
      router.replace("/login");
    } else if (session && inAuthGroup) {
      // Redirect to home if authenticated and on login page
      // Small delay to ensure session state is fully propagated
      const timeoutId = setTimeout(() => {
        router.replace("/");
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#ffffff" }}>
        <ActivityIndicator size="large" color="#fbbf24" />
      </View>
    );
  }

  const isWeb = Platform.OS === "web";

  return (
    <GestureHandlerRootView style={styles.container}>
      {!isWeb && (
        <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#ffffff" },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="roster" />
            <Stack.Screen name="demand" />
            <Stack.Screen name="surveyors" />
            <Stack.Screen name="profile" />
          </Stack>
        </SafeAreaView>
      )}
      {isWeb && (
        <>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: "#ffffff" },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="roster" />
            <Stack.Screen name="demand" />
            <Stack.Screen name="surveyors" />
            <Stack.Screen name="profile" />
          </Stack>
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
