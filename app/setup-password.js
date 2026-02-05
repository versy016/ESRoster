/**
 * Password Setup Screen for Invited Users
 * 
 * When a user is invited, they need to set their password before they can log in.
 * This screen handles the password setup flow.
 */

import React, { useState, useEffect } from "react";
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
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";

export default function SetupPasswordScreen() {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);
    const router = useRouter();
    const params = useLocalSearchParams();

    // Note: The invitation email's ConfirmationURL already confirms the account and logs the user in
    // We just need to set the password for the authenticated user

    useEffect(() => {
        // Check if user is authenticated (from invitation ConfirmationURL)
        const checkSession = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();

                if (session?.user) {
                    // User is authenticated from invitation link, they can set password
                    console.log("[SETUP PASSWORD] User is authenticated, can set password");
                    setCheckingSession(false);
                } else {
                    // No session - user needs to click invitation link first
                    console.log("[SETUP PASSWORD] No session found - user needs to use invitation link");
                    setCheckingSession(false);
                }
            } catch (err) {
                console.error("[SETUP PASSWORD] Error checking session:", err);
                setCheckingSession(false);
            }
        };

        checkSession();
    }, []);

    const handleSetupPassword = async () => {
        // Validation
        if (!password.trim()) {
            setError("Password is required");
            return;
        }

        if (password.length < 6) {
            setError("Password must be at least 6 characters");
            return;
        }

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        setError("");
        setLoading(true);

        try {
            // Check if user is authenticated (from invitation ConfirmationURL)
            const { data: { session } } = await supabase.auth.getSession();

            if (!session?.user) {
                throw new Error("You must be logged in to set your password. Please click the invitation link from your email first.");
            }

            // User is authenticated from invitation link, just set the password
            console.log("[SETUP PASSWORD] Setting password for authenticated user:", session.user.email);

            const { error: updateError } = await supabase.auth.updateUser({
                password: password.trim(),
                data: {
                    password_set: true, // Mark that password has been set
                },
            });

            if (updateError) {
                throw updateError;
            }

            console.log("[SETUP PASSWORD] Password set successfully");

            // Store flag that password was just set to prevent redirect loop
            if (Platform.OS === "web" && typeof window !== "undefined") {
                localStorage.setItem('password_just_set', 'true');
                localStorage.setItem('password_set_timestamp', Date.now().toString());
            }

            setSuccess(true);

            // Redirect after a short delay
            setTimeout(() => {
                if (Platform.OS === "web" && typeof window !== "undefined") {
                    // Clear URL parameters
                    window.history.replaceState({}, '', '/');
                }
                router.replace("/");
            }, 1500);
        } catch (err) {
            console.error("[SETUP PASSWORD] Error:", err);
            setError(err.message || "Failed to set password. The invitation link may have expired. Please request a new invitation.");
        } finally {
            setLoading(false);
        }
    };

    if (checkingSession) {
        return (
            <View style={styles.container}>
                <View style={styles.successContainer}>
                    <ActivityIndicator size="large" color="#fbbf24" />
                    <Text style={[styles.successText, { marginTop: 16 }]}>
                        Verifying invitation...
                    </Text>
                </View>
            </View>
        );
    }

    if (success) {
        return (
            <View style={styles.container}>
                <View style={styles.successContainer}>
                    <View style={styles.successIconContainer}>
                        <Ionicons name="checkmark-circle" size={64} color="#22c55e" />
                    </View>
                    <Text style={styles.successTitle}>Password Set Successfully!</Text>
                    <Text style={styles.successText}>
                        Your account is now active. Redirecting you to ES Roster...
                    </Text>
                </View>
            </View>
        );
    }

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
                            <Text style={styles.title}>Set Your Password</Text>
                            <Text style={styles.subtitle}>
                                You've been invited to ES Roster. Please set a password to complete your account setup.
                            </Text>
                        </View>

                        {error ? (
                            <View style={styles.errorContainer}>
                                <Ionicons name="alert-circle" size={20} color="#dc2626" />
                                <Text style={styles.errorText}>{error}</Text>
                            </View>
                        ) : null}

                        <View style={styles.form}>
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
                                    autoComplete="password-new"
                                />
                                <Text style={styles.helperText}>
                                    Must be at least 6 characters
                                </Text>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Confirm Password</Text>
                                <TextInput
                                    style={styles.input}
                                    value={confirmPassword}
                                    onChangeText={setConfirmPassword}
                                    placeholder="Confirm your password"
                                    placeholderTextColor="#999999"
                                    secureTextEntry
                                    autoCapitalize="none"
                                    autoComplete="password-new"
                                />
                            </View>

                            <Pressable
                                style={[styles.button, loading && styles.buttonDisabled]}
                                onPress={handleSetupPassword}
                                disabled={loading}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#000000" />
                                ) : (
                                    <Text style={styles.buttonText}>Set Password</Text>
                                )}
                            </Pressable>

                            <Pressable
                                style={styles.switchButton}
                                onPress={() => router.replace("/login")}
                            >
                                <Text style={styles.switchText}>
                                    Already have a password? Sign In
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
        minHeight: Platform.OS === "web" ? "auto" : 48,
    },
    helperText: {
        fontSize: 12,
        color: "#666666",
        marginTop: 4,
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
        minHeight: Platform.OS === "web" ? "auto" : 48,
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
    successContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 40,
    },
    successIconContainer: {
        marginBottom: 24,
    },
    successTitle: {
        fontSize: 24,
        fontWeight: "700",
        color: "#000000",
        marginBottom: 12,
        textAlign: "center",
    },
    successText: {
        fontSize: 16,
        color: "#666666",
        textAlign: "center",
        lineHeight: 24,
    },
});

