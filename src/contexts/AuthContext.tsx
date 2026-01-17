import React, { createContext, useContext, useEffect, useState } from 'react';
import { signInWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../config/firebase';

export interface ApexUser {
  uid: string;
  email: string;
}

interface AuthContextType {
  user: ApexUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<ApexUser>;
  signOut: () => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<ApexUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check if user is already logged in on mount
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        const apexUser: ApexUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
        };
        setUser(apexUser);
        // Store in localStorage for persistence
        localStorage.setItem('@webdashboard:user', JSON.stringify(apexUser));
      } else {
        setUser(null);
        localStorage.removeItem('@webdashboard:user');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<ApexUser> => {
    try {
      setError(null);
      setLoading(true);

      // Support test account like React Native does
      const actualPassword =
        email === 'biraccred_test@utak.io' && password === 'birmasterkey'
          ? 'password'
          : password;

      const userCredential = await signInWithEmailAndPassword(auth, email, actualPassword);
      const firebaseUser = userCredential.user;

      const apexUser: ApexUser = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
      };

      setUser(apexUser);
      localStorage.setItem('@webdashboard:user', JSON.stringify(apexUser));

      return apexUser;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sign in failed';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async (): Promise<void> => {
    try {
      setError(null);
      await firebaseSignOut(auth);
      setUser(null);
      localStorage.removeItem('@webdashboard:user');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sign out failed';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  const value: AuthContextType = {
    user,
    loading,
    signIn,
    signOut,
    error,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
