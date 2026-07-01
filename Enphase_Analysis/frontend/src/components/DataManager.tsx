import React, { useState } from "react";
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import type { MonthlyBillingData, InvestmentData } from "../types";

interface DataManagerProps {
  monthlyData: MonthlyBillingData[];
  investment: InvestmentData | null;
  onRefresh: () => Promise<void>;
}

const formatCurrency = (val: number) => {
  if (val < 0) {
    return `-$${Math.abs(val).toFixed(2)}`;
  }
  return `$${val.toFixed(2)}`;
};

export const DataManager: React.FC<DataManagerProps> = ({ monthlyData, investment, onRefresh }) => {
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // File states
  const [pecoFile, setPecoFile] = useState<File | null>(null);
  const [enphaseFile, setEnphaseFile] = useState<File | null>(null);

  // Form states for adding/editing a record
  const [editingRecord, setEditingRecord] = useState<Partial<MonthlyBillingData> | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  // Form states for investment settings
  const [invForm, setInvForm] = useState<Partial<InvestmentData>>({
    invoice_amount: investment?.invoice_amount || 26777,
    actual_paid: investment?.actual_paid || 24777.6,
    federal_tax_credit: investment?.federal_tax_credit || 8033.1,
    peco_rebate: investment?.peco_rebate || 500,
    contract_file: investment?.contract_file || "investment_docs/Raju Chekuri contract.pdf",
    invoice_file: investment?.invoice_file || "investment_docs/Solar_Install_RegalSolarEnergy.pdf",
    rebate_file: investment?.rebate_file || "investment_docs/PECO_500_Rebate.pdf"
  });
  const [showInvEditor, setShowInvEditor] = useState(false);

  // Derived calculation helper
  const calculateDerivedMetrics = (data: Partial<MonthlyBillingData>): MonthlyBillingData => {
    const import_kwh = Number(data.import_kwh) || 0;
    const export_kwh = Number(data.export_kwh) || 0;
    const solar_est = Number(data.solar_est_kwh) || 0;
    const solar_gats = Number(data.solar_gats_kwh) || 0;
    
    // Choose solar estimation if available, otherwise GATS
    const solar_kwh = solar_est > 0 ? solar_est : solar_gats;
    const cons_kwh = Math.max(0, import_kwh - export_kwh + solar_kwh);
    
    const customer_charge = Number(data.customer_charge) || 11.30;
    const dist_rate = Number(data.dist_rate) || 0.09655;
    const supply_rate = Number(data.supply_rate) || 0.10;
    const actual_charge = Number(data.actual_charge) || 0;
    const supplier_refund = Number(data.supplier_refund) || 0;

    const cost_no_solar = customer_charge + cons_kwh * (dist_rate + supply_rate);
    const savings = cost_no_solar - actual_charge + supplier_refund;

    // Build document ID from month (e.g. "Jun 2026" -> "2026-06")
    const monthsOrder: Record<string, string> = {
      "Jan": "01", "Feb": "02", "Mar": "03", "Apr": "04", "May": "05", "Jun": "06",
      "Jul": "07", "Aug": "08", "Sep": "09", "Oct": "10", "Nov": "11", "Dec": "12"
    };

    let id = data.id || "";
    if (!id && data.month) {
      const parts = data.month.split(" ");
      if (parts.length === 2) {
        const yr = parts[1];
        const mo = monthsOrder[parts[0].slice(0, 3)];
        if (mo) {
          id = `${yr}-${mo}`;
        }
      }
    }
    if (!id) {
      id = new Date().toISOString().substring(0, 7);
    }

    return {
      id,
      month: data.month || "",
      bill_file: data.bill_file || "",
      image_file: data.image_file || "",
      service_period: data.service_period || "",
      import_kwh,
      export_kwh,
      solar_gats_kwh: solar_gats,
      solar_est_kwh: solar_est,
      actual_charge,
      customer_charge,
      dist_rate,
      supply_rate,
      supplier_refund,
      solar_kwh,
      cons_kwh,
      cost_no_solar,
      savings
    };
  };

  // Convert File to base64 helper
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64Str = (reader.result as string).split(",")[1];
        resolve(base64Str);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  // 1. AI Parse PECO Bill
  const handleParsePeco = async () => {
    if (!pecoFile) return;
    setParsing(true);
    setError(null);
    try {
      console.log("Reading PECO bill PDF and calling cloud parser...");
      const base64 = await fileToBase64(pecoFile);
      const parseBill = httpsCallable<{ fileBase64: string }, any>(functions, "parsePecoBill");
      const result = await parseBill({ fileBase64: base64 });
      
      const parsed = result.data;
      console.log("Parsed PECO bill data:", parsed);

      // Prepopulate form
      const record = calculateDerivedMetrics({
        month: parsed.month,
        bill_file: pecoFile.name,
        service_period: parsed.service_period,
        import_kwh: parsed.import_kwh,
        export_kwh: parsed.export_kwh,
        actual_charge: parsed.actual_charge,
        customer_charge: parsed.customer_charge || 11.30,
        dist_rate: parsed.dist_rate || 0.09655,
        supply_rate: parsed.supply_rate || 0.10,
        supplier_refund: parsed.supplier_refund || 0
      });

      setEditingRecord(record);
      setShowEditor(true);
      setPecoFile(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to parse PECO bill");
    } finally {
      setParsing(false);
    }
  };

  // 2. AI Parse Enphase Screenshot
  const handleParseEnphase = async () => {
    if (!enphaseFile) return;
    setParsing(true);
    setError(null);
    try {
      console.log("Reading Enphase image and calling cloud parser...");
      const base64 = await fileToBase64(enphaseFile);
      const parseEnphase = httpsCallable<{ fileBase64: string; mimeType: string }, any>(functions, "parseEnphaseScreenshot");
      const result = await parseEnphase({ fileBase64: base64, mimeType: enphaseFile.type });
      
      const parsed = result.data;
      console.log("Parsed Enphase data:", parsed);

      // Calculate panel estimates
      const panelVals: number[] = parsed.panel_values || [];
      const solarEst = panelVals.length > 0 ? (panelVals.reduce((a, b) => a + b, 0) / panelVals.length) * 24 : parsed.solar_gats_kwh;

      // Try to find matching month record
      const match = monthlyData.find(d => d.month.toLowerCase() === parsed.month.toLowerCase());

      const record = calculateDerivedMetrics({
        ...(match || {}),
        month: parsed.month,
        image_file: enphaseFile.name,
        solar_gats_kwh: parsed.solar_gats_kwh,
        solar_est_kwh: solarEst
      });

      setEditingRecord(record);
      setShowEditor(true);
      setEnphaseFile(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to parse Enphase screenshot");
    } finally {
      setParsing(false);
    }
  };

  // 3. Save Record to Firestore
  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord || !editingRecord.month) return;
    setSaving(true);
    setError(null);
    try {
      const finalDoc = calculateDerivedMetrics(editingRecord);
      console.log("Saving monthly record to Firestore:", finalDoc);
      await setDoc(doc(db, "monthly_billing", finalDoc.id), finalDoc);
      
      setShowEditor(false);
      setEditingRecord(null);
      await onRefresh();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to save record");
    } finally {
      setSaving(false);
    }
  };

  // 4. Delete Record from Firestore
  const handleDeleteRecord = async (id: string, month: string) => {
    if (!window.confirm(`Are you sure you want to delete the record for ${month}?`)) {
      return;
    }
    setSaving(true);
    try {
      console.log("Deleting monthly record from Firestore:", id);
      await deleteDoc(doc(db, "monthly_billing", id));
      await onRefresh();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to delete record");
    } finally {
      setSaving(false);
    }
  };

  // 5. Save Investments settings
  const handleSaveInvestments = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const actualPaid = Number(invForm.actual_paid) || 0;
      const taxCredit = Number(invForm.federal_tax_credit) || 0;
      const rebate = Number(invForm.peco_rebate) || 0;
      const netInv = actualPaid - taxCredit - rebate;

      const finalInv: InvestmentData = {
        invoice_amount: Number(invForm.invoice_amount) || 0,
        actual_paid: actualPaid,
        federal_tax_credit: taxCredit,
        peco_rebate: rebate,
        net_investment: netInv,
        contract_file: invForm.contract_file || "",
        invoice_file: invForm.invoice_file || "",
        rebate_file: invForm.rebate_file || ""
      };

      console.log("Saving investment configs to Firestore:", finalInv);
      await setDoc(doc(db, "configs", "investments"), finalInv);
      setShowInvEditor(false);
      await onRefresh();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to save investment settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem", width: "100%" }}>
      
      {error && (
        <div style={{ padding: "1rem", background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", borderRadius: "12px", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* OCR Document Uploader Panel */}
      <div className="panel" style={{ padding: "1.5rem" }}>
        <h3 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>📷 AI Document parser (Multimodal Gemini)</h3>
        
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem" }}>
          
          {/* PECO PDF File Picker */}
          <div style={{ padding: "1.5rem", border: "1px dashed var(--border-color)", borderRadius: "16px", display: "flex", flexDirection: "column", gap: "1rem", background: "rgba(15, 23, 42, 0.01)", transition: "all 0.2s ease" }}>
            <span style={{ fontWeight: "700", fontSize: "1rem", color: "var(--text-primary)" }}>Upload PECO Bill (PDF)</span>
            <label style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "2rem 1.5rem",
              borderRadius: "12px",
              border: "2px dashed rgba(37, 99, 235, 0.2)",
              background: "rgba(37, 99, 235, 0.02)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              textAlign: "center"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = "var(--color-cloud)";
              e.currentTarget.style.background = "rgba(8, 145, 178, 0.04)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = "rgba(37, 99, 235, 0.2)";
              e.currentTarget.style.background = "rgba(37, 99, 235, 0.02)";
            }}
            >
              <span style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📄</span>
              <span style={{ fontSize: "0.9rem", fontWeight: "600", color: "var(--color-cloud)" }}>
                {pecoFile ? "File Selected" : "Choose PECO Statement"}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.25rem", wordBreak: "break-all" }}>
                {pecoFile ? pecoFile.name : "Click to browse PDF"}
              </span>
              <input
                type="file"
                accept=".pdf"
                onChange={(e) => setPecoFile(e.target.files?.[0] || null)}
                style={{ display: "none" }}
              />
            </label>
            <button
              className="btn-primary"
              disabled={!pecoFile || parsing}
              onClick={handleParsePeco}
              style={{ padding: "0.75rem", justifyContent: "center", width: "100%", marginTop: "auto" }}
            >
              {parsing ? "Parsing PDF with Gemini..." : "Parse PDF with Gemini"}
            </button>
          </div>

          {/* Enphase Image File Picker */}
          <div style={{ padding: "1.5rem", border: "1px dashed var(--border-color)", borderRadius: "16px", display: "flex", flexDirection: "column", gap: "1rem", background: "rgba(15, 23, 42, 0.01)", transition: "all 0.2s ease" }}>
            <span style={{ fontWeight: "700", fontSize: "1rem", color: "var(--text-primary)" }}>Upload Enphase Reading (Image)</span>
            <label style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "2rem 1.5rem",
              borderRadius: "12px",
              border: "2px dashed rgba(234, 88, 12, 0.2)",
              background: "rgba(234, 88, 12, 0.02)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              textAlign: "center"
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = "var(--color-solar)";
              e.currentTarget.style.background = "rgba(234, 88, 12, 0.05)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = "rgba(234, 88, 12, 0.2)";
              e.currentTarget.style.background = "rgba(234, 88, 12, 0.02)";
            }}
            >
              <span style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🖼️</span>
              <span style={{ fontSize: "0.9rem", fontWeight: "600", color: "var(--color-solar)" }}>
                {enphaseFile ? "File Selected" : "Choose Enphase Screenshot"}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.25rem", wordBreak: "break-all" }}>
                {enphaseFile ? enphaseFile.name : "Click to browse JPEG/PNG"}
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setEnphaseFile(e.target.files?.[0] || null)}
                style={{ display: "none" }}
              />
            </label>
            <button
              className="btn-primary"
              disabled={!enphaseFile || parsing}
              onClick={handleParseEnphase}
              style={{ padding: "0.75rem", justifyContent: "center", width: "100%", marginTop: "auto" }}
            >
              {parsing ? "Parsing Screenshot with Gemini..." : "Parse Screenshot with Gemini"}
            </button>
          </div>

        </div>
      </div>

      {/* Editor Modal/Overlay */}
      {showEditor && editingRecord && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(15, 23, 42, 0.4)", backdropFilter: "blur(4px)",
          display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000,
          padding: "1rem"
        }}>
          <form onSubmit={handleSaveRecord} className="panel" style={{
            width: "100%", maxWidth: "600px", maxHeight: "90vh", overflowY: "auto",
            padding: "2rem", display: "flex", flexDirection: "column", gap: "1.25rem",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
          }}>
            <h3 style={{ fontSize: "1.25rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.5rem" }}>
              {editingRecord.id ? "Edit Monthly Record" : "Add New Monthly Record"}
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Month (e.g. Jun 2026)</label>
                <input
                  type="text"
                  required
                  placeholder="Jun 2026"
                  value={editingRecord.month || ""}
                  onChange={(e) => setEditingRecord({ ...editingRecord, month: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Service Period</label>
                <input
                  type="text"
                  placeholder="05/22/2026 - 06/23/2026"
                  value={editingRecord.service_period || ""}
                  onChange={(e) => setEditingRecord({ ...editingRecord, service_period: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Import from Grid (kWh)</label>
                <input
                  type="number"
                  step="any"
                  value={editingRecord.import_kwh || 0}
                  onChange={(e) => setEditingRecord({ ...editingRecord, import_kwh: Number(e.target.value) })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Export to Grid (kWh)</label>
                <input
                  type="number"
                  step="any"
                  value={editingRecord.export_kwh || 0}
                  onChange={(e) => setEditingRecord({ ...editingRecord, export_kwh: Number(e.target.value) })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Solar GATS Production (kWh)</label>
                <input
                  type="number"
                  step="any"
                  value={editingRecord.solar_gats_kwh || 0}
                  onChange={(e) => setEditingRecord({ ...editingRecord, solar_gats_kwh: Number(e.target.value) })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Solar Est (24-Panel Avg kWh)</label>
                <input
                  type="number"
                  step="any"
                  value={editingRecord.solar_est_kwh || 0}
                  onChange={(e) => setEditingRecord({ ...editingRecord, solar_est_kwh: Number(e.target.value) })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Actual Bill Charge ($)</label>
                <input
                  type="number"
                  step="any"
                  value={editingRecord.actual_charge || 0}
                  onChange={(e) => setEditingRecord({ ...editingRecord, actual_charge: Number(e.target.value) })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Customer Charge ($)</label>
                <input
                  type="number"
                  step="any"
                  value={editingRecord.customer_charge || 11.30}
                  onChange={(e) => setEditingRecord({ ...editingRecord, customer_charge: Number(e.target.value) })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Supplier Refund ($)</label>
                <input
                  type="number"
                  step="any"
                  value={editingRecord.supplier_refund || 0}
                  onChange={(e) => setEditingRecord({ ...editingRecord, supplier_refund: Number(e.target.value) })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Bill File Name</label>
                <input
                  type="text"
                  placeholder="PECO_Bill_2026-06.pdf"
                  value={editingRecord.bill_file || ""}
                  onChange={(e) => setEditingRecord({ ...editingRecord, bill_file: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Image File Name</label>
                <input
                  type="text"
                  placeholder="Enphase_Reading_2026-06.png"
                  value={editingRecord.image_file || ""}
                  onChange={(e) => setEditingRecord({ ...editingRecord, image_file: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1rem" }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={saving}
                onClick={() => {
                  setShowEditor(false);
                  setEditingRecord(null);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Record"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Investment Settings Editor Overlay */}
      {showInvEditor && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(15, 23, 42, 0.4)", backdropFilter: "blur(4px)",
          display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000,
          padding: "1rem"
        }}>
          <form onSubmit={handleSaveInvestments} className="panel" style={{
            width: "100%", maxWidth: "500px", padding: "2rem", display: "flex", flexDirection: "column", gap: "1.25rem",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
          }}>
            <h3 style={{ fontSize: "1.25rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.5rem" }}>
              Edit Investment Variables
            </h3>

            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Gross Invoice Amount ($)</label>
              <input
                type="number"
                step="any"
                required
                value={invForm.invoice_amount || 0}
                onChange={(e) => setInvForm({ ...invForm, invoice_amount: Number(e.target.value) })}
                style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Actual Paid out ($)</label>
              <input
                type="number"
                step="any"
                required
                value={invForm.actual_paid || 0}
                onChange={(e) => setInvForm({ ...invForm, actual_paid: Number(e.target.value) })}
                style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>Federal Tax Credit (30% $)</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={invForm.federal_tax_credit || 0}
                  onChange={(e) => setInvForm({ ...invForm, federal_tax_credit: Number(e.target.value) })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", fontWeight: "600", color: "var(--text-secondary)" }}>PECO Utility Rebate ($)</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={invForm.peco_rebate || 0}
                  onChange={(e) => setInvForm({ ...invForm, peco_rebate: Number(e.target.value) })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid var(--border-color)", background: "var(--bg-color)", color: "var(--text-primary)" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1rem" }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={saving}
                onClick={() => setShowInvEditor(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Capital Stats"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main Records List Panel */}
      <div className="panel" style={{ padding: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h3 style={{ fontSize: "1.2rem" }}>🗃️ Database Records ({monthlyData.length})</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Add, update, or clear historical net metering logs in Firestore</p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="btn-secondary" onClick={() => {
              setInvForm({
                invoice_amount: investment?.invoice_amount || 26777,
                actual_paid: investment?.actual_paid || 24777.6,
                federal_tax_credit: investment?.federal_tax_credit || 8033.1,
                peco_rebate: investment?.peco_rebate || 500,
                contract_file: investment?.contract_file || "",
                invoice_file: investment?.invoice_file || "",
                rebate_file: investment?.rebate_file || ""
              });
              setShowInvEditor(true);
            }}>
              ⚙️ Capital Investment
            </button>
            <button className="btn-primary" onClick={() => {
              setEditingRecord({
                customer_charge: 11.30,
                dist_rate: 0.09655,
                supply_rate: 0.10
              });
              setShowEditor(true);
            }}>
              ➕ Add Month Manually
            </button>
          </div>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Grid Import / Export</th>
                <th>Solar Production</th>
                <th>Actual Charge</th>
                <th>Savings</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...monthlyData].sort((a, b) => b.id.localeCompare(a.id)).map(m => (
                <tr key={m.id}>
                  <td className="text-bold">{m.month}</td>
                  <td>
                    {m.import_kwh.toLocaleString()} / {m.export_kwh.toLocaleString()} kWh
                  </td>
                  <td>{m.solar_kwh.toLocaleString()} kWh</td>
                  <td style={{ fontWeight: "700", color: m.actual_charge < 0 ? "var(--color-cloud)" : "inherit" }}>
                    {formatCurrency(m.actual_charge)}
                  </td>
                  <td style={{ color: "var(--color-solar)", fontWeight: "700" }}>{formatCurrency(m.savings)}</td>
                  <td style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                    <button
                      className="btn-secondary"
                      style={{ padding: "0.3rem 0.6rem", borderRadius: "8px", fontSize: "0.8rem" }}
                      onClick={() => {
                        setEditingRecord(m);
                        setShowEditor(true);
                      }}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ padding: "0.3rem 0.6rem", borderRadius: "8px", fontSize: "0.8rem", color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.2)" }}
                      onClick={() => handleDeleteRecord(m.id, m.month)}
                    >
                      🗑️ Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
