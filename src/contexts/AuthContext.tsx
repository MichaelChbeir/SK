import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Person } from '../lib/types';

interface AuthContextValue {
  session: Session | null;
  person: Person | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshPerson: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadPerson(email: string) {
    const { data } = await supabase
      .from('people')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    setPerson(data ?? null);
  }

  async function refreshPerson() {
    if (session?.user?.email) {
      await loadPerson(session.user.email);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user?.email) {
        loadPerson(s.user.email).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setSession(s);
      (async () => {
        if (s?.user?.email) {
          await loadPerson(s.user.email);
        } else {
          setPerson(null);
        }
      })();
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string): Promise<string | null> {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (!signInError) return null;

    if (signInError.message.includes('Invalid login credentials')) {
      const { data: personData } = await supabase
        .from('people')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (!personData) {
        return 'No account found for this email. Contact your admin.';
      }

      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) return signUpError.message;
      return null;
    }

    return signInError.message;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setPerson(null);
    setSession(null);
  }

  return (
    <AuthContext.Provider value={{ session, person, loading, signIn, signOut, refreshPerson }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
