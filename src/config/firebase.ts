import { initializeApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getDatabase, Database } from 'firebase/database';

const getRequiredEnv = (name: string): string => {
  const env = (import.meta as ImportMeta & {
    env: Record<string, string | undefined>;
  }).env;
  const value = env[name];

  if (!value) {
    throw new Error(`Missing required Firebase environment variable: ${name}`);
  }

  return value;
};

// Firebase configuration is supplied through Vercel or a local .env file.
const firebaseConfig = {
  apiKey: getRequiredEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getRequiredEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  databaseURL: getRequiredEnv('VITE_FIREBASE_DATABASE_URL'),
  projectId: getRequiredEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getRequiredEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getRequiredEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getRequiredEnv('VITE_FIREBASE_APP_ID'),
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Get Firebase services
export const auth: Auth = getAuth(app);
export const database: Database = getDatabase(app);

export default app;
