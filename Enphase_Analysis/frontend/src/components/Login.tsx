import React, { useState } from "react";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "../firebase";

interface LoginProps {}

export const Login: React.FC<LoginProps> = () => {
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleGoogleSignIn = async () => {
        setError(null);
        setLoading(true);
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
        } catch (err: any) {
            console.error("Google Sign-In Error:", err);
            setError(err.message || "Failed to sign in with Google. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-wrapper">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo">☀️</div>
                    <h2 className="login-title">Solar Dashboard</h2>
                    <p className="login-subtitle">Sign in to view enphase metrics (Firebase)</p>
                </div>

                <div className="login-form">
                    {error && <div className="login-error" style={{ marginBottom: "1.5rem" }}>{error}</div>}

                    <button
                        onClick={handleGoogleSignIn}
                        className="btn-primary login-btn"
                        disabled={loading}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "10px",
                            width: "100%",
                            padding: "12px",
                            fontSize: "1rem",
                            cursor: "pointer"
                        }}
                    >
                        <span>🔑</span>
                        <span>{loading ? "Signing in..." : "Sign In with Google"}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
