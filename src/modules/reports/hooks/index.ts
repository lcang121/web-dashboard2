import { ref, query, orderByKey, startAt, endAt, get } from "firebase/database";
import { database } from "../../../config/firebase";
import Transaction from "../../../models/Transaction";
import exportUtils from "../../../utils/exportUtils";
import Moment from "moment-timezone";

// Get current user from localStorage (since we're not in a React component)
// This matches the storage pattern in AuthContext
function getCurrentUserUid(): string | null {
  try {
    const storedUser = localStorage.getItem("@webdashboard:user");
    if (storedUser) {
      const user = JSON.parse(storedUser);
      return user.uid || null;
    }
    return null;
  } catch (error) {
    console.warn("Error getting user from localStorage:", error);
    return null;
  }
}

// Helper to get user settings (placeholder implementation)
function getUserSettings() {
  return exportUtils.getUserSettings();
}

// X Reading functions
export async function saveX(
  startDate?: string,
  endDate?: string,
  upload = false,
) {
  try {
    console.log("saveX called", { startDate, endDate, upload });

    if (!startDate) {
      throw new Error("Start date is required");
    }

    const sttS = Moment(startDate, "YYMMDD").startOf("day").format("X");
    const endS = Moment(endDate || startDate, "YYMMDD")
      .endOf("day")
      .format("X");

    // Generate X reading CSV data
    const xData = exportUtils.generateXCsv(startDate, endDate);
    const timeRange = exportUtils.formatTimeRange(
      parseInt(sttS),
      parseInt(endS),
    );
    const filename = `XReading ${timeRange.start} to ${timeRange.end}`;

    // Download the file
    const result = await exportUtils.downloadCsvFile(xData, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });

    console.log(`X reading generated and downloaded: ${result}`);
    return result;
  } catch (error) {
    console.error("Error in saveX:", error);
    alert(`Error generating X reading: ${error.message}`);
    return null;
  }
}

// Z Reading functions
export async function saveZ(date?: string, upload = false) {
  try {
    console.log("saveZ called", { date, upload });

    if (!date) {
      throw new Error("Date is required");
    }

    const sttS = Moment(date, "YYMMDD").startOf("day").format("X");
    const endS = Moment(date, "YYMMDD").endOf("day").format("X");

    const zData = exportUtils.generateZCsv(date);
    const timeRange = exportUtils.formatTimeRange(
      parseInt(sttS),
      parseInt(endS),
    );
    const filename = `ZReading ${timeRange.start} to ${timeRange.end}`;

    const result = await exportUtils.downloadCsvFile(zData, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });

    console.log(`Z reading generated and downloaded: ${result}`);
    return result;
  } catch (error) {
    console.error("Error in saveZ:", error);
    alert(`Error generating Z reading: ${error.message}`);
    return null;
  }
}

export async function saveZCustom(
  startDate?: string,
  endDate?: string,
  upload = false,
) {
  try {
    console.log("saveZCustom called", { startDate, endDate, upload });

    if (!startDate || !endDate) {
      throw new Error("Start date and end date are required");
    }

    // Convert to timestamps
    const sttS = Moment(startDate, "YYMMDD").startOf("day").unix();
    const endS = Moment(endDate, "YYMMDD").endOf("day").unix();

    // For now, use the same logic as regular Z reading
    const zData = exportUtils.generateZCsv(`${startDate}-${endDate}`);
    const timeRange = exportUtils.formatTimeRange(sttS, endS);
    const filename = `ZReading Custom ${timeRange.start} to ${timeRange.end}`;

    const result = await exportUtils.downloadCsvFile(zData, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });

    console.log(`Custom Z reading generated and downloaded: ${result}`);
    return result;
  } catch (error) {
    console.error("Error in saveZCustom:", error);
    alert(`Error generating custom Z reading: ${error.message}`);
    return null;
  }
}

