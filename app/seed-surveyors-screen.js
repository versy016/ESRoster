/**
 * Screen to seed surveyors into the database
 * This can be accessed from the app to populate the database
 */

import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, Alert, StyleSheet } from "react-native";
import { seedSurveyors } from "../scripts/seed-surveyors";

export default function SeedSurveyorsScreen() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);

  async function handleSeed() {
    setLoading(true);
    setResults(null);

    try {
      const seedResults = await seedSurveyors();
      setResults(seedResults);
      
      const successCount = seedResults.filter((r) => r.success).length;
      const failCount = seedResults.filter((r) => !r.success).length;
      
      Alert.alert(
        "Seeding Complete",
        `${successCount} surveyors added successfully${failCount > 0 ? `, ${failCount} failed` : ""}`
      );
    } catch (error) {
      Alert.alert("Error", error.message);
      console.error("Error seeding surveyors:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Seed Surveyors</Text>
      <Text style={styles.subtitle}>
        Add all surveyors to the database with generated avatar images
      </Text>

      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSeed}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? "Seeding..." : "Seed Surveyors"}
        </Text>
      </Pressable>

      {results && (
        <ScrollView style={styles.results}>
          <Text style={styles.resultsTitle}>Results:</Text>
          {results.map((result, idx) => (
            <View key={idx} style={styles.resultItem}>
              <Text style={[styles.resultText, result.success ? styles.success : styles.error]}>
                {result.success ? "✓" : "✗"} {result.name}
              </Text>
              {result.error && (
                <Text style={styles.errorText}>{result.error}</Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#ffffff",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#000000",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#666666",
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#fbbf24",
    padding: 16,
    borderRadius: 6,
    alignItems: "center",
    marginBottom: 24,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#000000",
    fontWeight: "600",
    fontSize: 16,
  },
  results: {
    flex: 1,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#000000",
    marginBottom: 12,
  },
  resultItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  resultText: {
    fontSize: 14,
    fontWeight: "500",
  },
  success: {
    color: "#000000",
  },
  error: {
    color: "#cc0000",
  },
  errorText: {
    fontSize: 12,
    color: "#cc0000",
    marginTop: 4,
  },
});

