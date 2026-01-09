/**
 * Authentication Context for managing user sessions
 */

import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext({
  session: null,
  user: null,
  role: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  refreshRole: async () => {},
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
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!isMounted) return;
      
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
      // Load role if user is linked to a surveyor
      if (data.user?.id) {
        await loadUserRole(data.user.id);
      }
      setLoading(false);
    }
    
    return data;
  };

  const signUp = async (email, password, metadata = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    });
    if (error) throw error;
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