// Transaction reports
export async function saveTransactions(
  sttS?: number,
  endS?: number,
  isManual = false,
) {
  try {
    console.log("saveTransactions called", { sttS, endS, isManual });

    const userUid = getCurrentUserUid();
    if (!userUid) {
      throw new Error("User not authenticated");
    }

    if (!sttS || !endS) {
      throw new Error("Start and end timestamps are required");
    }

    // Query Firebase for transactions
    const dbPath = isManual ? "manual_transactions" : "transactions";
    const transactionsRef = ref(database, `${userUid}/${dbPath}`);
    const transactionsQuery = query(
      transactionsRef,
      orderByKey(),
      startAt(`${sttS}`),
      endAt(`${endS - 1}`),
    );

    const snapshot = await get(transactionsQuery);
    const transactions: any[] = [];

    if (snapshot.exists()) {
      snapshot.forEach((childSnapshot) => {
        const txn = new Transaction({
          key: childSnapshot.key,
          val: childSnapshot.val(),
        });
        transactions.push(txn);
      });
    }

    // Generate CSV data
    const data = exportUtils.generateTransactionsCsv(transactions, isManual);
    const timeRange = exportUtils.formatTimeRange(sttS, endS);
    const filename = `${isManual ? "Manual " : ""}Transactions Report ${timeRange.start} to ${timeRange.end}`;

    const result = await exportUtils.downloadCsvFile(data, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });

    console.log(`Transactions report generated and downloaded: ${result}`);
    return result;
  } catch (error) {
    console.error("Error in saveTransactions:", error);
    alert(`Error generating transactions report: ${error.message}`);
    throw error;
  }
}

// Returns report (aligns with utakmobile - fetches from returns collection)
export async function saveReturnsReport(
  sttS?: number,
  endS?: number,
  upload = false,
) {
  try {
    const userUid = getCurrentUserUid();
    if (!userUid) throw new Error("User not authenticated");
    if (!sttS || !endS) throw new Error("Start and end timestamps required");

    const returnsRef = ref(database, `${userUid}/returns`);
    const returnsQuery = query(
      returnsRef,
      orderByKey(),
      startAt(`${sttS}`),
      endAt(`${endS}`),
    );
    const snapshot = await get(returnsQuery);

    const headers = [
      "Return No",
      "Original Receipt No",
      "Date",
      "Time",
      "Cashier",
      "Returned Amount",
      "Items",
      "Discount Type",
      "Names",
      "IDs",
      "TINs",
    ];
    const data: string[][] = [headers];

    if (snapshot.exists()) {
      snapshot.forEach((childSnapshot) => {
        const returnData = childSnapshot.val();
        const key = childSnapshot.key;
        const txn = new Transaction({ key, val: returnData });
        const returnAmount = Math.abs(
          (txn.$amountDue || txn.original?.total || 0) / Transaction.MONEY_PRECISION,
        );
        const timestamp = parseInt(String(key), 10);

        const rawItems = Array.isArray(returnData?.items)
          ? returnData.items
          : Object.values(returnData?.items || {});
        const itemsList = rawItems
          .filter((item: any) => item?.returned)
          .map(
            (item: any) =>
              `${item?.title || "Item"} x${Math.abs(item?.quantity || 1)}`,
          )
          .join("; ");

        const metadata = returnData?.seniorAndPwdMetadata || {};
        const row = [
          returnData?.returnNo || "",
          returnData?.receiptNo || "",
          Moment.unix(timestamp).format("MM/DD/YYYY"),
          Moment.unix(timestamp).format("hh:mm:ss A"),
          returnData?.cashier || "",
          returnAmount.toFixed(2),
          itemsList,
          returnData?.transactionDiscountType || "",
          metadata?.names || "",
          metadata?.ids || "",
          metadata?.tins || "",
        ];
        data.push(row);
      });
    }

    const timeRange = exportUtils.formatTimeRange(sttS, endS);
    const filename = `Returns Report ${timeRange.start} to ${timeRange.end}`;
    const result = await exportUtils.downloadCsvFile(data, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });
    return result;
  } catch (error) {
    console.error("Error in saveReturnsReport:", error);
    alert(`Error generating returns report: ${error.message}`);
    return null;
  }
}

