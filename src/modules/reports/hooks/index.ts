import { ref, query, orderByKey, startAt, endAt, get } from "firebase/database";
import { database } from "../../../config/firebase";
import Transaction from "../../../models/Transaction";
import TransactionItem from "../../../models/TransactionItem";
import exportUtils from "../../../utils/exportUtils";
import Moment from "moment-timezone";
import { getTransactionSummary } from "../../../utils/bir/transaction";
import { getRefundSummary, getReturnSummary, getVoidSummary } from "../../../utils/bir/refund";
import { calcReadingData } from "../../../utils/bir/calcReadingData";
import { SalesSummary, DetailedSalesReport, SALES_SUMMARY_COLUMNS } from "../../../utils/bir/salesSummary";
import { renderReading } from "../../../utils/bir/readingReceipt";
import { aggregateProductMixFromSnapshot } from "../../../utils/bir/productMix";
import { appendTotalsRow } from "../../../utils/bir/totals";
import { specialDiscounts } from "../../../utils/bir/specialDiscounts";

const MP = Transaction.MONEY_PRECISION;

// Normalized discount types matching BIR requirements
function normalizeDiscountType(type?: string): string {
  const t = String(type || "").trim().toLowerCase();
  if (!t) return "";
  if (["sc", "senior", "seniorcitizen", "senior_citizen"].includes(t)) return "senior";
  if (["pwd", "personwithdisability", "person_with_disability"].includes(t)) return "pwd";
  if (["sp", "soloparent", "solo_parent"].includes(t)) return "soloParent";
  if (["ntl", "ntlathlete", "naac", "nationalathlete"].includes(t)) return "ntlAthlete";
  if (["diplomat"].includes(t)) return "diplomat";
  if (["mov", "medalofvalor", "medal_of_valor"].includes(t)) return "medalOfValor";
  if (["commodity"].includes(t)) return "commodity";
  if (["regular"].includes(t)) return "regular";
  // Promotional discounts behave exactly like regular percentage discounts.
  if (["promotional", "promo"].includes(t)) return "regular";
  return String(type || "");
}

function mapPaxDiscType(discType?: string): string {
  const normalized = normalizeDiscountType(discType);
  if (normalized === "ntlAthlete") return "ntlAthlete";
  if (normalized === "soloParent") return "soloParent";
  if (normalized === "medalOfValor") return "medalOfValor";
  return normalized || "";
}

function resolveDiscountType(item: any): string {
  const explicit = normalizeDiscountType(item?.individualDiscountType || item?.transactionDiscountType || "");
  if (explicit) return explicit;

  const pax = item?.paxDiscount;
  if (!pax || typeof pax !== 'object') return "";

  if (pax.senior) return 'senior';
  if (pax.pwd) return 'pwd';
  if (pax.sp) return 'soloParent';
  if (pax.ntl) return 'ntlAthlete';
  if (pax.diplomat) return 'diplomat';
  if (pax.medalOfValor) return 'medalOfValor';
  if (pax.regular) return 'regular';
  return "";
}

function resolveDiscountRate(item: any, discountType: string): number {
  const pax = item?.paxDiscount;
  if (pax && typeof pax === 'object') {
    if (discountType === 'senior' && pax.senior) return (parseFloat(pax.senior.percent) || 20) / 100;
    if (discountType === 'pwd' && pax.pwd) return (parseFloat(pax.pwd.percent) || 20) / 100;
    if (discountType === 'soloParent' && pax.sp) return (parseFloat(pax.sp.percent) || 10) / 100;
    if (discountType === 'medalOfValor' && pax.medalOfValor)
      return (parseFloat(pax.medalOfValor.percent) || 20) / 100;
    if (discountType === 'regular' && pax.regular) return (parseFloat(pax.regular.percent) || 0) / 100;
  }

  if (discountType === 'senior') return 0.2;
  if (discountType === 'pwd') return 0.2;
  if (discountType === 'soloParent') return 0.1;
  if (discountType === 'medalOfValor') return 0.2;
  return 0;
}

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

// getRefundSummary/getReturnSummary/getVoidSummary come from utils/bir/refund,
// which mirrors the device's HelperFunctions/refund.js. A local copy used to
// live here and shadowed the import: it divided VAT-inclusive prices by 0.12
// instead of 1.12, dropped Medal of Valor, and returned neither `date`,
// `transactionKey` nor `refundsByPaymentType` — the fields the Sales Summary
// per-day filter and calcReadingData's payment-reversal netting rely on.

