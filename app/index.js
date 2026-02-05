import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";

export default function Home() {
  const router = useRouter();
  const [shouldRedirect, setShouldRedirect] = useState(false);
  const [redirectTo, setRedirectTo] = useState("/roster");

  useEffect(() => {
    // Check if user came from an invitation link (has token in URL)
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const hash = window.location.hash;
      
      // Check for invitation tokens in URL params or hash
      const hasToken = urlParams.has("token") || 
                       urlParams.has("confirmation_token") || 
                       urlParams.has("token_hash") ||
                       hash.includes("access_token") ||
                       hash.includes("type=invite");
      
      if (hasToken) {
        // User came from invitation, redirect to password setup
        console.log("[HOME] Detected invitation token, redirecting to setup-password");
        setRedirectTo("/setup-password");
      }
      
      setShouldRedirect(true);
    } else {
      // For non-web platforms, just redirect to roster
      setShouldRedirect(true);
    }
  }, []);

  if (!shouldRedirect) {
    return null; // Wait for check to complete
  }

  // Redirect to appropriate screen
  return <Redirect href={redirectTo} />;
}
