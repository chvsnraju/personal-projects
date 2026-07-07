import { useState, useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { auth } from "./firebase";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Monitor Firebase Auth state changes
  useEffect(() => {
    console.log("App mounted, listening to auth state changes...");
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Error signing out from Firebase Auth:", err);
    }
  };

  if (loading) {
    return (
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: "var(--bg-color, #f8fafc)",
        color: "var(--text-primary, #0f172a)",
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        zIndex: 99999
      }}>
        <div style={{
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          border: "3px solid rgba(234, 88, 12, 0.1)",
          borderTopColor: "var(--color-solar, #ea580c)",
          animation: "spinAppLoader 0.8s linear infinite",
          marginBottom: "1.25rem"
        }} />
        <style>{`
          @keyframes spinAppLoader {
            to { transform: rotate(360deg); }
          }
        `}</style>
        <span style={{ fontSize: "1.05rem", fontWeight: 500, letterSpacing: "-0.01em" }}>
          Loading Solar Dashboard...
        </span>
      </div>
    );
  }

  return (
    <>
      {user ? (
        <Dashboard user={user} onLogout={handleLogout} />
      ) : (
        <Login />
      )}
    </>
  );
}

export default App;