// Refunds report
export async function saveRefunds(
  startDate?: string,
  endDate?: string,
  upload = false,
) {
  try {
    console.log("saveRefunds called", { startDate, endDate, upload });

    if (!startDate) {
      throw new Error("Start date is required");
    }

    const sttS = parseInt(
      Moment(startDate, "YYMMDD").startOf("day").format("X"),
    );
    const endS = parseInt(
      Moment(endDate || startDate, "YYMMDD")
        .endOf("day")
        .format("X"),
    );

    const refundsData = exportUtils.generateRefundsCsv(sttS, endS);
    const timeRange = exportUtils.formatTimeRange(sttS, endS);
    const filename = `Refunds Report ${timeRange.start} to ${timeRange.end}`;

    const result = await exportUtils.downloadCsvFile(refundsData, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });

    console.log(`Refunds report generated and downloaded: ${result}`);
    return result;
  } catch (error) {
    console.error("Error in saveRefunds:", error);
    alert(`Error generating refunds report: ${error.message}`);
    return null;
  }
}

// Get Z-Reading history for reprint (aligns with utakmobile)
export async function getZReadingHistory(): Promise<Record<string, any>> {
  try {
    const userUid = getCurrentUserUid();
    if (!userUid) return {};

    const historyRef = ref(database, `${userUid}/zReadingHistory`);
    const historyQuery = query(historyRef, orderByKey());
    const snapshot = await get(historyQuery);
    return snapshot.val() || {};
  } catch (error) {
    console.error("Error fetching Z-reading history:", error);
    return {};
  }
}

// Get X-Reading history for reprint (aligns with utakmobile)
export async function getXReadingHistory(): Promise<Record<string, any>> {
  try {
    const userUid = getCurrentUserUid();
    if (!userUid) return {};

    const historyRef = ref(database, `${userUid}/xReadingHistory`);
    const historyQuery = query(historyRef, orderByKey());
    const snapshot = await get(historyQuery);
    return snapshot.val() || {};
  } catch (error) {
    console.error("Error fetching X-reading history:", error);
    return {};
  }
}

// Journal report - supports type: 'all' | 'z' | 'x' (aligns with utakmobile)
export async function saveJournal(
  stt?: string,
  end?: string,
  upload = false,
  type: "all" | "z" | "x" = "all",
) {
  try {
    console.log("saveJournal called", { stt, end, upload, type });

    const userUid = getCurrentUserUid();
    if (!userUid) {
      throw new Error("User not authenticated");
    }

    if (!stt || !end) {
      throw new Error("Start and end dates are required");
    }

    const sttS = Moment(stt, "YYMMDD").startOf("day").format("X");
    const endS = Moment(end, "YYMMDD").endOf("day").format("X");

    // Query journal data from Firebase
    const journalRef = ref(database, `${userUid}/journal`);
    const journalQuery = query(
      journalRef,
      orderByKey(),
      startAt(sttS),
      endAt(endS),
    );

    const snapshot = await get(journalQuery);
    let journal = "";

    if (snapshot.exists()) {
      snapshot.forEach((childSnapshot) => {
        const journalData = childSnapshot.val();
        if (type === "z") {
          journal += journalData.zReading || "";
        } else if (type === "x") {
          journal += journalData.xReading || "";
        } else {
          journal += journalData.transaction || "";
          journal += journalData.refund || "";
          journal += journalData.void || "";
          journal += journalData.return || "";
        }
      });
    }

    if (!journal.trim()) {
      const typeLabel =
        type === "z" ? "Z-Reading " : type === "x" ? "X-Reading " : "";
      alert(
        `No ${typeLabel}journal data found for the selected date range.`,
      );
      return null;
    }

    const timeRange = exportUtils.formatTimeRange(
      parseInt(sttS),
      parseInt(endS),
    );
    const typeLabel = type === "z" ? "Z-Reading " : type === "x" ? "X-Reading " : "";
    const filename = `BIR eSales ${typeLabel}Journal ${timeRange.start} to ${timeRange.end}.txt`;

    // Create and download text file
    const blob = new Blob([journal], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(globalThis as any).isInTrainingMode ? "[TRAINING MODE] " : ""}${filename}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    console.log(`Journal saved and downloaded: ${filename}`);
    return filename;
  } catch (error) {
    console.error("Error in saveJournal:", error);
    alert(`Error generating journal: ${error.message}`);
    return null;
  }
}

