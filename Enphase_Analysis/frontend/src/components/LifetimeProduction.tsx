import React, { useState, useMemo } from "react";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from "chart.js";
import type { ChartOptions } from "chart.js";
import type { DailyProduction, InvestmentData } from "../types";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface LifetimeProductionProps {
  history: DailyProduction[];
  investment: InvestmentData | null;
}

export const LifetimeProduction: React.FC<LifetimeProductionProps> = ({ history, investment }) => {
  const [unit, setUnit] = useState<"kW" | "MW">("kW");
  const [activeChart, setActiveChart] = useState<"monthly" | "cumulative">("monthly");

  const MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  // Historical records: Nov 2025 - Mar 2026 totals
  const historicalWh = 3840000;
  const historicalDaysCount = 151; // Nov: 30, Dec: 31, Jan: 31, Feb: 28, Mar: 31
  const historicalMonths: Record<string, number> = {
    "2025-11": 330000,
    "2025-12": 550000,
    "2026-01": 700000,
    "2026-02": 1050000,
    "2026-03": 1210000,
  };
  const historicalDays: Record<string, number> = {
    "2025-11": 30,
    "2025-12": 31,
    "2026-01": 31,
    "2026-02": 28,
    "2026-03": 31,
  };

  // Calculate database totals
  const databaseWh = useMemo(() => {
    return history.reduce((acc, curr) => acc + (curr.productionWh || 0), 0);
  }, [history]);

  const lifetimeWh = databaseWh + historicalWh;
  const totalTrackedDays = historicalDaysCount + history.length;
  const averageDailyWh = lifetimeWh / totalTrackedDays;

  // SREC estimations (1 SREC = 1 MWh = 1,000,000 Wh)
  const srecPrice = investment?.srec_price !== undefined ? investment.srec_price : 25.0;
  const srecBrokerFeePct = investment?.srec_broker_fee_pct !== undefined ? investment.srec_broker_fee_pct : 10.0;
  const srecEarnedFraction = lifetimeWh / 1000000;
  const estSrecRevenue = srecEarnedFraction * srecPrice * (1 - srecBrokerFeePct / 100);

  // Peak production day (database only, since historical is aggregated)
  const peakDay = useMemo(() => {
    if (history.length === 0) return null;
    return history.reduce((max, curr) => (curr.productionWh > (max?.productionWh || 0) ? curr : max), history[0]);
  }, [history]);

  // Aggregate monthly data (combining historical and database)
  const monthlyDataPoints = useMemo(() => {
    const monthlyTotals: Record<string, number> = { ...historicalMonths };
    const monthlyDaysMap: Record<string, number> = { ...historicalDays };

    history.forEach((entry) => {
      if (entry.date && entry.date.length >= 7) {
        const monthKey = entry.date.substring(0, 7); // e.g. "2026-04"
        if (monthKey >= "2026-04") {
          monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + (entry.productionWh || 0);
          monthlyDaysMap[monthKey] = (monthlyDaysMap[monthKey] || 0) + 1;
        }
      }
    });

    const sortedKeys = Object.keys(monthlyTotals).sort((a, b) => a.localeCompare(b));
    let runningSum = 0;

    return sortedKeys.map((key) => {
      const totalWh = monthlyTotals[key];
      runningSum += totalWh;
      const [yr, mo] = key.split("-");
      const label = `${MONTH_NAMES[parseInt(mo, 10)].substring(0, 3)} ${yr}`;
      const isHistorical = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"].includes(key);

      return {
        key,
        label,
        totalWh,
        runningSum,
        days: monthlyDaysMap[key],
        isHistorical
      };
    });
  }, [history]);

  // Unit conversion formatting helpers
  const formatEnergy = (wh: number) => {
    if (unit === "MW") {
      return `${(wh / 1000000).toFixed(3)} MWh`;
    } else {
      return `${(wh / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`;
    }
  };

  const formatAlternateEnergy = (wh: number) => {
    if (unit === "MW") {
      return `${(wh / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`;
    } else {
      return `${(wh / 1000000).toFixed(3)} MWh`;
    }
  };

  const getUnitValue = (wh: number) => {
    if (unit === "MW") {
      return (wh / 1000000).toFixed(3);
    } else {
      return (wh / 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  };

  const getUnitLabel = () => (unit === "MW" ? "MWh" : "kWh");

  // Charts Config
  const monthlyChartData = {
    labels: monthlyDataPoints.map(d => d.label),
    datasets: [
      {
        label: `Total Production (${getUnitLabel()})`,
        data: monthlyDataPoints.map(d => unit === "MW" ? d.totalWh / 1000000 : d.totalWh / 1000),
        backgroundColor: "rgba(234, 88, 12, 0.7)",
        borderColor: "#ea580c",
        borderWidth: 1.5,
        borderRadius: 8
      }
    ]
  };

  const cumulativeChartData = {
    labels: monthlyDataPoints.map(d => d.label),
    datasets: [
      {
        label: `Cumulative Trajectory (${getUnitLabel()})`,
        data: monthlyDataPoints.map(d => unit === "MW" ? d.runningSum / 1000000 : d.runningSum / 1000),
        borderColor: "#ea580c",
        backgroundColor: "rgba(234, 88, 12, 0.1)",
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: "#ea580c",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
        pointRadius: 5
      }
    ]
  };

  const chartOptions: ChartOptions<"bar" | "line"> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          color: "var(--text-primary)",
          font: { family: "Plus Jakarta Sans", weight: 600, size: 11 }
        }
      },
      tooltip: {
        padding: 10,
        cornerRadius: 8,
        titleFont: { family: "Outfit", weight: 700, size: 13 },
        bodyFont: { family: "Plus Jakarta Sans", weight: 500 }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "var(--text-secondary)", font: { family: "Plus Jakarta Sans", weight: 500 } }
      },
      y: {
        grid: { color: "rgba(15, 23, 42, 0.04)" },
        ticks: { color: "var(--text-secondary)", font: { family: "Plus Jakarta Sans", weight: 500 } }
      }
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem", width: "100%" }}>
      
      {/* Header + Unit Toggle */}
      <div className="panel" style={{ padding: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.4rem", color: "var(--text-primary)" }}>System Lifetime Production Analysis</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Track lifetime production trajectory and monthly benchmarks in MW or kW units</p>
        </div>
        <div style={{
          display: "flex",
          background: "rgba(15, 23, 42, 0.04)",
          padding: "4px",
          borderRadius: "10px",
          border: "1px solid var(--border-color)"
        }}>
          <button
            onClick={() => setUnit("kW")}
            style={{
              border: "none",
              background: unit === "kW" ? "var(--card-bg)" : "transparent",
              color: unit === "kW" ? "var(--color-solar)" : "var(--text-secondary)",
              padding: "0.4rem 1rem",
              borderRadius: "8px",
              fontWeight: "600",
              fontSize: "0.85rem",
              cursor: "pointer",
              boxShadow: unit === "kW" ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
              transition: "all 0.2s"
            }}
          >
            Kilowatts (kW / kWh)
          </button>
          <button
            onClick={() => setUnit("MW")}
            style={{
              border: "none",
              background: unit === "MW" ? "var(--card-bg)" : "transparent",
              color: unit === "MW" ? "var(--color-solar)" : "var(--text-secondary)",
              padding: "0.4rem 1rem",
              borderRadius: "8px",
              fontWeight: "600",
              fontSize: "0.85rem",
              cursor: "pointer",
              boxShadow: unit === "MW" ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
              transition: "all 0.2s"
            }}
          >
            Megawatts (MW / MWh)
          </button>
        </div>
      </div>

      {/* KPIs Grid */}
      <div className="grid-metrics">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Lifetime Output</span>
            <span className="card-icon">⚡</span>
          </div>
          <div className="card-value">
            <span>{getUnitValue(lifetimeWh)}</span> <span className="card-unit">{getUnitLabel()}</span>
          </div>
          <div className="card-footer">
            <span>Equivalent to</span>
            <span className="card-footer-val">{formatAlternateEnergy(lifetimeWh)}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Daily Average</span>
            <span className="card-icon">📊</span>
          </div>
          <div className="card-value">
            <span>{getUnitValue(averageDailyWh)}</span> <span className="card-unit">{getUnitLabel()}</span>
          </div>
          <div className="card-footer">
            <span>Equivalent to</span>
            <span className="card-footer-val">{formatAlternateEnergy(averageDailyWh)}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Record Day</span>
            <span className="card-icon">🏆</span>
          </div>
          <div className="card-value">
            <span>{peakDay ? getUnitValue(peakDay.productionWh) : "0"}</span> <span className="card-unit">{getUnitLabel()}</span>
          </div>
          <div className="card-footer">
            <span>Date</span>
            <span className="card-footer-val">{peakDay ? peakDay.date : "N/A"}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">SREC Credits (Pending)</span>
            <span className="card-icon">💰</span>
          </div>
          <div className="card-value" style={{ color: "var(--color-cloud)" }}>
            <span>{srecEarnedFraction.toFixed(2)}</span> <span className="card-unit"> SRECs</span>
          </div>
          <div className="card-footer">
            <span>Est. Net Value</span>
            <span className="card-footer-val" style={{ fontWeight: "700", color: "var(--color-solar)" }}>
              ${estSrecRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Tracked Period</span>
            <span className="card-icon">📅</span>
          </div>
          <div className="card-value">
            <span>{totalTrackedDays}</span> <span className="card-unit">Days</span>
          </div>
          <div className="card-footer">
            <span>Nov 2025 – Present</span>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="panel" style={{ minHeight: "450px", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div className="tab-header-container" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="tabs" style={{ borderBottom: "none" }}>
            <button
              className={`tab-btn ${activeChart === "monthly" ? "active" : ""}`}
              onClick={() => setActiveChart("monthly")}
              style={{ fontSize: "0.95rem" }}
            >
              📊 Monthly Generation
            </button>
            <button
              className={`tab-btn ${activeChart === "cumulative" ? "active" : ""}`}
              onClick={() => setActiveChart("cumulative")}
              style={{ fontSize: "0.95rem" }}
            >
              📈 Cumulative Growth
            </button>
          </div>
          <span className="badge">Interactive Charts</span>
        </div>

        <div style={{ flex: 1, position: "relative", minHeight: "350px" }}>
          {activeChart === "monthly" ? (
            <Bar data={monthlyChartData} options={chartOptions as any} />
          ) : (
            <Line data={cumulativeChartData} options={chartOptions as any} />
          )}
        </div>
      </div>

      {/* Monthly Breakdowns Table */}
      <div className="panel">
        <div className="tab-header-container">
          <h3 style={{ fontSize: "1.1rem", fontWeight: "700" }}>Monthly Production Breakdowns</h3>
          <span className="badge">Detailed Metrics</span>
        </div>

        <div className="table-container" style={{ maxHeight: "400px" }}>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Total Output</th>
                <th>Contribution %</th>
                <th>Daily Average</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {[...monthlyDataPoints].reverse().map((data) => {
                const percent = ((data.totalWh / lifetimeWh) * 100).toFixed(1);
                const dailyAvg = data.totalWh / data.days;
                return (
                  <tr key={data.key}>
                    <td className="text-bold">{data.label}</td>
                    <td className="text-solar">{formatEnergy(data.totalWh)}</td>
                    <td>{percent}%</td>
                    <td>{formatEnergy(dailyAvg)}/day</td>
                    <td>
                      <span className={`status-badge ${data.isHistorical ? "status-historical" : "status-verified"}`}>
                        {data.isHistorical ? "Historical" : "Verified"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
