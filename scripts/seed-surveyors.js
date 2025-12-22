/**
 * Script to seed surveyors into the Supabase database
 * Run this from the app or use it as a reference for SQL
 */

import { createSurveyor, bulkCreateSurveyors } from "../lib/db.js";

// Surveyor data with emails and photo URLs
const surveyors = [
  { name: "Barry McDonald", email: "barry.mcdonald@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/0nxyj07q65g1.jpg" },
  { name: "Bradley Gosling", email: "bradley.gosling@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/p8j70vxm6w4e.jpg" },
  { name: "Cameron Steer", email: "csteer@engsurveys.com.au", photoUrl: null }, // No image yet
  { name: "Changyi Tang", email: "changyi.tang@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/regl9kwv9moy.jpg" },
  { name: "Chen Bai", email: "chen.bai@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/m4pz9ey108gn.jpg" },
  { name: "Daniel Corcoran", email: "daniel.corcoran@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/k2v3jkp6891m.jpg" },
  { name: "Dario Rigon", email: "dario.rigon@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/zpr1840rqng2.jpg" },
  { name: "Darren Cross", email: "darren.cross@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/x324qx18repd.jpg" },
  { name: "David Topfer", email: "david.topfer@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/3kyw0lx0o4de.jpg" },
  { name: "Ethan Spinks", email: "ethan.spinks@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/84zo6jdy6wxy.jpg" },
  { name: "Justin Scott", email: "justin.scott@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/0nxyj0e7865g.jpg" },
  { name: "Kat Bergin", email: "kathryn.bergin@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/2g1l63nw9j3q.jpg" },
  { name: "Luke Shawcross", email: "luke.shawcross@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/r4ne9xqx035w.jpg" },
  { name: "Mark Ainsworth", email: "mark.ainsworth@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/ymxoqdxj4n67.jpg" },
  { name: "Matthew Gooding", email: "matthew.gooding@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/48yz9p2m6ev7.jpg" },
  { name: "Michael Templer", email: "michael.templer@engsurveys.com.au", photoUrl: "https://ese.engsurveys.com.au/profiles/vxz2qemj1ge3.jpg" },
  { name: "Yasar Chitthiwala", email: "yasar.chitthiwala@engsurveys.com.au", photoUrl: null }, // No image yet
];

/**
 * Generate avatar URL from name using UI Avatars service
 */
function generateAvatarUrl(name) {
  const encodedName = encodeURIComponent(name);
  return `https://ui-avatars.com/api/?name=${encodedName}&size=200&background=fbbf24&color=000000&bold=true&format=png`;
}

/**
 * Seed surveyors into the database
 */
export async function seedSurveyors() {
  // Prepare surveyors with photo URLs (use provided URL or generate avatar)
  const surveyorsToInsert = surveyors.map(surveyor => ({
    name: surveyor.name,
    photoUrl: surveyor.photoUrl || generateAvatarUrl(surveyor.name),
    email: surveyor.email,
    active: true,
  }));

  // Try bulk insert first (faster)
  const bulkResult = await bulkCreateSurveyors(surveyorsToInsert);
  
  if (bulkResult.success) {
    console.log(`✓ Bulk inserted ${bulkResult.data.length} surveyors`);
    return bulkResult.data.map((s, idx) => ({
      success: true,
      name: surveyors[idx].name,
      id: s.id,
    }));
  }

  // Fall back to individual inserts if bulk fails
  console.log("Bulk insert failed, trying individual inserts...");
  const results = [];
  
  for (const surveyor of surveyorsToInsert) {
    const result = await createSurveyor(surveyor);
    
    if (result.success) {
      results.push({ success: true, name: surveyor.name, id: result.data.id });
      console.log(`✓ Added: ${surveyor.name}`);
    } else {
      results.push({ success: false, name: surveyor.name, error: result.error });
      console.error(`✗ Failed: ${surveyor.name} - ${result.error}`);
    }
  }
  
  return results;
}

// If running directly (not imported)
if (typeof window === "undefined" && require.main === module) {
  seedSurveyors()
    .then((results) => {
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;
      console.log(`\nCompleted: ${successCount} succeeded, ${failCount} failed`);
    })
    .catch((error) => {
      console.error("Error seeding surveyors:", error);
    });
}

