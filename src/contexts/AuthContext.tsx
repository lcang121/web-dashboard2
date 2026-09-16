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

/**
 * Firebase reports any address containing ASCII whitespace as
 * `auth/invalid-email` ("The email address is badly formatted"), which is what
 * a copy-paste out of a spreadsheet or a chat message routinely produces. The
 * device normalises the same way before signing in (see `signIn` in
 * mod_temp_bir/auth/index.ts), so the two stay in step.
 *
 * Invisible characters are stripped too, but for a different reason: Firebase
 * accepts them as *valid* and then reports EMAIL_NOT_FOUND, so an address
 * carrying a zero-width space fails as "no such user" and gives the person no
 * clue why an address they can read plainly does not work.
 */
const normalizeEmail = (raw: string): string =>
  raw
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim()
    .toLowerCase();

/** Firebase's own messages put an error code in front of the user. Say it plainly. */
const describeAuthError = (err: unknown): string => {
  switch ((err as { code?: string })?.code) {
    case 'auth/invalid-email':
      return 'That does not look like an email address. Check for a typo or a stray space.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/user-disabled':
      return 'That account has been disabled.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Could not reach Firebase. Check your connection and try again.';
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid-please-pass-a-valid-api-key':
      return 'Firebase is not configured for this build. The VITE_FIREBASE_* variables are missing.';
    default:
      return err instanceof Error ? err.message : 'Sign in failed';
  }
};

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

      const normalizedEmail = normalizeEmail(email);

      // Support test account like React Native does
      const actualPassword =
        normalizedEmail === 'biraccred_test@utak.io' && password === 'birmasterkey'
          ? 'password'
          : password;

      const userCredential = await signInWithEmailAndPassword(auth, normalizedEmail, actualPassword);
      const firebaseUser = userCredential.user;

      const apexUser: ApexUser = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
      };

      setUser(apexUser);
      localStorage.setItem('@webdashboard:user', JSON.stringify(apexUser));

      return apexUser;
    } catch (err) {
      const errorMessage = describeAuthError(err);
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
