import { createContext, useContext, useEffect, useState } from "react"
import { supabase } from "../lib/supabaseClient"

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const getInitialSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (!isMounted) return

        if (error) {
          console.error("Error getting session:", error)
        }

        setSession(data.session ?? null)
        setUser(data.session?.user ?? null)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    getInitialSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return

      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async ({ email, password }) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    return { data, error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  /**
   * Re-verify the signed-in user's password by re-authenticating against
   * Supabase. Used to confirm sensitive actions (e.g. disconnecting the
   * WhatsApp account). A wrong password returns an error and does NOT sign the
   * user out; a correct one refreshes the session (fires SIGNED_IN).
   *
   * @param {string} password
   * @returns {Promise<{error: import("@supabase/supabase-js").AuthError | Error | null}>}
   */
  const verifyPassword = async (password) => {
    if (!user?.email) return { error: new Error("No signed-in account.") }
    const { error } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    })
    return { error }
  }

  const value = {
    session,
    user,
    loading,
    signIn,
    signOut,
    verifyPassword,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
