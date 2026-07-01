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
import type { MonthlyBillingData, InvestmentData } from "../types";

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

interface MonthlyBillingProps {
  monthlyData: MonthlyBillingData[];
  investment: InvestmentData | null;
}

export const MonthlyBilling: React.FC<MonthlyBillingProps> = ({ monthlyData, investment }) => {
  const [startMonthIndex, setStartMonthIndex] = useState<number>(0);
  const [activeTableTab, setActiveTableTab] = useState<"peco" | "solar" | "savings" | "investment">("peco");

  // Sorted list of months for filtering (sorting chronological)
  const sortedData = useMemo(() => {
    return [...monthlyData].sort((a, b) => a.id.localeCompare(b.id));
  }, [monthlyData]);

  // Dropdown list options
  const monthOptions = useMemo(() => {
    return sortedData.map((d, index) => ({
      index,
      label: d.month
    }));
  }, [sortedData]);

  // Filtered data based on selected start month index
  const filteredData = useMemo(() => {
    return sortedData.slice(startMonthIndex);
  }, [sortedData, startMonthIndex]);

  // Calculations for filtered data KPIs
  const kpi = useMemo(() => {
    let totalImport = 0;
    let totalExport = 0;
    let totalSolar = 0;
    let totalActualCost = 0;
    let totalSupplierRefund = 0;
    let totalNoSolar = 0;
    let totalSavings = 0;
    let totalCons = 0;

    filteredData.forEach(m => {
      totalImport += m.import_kwh;
      totalExport += m.export_kwh;
      totalSolar += m.solar_kwh;
      totalActualCost += m.actual_charge;
      totalSupplierRefund += m.supplier_refund || 0;
      totalNoSolar += m.cost_no_solar;
      totalSavings += m.savings;
      totalCons += m.cons_kwh;
    });

    const netImport = totalImport - totalExport;
    const gridDependency = totalCons > 0 ? (totalImport / totalCons) * 100 : 0;
    const netBilledCost = totalActualCost - totalSupplierRefund;

    return {
      totalImport,
      totalExport,
      totalSolar,
      totalActualCost,
      totalSupplierRefund,
      totalNoSolar,
      totalSavings,
      totalCons,
      netImport,
      gridDependency,
      netBilledCost
    };
  }, [filteredData]);

  // ROI / All-time payback calculations (always uses full dataset to show real ROI)
  const investmentKpi = useMemo(() => {
    const netInv = investment?.net_investment || 16244.50;
    const grossInv = investment?.actual_paid || 24777.60;
    const federalTaxCredit = investment?.federal_tax_credit || 8033.10;
    const pecoRebate = investment?.peco_rebate || 500.00;
    const totalRebates = federalTaxCredit + pecoRebate;

    let allTimeSavings = 0;
    sortedData.forEach(m => {
      allTimeSavings += m.savings;
    });

    const pctRecovered = netInv > 0 ? (allTimeSavings / netInv) * 100 : 0;
    const outstanding = netInv - allTimeSavings;
    const activeMonthsCount = sortedData.length;
    const avgMonthlySavings = activeMonthsCount > 0 ? (allTimeSavings / activeMonthsCount) : 0;
    const annualizedSavings = avgMonthlySavings * 12;
    const paybackYears = annualizedSavings > 0 ? (netInv / annualizedSavings) : 0;

    let breakevenDateStr = "N/A";
    if (paybackYears > 0) {
      const startYear = 2025;
      const startMonth = 10; // November
      const monthsNeeded = Math.round(paybackYears * 12);
      const breakevenDate = new Date(startYear, startMonth + monthsNeeded, 1);
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      breakevenDateStr = `${monthNames[breakevenDate.getMonth()]} ${breakevenDate.getFullYear()}`;
    }

    return {
      netInv,
      grossInv,
      federalTaxCredit,
      pecoRebate,
      totalRebates,
      allTimeSavings,
      pctRecovered,
      outstanding,
      avgMonthlySavings,
      annualizedSavings,
      paybackYears,
      breakevenDateStr
    };
  }, [sortedData, investment]);

  // Format currency helpers
  const formatCurrency = (val: number) => {
    if (val < 0) {
      return `-$${Math.abs(val).toFixed(2)}`;
    }
    return `$${val.toFixed(2)}`;
  };

  // 1. Energy Balance Chart Data
  const energyChartData = {
    labels: filteredData.map(d => d.month),
    datasets: [
      {
        label: "Solar Generated (kWh)",
        data: filteredData.map(d => d.solar_kwh),
        backgroundColor: "rgba(16, 185, 129, 0.7)",
        borderColor: "#10b981",
        borderWidth: 1.5,
        borderRadius: 8
      },
      {
        label: "Imported From Grid (kWh)",
        data: filteredData.map(d => d.import_kwh),
        backgroundColor: "rgba(37, 99, 235, 0.7)",
        borderColor: "#2563eb",
        borderWidth: 1.5,
        borderRadius: 8
      },
      {
        label: "Exported To Grid (kWh)",
        data: filteredData.map(d => d.export_kwh),
        backgroundColor: "rgba(124, 58, 237, 0.7)",
        borderColor: "#7c3aed",
        borderWidth: 1.5,
        borderRadius: 8
      }
    ]
  };

  // 2. Cost Comparison Chart Data
  const costChartData = {
    labels: filteredData.map(d => d.month),
    datasets: [
      {
        label: "Estimated Cost Without Solar ($)",
        data: filteredData.map(d => d.cost_no_solar),
        backgroundColor: "rgba(239, 68, 68, 0.7)",
        borderColor: "#ef4444",
        borderWidth: 1.5,
        borderRadius: 8
      },
      {
        label: "Actual Electric Bill ($)",
        data: filteredData.map(d => d.actual_charge),
        backgroundColor: "rgba(16, 185, 129, 0.75)",
        borderColor: "#10b981",
        borderWidth: 1.5,
        borderRadius: 8
      }
    ]
  };

  // 3. Payback Trajectory Chart Data
  let cumSum = 0;
  const cumSavingsData = filteredData.map(d => {
    cumSum += d.savings;
    return Number(cumSum.toFixed(2));
  });

  const paybackChartData = {
    labels: filteredData.map(d => d.month),
    datasets: [
      {
        label: "Cumulative Savings ($)",
        data: cumSavingsData,
        borderColor: "#d97706",
        backgroundColor: "rgba(245, 158, 11, 0.15)",
        borderWidth: 3,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: "#d97706",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
        pointRadius: 5
      },
      {
        label: `Net Capital Investment ($${investmentKpi.netInv.toLocaleString()})`,
        data: filteredData.map(() => investmentKpi.netInv),
        borderColor: "#ef4444",
        borderDash: [5, 5],
        borderWidth: 2,
        fill: false,
        pointRadius: 0
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
    <div className="monthly-billing-root" style={{ display: "flex", flexDirection: "column", gap: "2rem", width: "100%" }}>
      
      {/* Start Month Filter */}
      <div className="panel" style={{ padding: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.4rem", color: "var(--text-primary)" }}>Monthly Net Metering & ROI Analysis</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Compare grid metrics, utility expenses, savings, and payback progress</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label htmlFor="start-month-select" style={{ fontSize: "0.9rem", fontWeight: "600", color: "var(--text-secondary)" }}>Start Month:</label>
          <select
            id="start-month-select"
            value={startMonthIndex}
            onChange={(e) => setStartMonthIndex(parseInt(e.target.value, 10))}
            style={{
              padding: "0.4rem 1.5rem 0.4rem 0.75rem",
              borderRadius: "8px",
              border: "1px solid var(--border-color)",
              background: "var(--card-bg)",
              color: "var(--text-primary)",
              fontWeight: "600",
              cursor: "pointer"
            }}
          >
            {monthOptions.map(opt => (
              <option key={opt.index} value={opt.index}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid-metrics">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Net Grid Import / Export</span>
            <span className="card-icon">⚡</span>
          </div>
          <div className="card-value">
            <span style={{ color: kpi.netImport <= 0 ? "var(--color-cloud)" : "inherit" }}>
              {kpi.netImport > 0 ? "+" : ""}{kpi.netImport.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </span>
            <span className="card-unit"> kWh</span>
          </div>
          <div className="card-footer">
            <span>Grid Dependency</span>
            <span className="card-footer-val">{kpi.gridDependency.toFixed(1)}%</span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Net Utility Cost</span>
            <span className="card-icon">💵</span>
          </div>
          <div className="card-value">
            <span>{formatCurrency(kpi.netBilledCost)}</span>
          </div>
          <div className="card-footer">
            <span>Charges / Refund</span>
            <span className="card-footer-val" style={{ color: kpi.totalSupplierRefund > 0 ? "var(--color-cloud)" : "inherit" }}>
              {formatCurrency(kpi.totalActualCost)} / -{formatCurrency(kpi.totalSupplierRefund)}
            </span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">All-Time Solar Savings</span>
            <span className="card-icon">💰</span>
          </div>
          <div className="card-value" style={{ color: "var(--color-solar)" }}>
            <span>{formatCurrency(investmentKpi.allTimeSavings)}</span>
          </div>
          <div className="card-footer">
            <span>ROI Recovered</span>
            <span className="card-footer-val" style={{ fontWeight: "700" }}>{investmentKpi.pctRecovered.toFixed(1)}%</span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Estimated Payback Period</span>
            <span className="card-icon">🕒</span>
          </div>
          <div className="card-value">
            <span>{investmentKpi.paybackYears.toFixed(2)}</span>
            <span className="card-unit"> Years</span>
          </div>
          <div className="card-footer">
            <span>Est. Break-Even</span>
            <span className="card-footer-val">{investmentKpi.breakevenDateStr}</span>
          </div>
        </div>
      </div>

      {/* Chart Layout: Two column or single grid */}
      <div className="charts-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem" }}>
        
        {/* Energy Balance Chart */}
        <div className="panel" style={{ padding: "1.5rem", height: "360px", display: "flex", flexDirection: "column" }}>
          <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Energy Balance (kWh)</h3>
          <div style={{ flex: 1, position: "relative" }}>
            <Bar data={energyChartData} options={chartOptions as any} />
          </div>
        </div>

        {/* Cost Comparison Chart */}
        <div className="panel" style={{ padding: "1.5rem", height: "360px", display: "flex", flexDirection: "column" }}>
          <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Cost Comparison (With vs. Without Solar)</h3>
          <div style={{ flex: 1, position: "relative" }}>
            <Bar data={costChartData} options={chartOptions as any} />
          </div>
        </div>
      </div>

      {/* Payback Trajectory Chart */}
      <div className="panel" style={{ padding: "1.5rem", height: "380px", display: "flex", flexDirection: "column" }}>
        <h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Solar Investment Payback Trajectory</h3>
        <div style={{ flex: 1, position: "relative" }}>
          <Line data={paybackChartData} options={chartOptions as any} />
        </div>
      </div>

      {/* Tables Selection Panel */}
      <div className="panel">
        <div className="tab-header-container">
          <div className="tabs">
            <button
              className={`tab-btn ${activeTableTab === "peco" ? "active" : ""}`}
              onClick={() => setActiveTableTab("peco")}
            >
              PECO Grid Statement
            </button>
            <button
              className={`tab-btn ${activeTableTab === "solar" ? "active" : ""}`}
              onClick={() => setActiveTableTab("solar")}
            >
              Solar Readings
            </button>
            <button
              className={`tab-btn ${activeTableTab === "savings" ? "active" : ""}`}
              onClick={() => setActiveTableTab("savings")}
            >
              Savings & ROI
            </button>
            <button
              className={`tab-btn ${activeTableTab === "investment" ? "active" : ""}`}
              onClick={() => setActiveTableTab("investment")}
            >
              Investment Projections
            </button>
          </div>
        </div>

        {/* PECO Net Metering Table */}
        {activeTableTab === "peco" && (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Month / Service Period</th>
                  <th>Bill File Reference</th>
                  <th>Import (kWh)</th>
                  <th>Export (kWh)</th>
                  <th>Balance (kWh)</th>
                  <th>Actual Charge</th>
                  <th>Supplier Refund</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map(m => {
                  const balance = m.export_kwh - m.import_kwh;
                  return (
                    <tr key={m.id}>
                      <td>
                        <span className="text-bold">{m.month}</span>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{m.service_period}</div>
                      </td>
                      <td style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                        {m.bill_file ? m.bill_file.replace("PECO_Bill_", "") : "Manual / N/A"}
                      </td>
                      <td>{m.import_kwh.toLocaleString()}</td>
                      <td>{m.export_kwh.toLocaleString()}</td>
                      <td style={{ fontWeight: "700", color: balance > 0 ? "var(--color-cloud)" : "inherit" }}>
                        {balance > 0 ? `+${balance.toLocaleString()}` : balance.toLocaleString()}
                      </td>
                      <td style={{ fontWeight: "700", color: m.actual_charge < 0 ? "var(--color-cloud)" : "inherit" }}>
                        {formatCurrency(m.actual_charge)}
                      </td>
                      <td style={{ color: m.supplier_refund > 0 ? "var(--color-cloud)" : "inherit" }}>
                        {m.supplier_refund > 0 ? formatCurrency(m.supplier_refund) : "-"}
                      </td>
                      <td>
                        <span className={`status-badge ${balance > 0 ? "status-verified" : "status-historical"}`}>
                          {balance > 0 ? "Net Export" : "Net Usage"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {/* Summary Row */}
                <tr style={{ fontWeight: "bold", background: "var(--table-header-bg)" }}>
                  <td>TOTAL</td>
                  <td>-</td>
                  <td>{kpi.totalImport.toLocaleString()}</td>
                  <td>{kpi.totalExport.toLocaleString()}</td>
                  <td style={{ color: kpi.totalExport >= kpi.totalImport ? "var(--color-cloud)" : "inherit" }}>
                    {kpi.totalExport >= kpi.totalImport ? "+" : ""}{(kpi.totalExport - kpi.totalImport).toLocaleString()}
                  </td>
                  <td>{formatCurrency(kpi.totalActualCost)}</td>
                  <td style={{ color: "var(--color-cloud)" }}>{formatCurrency(kpi.totalSupplierRefund)}</td>
                  <td>-</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Enphase Screenshot Solar Readings Table */}
        {activeTableTab === "solar" && (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Solar Production (kWh)</th>
                  <th>Monitored Panels</th>
                  <th>Avg Generation / Panel</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map(m => {
                  const hasOcrEst = m.solar_est_kwh > 0;
                  const panelsCount = 24;
                  const avgPanelGen = hasOcrEst ? m.solar_kwh / panelsCount : 0;
                  
                  // Alert if Enphase gateway parsing mismatch/error
                  const isNormal = m.month === "May 2026" || m.month === "Nov 2025" || !m.image_file;
                  
                  return (
                    <tr key={m.id}>
                      <td className="text-bold">{m.month}</td>
                      <td className="text-solar" style={{ fontWeight: "700" }}>{m.solar_kwh.toLocaleString(undefined, { minimumFractionDigits: 1 })} kWh</td>
                      <td>{panelsCount}</td>
                      <td>{avgPanelGen > 0 ? `${avgPanelGen.toFixed(2)} kWh` : "-"}</td>
                      <td>
                        <span className={`status-badge ${isNormal ? "status-verified" : "status-monthly"}`} style={{ background: isNormal ? "" : "rgba(245, 158, 11, 0.1)", color: isNormal ? "" : "#d97706" }}>
                          {isNormal ? "Normal" : "Gateway Alert"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ fontWeight: "bold", background: "var(--table-header-bg)" }}>
                  <td>TOTAL</td>
                  <td className="text-solar">{kpi.totalSolar.toLocaleString(undefined, { minimumFractionDigits: 1 })} kWh</td>
                  <td>24</td>
                  <td>-</td>
                  <td>-</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Savings & ROI Table */}
        {activeTableTab === "savings" && (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Solar Output (kWh)</th>
                  <th>Net Grid Export (kWh)</th>
                  <th>Est. Consumption (kWh)</th>
                  <th>Actual Bill</th>
                  <th>Supplier Refund</th>
                  <th>Cost Without Solar</th>
                  <th>Net Savings</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map(m => {
                  const netGridExport = m.export_kwh - m.import_kwh;
                  return (
                    <tr key={m.id}>
                      <td className="text-bold">{m.month}</td>
                      <td>{m.solar_kwh.toLocaleString(undefined, { minimumFractionDigits: 1 })}</td>
                      <td style={{ color: netGridExport > 0 ? "var(--color-cloud)" : "inherit" }}>
                        {netGridExport > 0 ? `+${netGridExport.toLocaleString()}` : netGridExport.toLocaleString()}
                      </td>
                      <td>{m.cons_kwh.toLocaleString(undefined, { minimumFractionDigits: 1 })}</td>
                      <td style={{ color: m.actual_charge < 0 ? "var(--color-cloud)" : "inherit" }}>{formatCurrency(m.actual_charge)}</td>
                      <td style={{ color: m.supplier_refund > 0 ? "var(--color-cloud)" : "inherit" }}>{m.supplier_refund > 0 ? formatCurrency(m.supplier_refund) : "-"}</td>
                      <td>{formatCurrency(m.cost_no_solar)}</td>
                      <td className="text-bold" style={{ color: "var(--color-solar)" }}>{formatCurrency(m.savings)}</td>
                    </tr>
                  );
                })}
                <tr style={{ fontWeight: "bold", background: "var(--table-header-bg)" }}>
                  <td>TOTAL</td>
                  <td>{kpi.totalSolar.toLocaleString(undefined, { minimumFractionDigits: 1 })}</td>
                  <td style={{ color: kpi.totalExport >= kpi.totalImport ? "var(--color-cloud)" : "inherit" }}>
                    {kpi.totalExport >= kpi.totalImport ? "+" : ""}{(kpi.totalExport - kpi.totalImport).toLocaleString()}
                  </td>
                  <td>{kpi.totalCons.toLocaleString(undefined, { minimumFractionDigits: 1 })}</td>
                  <td>{formatCurrency(kpi.totalActualCost)}</td>
                  <td style={{ color: "var(--color-cloud)" }}>{formatCurrency(kpi.totalSupplierRefund)}</td>
                  <td>{formatCurrency(kpi.totalNoSolar)}</td>
                  <td style={{ color: "var(--color-solar)" }}>{formatCurrency(kpi.totalSavings)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Investment Projections Table */}
        {activeTableTab === "investment" && (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Financial Metric</th>
                  <th>Value</th>
                  <th>Details & Reference Docs</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-bold">Gross Capital Invoice</td>
                  <td style={{ fontWeight: "700" }}>{formatCurrency(investmentKpi.grossInv)}</td>
                  <td>Contract: <code>Raju Chekuri contract.pdf</code></td>
                </tr>
                <tr>
                  <td className="text-bold">Government & Utility Incentives</td>
                  <td style={{ fontWeight: "700", color: "var(--color-cloud)" }}>-{formatCurrency(investmentKpi.totalRebates)}</td>
                  <td>30% Fed Tax Credit: {formatCurrency(investmentKpi.federalTaxCredit)} | PECO Rebate: {formatCurrency(investmentKpi.pecoRebate)}</td>
                </tr>
                <tr style={{ background: "var(--table-header-bg)" }}>
                  <td className="text-bold">Net System Capital Cost</td>
                  <td style={{ fontWeight: "700", color: "var(--text-primary)" }}>{formatCurrency(investmentKpi.netInv)}</td>
                  <td>Out-of-pocket investment capital to recover</td>
                </tr>
                <tr>
                  <td className="text-bold">Accumulated Savings To-Date</td>
                  <td style={{ fontWeight: "700", color: "var(--color-solar)" }}>{formatCurrency(investmentKpi.allTimeSavings)}</td>
                  <td>Total utility savings generated since November 2025</td>
                </tr>
                <tr>
                  <td className="text-bold">Outstanding Capital Balance</td>
                  <td style={{ fontWeight: "700" }}>{formatCurrency(investmentKpi.outstanding)}</td>
                  <td>Remaining capital investment outstanding ({ (100 - investmentKpi.pctRecovered).toFixed(1) }%)</td>
                </tr>
                <tr>
                  <td className="text-bold">Average Monthly Return</td>
                  <td style={{ fontWeight: "700" }}>{formatCurrency(investmentKpi.avgMonthlySavings)}</td>
                  <td>Based on {sortedData.length} months of active billing datasets</td>
                </tr>
                <tr>
                  <td className="text-bold">Annual Savings Return Rate</td>
                  <td style={{ fontWeight: "700" }}>{formatCurrency(investmentKpi.annualizedSavings)}</td>
                  <td>Estimated annual savings rate based on monthly averages</td>
                </tr>
                <tr style={{ background: "var(--table-header-bg)", fontWeight: "bold" }}>
                  <td className="text-bold">Total Payback Expectation</td>
                  <td style={{ color: "var(--color-solar)" }}>{investmentKpi.paybackYears.toFixed(2)} Years</td>
                  <td>Estimated break-even date: {investmentKpi.breakevenDateStr}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};
