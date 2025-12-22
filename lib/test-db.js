/**
 * Test database connection and query
 * Run this to debug Supabase connection issues
 */

import { supabase } from "./supabase";
import * as db from "./db";

export async function testDatabaseConnection() {
  console.log("=== Testing Database Connection ===");
  
  // Test 1: Check Supabase client
  console.log("\n1. Checking Supabase client...");
  console.log("Supabase URL:", supabase.supabaseUrl ? "Set" : "NOT SET");
  console.log("Supabase Key:", supabase.supabaseKey ? "Set" : "NOT SET");
  
  // Test 2: Try a simple query
  console.log("\n2. Testing basic query...");
  const { data: testData, error: testError } = await supabase
    .from("surveyors")
    .select("count", { count: "exact", head: true });
  
  console.log("Count query result:", { data: testData, error: testError?.message });
  
  // Test 3: Try to get all surveyors
  console.log("\n3. Testing getSurveyors function...");
  const result = await db.getSurveyors();
  console.log("getSurveyors result:", result);
  
  // Test 4: Check if table exists
  console.log("\n4. Checking table structure...");
  const { data: tableData, error: tableError } = await supabase
    .from("surveyors")
    .select("id, name, photo_url, active")
    .limit(1);
  
  console.log("Table structure test:", { 
    hasData: !!tableData, 
    dataLength: tableData?.length,
    error: tableError?.message 
  });
  
  if (tableData && tableData.length > 0) {
    console.log("Sample row:", tableData[0]);
  }
  
  return {
    clientConfigured: !!supabase.supabaseUrl,
    queryWorks: !testError,
    surveyorsCount: result.success ? result.data?.length : 0,
    tableAccessible: !tableError,
  };
}

// If running in browser console
if (typeof window !== "undefined") {
  window.testDatabase = testDatabaseConnection;
}