// Get PAX discount summary from refunded items
function getPaxDiscountSummary(items: any[] = []): { amount: number; types: string[] } {
  let amount = 0;
  const types = new Set<string>();
  const vatRate = 0.12;

  for (const item of items) {
    let usedParts = false;

    if (item?._parts?.values) {
      for (const [, part] of Object.entries(item._parts.values)) {
        const discType = mapPaxDiscType((part as any)?.discType);
        if (discType) types.add(discType);

        if ((part as any)?.discType === 'diplomat') {
          amount += Math.abs(Number((part as any)?.vatExemption) || 0);
        } else {
          amount += Math.abs(Number((part as any)?.discount) || 0);
        }
      }
      usedParts = true;
    }

    if (!usedParts && item?.paxDiscount && typeof item.paxDiscount === 'object') {
      const paxEntries = Object.entries(item.paxDiscount);
      const totalGuests = paxEntries.reduce(
        (sum, [, v]) => sum + (parseInt((v as any)?.guestCount, 10) || 0),
        0,
      );
      const totalPrice = Math.abs(Number(item?.price || 0) * Number(item?.quantity || 0));
      const baseAmount = totalPrice / (1 + vatRate);

      for (const [k, v] of paxEntries) {
        const guestCount = parseInt((v as any)?.guestCount, 10) || 0;
        if (guestCount <= 0) continue;
        const discType = mapPaxDiscType(k);
        if (discType) types.add(discType);

        const ratio = totalGuests > 0 ? guestCount / totalGuests : 0;
        const proportionalBase = baseAmount * ratio;
        const parsedRate = (parseFloat((v as any)?.percent) || 0) / 100;
        const defaultRate =
          discType === 'senior' || discType === 'pwd'
            ? 0.2
            : discType === 'soloParent'
            ? 0.1
            : discType === 'ntlAthlete'
            ? 0.2
            : 0;
        const rate = parsedRate || defaultRate;

        if (discType === 'diplomat') {
          amount += proportionalBase * vatRate;
        } else {
          amount += proportionalBase * rate;
        }
      }
    }
  }

  return { amount, types: Array.from(types) };
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
    const xData = await exportUtils.generateXCsv(startDate, endDate);
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

    const zData = await exportUtils.generateZCsv(date);
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

    const zData = await exportUtils.generateZCsv(startDate, endDate);
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

    // generateTransactionsCsv already appends the TOTAL row and comma-formats
    // the money columns, mirroring the device's csvs/transactions.
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
// Helper to format receipt number
function formatReceiptNoSimple(cycle: number, no: string | number): string {
  if (no === '' || no === undefined || no === null) return '';
  const cycleNum = Math.max(0, parseInt(String(cycle ?? 0), 10) || 0);
  const noNum = Math.max(0, parseInt(String(no), 10) || 0);
  const c = String(cycleNum).padStart(2, '0');
  const n6 = String(noNum).padStart(6, '0');
  return `${c}-${n6}`;
}

// Helper to extract customer metadata from PAX or seniorAndPwdMetadata
function resolveCustomerMetadataForReturn(record: any, items: any[] = []): { names: string; ids: string; tins: string } {
  const meta = record?.seniorAndPwdMetadata || {};
  const normalized = {
    names: String(meta?.names || '').trim(),
    ids: String(meta?.ids || '').trim(),
    tins: String(meta?.tins || '').trim(),
  };

  if (normalized.names || normalized.ids || normalized.tins) {
    return normalized;
  }

  // Fallback: extract from PAX
  const names = [];
  const ids = [];
  const tins = [];
  for (const item of items || []) {
    const pax = item?.paxDiscount;
    if (!pax || typeof pax !== 'object') continue;
    for (const entry of Object.values(pax) as any[]) {
      if (entry?.names) names.push(...String(entry.names || '').split(/[\n,]+/).map((v: string) => v.trim()).filter(Boolean));
      if (entry?.ids) ids.push(...String(entry.ids || '').split(/[\n,]+/).map((v: string) => v.trim()).filter(Boolean));
      if (entry?.tins) tins.push(...String(entry.tins || '').split(/[\n,]+/).map((v: string) => v.trim()).filter(Boolean));
    }
  }

  return {
    names: [...new Set(names)].join('\n'),
    ids: [...new Set(ids)].join('\n'),
    tins: [...new Set(tins)].join('\n'),
  };
}

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
      'Return No',
      'SI No',
      'Date',
      'Time',
      'Cashier',
      'Returned Amount',
      'Z Less Return (Sales Adj)',
      'Z VAT on Return (VAT Adj)',
      'Z Service Charge',
      'Z Total Return Effect',
      'Discount Type',
      'Discount Amount',
      'Items',
      'Item Discount Types',
      'Names',
      'IDs',
      'TINs',
    ];
    const data: any[][] = [headers];

    if (snapshot.exists()) {
      const zReturnSummary = getReturnSummary(snapshot);
      const zReturnByKey = new Map(
        (zReturnSummary?.returns || []).map((r: any) => [String(r.key), r]),
      );

      snapshot.forEach((returnSnapshot: any) => {
        const returnData = returnSnapshot.val();
        if (returnData?.trainingMode) return;
        const returnKey = returnSnapshot.key;
        const timestamp = parseInt(returnKey);

        const isReturnedItem = (item: any) =>
          item?.return != null && Number(item.return) === Number(returnKey);

        const returnedItems = (returnData.items || []).filter(isReturnedItem);
        const returnAmount = returnedItems.reduce((sum: number, item: any, i: number) => {
          const $itm = new TransactionItem({ val: item, key: i });
          return sum + Math.abs($itm.__itmTotal) / MP;
        }, 0);
        const zAligned = zReturnByKey.get(String(returnKey));
        const salesAdjustmentReturn = Math.abs(
          Number(
            zAligned
              ? (zAligned.vatableSales || 0) + (zAligned.vatExemptSales || 0) + (zAligned.zeroRatedSales || 0)
              : returnAmount,
          ) || 0,
        );
        const vatOnReturnAdjustment = Math.abs(Number(zAligned?.vatAmount) || 0);
        const $txnReturn = returnedItems.length
          ? Transaction.asAdjustment({ key: returnKey, val: { ...returnData, items: returnedItems } })
          : { $service: 0 };
        const serviceChargeReturn = Math.abs(Number($txnReturn.$service) || 0) / MP;
        const returnedAmountForReport = Math.abs(
          Number(zAligned?.returnAmount ?? returnAmount) || 0,
        );
        const zReturnImpact = salesAdjustmentReturn + vatOnReturnAdjustment + serviceChargeReturn;

        const totalDiscountMP = returnedItems.reduce((sum: number, item: any, i: number) => {
          const $itm = new TransactionItem({ val: item, key: i });
          const d = $itm._parts?.discount != null
            ? Math.abs($itm._parts.discount)
            : Math.abs($itm.$discount);
          return sum + d;
        }, 0);
        const discountAmount = totalDiscountMP > 0 ? (totalDiscountMP / MP).toFixed(2) : '';
        const itemsList = returnedItems
          .map((item: any) => `${item.title || ''} x${Math.abs(item.quantity || 1)}`)
          .join('; ');

        const discountType = returnData.transactionDiscountType || '';
        const itemDiscountTypes = [...new Set(
          returnedItems.flatMap((item: any) => {
            const types = [];
            const explicit = item.individualDiscountType || item.transactionDiscountType || '';
            if (explicit) types.push(explicit);
            if (item.paxDiscount && typeof item.paxDiscount === 'object') {
              for (const k of Object.keys(item.paxDiscount)) {
                const mapped = normalizeDiscountType(k);
                if (mapped) types.push(mapped);
              }
            }
            return types.filter(Boolean);
          }),
        )].join('; ');
        const effectiveDiscountType = discountType || itemDiscountTypes;

        const metadata = resolveCustomerMetadataForReturn(returnData, returnedItems);
        const siFormatted = returnData.receiptNo != null ? formatReceiptNoSimple(returnData.receiptCycle ?? 0, returnData.receiptNo) : '';
        const row = [
          returnData.returnNo || '',
          siFormatted,
          Moment.unix(timestamp).format('MM/DD/YYYY'),
          Moment.unix(timestamp).format('hh:mm:ss A'),
          returnData.cashier || '',
          returnedAmountForReport.toFixed(2),
          salesAdjustmentReturn.toFixed(2),
          vatOnReturnAdjustment.toFixed(2),
          serviceChargeReturn.toFixed(2),
          zReturnImpact.toFixed(2),
          effectiveDiscountType,
          discountAmount,
          itemsList,
          itemDiscountTypes,
          metadata.names || '',
          metadata.ids || '',
          metadata.tins || '',
        ];

        data.push(row);
      });
    }

    const timeRange = exportUtils.formatTimeRange(sttS, endS);
    const filename = `Returns Report ${timeRange.start} to ${timeRange.end}`;
    // Totals row last. Label/identifier columns are skipped by header — an
    // "Items" cell like "Coffee x1" would otherwise parse as 1 and get summed.
    const dataWithTotals = appendTotalsRow(data, { excludeHeaders: ['Discount Type', 'Items', 'Item Discount Types', 'Names', 'IDs', 'TINs'] });
    const result = await exportUtils.downloadCsvFile(dataWithTotals, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });
    return result;
  } catch (error) {
    console.error("Error in saveReturnsReport:", error);
    alert(`Error generating returns report: ${(error as any).message}`);
    return null;
  }
}

