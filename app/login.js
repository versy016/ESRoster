import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { useAuth } from "../contexts/AuthContext";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { signIn, signUp } = useAuth();
  const router = useRouter();

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setError("");
    setLoading(true);

    try {
      if (isSignUp) {
        await signUp(email.trim(), password, {
          name: name.trim() || email.split("@")[0],
        });
        Alert.alert(
          "Verification Email Sent",
          "We've sent a verification link to your email address. Please check your inbox (and spam folder) and click the link to activate your account.",
          [{ text: "OK" }]
        );
        setIsSignUp(false);
        setPassword("");
        setName("");
      } else {
        await signIn(email.trim(), password);
        // Don't navigate here - let _layout.js handle the redirect
        // The session state will update via onAuthStateChange, which will trigger the redirect in _layout.js
        // This ensures the session is properly set before navigation
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            <View style={styles.header}>
              <Image
                source={require("../assets/ES_Logo.png")}
                style={styles.logo}
                resizeMode="contain"
              />
              <Text style={styles.title}>
                {isSignUp ? "Create Account" : "Welcome Back"}
              </Text>
              <Text style={styles.subtitle}>
                {isSignUp
                  ? "Sign up to access ESRoster"
                  : "Sign in to continue"}
              </Text>
            </View>

            {error ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={20} color="#dc2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.form}>
              {isSignUp && (
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Name (optional)</Text>
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="Enter your name"
                    placeholderTextColor="#999999"
                    autoCapitalize="words"
                  />
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Enter your email"
                  placeholderTextColor="#999999"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  placeholderTextColor="#999999"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete={isSignUp ? "password-new" : "password"}
                />
              </View>

              <Pressable
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#000000" />
                ) : (
                  <Text style={styles.buttonText}>
                    {isSignUp ? "Sign Up" : "Sign In"}
                  </Text>
                )}
              </Pressable>

              <Pressable
                style={styles.switchButton}
                onPress={() => {
                  setIsSignUp(!isSignUp);
                  setError("");
                  setPassword("");
                }}
              >
                <Text style={styles.switchText}>
                  {isSignUp
                    ? "Already have an account? Sign In"
                    : "Don't have an account? Sign Up"}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: Platform.OS === "web" ? 24 : 20,
  },
  content: {
    maxWidth: 400,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    alignItems: "center",
    marginBottom: 32,
  },
  logo: {
    height: 80,
    width: 300,
    marginBottom: 16,
  },
  title: {
    fontSize: Platform.OS === "web" ? 28 : 24,
    fontWeight: "800",
    color: "#000000",
    marginTop: 8,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#666666",
    textAlign: "center",
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000000",
  },
  input: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 10,
    padding: Platform.OS === "web" ? 14 : 16,
    fontSize: Platform.OS === "web" ? 16 : 16,
    color: "#000000",
    backgroundColor: "#ffffff",
    minHeight: Platform.OS === "web" ? "auto" : 48, // Minimum touch target for mobile
  },
  button: {
    backgroundColor: "#fbbf24",
    borderRadius: 10,
    padding: Platform.OS === "web" ? 16 : 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    minHeight: Platform.OS === "web" ? "auto" : 48, // Minimum touch target for mobile
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000000",
  },
  switchButton: {
    padding: 12,
    alignItems: "center",
  },
  switchText: {
    fontSize: 14,
    color: "#666666",
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fee2e2",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#dc2626",
  },
  errorText: {
    flex: 1,
    color: "#dc2626",
    fontSize: 14,
  },
});
