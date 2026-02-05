/**
 * Authentication Context for managing user sessions
 */

import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { validateEmailDomain } from "../lib/email-domain-validation";
import { autoLinkUserToSurveyorByEmail } from "../lib/db";

const AuthContext = createContext({
  session: null,
  user: null,
  role: null,
  loading: true,
  signIn: async () => { },
  signUp: async () => { },
  signOut: async () => { },
  refreshRole: async () => { },
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let timeoutId;

    // Add timeout to prevent infinite loading
    timeoutId = setTimeout(() => {
      if (isMounted && loading) {
        console.warn("[AUTH] Session load timeout - proceeding anyway");
        setLoading(false);
      }
    }, 10000); // 10 second timeout

    // Get initial session and load role
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (!isMounted) return;

      clearTimeout(timeoutId);

      if (error) {
        console.error("[AUTH] Error getting session:", error);
        setLoading(false);
        return;
      }

      console.log("[AUTH] Initial session:", session ? "Found" : "None");
      setSession(session);
      setUser(session?.user ?? null);

      // Load user role from surveyors table
      if (session?.user) {
        console.log("[AUTH] Loading role for user:", session.user.id);
        try {
          await loadUserRole(session.user.id);
        } catch (roleError) {
          console.error("[AUTH] Error loading role:", roleError);
          setRole("surveyor"); // Default role on error
        }
      } else {
        console.log("[AUTH] No user session - user not authenticated");
        setRole(null);
      }

      setLoading(false);
    }).catch((error) => {
      if (!isMounted) return;
      clearTimeout(timeoutId);
      console.error("[AUTH] Exception getting session:", error);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      console.log("[AUTH] Auth state changed:", event, session?.user?.email);

      // Handle invitation acceptance - user needs to set password
      if (event === 'SIGNED_IN' && session?.user) {
        // Check if user needs to set password (invited user)
        // Invited users don't have password_updated_at in their metadata initially
        const needsPasswordSetup = !session.user.user_metadata?.password_set;

        if (needsPasswordSetup) {
          console.log("[AUTH] User signed in but needs to set password");
          // Store flag that user needs password setup
          // This will be checked in _layout.js to redirect to setup-password
        } else {
          // User has password set, try to auto-link to surveyor if not already linked
          if (session.user.id && session.user.email) {
            try {
              // Check if user is already linked
              const { data: surveyorCheck } = await supabase
                .from("surveyors")
                .select("id, user_id")
                .eq("user_id", session.user.id)
                .maybeSingle();

              if (!surveyorCheck) {
                // User not linked, try auto-link
                console.log("[AUTH] User not linked to surveyor, attempting auto-link after password setup");
                const linkResult = await autoLinkUserToSurveyorByEmail(session.user.id, session.user.email);

                if (linkResult.success) {
                  console.log("[AUTH] Successfully auto-linked user to surveyor:", linkResult.surveyorId);
                  // Reload role after linking
                  await loadUserRole(session.user.id);
                } else {
                  console.log("[AUTH] Auto-link failed (user may not have matching surveyor record):", linkResult.error);
                }
              } else {
                // User already linked, just load role
                await loadUserRole(session.user.id);
              }
            } catch (linkError) {
              console.warn("[AUTH] Error during auto-link:", linkError);
              // Still load role even if auto-link fails
              await loadUserRole(session.user.id);
            }
          }
        }
      }

      setSession(session);
      setUser(session?.user ?? null);

      // Load user role from surveyors table
      if (session?.user) {
        try {
          await loadUserRole(session.user.id);
        } catch (roleError) {
          console.error("[AUTH] Error loading role in auth change:", roleError);
          setRole("surveyor"); // Default role on error
        }
      } else {
        setRole(null);
      }

      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadUserRole = async (userId) => {
    try {
      // Load role from surveyors table where user_id matches
      const { data, error } = await supabase
        .from("surveyors")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle(); // Use maybeSingle() since user might not be linked to a surveyor yet

      if (error) {
        // Check if it's a column doesn't exist error (migration hasn't been run)
        if (error.code === "42703" || error.message?.includes("column") || error.message?.includes("does not exist")) {
          console.warn("Role column not found in surveyors table. Please run the database migration (database/add-roles-and-user-linking.sql) to enable roles. Defaulting to 'surveyor' role.");
        } else {
          console.error("Error loading user role:", error);
        }
        setRole("surveyor"); // Default role
      } else {
        setRole(data?.role || "surveyor");
      }
    } catch (error) {
      // Check if it's a column doesn't exist error
      if (error.message?.includes("column") || error.message?.includes("does not exist")) {
        console.warn("Role column not found in surveyors table. Please run the database migration (database/add-roles-and-user-linking.sql) to enable roles. Defaulting to 'surveyor' role.");
      } else {
        console.error("Error loading user role:", error);
      }
      setRole("surveyor"); // Default role
    }
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;

    // Immediately update session state (onAuthStateChange will also fire, but this ensures it's set right away)
    if (data?.session) {
      setSession(data.session);
      setUser(data.user ?? null);

      // Try to auto-link user to surveyor if not already linked
      if (data.user?.id && data.user?.email) {
        try {
          // Check if user is already linked by trying to load role
          await loadUserRole(data.user.id);

          // If role is null or default, try auto-linking
          // (This handles cases where user signed up before auto-link was implemented)
          const { data: surveyorCheck } = await supabase
            .from("surveyors")
            .select("id, user_id")
            .eq("user_id", data.user.id)
            .maybeSingle();

          if (!surveyorCheck) {
            // User not linked, try auto-link
            console.log("[AUTH] User not linked to surveyor, attempting auto-link on signin");
            const linkResult = await autoLinkUserToSurveyorByEmail(data.user.id, data.user.email);

            if (linkResult.success) {
              console.log("[AUTH] Successfully auto-linked user to surveyor on signin:", linkResult.surveyorId);
              // Reload role after linking
              await loadUserRole(data.user.id);
            }
          }
        } catch (linkError) {
          // Log but don't fail signin if auto-link errors
          console.warn("[AUTH] Error during auto-link on signin (signin still successful):", linkError);
        }
      }

      setLoading(false);
    }

    return data;
  };

  const signUp = async (email, password, metadata = {}) => {
    // Validate email domain before attempting signup
    const validation = await validateEmailDomain(email);
    if (!validation.valid) {
      const error = new Error(validation.error);
      error.name = 'EmailDomainError';
      throw error;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    });
    if (error) throw error;

    // Automatically link user to surveyor if email matches
    if (data?.user?.id && data?.user?.email) {
      try {
        console.log("[AUTH] Attempting to auto-link user to surveyor by email");
        const linkResult = await autoLinkUserToSurveyorByEmail(data.user.id, data.user.email);

        if (linkResult.success) {
          console.log("[AUTH] Successfully auto-linked user to surveyor:", linkResult.surveyorId);
          // Reload role after linking
          await loadUserRole(data.user.id);
        } else {
          // Log but don't fail signup if auto-link fails
          console.log("[AUTH] Auto-link failed (user may not have matching surveyor record):", linkResult.error);
        }
      } catch (linkError) {
        // Log but don't fail signup if auto-link errors
        console.warn("[AUTH] Error during auto-link (signup still successful):", linkError);
      }
    }

    return data;
  };

  const signOut = async () => {
    try {
      // Only try to sign out if there's an active session
      const currentSession = await supabase.auth.getSession();
      if (currentSession.data?.session) {
        const { error } = await supabase.auth.signOut();
        if (error) {
          // If signOut fails, still clear local state
          console.warn("[AUTH] Sign out error (continuing anyway):", error);
        }
      }
    } catch (error) {
      // If there's no session or signOut fails, continue anyway
      // This can happen if the session is already cleared or expired
      console.warn("[AUTH] Sign out error (continuing anyway):", error);
    } finally {
      // Always clear session state, regardless of signOut success/failure
      setSession(null);
      setUser(null);
      setRole(null);
    }
  };

  // Expose refreshRole function to allow manual role refresh
  const refreshRole = async () => {
    if (user?.id) {
      await loadUserRole(user.id);
    }
  };

  const value = {
    session,
    user,
    role,
    loading,
    signIn,
    signUp,
    signOut,
    refreshRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