// Voids report
export async function saveVoidsReport(
  sttS?: number,
  endS?: number,
  upload = false,
) {
  try {
    const userUid = getCurrentUserUid();
    if (!userUid) throw new Error("User not authenticated");
    if (!sttS || !endS) throw new Error("Start and end timestamps required");

    const voidsRef = ref(database, `${userUid}/voids`);
    const voidsQuery = query(
      voidsRef,
      orderByKey(),
      startAt(`${sttS}`),
      endAt(`${endS}`),
    );
    const snapshot = await get(voidsQuery);

    const headers = [
      'Void No',
      'SI No',
      'Date',
      'Time',
      'Cashier',
      'Voided Amount',
      'Z Less Void (Sales Adj)',
      'Z VAT on Void (VAT Adj)',
      'Z Service Charge',
      'Z Total Void Effect',
      'Reason',
      'Discount Type',
      'Discount Amount',
      'Items',
      'Item Discount Types',
      'Names',
      'IDs',
      'TINs',
    ];
    const data: any[][] = [headers];

    if (snapshot.exists()) {
      const zVoidSummary = getVoidSummary(snapshot);
      const zVoidByKey = new Map(
        (zVoidSummary?.voids || []).map((v: any) => [String(v.key), v]),
      );

      snapshot.forEach((voidSnapshot: any) => {
        const voidData = voidSnapshot.val();
        if (voidData?.trainingMode) return;
        if (voidData?.isCancel === true) return;

        const voidKey = voidSnapshot.key;
        const timestamp = parseInt(voidKey);
        const voidAmount = parseFloat(voidData.amount) || 0;
        const zAligned = zVoidByKey.get(String(voidKey));
        const salesAdjustmentVoid = Math.abs(Number(zAligned?.voidBase ?? 0) || 0);
        const vatOnVoidAdjustment = Math.abs(Number(zAligned?.voidVat ?? 0) || 0);

        const voidItems = voidData.items || [];
        const $txnVoid = voidItems.length
          ? Transaction.asAdjustment({ key: voidKey, val: { ...voidData, items: voidItems } })
          : { $service: 0 };
        const serviceChargeVoid = Math.abs(Number($txnVoid.$service) || 0) / MP;
        const zVoidImpact = salesAdjustmentVoid + vatOnVoidAdjustment + serviceChargeVoid;

        const totalDiscountMP = voidItems.reduce((sum: number, item: any, i: number) => {
          if (!item) return sum;
          const $itm = new TransactionItem({ val: item, key: i });
          const d = $itm._parts?.discount != null
            ? Math.abs($itm._parts.discount)
            : Math.abs($itm.$discount);
          return sum + d;
        }, 0);
        const discountAmount = totalDiscountMP > 0 ? (totalDiscountMP / MP).toFixed(2) : '';

        const itemsList = voidItems
          .map((item: any) => `${item.title || ''} x${Math.abs(item.quantity || 1)}`)
          .join('; ');

        const discountType = voidData.transactionDiscountType || '';
        const itemDiscountTypes = [...new Set(
          voidItems.flatMap((item: any) => {
            const types = [];
            const explicit = item?.individualDiscountType || item?.transactionDiscountType || '';
            if (explicit) types.push(explicit);
            if (item?.paxDiscount && typeof item.paxDiscount === 'object') {
              for (const k of Object.keys(item.paxDiscount)) {
                const mapped = normalizeDiscountType(k);
                if (mapped) types.push(mapped);
              }
            }
            return types.filter(Boolean);
          }),
        )].join('; ');
        const effectiveDiscountType = discountType || itemDiscountTypes;

        const metadata = resolveCustomerMetadataForReturn(voidData, voidItems);
        const siFormatted = voidData.receiptNo != null
          ? formatReceiptNoSimple(voidData.receiptCycle ?? 0, voidData.receiptNo)
          : '';

        const row = [
          voidData.voidNo ?? '',
          siFormatted,
          Moment.unix(timestamp).format('MM/DD/YYYY'),
          Moment.unix(timestamp).format('hh:mm:ss A'),
          voidData.cashier || '',
          voidAmount.toFixed(2),
          salesAdjustmentVoid.toFixed(2),
          vatOnVoidAdjustment.toFixed(2),
          serviceChargeVoid.toFixed(2),
          zVoidImpact.toFixed(2),
          voidData.reason || '',
          effectiveDiscountType,
          discountAmount,
          itemsList,
          itemDiscountTypes,
          metadata.names || '',
          metadata.ids || '',
          metadata.tins || '',
        ];

        data.push(row);
      });
    }

    const timeRange = exportUtils.formatTimeRange(sttS, endS);
    const filename = `Voids Report ${timeRange.start} to ${timeRange.end}`;
    // Totals row last. Label/identifier columns are skipped by header — an
    // "Items" cell like "Coffee x1" would otherwise parse as 1 and get summed.
    const dataWithTotals = appendTotalsRow(data, { excludeHeaders: ['Reason', 'Discount Type', 'Items', 'Item Discount Types', 'Names', 'IDs', 'TINs'] });
    const result = await exportUtils.downloadCsvFile(dataWithTotals, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });
    return result;
  } catch (error) {
    console.error("Error in saveVoidsReport:", error);
    alert(`Error generating voids report: ${(error as any).message}`);
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

    const userUid = getCurrentUserUid();
    if (!userUid) {
      throw new Error("User not authenticated");
    }

    const refundsRef = ref(database, `${userUid}/refunds`);
    const refundsQuery = query(
      refundsRef,
      orderByKey(),
      startAt(`${sttS}`),
      endAt(`${endS}`),
    );
    const snapshot = await get(refundsQuery);

    const headers = [
      "Refund No",
      "SI No",
      "Date",
      "Time",
      "Cashier",
      "Refunded Amount",
      "Z Less Refund (Sales Adj)",
      "Z VAT on Refund (VAT Adj)",
      "Z Service Charge",
      "Z Total Refund Effect",
      "Discount Type",
      "Discount Amount",
      "Items",
      "Item Discount Types",
      "Names",
      "IDs",
      "TINs",
    ];

    const refundsData: string[][] = [headers];
    
    // Get Z-aligned refund summary for consistent calculations
    const zRefundSummary = getRefundSummary(snapshot);
    const zRefundByKey = new Map(
      (zRefundSummary || []).map(r => [String(r.refundKey), r]),
    );

    if (snapshot.exists()) {
      snapshot.forEach((childSnapshot) => {
        const refund: any = childSnapshot.val() || {};
        const refundKey = String(childSnapshot.key);
        const matchKey =
          refund.originalRefundKey != null
            ? String(refund.originalRefundKey)
            : refundKey;
        const timestamp = parseInt(refundKey, 10);

        const refundedItems = (refund.items || []).filter(
          (item: any) => item?.refund != null && String(item.refund) === matchKey,
        );

        const refundAmount = refundedItems.reduce((sum: number, item: any, i: number) => {
          const $itm = new TransactionItem({ val: item, key: i } as any);
          return sum + Math.abs(($itm as any).__itmTotal) / MP;
        }, 0);

        // Use Z-aligned calculations
        const zAligned = zRefundByKey.get(refundKey);
        const salesAdjustmentRefund = Math.abs(
          Number(zAligned?.totalRefundAmount ?? refundAmount) || 0,
        );
        const vatOnRefundAdjustment = Math.abs(Number(zAligned?.vatAmount) || 0);
        
        // Calculate service charge from refunded items
        const $txnRefund = refundedItems.length
          ? new Transaction({ val: { ...refund, items: refundedItems }, key: refundKey })
          : ({ $service: 0 } as any);
        const serviceChargeRefund = Math.abs(Number(($txnRefund as any).$service) || 0) / MP;
        
        const refundedAmountForReport = salesAdjustmentRefund;
        const zRefundImpact =
          refundedAmountForReport + vatOnRefundAdjustment + serviceChargeRefund;

        // Get discount amount using improved PAX discount extraction
        const { amount: discountAmountMP } = getPaxDiscountSummary(refundedItems);
        const discountAmount = discountAmountMP > 0 ? (discountAmountMP / MP).toFixed(2) : "";

        const itemDiscountTypes = [
          ...new Set(
            refundedItems.flatMap((item: any) => {
              const types: string[] = [];
              const explicit = normalizeDiscountType(
                item?.individualDiscountType || item?.transactionDiscountType || ""
              );
              if (explicit) types.push(explicit);
              if (item?.paxDiscount && typeof item.paxDiscount === "object") {
                for (const k of Object.keys(item.paxDiscount)) {
                  const mapped = mapPaxDiscType(k);
                  if (mapped) types.push(mapped);
                }
              }
              return types.filter(Boolean);
            }),
          ),
        ].join("; ");

        const effectiveDiscountType =
          refund.transactionDiscountType || itemDiscountTypes;

        const itemsList = refundedItems
          .map((item: any) => `${item.title || ""} x${Math.abs(item.quantity || 1)}`)
          .join("; ");

        const metadata = refund.seniorAndPwdMetadata || {};
        const siFormatted = refund.receiptNo != null
          ? `${String(refund.receiptCycle ?? 0).padStart(2, "0")}-${String(refund.receiptNo).padStart(6, "0")}`
          : "";

        refundsData.push([
          String(refund.refundNo ?? ""),
          siFormatted,
          Moment.unix(timestamp).format("MM/DD/YYYY"),
          Moment.unix(timestamp).format("hh:mm:ss A"),
          String(refund.cashier || ""),
          refundedAmountForReport.toFixed(2),
          salesAdjustmentRefund.toFixed(2),
          vatOnRefundAdjustment.toFixed(2),
          serviceChargeRefund.toFixed(2),
          zRefundImpact.toFixed(2),
          String(effectiveDiscountType || ""),
          discountAmount,
          itemsList,
          itemDiscountTypes,
          String(metadata.names || ""),
          String(metadata.ids || ""),
          String(metadata.tins || ""),
        ]);
      });
    }

    const timeRange = exportUtils.formatTimeRange(sttS, endS);
    const filename = `Refunds Report ${timeRange.start} to ${timeRange.end}`;

    // Totals row last. Label/identifier columns are skipped by header — an
    // "Items" cell like "Coffee x1" would otherwise parse as 1 and get summed.
    const refundsWithTotals = appendTotalsRow(refundsData, {
      excludeHeaders: ['Discount Type', 'Items', 'Item Discount Types', 'Names', 'IDs', 'TINs'],
    });
    const result = await exportUtils.downloadCsvFile(refundsWithTotals, filename, {
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
  type: "all" | "z" | "x" | "orderslip" | "billout" = "all",
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
        } else if (type === "billout") {
          journal += journalData.billout || "";
        } else if (type === "orderslip") {
          journal += journalData.orderslip || "";
        } else {
          journal += journalData.transaction || "";
          journal += journalData.refund || "";
          journal += journalData.void || "";
          journal += journalData.return || "";
        }
      });
    }

    const journalTypeLabel =
      type === "z" ? "Z-Reading " :
      type === "x" ? "X-Reading " :
      type === "billout" ? "Bill Outs " :
      type === "orderslip" ? "Order Slips " : "";

    if (!journal.trim()) {
      alert(
        `No ${journalTypeLabel}journal data found for the selected date range.`,
      );
      return null;
    }

    const timeRange = exportUtils.formatTimeRange(
      parseInt(sttS),
      parseInt(endS),
    );
    const typeLabel = journalTypeLabel;
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
  consolidate = false,
) {
  try {
    console.log("saveSalesSummary called", { stt, end, upload, consolidate });

    const userUid = getCurrentUserUid();
    if (!userUid) {
      throw new Error("User not authenticated");
    }

    if (!stt || !end) {
      throw new Error("Start and end dates are required");
    }

    const sttS = parseInt(Moment(stt, "YYMMDD").startOf("day").format("X"));
    const endS = parseInt(Moment(end, "YYMMDD").endOf("day").format("X"));

    // Fetch the same sources as the Z-reading so numbers align. zCounters and
    // zReadingHistory are whole-node reads (per-date Z-Counter / Reset Counter /
    // overrun snapshots); prevTxns seeds the Grand Accumulated beginning balance.
    const [
      transactionsSnapshot,
      refundsSnapshot,
      returnsSnapshot,
      voidsSnapshot,
      zCountersSnapshot,
      zReadingHistorySnapshot,
      prevTxnsSnapshot,
    ] = await Promise.all([
      get(query(ref(database, `${userUid}/transactions`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
      get(query(ref(database, `${userUid}/refunds`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
      get(query(ref(database, `${userUid}/returns`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
      get(query(ref(database, `${userUid}/voids`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
      get(ref(database, `${userUid}/zCounters`)),
      get(ref(database, `${userUid}/zReadingHistory`)),
      get(query(ref(database, `${userUid}/transactions`), orderByKey(), endAt(`${sttS - 1}`))),
    ]);

    const refundSummary = getRefundSummary(refundsSnapshot);
    const returnSummary = getReturnSummary(returnsSnapshot);
    const voidSummary = getVoidSummary(voidsSnapshot);
    const settings = await exportUtils.getUserSettings();

    const zCounters = (zCountersSnapshot.exists() ? zCountersSnapshot.val() : {}) as Record<string, number>;
    const zReadingHistory = (zReadingHistorySnapshot.exists() ? zReadingHistorySnapshot.val() : {}) as Record<string, any>;

    // Grand Accumulated beginning balance = sum of all sales before the range.
    const prevSummary = getTransactionSummary(prevTxnsSnapshot);
    const startingAccumBalance = prevSummary.reduce(
      (acc, i: any) => acc + (i.vatableSales || 0) + (i.vatAmount || 0) + (i.vatExemptSales || 0) + (i.zeroRatedSales || 0),
      0,
    );

    // Per-date overrun (short/over) from Z history. Reset Counter is NOT taken
    // from here: SalesSummary derives it from the accumulated balance, matching
    // the Z-reading receipt. The history snapshots recorded the then-current
    // global BIRresetNo, which for re-downloaded data is uniformly the latest
    // value rather than the value as of that day.
    const overrunByDate: Record<string, number> = {};
    Object.values(zReadingHistory || {}).forEach((entry: any) => {
      const yymmdd = entry?.dateRange;
      if (!yymmdd) return;
      if (entry?.shortOver != null) {
        const entryDate = Moment(yymmdd, "YYMMDD").startOf("day").unix();
        if (entryDate >= sttS && entryDate <= endS) overrunByDate[yymmdd] = entry.shortOver;
      }
    });

    const data = SalesSummary({
      txnSnapshot: transactionsSnapshot,
      startingAccumBalance,
      returnSummary,
      refundSummary,
      voidSummary,
      zCounters,
      overrunByDate,
      zReadNo: settings.zReadNo ?? 0,
      consolidate,
    });

    const timeRange = exportUtils.formatTimeRange(sttS, endS);

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
      ["POS Terminal No", settings.posTerminalNumber || "1"],
      ["Generated", Moment().format("MM/DD/YYYY h:mm a")],
      ["Report Period", `${timeRange.start} to ${timeRange.end}`],
      ["", ""],
    ];

    // Grand Accum. columns are running balances — "Accum." doesn't match the
    // generic RUNNING_PATTERNS regex (which looks for "accumulated"), so they
    // need an explicit exclusion or the TOTAL row would sum a running balance.
    const sheet1WithTotals = appendTotalsRow([SALES_SUMMARY_COLUMNS, ...data.sheet1], {
      excludeHeaders: ["Grand Accum. Sales Ending Balance", "Grand Accum. Beg. Balance"],
    }).slice(1);

    const workbookData: { [sheetName: string]: any[][] } = {};
    workbookData["SalesSummary"] = [
      headerTitle,
      ...metaRows,
      SALES_SUMMARY_COLUMNS,
      ...sheet1WithTotals,
    ];
    if (data.sheetBreakdown.length > 1) {
      workbookData["Breakdown"] = data.sheetBreakdown;
    }

    const label = consolidate ? "Monthly Sales Summary" : "Sales Summary Report";
    const filename = `${label} ${timeRange.start} to ${timeRange.end}`;
    const result = await exportUtils.downloadExcelFile(workbookData, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });

    console.log(`Sales summary generated and downloaded: ${result}`);
    return result;
  } catch (error: any) {
    console.error("Error in saveSalesSummary:", error);
    alert(`Error generating sales summary: ${error.message}`);
    return null;
  }
}

/**
 * Detailed Sales Report (per-transaction) XLSX. Ported to align with the mobile
 * app's saveDetailedSalesReport.
 */
export async function saveDetailedSalesReport(
  stt?: string,
  end?: string,
  upload = false,
) {
  try {
    console.log("saveDetailedSalesReport called", { stt, end, upload });
    const userUid = getCurrentUserUid();
    if (!userUid) throw new Error("User not authenticated");
    if (!stt || !end) throw new Error("Start and end dates are required");

    const sttS = parseInt(Moment(stt, "YYMMDD").startOf("day").format("X"));
    const endS = parseInt(Moment(end, "YYMMDD").endOf("day").format("X"));

    const [transactionsSnapshot, refundsSnapshot, returnsSnapshot, voidsSnapshot] = await Promise.all([
      get(query(ref(database, `${userUid}/transactions`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
      get(query(ref(database, `${userUid}/refunds`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
      get(query(ref(database, `${userUid}/returns`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
      get(query(ref(database, `${userUid}/voids`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
    ]);

    const refundSummary = getRefundSummary(refundsSnapshot);
    const returnSummary = getReturnSummary(returnsSnapshot);
    const voidSummary = getVoidSummary(voidsSnapshot);

    const { sheetRows } = DetailedSalesReport(transactionsSnapshot, {
      refundSummary,
      returnSummary,
      voidSummary,
    });

    const timeRange = exportUtils.formatTimeRange(sttS, endS);
    const workbookData: { [sheetName: string]: any[][] } = {
      "Detailed Sales Summary": sheetRows,
    };
    const filename = `Detailed Sales Summary ${timeRange.start} to ${timeRange.end}`;
    const result = await exportUtils.downloadExcelFile(workbookData, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });
    console.log(`Detailed sales report generated and downloaded: ${result}`);
    return result;
  } catch (error: any) {
    console.error("Error in saveDetailedSalesReport:", error);
    alert(`Error generating detailed sales report: ${error.message}`);
    return null;
  }
}

/**
 * Custom Reading — a Z-layout reading over an arbitrary date range, computed
 * fresh (not replayed from stored journal text) so Previous/Present Accumulated
 * Sales reflect the 12-digit rollover carryover. Ported to align with the mobile
 * saveZCustom: previousAccSales = accumulatedSalesCarryover + gross since the last
 * accumulated-sales reset. Returns the reading text (also downloaded when `download`).
 */
export async function generateCustomReading(
  stt?: string,
  end?: string,
  download = true,
): Promise<string | null> {
  const userUid = getCurrentUserUid();
  if (!userUid) throw new Error("User not authenticated");
  if (!stt || !end) throw new Error("Start and end dates are required");

  const sttS = parseInt(Moment(stt, "YYMMDD").startOf("day").format("X"));
  const endS = parseInt(Moment(end, "YYMMDD").endOf("day").format("X"));

  const settings = await exportUtils.getUserSettings();
  const accResetAt = String((settings as any).accumulatedSalesResetAt || "0");
  const startAfterReset = String(parseInt(accResetAt, 10) + 1);

  const [transactionsSnapshot, refundsSnapshot, returnsSnapshot, voidsSnapshot, prevTxnsSnapshot] =
    await Promise.all([
      get(query(ref(database, `${userUid}/transactions`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
      get(query(ref(database, `${userUid}/refunds`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
      get(query(ref(database, `${userUid}/returns`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
      get(query(ref(database, `${userUid}/voids`), orderByKey(), startAt(`${sttS}`), endAt(`${endS - 1}`))),
      get(query(ref(database, `${userUid}/transactions`), orderByKey(), startAt(startAfterReset), endAt(`${sttS - 1}`))),
    ]);

  const txnSummary = getTransactionSummary(transactionsSnapshot);
  const refundSummary = getRefundSummary(refundsSnapshot);
  const returnSummary = getReturnSummary(returnsSnapshot);
  const voidSummary = getVoidSummary(voidsSnapshot);

  const VAT_RATE = 0.12;
  const prevSummary = getTransactionSummary(prevTxnsSnapshot);
  const carryover = Number((settings as any).accumulatedSalesCarryover) || 0;
  const previousAccSales =
    carryover +
    prevSummary.reduce(
      (s, i: any) =>
        s +
        (i.grossSales ??
          ((i.vatableSales || 0) + (i.vatAmount || 0) + (i.vatExemptSales || 0) + ((i.zeroRatedSales || 0) * (1 + VAT_RATE)))),
      0,
    );

  const text = renderReading(
    {
      type: "Z",
      txnSummary,
      refundSummary,
      returnSummary,
      voidSummary,
      sttS,
      endS,
      previousAccSales,
      cashier: (settings as any).account ? String((settings as any).account).split("@")[0] : "",
      posTerminalNumber: (settings as any).posTerminalNumber || "",
      cashdrawer: {},
    },
    settings,
  );

  if (download) {
    const timeRange = exportUtils.formatTimeRange(sttS, endS);
    const filename = `${(globalThis as any).isInTrainingMode ? "[TRAINING MODE] " : ""}Custom Reading ${timeRange.start} to ${timeRange.end}.txt`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  return text;
}

/**
 * Special Discounts ("Discount Report") workbook.
 *
 * Fetch + workbook assembly only; every figure comes from
 * `utils/bir/specialDiscounts.ts`, a verbatim port of the device's
 * `csvs/specialDiscounts.ts`. Sheets follow the device's Excel template: the
 * Annex E-1 recap first, then E-2..E-6, with Medal of Valor appended last.
 */
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

    const sttUnix = parseInt(Moment(stt, "YYMMDD").startOf("day").format("X"));
    const endUnix = parseInt(Moment(end, "YYMMDD").endOf("day").format("X"));
    const timeRange = exportUtils.formatTimeRange(sttUnix, endUnix);

    const userUid = getCurrentUserUid();
    if (!userUid) throw new Error("User not authenticated");

    // The reversal collections feed sheet1's Returns / Refunds / Voids columns
    // and the Remarks column on every discount sheet, so all four are fetched.
    const [txnsSnapshot, refundsSnapshot, returnsSnapshot, voidsSnapshot] =
      await Promise.all([
        get(query(ref(database, `${userUid}/transactions`), orderByKey(), startAt(`${sttUnix}`), endAt(`${endUnix - 1}`))),
        get(query(ref(database, `${userUid}/refunds`), orderByKey(), startAt(`${sttUnix}`), endAt(`${endUnix - 1}`))),
        get(query(ref(database, `${userUid}/returns`), orderByKey(), startAt(`${sttUnix}`), endAt(`${endUnix - 1}`))),
        get(query(ref(database, `${userUid}/voids`), orderByKey(), startAt(`${sttUnix}`), endAt(`${endUnix - 1}`))),
      ]);

    // Start of the range's month: splits each transaction's total into
    // current-month and prior-month buckets, as on the device.
    const month = Moment.unix(sttUnix).startOf("month").format("X");

    const data = await specialDiscounts({
      snapshot: txnsSnapshot,
      month,
      refundsSnapshot,
      returnsSnapshot,
      voidsSnapshot,
    });

    // The device writes a TOTAL row under Senior Citizen, PWD and NAAC only —
    // Solo Parent, Diplomat, Medal of Valor and the E-1 recap get none
    // (saveSpecialDiscounts.js:170-193). Mirrored rather than "fixed": the
    // device is the accredited output.
    const workbookData: { [sheetName: string]: any[][] } = {
      BIRSalesSummary: data.sheet1,
      SeniorCitizen: appendTotalsRow(data.sheet2),
      PWD: appendTotalsRow(data.sheet3),
      NAAC: appendTotalsRow(data.sheet4),
      SoloParent: data.sheet5,
      Diplomat: data.sheet6,
      MedalOfValor: data.sheet7,
    };

    const filename = `Discount Report ${timeRange.start} to ${timeRange.end}`;
    const result = await exportUtils.downloadExcelFile(workbookData, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });

    console.log(`Discount report generated and downloaded: ${result}`);
    return result;
  } catch (error) {
    console.error("Error in saveSpecialDiscounts:", error);
    alert(`Error generating discount report: ${(error as any).message}`);
    return null;
  }
}

/**
 * Product Mix report: one row per product (title + option) with total quantity
 * sold and gross sales over the range, sorted by sales (best-sellers first).
 * Excludes reversed items (refunded/returned/voided) and adjustment clones.
 * Ported from mobile saveProductMix (utakmobileBIR).
 */
export async function saveProductMix(
  stt?: string,
  end?: string,
  upload = false,
) {
  try {
    console.log("saveProductMix called", { stt, end, upload });

    if (!stt || !end) {
      throw new Error("Start and end dates are required");
    }

    const sttUnix = parseInt(Moment(stt, "YYMMDD").startOf("day").format("X"), 10);
    const endUnix = parseInt(Moment(end, "YYMMDD").endOf("day").format("X"), 10);
    const timeRange = exportUtils.formatTimeRange(sttUnix, endUnix);

    const userUid = getCurrentUserUid();
    if (!userUid) throw new Error("User not authenticated");

    // Fetch transactions from Firebase
    const txnsRef = ref(database, `${userUid}/transactions`);
    const txnsQuery = query(txnsRef, orderByKey(), startAt(String(sttUnix)), endAt(String(endUnix)));
    const txnsSnapshot = await get(txnsQuery);

    const { rows: sorted, totalQty, totalSales } = aggregateProductMixFromSnapshot(txnsSnapshot);
    const sheetRows: any[][] = [["Item", "Option", "Category", "Quantity Sold", "Gross Sales"]];
    for (const r of sorted) {
      sheetRows.push([r.item, r.option, r.category, r.quantity, r.sales]);
    }
    sheetRows.push(["TOTAL", "", "", totalQty, totalSales]);

    const settings = await exportUtils.getUserSettings();
    const workbookData: { [sheetName: string]: any[][] } = {
      "Product Mix": [
        ["PRODUCT MIX"],
        ["", ""],
        ["Report Period", `${timeRange.start} to ${timeRange.end}`],
        ["Business Name", settings?.name || ""],
        ["Generated", Moment().format("MM/DD/YYYY h:mm a")],
        ["", ""],
        ...sheetRows,
      ],
    };

    const filename = `Product Mix ${timeRange.start} to ${timeRange.end}`;
    const result = await exportUtils.downloadExcelFile(workbookData, filename, {
      trainingMode: (globalThis as any).isInTrainingMode || false,
    });

    console.log(`Product Mix generated and downloaded: ${result}`);
    return result;
  } catch (error) {
    console.error("Error in saveProductMix:", error);
    alert(`Error generating Product Mix: ${(error as any).message}`);
    return null;
  }
}

// View journal (read-only) - supports type: 'all' | 'z' | 'x' (aligns with utakmobile)
export async function viewJournal(
  stt?: string,
  end?: string,
  type: "all" | "z" | "x" | "orderslip" | "billout" = "all",
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
        } else if (type === "billout") {
          journal += journalData.billout || "";
        } else if (type === "orderslip") {
          journal += journalData.orderslip || "";
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
  type: "all" | "z" | "x" | "orderslip" | "billout" = "all",
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
