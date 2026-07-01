export interface DailyProduction {
    date: string;
    productionWh: number;
    status: string;
}

export interface AuthResponse {
    token: string;
    username: string;
    role: string;
}

export interface MonthlyBillingData {
    id: string; // Document ID (YYYY-MM)
    month: string; // e.g. "Jun 2026"
    bill_file: string;
    image_file: string;
    service_period: string;
    import_kwh: number;
    export_kwh: number;
    solar_gats_kwh: number;
    solar_est_kwh: number;
    actual_charge: number;
    customer_charge: number;
    dist_rate: number;
    supply_rate: number;
    supplier_refund: number;
    solar_kwh: number;
    cons_kwh: number;
    cost_no_solar: number;
    savings: number;
}

export interface InvestmentData {
    invoice_amount: number;
    actual_paid: number;
    federal_tax_credit: number;
    peco_rebate: number;
    net_investment: number;
    contract_file: string;
    invoice_file: string;
    rebate_file: string;
}

