# Instructions for PECO & Enphase Solar Analysis Project

This project contains tools to automatically analyze PECO electric bills and Enphase solar screenshots, calculate your energy usage and net savings, and generate an interactive dashboard.

---

## Folder Structure

* **`peco_bills/`**: Folder containing monthly PECO electric bill PDFs.
* **`enphase_readings/`**: Folder containing Enphase solar app screenshots (JPEG/PNG).
* **`investment_docs/`**: Folder containing solar installation contract, invoice, rebate checks, and other capital documents.
* **`data.json`**: The core database cache. Contains parsed metrics (imports, exports, solar generation, billed cost, and default rates) for each month.
* **`investment.json`**: Contains capital investment details (invoice amount, actual amount paid, federal tax credit, and utility rebates) used for calculating ROI and payback metrics.
* **`Solar_Analysis_Dashboard.html`**: The premium single-page dashboard featuring interactive charts, tabs, and tables.
* **`analyze_and_generate.py`**: The automated Python script that discovers new files, parses their contents, updates the database cache (`data.json`), and re-generates the HTML dashboard.
* **`bin/ocr`**: The compiled macOS Vision OCR tool used to read text from Enphase screenshots.
* **`src/ocr.swift`**: The Swift source code for the OCR tool (uses native Apple Vision framework).

---

## Naming Conventions for New Files

To add new data, name your files strictly according to these conventions and place them in the correct folders:

1. **PECO Utility Bills (PDFs):**
   * Pattern: `PECO_Bill_YYYY-MM.pdf`
   * Example: `PECO_Bill_2026-06.pdf` (for the June 2026 billing cycle statement).
   * **Location**: Place in the `peco_bills/` folder.
   
2. **Enphase App screenshots (JPEGs or PNGs):**
   * Pattern: `Enphase_Reading_YYYY-MM.jpeg` or `Enphase_Reading_YYYY-MM.png`
   * Example: `Enphase_Reading_2026-06.png` (for the June 2026 month view screenshot).
   * **Location**: Place in the `enphase_readings/` folder.

---

## How to Update the Dashboard

When you add new files, update the database and dashboard in one step:

1. Open a terminal in the project directory:
   ```bash
   cd /Users/a081057/Development/poc_projects/Solar_Analysis
   ```
2. Run the update script:
   ```bash
   python3 analyze_and_generate.py
   ```

### What the Script Does Automatically:
* **Discovers New Files:** Scans `peco_bills/` and `enphase_readings/` folders and identifies any new bills or screenshots that are not yet recorded in `data.json`.
* **Extracts Bill Statement Data:** Runs `pdftotext` on new PDFs and uses regex matches to extract the statement date, billing period, grid imports (kWh), grid exports (kWh), and actual electricity charges.
* **Extracts Solar Generation Data:** Invokes `bin/ocr` to perform native text recognition on the new screenshot. It extracts the month, reported total production, and parses the 24 individual microinverter panel outputs to compute the true average and estimated sum (bypassing any screenshot overlays that cover the screen's bottom corner).
* **Updates the Database & Recalculates:** Appends the parsed data to `data.json` and updates all derived metrics (household consumption, cost without solar, and net savings).
* **Generates the Dashboard:** Overwrites `Solar_Analysis_Dashboard.html` with the latest dataset.

---

## How to Adjust or Override Data Manually

The script is designed to be **safe and non-destructive**:
* It only parses files that do **not** already exist in the `data.json` list.
* If a new PECO bill layout changes and the script misinterprets a value, or if you want to manually adjust a value, simply open `data.json` in a text editor, modify the field (e.g. change `"actual_charge": 11.30` or `"solar_est_kwh": 700.0`), and save.
* If you need to update capital investment costs, tax credits, or rebates, open `investment.json` in a text editor and adjust the fields directly.
* Run `python3 analyze_and_generate.py` to re-apply your changes to the dashboard. The script will **not** re-parse the PDF/images for already existing entries.

---

## Re-compiling the OCR Tool (Optional)

If the `bin/ocr` binary is deleted or needs to be rebuilt, you can compile it natively using macOS's built-in Swift compiler:
```bash
swiftc src/ocr.swift -o bin/ocr
```
*No external dependencies or python packages (like pytesseract) are required, as it uses Apple's native Vision API.*
