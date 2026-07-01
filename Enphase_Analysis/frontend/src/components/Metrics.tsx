import React from "react";
import type { DailyProduction } from "../types";

interface MetricsProps {
    history: DailyProduction[];
}

export const Metrics: React.FC<MetricsProps> = ({ history }) => {
    if (history.length === 0) {
        return null;
    }

    // Sort history by date descending
    const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
    const lastEntry = sorted[0];

    // Compute production statistics
    const historicalWh = 3840000; // Nov 2025 - Mar 2026 totals from original setup
    const databaseWh = history.reduce((acc, curr) => acc + (curr.productionWh || 0), 0);
    const lifetimeWh = databaseWh + historicalWh;

    const lastRecordedKwh = (lastEntry.productionWh / 1000).toFixed(2);
    const lastRecordedDate = lastEntry.date;

    const lifetimeKwhStr = (lifetimeWh / 1000).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    
    const lifetimeMwhStr = `${(lifetimeWh / 1000000).toFixed(3)} MWh`;

    return (
        <div className="grid-metrics">
            <div className="card">
                <div className="card-header">
                    <span className="card-title">Last Recorded Day</span>
                    <span className="card-icon">☀️</span>
                </div>
                <div className="card-value">
                    <span>{lastRecordedKwh}</span> <span className="card-unit">kWh</span>
                </div>
                <div className="card-footer">
                    <span>Date</span>
                    <span className="card-footer-val">{lastRecordedDate}</span>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <span className="card-title">Lifetime Generation</span>
                    <span className="card-icon">📈</span>
                </div>
                <div className="card-value">
                    <span>{lifetimeKwhStr}</span> <span className="card-unit">kWh</span>
                </div>
                <div className="card-footer">
                    <span>Total output</span>
                    <span className="card-footer-val">{lifetimeMwhStr}</span>
                </div>
            </div>
        </div>
    );
};