// Sales Summary Excel report
export async function saveSalesSummary(
  stt?: string,
  end?: string,
  upload = false,
) {
  try {
    console.log("saveSalesSummary called", { stt, end, upload });

    const userUid = getCurrentUserUid();
    if (!userUid) {
      throw new Error("User not authenticated");
    }

    if (!stt || !end) {
      throw new Error("Start and end dates are required");
    }

    const sttS = parseInt(Moment(stt, "YYMMDD").startOf("day").format("X"));
    const endS = parseInt(Moment(end, "YYMMDD").endOf("day").format("X"));

    // Query transactions for the date range
    const transactionsRef = ref(database, `${userUid}/transactions`);
    const transactionsQuery = query(
      transactionsRef,
      orderByKey(),
      startAt(`${sttS}`),
      endAt(`${endS - 1}`),
    );

    const snapshot = await get(transactionsQuery);
    const transactions: Transaction[] = [];

    if (snapshot.exists()) {
      snapshot.forEach((childSnapshot) => {
        const txn = new Transaction({
          key: childSnapshot.key,
          val: childSnapshot.val(),
        });
        transactions.push(txn);
      });
    }

    // Generate sales summary data
    const settings = getUserSettings();
    const timeRange = exportUtils.formatTimeRange(sttS, endS);

    // Build workbook data
    const workbookData: { [sheetName: string]: any[][] } = {};

    // Main sales summary sheet
    const headerTitle = ["BIR SALES SUMMARY REPORT"];
    const metaRows = [
      ["Name", settings.name],
      ["Address", settings.address],
      [
        "TIN",
        settings.receiptDetails?.VATTIN
          ? `VAT REG TIN ${settings.receiptDetails.VATTIN}`
          : settings.receiptDetails?.NONVATTIN
            ? `NON VAT REG TIN ${settings.receiptDetails.NONVATTIN}`
            : "",
      ],
      ["Software", "UTAKPOS v1.0.0"],
      ["Serial No", settings.receiptDetails?.SN || ""],
      ["MIN", settings.receiptDetails?.MIN || ""],
      ["POS Terminal No", "1"],
      ["Generated", Moment().format("MMMM D, YYYY h:mma")],
      ["UserID", settings.account.split("@")[0]],
      ["Report Period", `${timeRange.start} to ${timeRange.end}`],
      ["", ""],
    ];

    // BIR-compliant column headers (aligns with utakmobile mod_temp_bir/csvs/salesSummary.ts)
    const headerColumns = [
      "Date",
      `Beginning ${settings.receiptDetails?.receiptType || "OR"} No.`,
      `Ending ${settings.receiptDetails?.receiptType || "OR"} No.`,
      "Grand Accum. Sales Balance",
      "Grand Accum. Beg Balance",
      "Gross Sales for the Day",
      "VATable Sales",
      "VAT-Exempt Sales",
      "VAT Zero-Rated Sales",
      "VAT Amount",
      "Discounts",
      "Returns",
      "Voids",
      "Total Deductions",
      "Adjustment on VAT: SC",
      "Adjustment on VAT: PWD",
      "Adjustment on VAT: Others",
      "VAT on Return",
      "Total VAT Adjustment",
      "VAT Payable",
      "Net Sales",
      "Sales Overrun/Overflow",
      "Reset Counter",
      "Z-Counter",
      "Remarks",
    ];

    // Sales summary calculation (simplified - full BIR logic in utakmobile)
    const summaryRows = [];
    let totalSales = 0;
    let totalVAT = 0;
    let totalVatableSales = 0;
    let totalVatExempt = 0;
    let totalZeroRated = 0;
    let totalDiscount = 0;

    transactions.forEach((txn) => {
      totalSales += txn.getDisplayValue("$netSales");
      totalVAT += txn.getDisplayValue("$vat");
      totalVatableSales += txn.getDisplayValue("$vatableSales");
      totalVatExempt += txn.getDisplayValue("$vatExemptSales");
      totalZeroRated += txn.getDisplayValue("$zeroRatedSales");
      totalDiscount += txn.getDisplayValue("$discount");
    });

    const firstReceipt = transactions[0]?.original?.receiptNo ?? "000001";
    const lastReceipt = transactions[transactions.length - 1]?.original?.receiptNo ?? firstReceipt;

    summaryRows.push([
      Moment.unix(sttS).format("MM/DD/YYYY"),
      String(firstReceipt).padStart(6, "0"),
      String(lastReceipt).padStart(6, "0"),
      totalSales.toFixed(2),
      0, // Grand Accum. Beg Balance
      totalSales.toFixed(2),
      totalVatableSales.toFixed(2),
      totalVatExempt.toFixed(2),
      totalZeroRated.toFixed(2),
      totalVAT.toFixed(2),
      totalDiscount.toFixed(2),
      0, // Returns
      0, // Voids
      totalDiscount.toFixed(2), // Total Deductions
      0, // Adjustment on VAT: SC
      0, // Adjustment on VAT: PWD
      0, // Adjustment on VAT: Others
      0, // VAT on Return
      0, // Total VAT Adjustment
      totalVAT.toFixed(2),
      (totalSales - totalVAT).toFixed(2),
      "", // Sales Overrun/Overflow
      (settings as any).BIRresetNo ?? "00",
      (settings as any).zReadNo ?? 0,
      "",
    ]);

    workbookData["SalesSummary"] = [
      headerTitle,
      ...metaRows,
      headerColumns,
      ...summaryRows,
    ];

    const filename = `Sales Summary Report ${timeRange.start} to ${timeRange.end}`;
    const result = await exportUtils.downloadExcelFile(workbookData, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });

    console.log(`Sales summary generated and downloaded: ${result}`);
    return result;
  } catch (error) {
    console.error("Error in saveSalesSummary:", error);
    alert(`Error generating sales summary: ${error.message}`);
    return null;
  }
}

