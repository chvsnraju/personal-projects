import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

// Fallback configuration for local emulator development
const devConfig = {
  apiKey: "demo-key",
  authDomain: "demo-enphase-solar.firebaseapp.com",
  projectId: "demo-enphase-solar",
  storageBucket: "demo-enphase-solar.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || devConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || devConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || devConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || devConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || devConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || devConfig.appId,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app, "enphase-solar");
const functions = getFunctions(app);

// Connect to Emulators if we are running in Vite dev mode or local hostname
if (import.meta.env.DEV || window.location.hostname === "localhost") {
  console.log("Local development/localhost detected. Connecting to Firebase Emulators...");
  
  // These ports must match firebase.json config
  connectAuthEmulator(auth, "http://localhost:9099");
  connectFirestoreEmulator(db, "localhost", 8089);
  connectFunctionsEmulator(functions, "localhost", 5001);
}

export { app, auth, db, functions };
