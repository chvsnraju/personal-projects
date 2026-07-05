import React, { useEffect, useState } from "react";
import { collection, query, orderBy, getDocs, doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import type { User } from "firebase/auth";
import { db, functions } from "../firebase";
import type { DailyProduction, MonthlyBillingData, InvestmentData } from "../types";
import { Metrics } from "./Metrics";
import { Tables } from "./Tables";
import { MonthlyBilling } from "./MonthlyBilling";
import { DataManager } from "./DataManager";
import { LifetimeProduction } from "./LifetimeProduction";

interface DashboardProps {
    user: User;
    onLogout: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ user, onLogout }) => {
    const [history, setHistory] = useState<DailyProduction[]>([]);
    const [monthlyData, setMonthlyData] = useState<MonthlyBillingData[]>([]);
    const [investment, setInvestment] = useState<InvestmentData | null>(null);
    const [activeTab, setActiveTab] = useState<"daily" | "lifetime_production" | "monthly_billing" | "data_manager">("daily");
    
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastSyncLabel, setLastSyncLabel] = useState("");

    const fetchHistory = async () => {
        try {
            console.log("Fetching production history from Firestore...");
            const q = collection(db, "daily_production");
            const querySnapshot = await getDocs(q);
            
            const data: DailyProduction[] = [];
            querySnapshot.forEach((doc) => {
                const docData = doc.data();
                data.push({
                    date: doc.id,
                    productionWh: docData.productionWh as number,
                    status: docData.status as string,
                });
            });

            // Sort descending in memory
            data.sort((a, b) => b.date.localeCompare(a.date));

            setHistory(data);
            const now = new Date();
            setLastSyncLabel(`Last loaded: ${now.toLocaleString()}  •  ${data.length} days of data`);
        } catch (err: any) {
            console.error("Error fetching history from Firestore:", err);
            setError(err.message || "Failed to load dashboard data");
        }
    };

    const fetchBillingAndInvestment = async () => {
        try {
            console.log("Fetching monthly billing records and capital variables...");
            const qBilling = query(collection(db, "monthly_billing"), orderBy("__name__", "asc"));
            const snapshotBilling = await getDocs(qBilling);
            
            const billingList: MonthlyBillingData[] = [];
            snapshotBilling.forEach((doc) => {
                billingList.push({
                    id: doc.id,
                    ...doc.data()
                } as MonthlyBillingData);
            });
            setMonthlyData(billingList);

            const docInv = await getDoc(doc(db, "configs", "investments"));
            if (docInv.exists()) {
                setInvestment(docInv.data() as InvestmentData);
            }
        } catch (err: any) {
            console.error("Error fetching billing or investments:", err);
            setError(err.message || "Failed to load billing and investment details");
        }
    };

    const loadAllData = async () => {
        setLoading(true);
        setError(null);
        await Promise.all([fetchHistory(), fetchBillingAndInvestment()]);
        setLoading(false);
    };

    const handleSync = async () => {
        setSyncing(true);
        setError(null);
        try {
            console.log("Triggering syncCloudHistory Cloud Function...");
            const syncCloud = httpsCallable<any, { success: boolean; count: number }>(functions, "syncCloudHistory");
            const result = await syncCloud();
            
            if (!result.data || !result.data.success) {
                throw new Error("Synchronization failed");
            }

            console.log(`Synced ${result.data.count} entries.`);
            await fetchHistory();
        } catch (err: any) {
            console.error("Sync function error:", err);
            alert(`Sync failed: ${err.message}`);
        } finally {
            setSyncing(false);
        }
    };

    useEffect(() => {
        if (user) {
            loadAllData();
        }
    }, [user]);

    return (
        <div className="container">
            <header>
                <div className="title-area">
                    <h1>☀️ Enphase Solar Dashboard</h1>
                    <p className="subtitle">Production history & net billing analytics • React + Firebase</p>
                </div>
                <div className="header-right">
                    <span className="user-email" style={{ marginRight: "1rem", color: "var(--text-secondary)", fontSize: "0.9rem" }}>
                        👤 {user.email}
                    </span>
                    <button className="btn-secondary" onClick={onLogout}>
                        <span>🚪</span>
                        <span>Logout</span>
                    </button>
                </div>
            </header>

            {/* Main Tabs Navigation */}
            <div className="panel" style={{ padding: "0.5rem" }}>
                <div className="tabs" style={{ borderBottom: "none" }}>
                    <button
                        className={`tab-btn ${activeTab === "daily" ? "active" : ""}`}
                        onClick={() => setActiveTab("daily")}
                    >
                        📈 Daily Production
                    </button>
                    <button
                        className={`tab-btn ${activeTab === "lifetime_production" ? "active" : ""}`}
                        onClick={() => setActiveTab("lifetime_production")}
                    >
                        📊 Lifetime Production
                    </button>
                    <button
                        className={`tab-btn ${activeTab === "monthly_billing" ? "active" : ""}`}
                        onClick={() => setActiveTab("monthly_billing")}
                    >
                        📋 Monthly Net Metering & ROI
                    </button>
                    <button
                        className={`tab-btn ${activeTab === "data_manager" ? "active" : ""}`}
                        onClick={() => setActiveTab("data_manager")}
                    >
                        ⚙️ Data Manager
                    </button>
                </div>
            </div>

            {loading ? (
                <div style={{ textAlign: "center", padding: "3rem", fontSize: "1.2rem", color: "var(--text-secondary)" }}>
                    Loading solar statistics...
                </div>
            ) : error ? (
                <div className="sync-hint" style={{ borderColor: "rgba(239, 68, 68, 0.3)", background: "rgba(239, 68, 68, 0.05)" }}>
                    <span className="hint-icon" style={{ filter: "hue-rotate(280deg)" }}>⚠️</span>
                    <h3 style={{ color: "#ef4444" }}>Error Loading Dashboard</h3>
                    <p>{error}</p>
                    <button className="btn-secondary" style={{ marginTop: "1rem" }} onClick={loadAllData}>
                        Retry
                    </button>
                </div>
            ) : (
                <>
                    {activeTab === "daily" && (
                        <>
                            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "-1rem" }}>
                                <button
                                    className="btn-primary"
                                    onClick={handleSync}
                                    disabled={syncing}
                                    style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}
                                >
                                    <span>🔄</span>
                                    <span>{syncing ? "Syncing..." : "Sync Enphase Cloud"}</span>
                                </button>
                            </div>
                            <Metrics history={history} />
                            <Tables history={history} />
                            {lastSyncLabel && <p className="last-sync">{lastSyncLabel}</p>}
                        </>
                    )}

                    {activeTab === "lifetime_production" && (
                        <LifetimeProduction history={history} investment={investment} />
                    )}

                    {activeTab === "monthly_billing" && (
                        <MonthlyBilling monthlyData={monthlyData} investment={investment} />
                    )}

                    {activeTab === "data_manager" && (
                        <DataManager
                            monthlyData={monthlyData}
                            investment={investment}
                            onRefresh={fetchBillingAndInvestment}
                        />
                    )}
                </>
            )}
        </div>
    );
};