// Special discounts Excel report
export async function saveSpecialDiscounts(
  stt?: string,
  end?: string,
  upload = false,
) {
  try {
    console.log("saveSpecialDiscounts called", { stt, end, upload });

    if (!stt || !end) {
      throw new Error("Start and end dates are required");
    }

    const timeRange = exportUtils.formatTimeRange(
      parseInt(Moment(stt, "YYMMDD").startOf("day").format("X")),
      parseInt(Moment(end, "YYMMDD").endOf("day").format("X")),
    );

    // Placeholder implementation - would need actual discount data processing
    const settings = getUserSettings();
    const workbookData: { [sheetName: string]: any[][] } = {};

    // Senior Citizen sheet
    workbookData["SeniorCitizen"] = [
      ["Senior Citizen Sales Book/Report"],
      ["", ""],
      ["Report Period:", `${timeRange.start} to ${timeRange.end}`],
      ["Business Name:", settings.name],
      ["TIN:", settings.receiptDetails?.VATTIN || ""],
      ["Address:", settings.address],
      ["", ""],
      [
        "Date",
        "Receipt No.",
        "Name",
        "TIN/OSCA ID",
        "Gross Amount",
        "Discount",
        "Net Amount",
      ],
      // Data rows would go here
    ];

    // PWD sheet
    workbookData["PWD"] = [
      ["Persons with Disability Sales Book/Report"],
      ["", ""],
      ["Report Period:", `${timeRange.start} to ${timeRange.end}`],
      ["Business Name:", settings.name],
      ["TIN:", settings.receiptDetails?.VATTIN || ""],
      ["Address:", settings.address],
      ["", ""],
      [
        "Date",
        "Receipt No.",
        "Name",
        "PWD ID",
        "Gross Amount",
        "Discount",
        "Net Amount",
      ],
      // Data rows would go here
    ];

    const filename = `Discount Report ${timeRange.start} to ${timeRange.end}`;
    const result = await exportUtils.downloadExcelFile(workbookData, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });

    console.log(`Discount report generated and downloaded: ${result}`);
    return result;
  } catch (error) {
    console.error("Error in saveSpecialDiscounts:", error);
    alert(`Error generating discount report: ${error.message}`);
    return null;
  }
}

