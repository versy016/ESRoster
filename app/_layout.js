import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView, Platform, StyleSheet } from "react-native";
import { UnsavedChangesProvider } from "../contexts/UnsavedChangesContext";

export default function Layout() {
  const isWeb = Platform.OS === "web";

  return (
    <UnsavedChangesProvider>
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
            <Stack.Screen name="roster" />
            <Stack.Screen name="demand" />
            <Stack.Screen name="surveyors" />
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
            <Stack.Screen name="roster" />
            <Stack.Screen name="demand" />
            <Stack.Screen name="surveyors" />
          </Stack>
        </>
      )}
    </GestureHandlerRootView>
    </UnsavedChangesProvider>
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
