import React, { useState } from "react";
import type { DailyProduction } from "../types";

interface TablesProps {
    history: DailyProduction[];
}

const MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

export const Tables: React.FC<TablesProps> = ({ history }) => {
    const [activeTab, setActiveTab] = useState<"daily" | "monthly">("daily");

    // ── Daily Data Parsing ──
    const sortedDaily = [...history].sort((a, b) => b.date.localeCompare(a.date));

    // ── Monthly Aggregations ──
    // Seed with historical data (Nov 2025 - Mar 2026) as in the original project
    const monthlyTotals: Record<string, number> = {
        "2025-11": 330000,
        "2025-12": 550000,
        "2026-01": 700000,
        "2026-02": 1050000,
        "2026-03": 1210000,
    };

    const monthlyDays: Record<string, number> = {
        "2025-11": 30,
        "2025-12": 31,
        "2026-01": 31,
        "2026-02": 28,
        "2026-03": 31,
    };

    // Aggregate from PostgreSQL history
    history.forEach((entry) => {
        if (entry.date && entry.date.length >= 7) {
            const monthKey = entry.date.substring(0, 7); // e.g. "2026-06"
            if (monthKey >= "2026-04") {
                monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + (entry.productionWh || 0);
                monthlyDays[monthKey] = (monthlyDays[monthKey] || 0) + 1;
            }
        }
    });

    const sortedMonthsKeys = Object.keys(monthlyTotals).sort((a, b) => b.localeCompare(a));

    return (
        <div className="panel">
            <div className="tab-header-container">
                <div className="tabs">
                    <button
                        className={`tab-btn ${activeTab === "daily" ? "active" : ""}`}
                        onClick={() => setActiveTab("daily")}
                    >
                        Daily History
                    </button>
                    <button
                        className={`tab-btn ${activeTab === "monthly" ? "active" : ""}`}
                        onClick={() => setActiveTab("monthly")}
                    >
                        Monthly Totals
                    </button>
                </div>
                <span className="badge">System Lifetime</span>
            </div>

            {/* Daily History Tab */}
            {activeTab === "daily" && (
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Daily Production</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedDaily.map((entry) => {
                                const isVerified = entry.status === "Verified";
                                return (
                                    <tr key={entry.date}>
                                        <td className="text-bold">{entry.date}</td>
                                        <td className="text-solar">{(entry.productionWh / 1000).toFixed(2)} kWh</td>
                                        <td>
                                            <span className={`status-badge ${isVerified ? "status-verified" : "status-historical"}`}>
                                                {entry.status}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Monthly Totals Tab */}
            {activeTab === "monthly" && (
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Month</th>
                                <th>Total Generation</th>
                                <th>Days</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedMonthsKeys.map((key) => {
                                const totalWh = monthlyTotals[key];
                                const days = monthlyDays[key];
                                const [yr, mo] = key.split("-");
                                const label = `${MONTH_NAMES[parseInt(mo, 10)]} ${yr}`;
                                const isHistorical = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"].includes(key);

                                return (
                                    <tr key={key}>
                                        <td className="text-bold">{label}</td>
                                        <td className="text-solar">
                                            {isHistorical
                                                ? (totalWh / 1000).toFixed(0)
                                                : (totalWh / 1000).toFixed(2)}{" "}
                                            kWh
                                        </td>
                                        <td>
                                            <span className={`status-badge ${isHistorical ? "status-historical" : "status-monthly"}`}>
                                                {isHistorical ? "Self (Actual)" : `${days} days`}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