// View journal (read-only) - supports type: 'all' | 'z' | 'x' (aligns with utakmobile)
export async function viewJournal(
  stt?: string,
  end?: string,
  type: "all" | "z" | "x" = "all",
) {
  try {
    console.log("viewJournal called", { stt, end, type });

    const userUid = getCurrentUserUid();
    if (!userUid) {
      throw new Error("User not authenticated");
    }

    if (!stt || !end) {
      throw new Error("Start and end dates are required");
    }

    const sttS = Moment(stt, "YYMMDD").startOf("day").format("X");
    const endS = Moment(end, "YYMMDD").endOf("day").format("X");

    const journalRef = ref(database, `${userUid}/journal`);
    const journalQuery = query(
      journalRef,
      orderByKey(),
      startAt(sttS),
      endAt(endS),
    );

    const snapshot = await get(journalQuery);
    let journal = "";

    if (snapshot.exists()) {
      snapshot.forEach((childSnapshot) => {
        const journalData = childSnapshot.val();
        if (type === "z") {
          journal += journalData.zReading || "";
        } else if (type === "x") {
          journal += journalData.xReading || "";
        } else {
          journal += journalData.transaction || "";
          journal += journalData.refund || "";
          journal += journalData.void || "";
          journal += journalData.return || "";
        }
      });
    }

    return journal || "No journal data found for the selected date range.";
  } catch (error) {
    console.error("Error in viewJournal:", error);
    return `Error loading journal: ${error.message}`;
  }
}

// Print functions (web-compatible versions)
export async function printZ(date?: string) {
  console.log("printZ called - Print functionality adapted for web");
  try {
    // Generate and download Z reading instead of printing
    const result = await saveZ(date, false);
    alert(
      "Z Reading has been downloaded. Please use your browser's print function if you need a physical copy.",
    );
    return result;
  } catch (error) {
    console.error("Error in printZ:", error);
    alert(`Error generating Z reading: ${error.message}`);
    return null;
  }
}

export async function printX(startDate?: string, endDate?: string) {
  console.log("printX called - Print functionality adapted for web");
  try {
    const result = await saveX(startDate, endDate, false);
    alert(
      "X Reading has been downloaded. Please use your browser's print function if you need a physical copy.",
    );
    return result;
  } catch (error) {
    console.error("Error in printX:", error);
    alert(`Error generating X reading: ${error.message}`);
    return null;
  }
}

export async function printZCustom(
  startTimestamp?: string,
  endTimestamp?: string,
) {
  console.log("printZCustom called - Print functionality adapted for web");
  try {
    // Convert timestamps to date format
    const startDate = startTimestamp
      ? Moment.unix(parseInt(startTimestamp)).format("YYMMDD")
      : undefined;
    const endDate = endTimestamp
      ? Moment.unix(parseInt(endTimestamp)).format("YYMMDD")
      : undefined;

    const result = await saveZCustom(startDate, endDate, false);
    alert(
      "Custom Z Reading has been downloaded. Please use your browser's print function if you need a physical copy.",
    );
    return result;
  } catch (error) {
    console.error("Error in printZCustom:", error);
    alert(`Error generating custom Z reading: ${error.message}`);
    return null;
  }
}

export async function printJournal(
  stt?: string,
  end?: string,
  type: "all" | "z" | "x" = "all",
) {
  console.log("printJournal called - Print functionality adapted for web");
  try {
    const date = stt || Moment().format("YYMMDD");
    const endDate = end || date;
    const result = await saveJournal(date, endDate, false, type);
    alert(
      "Journal has been downloaded. Please use your browser's print function if you need a physical copy.",
    );
    return result;
  } catch (error) {
    console.error("Error in printJournal:", error);
    alert(`Error generating journal: ${error.message}`);
    return null;
  }
}

export async function printRefunds(
  startTimestamp?: string,
  endTimestamp?: string,
) {
  console.log("printRefunds called - Print functionality adapted for web");
  try {
    // Convert timestamps to date format
    const startDate = startTimestamp
      ? Moment.unix(parseInt(startTimestamp)).format("YYMMDD")
      : undefined;
    const endDate = endTimestamp
      ? Moment.unix(parseInt(endTimestamp)).format("YYMMDD")
      : undefined;

    const result = await saveRefunds(startDate, endDate, false);
    alert(
      "Refunds report has been downloaded. Please use your browser's print function if you need a physical copy.",
    );
    return result;
  } catch (error) {
    console.error("Error in printRefunds:", error);
    alert(`Error generating refunds report: ${error.message}`);
    return null;
  }
}

export async function printExpenses(
  startTimestamp?: string,
  endTimestamp?: string,
) {
  console.log("printExpenses called - Print functionality adapted for web");
  // For now, this is a placeholder as we don't have expenses functionality implemented
  alert(
    "Expenses report functionality is not yet implemented in the web version.",
  );
  return null;
}
