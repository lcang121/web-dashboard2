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
  if (["commodity"].includes(t)) return "commodity";
  if (["regular"].includes(t)) return "regular";
  return String(type || "");
}

function mapPaxDiscType(discType?: string): string {
  const normalized = normalizeDiscountType(discType);
  if (normalized === "ntlAthlete") return "ntlAthlete";
  if (normalized === "soloParent") return "soloParent";
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
  if (pax.regular) return 'regular';
  return "";
}

function resolveDiscountRate(item: any, discountType: string): number {
  const pax = item?.paxDiscount;
  if (pax && typeof pax === 'object') {
    if (discountType === 'senior' && pax.senior) return (parseFloat(pax.senior.percent) || 20) / 100;
    if (discountType === 'pwd' && pax.pwd) return (parseFloat(pax.pwd.percent) || 20) / 100;
    if (discountType === 'soloParent' && pax.sp) return (parseFloat(pax.sp.percent) || 10) / 100;
    if (discountType === 'regular' && pax.regular) return (parseFloat(pax.regular.percent) || 0) / 100;
  }

  if (discountType === 'senior') return 0.2;
  if (discountType === 'pwd') return 0.2;
  if (discountType === 'soloParent') return 0.1;
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

// Get refund summary with proper Z-aligned calculations
function getRefundSummary(snapshot: any): any[] {
  const data: any[] = [];
  
  if (!snapshot || !snapshot.forEach) {
    (data as any).beginningRefundSI = '';
    (data as any).endingRefundSI = '';
    return data;
  }

  const VAT_RATE = 0.12;
  const NAAC_RATE = 0.20;

  snapshot.forEach((snap: any) => {
    const key = snap.key;
    const value = snap.val();

    if (value.trainingMode) return;

    const matchKey = value.originalRefundKey != null
      ? String(value.originalRefundKey)
      : String(key);
    const isRefundedItem = (item: any) =>
      item != null && item.refund != null && String(item.refund) === matchKey;
    const refundedItems = (value.items || []).filter(isRefundedItem);

    let vatableSales = 0;
    let vatAmount = 0;
    let vatExemptSales = 0;
    let zeroRatedSales = 0;

    for (const item of refundedItems) {
      const vatType = item._defaultVatType
        ? item._defaultVatType
        : item.zeroVAT
        ? "vatExempt"
        : "vatable";
      const totalPrice = (item.price || 0) * Math.abs(item.quantity || 1);

      // PAX discount: each guest's portion is independently classified
      if (item.paxDiscount && typeof item.paxDiscount === 'object') {
        const guestCount = Object.values(item.paxDiscount).reduce(
          (a: number, e: any) => a + (parseInt(e?.guestCount, 10) || 0),
          0,
        );
        if (guestCount > 0) {
          const isCommodity = item.isCommodity === true;
          const baseAmount = totalPrice / (1 + VAT_RATE);

          for (const [paxDiscType, discObj] of Object.entries(item.paxDiscount)) {
            const seatCount = parseInt((discObj as any)?.guestCount, 10) || 0;
            if (seatCount <= 0) continue;
            const guestRatio = seatCount / guestCount;
            const proportionalBase = baseAmount * guestRatio;
            const normalizedType = normalizeDiscountType(paxDiscType);

            const discRate =
              (parseFloat((discObj as any)?.percent) || 0) / 100 ||
              (normalizedType === 'senior' || normalizedType === 'pwd'
                ? 0.2
                : normalizedType === 'soloParent'
                ? 0.1
                : normalizedType === 'ntlAthlete'
                ? 0.2
                : 0);

            if (normalizedType === 'ntlAthlete') {
              vatableSales += proportionalBase * (1 - NAAC_RATE);
              vatAmount += proportionalBase * VAT_RATE;
            } else if (['senior', 'pwd', 'soloParent', 'commodity'].includes(normalizedType)) {
              if (isCommodity && (normalizedType === 'senior' || normalizedType === 'pwd')) {
                const commodityRate = 0.05;
                vatableSales += proportionalBase * (1 - commodityRate);
                vatAmount += proportionalBase * (1 - commodityRate) * VAT_RATE;
              } else {
                vatExemptSales += proportionalBase * (1 - discRate);
              }
            } else if (normalizedType === 'diplomat') {
              zeroRatedSales += proportionalBase;
            } else if (normalizedType === 'regular') {
              const proportionalGross = totalPrice * guestRatio;
              const discounted = proportionalGross * (1 - discRate);
              vatableSales += discounted / (1 + VAT_RATE);
              const itemVat = discounted - discounted / (1 + VAT_RATE);
              vatAmount += itemVat;
            }
          }
          continue;
        }
      }

      const discountType = resolveDiscountType(item);
      if (discountType === "ntlAthlete") {
        const naacBase = totalPrice / (1 + VAT_RATE);
        const naacDiscountedBase = naacBase * (1 - NAAC_RATE);
        vatableSales += naacDiscountedBase;
        vatAmount += naacBase * VAT_RATE;
      } else if (["senior", "pwd", "soloParent", "commodity"].includes(discountType)) {
        const discountRate = resolveDiscountRate(item, discountType);
        vatExemptSales += (totalPrice / VAT_RATE) * (1 - discountRate);
      } else if (discountType === "diplomat") {
        const diplomataBase = totalPrice / (1 + VAT_RATE);
        zeroRatedSales += diplomataBase;
      } else if (discountType === "regular" && (vatType === "vatable" || !vatType)) {
        const paxRate = resolveDiscountRate(item, discountType);
        const rawDiscount = item.discount || item.discountSubtotal || 0;
        const effectiveRate = paxRate > 0 ? paxRate : rawDiscount / 100;
        const discountedPrice = totalPrice * (1 - effectiveRate);
        vatableSales += discountedPrice / (1 + VAT_RATE);
        const itemVat = discountedPrice - discountedPrice / (1 + VAT_RATE);
        vatAmount += itemVat;
      } else if (vatType === "vatable") {
        vatableSales += totalPrice / VAT_RATE;
        const itemVat = totalPrice - totalPrice / VAT_RATE;
        vatAmount += itemVat;
      } else if (vatType === "vatExempt") {
        vatExemptSales += totalPrice;
      } else if (vatType === "zeroVat") {
        zeroRatedSales += totalPrice / VAT_RATE;
      }
    }

    const totalRefundAmount = vatableSales + vatExemptSales + zeroRatedSales;

    data.push({
      refundKey: key,
      vatableSales,
      vatAmount,
      vatExemptSales,
      zeroRatedSales,
      totalRefundAmount,
    });
  });

  return data;
}

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
    const result = await exportUtils.downloadCsvFile(data, filename, {
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
    const result = await exportUtils.downloadCsvFile(data, filename, {
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

    // Per-date overrun (short/over) and Reset Counter snapshots from Z history.
    const overrunByDate: Record<string, number> = {};
    const resetNoByDate: Record<string, number> = {};
    Object.values(zReadingHistory || {}).forEach((entry: any) => {
      const yymmdd = entry?.dateRange;
      if (!yymmdd) return;
      if (entry?.shortOver != null) {
        const entryDate = Moment(yymmdd, "YYMMDD").startOf("day").unix();
        if (entryDate >= sttS && entryDate <= endS) overrunByDate[yymmdd] = entry.shortOver;
      }
      if (entry?.resetNo != null) resetNoByDate[yymmdd] = Number(entry.resetNo);
    });

    const data = SalesSummary({
      txnSnapshot: transactionsSnapshot,
      startingAccumBalance,
      returnSummary,
      refundSummary,
      voidSummary,
      zCounters,
      overrunByDate,
      resetNoByDate,
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

    const workbookData: { [sheetName: string]: any[][] } = {};
    workbookData["SalesSummary"] = [
      headerTitle,
      ...metaRows,
      SALES_SUMMARY_COLUMNS,
      ...data.sheet1,
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

// Special discounts Excel report - port from mobile specialDiscounts.ts
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

    // Fetch transactions from Firebase
    const txnsRef = ref(database, `${userUid}/transactions`);
    const txnsQuery = query(txnsRef, orderByKey(), startAt(String(sttUnix)), endAt(String(endUnix)));
    const txnsSnapshot = await get(txnsQuery);

    const seniorData: Record<string, any[]> = {};
    const pwdData: Record<string, any[]> = {};
    const ntlAthleteData: Record<string, any[]> = {};
    const soloParentData: Record<string, any[]> = {};
    const diplomatData: Record<string, any[]> = {};

    const VAT_RATE = 0.12;

    // Process transactions snapshot per transaction
    if (txnsSnapshot.exists()) {
      txnsSnapshot.forEach((snap: any) => {
        const key = snap.key;
        const val = snap.val();
        const $txn = new Transaction({ key, val });

        const names = $txn.original?.seniorAndPwdMetadata?.names?.split(/\n+/) || [];
        const ids = $txn.original?.seniorAndPwdMetadata?.ids?.split(/\n+/) || [];
        const tins = $txn.original?.seniorAndPwdMetadata?.tins?.split(/\n+/) || [];

        // PAX discount: stored on first item, not on transaction root
        const paxDiscount = (() => {
          const items = $txn.original?.items;
          if (!items) return null;
          const arr = Array.isArray(items) ? items : Object.values(items);
          const firstWithPax = arr.find((i: any) => i?.paxDiscount);
          return firstWithPax?.paxDiscount ?? null;
        })();

        // Calculate total service fee for transaction to allocate proportionally
        let totalGrossAfterDisc = 0;
        for (const $itm of $txn.items) {
          if (!$itm) continue;
          const qtyPrice = ($itm.quantity || 0) * ($itm.price || 0);
          const lineGross = $itm.vatType === 'vatable' ? qtyPrice / (1 + VAT_RATE) : qtyPrice;
          const discAmt = ($itm.itmDiscount || 0) + ($itm.txnDiscount || 0);
          totalGrossAfterDisc += lineGross - discAmt;
        }
        const svcRate = ($txn.original?.service || $txn.svcRate || 0) / (typeof ($txn.original?.service) === 'number' && ($txn.original?.service) > 1 ? 100 : 1);
        const totalServiceFee = totalGrossAfterDisc * svcRate;

        // Non-PAX aggregation per discount type
        const nonPaxTypeAgg: Record<string, any> = {
          senior: { vatable: 0, vat: 0, vatExempt: 0, discount: 0, netSales: 0, grossSales: 0, vatExcluded: 0, grossAfterDisc: 0 },
          pwd: { vatable: 0, vat: 0, vatExempt: 0, discount: 0, netSales: 0, grossSales: 0, vatExcluded: 0, grossAfterDisc: 0 },
          ntlAthlete: { vatable: 0, vat: 0, vatExempt: 0, discount: 0, netSales: 0, grossSales: 0, vatExcluded: 0, grossAfterDisc: 0 },
          soloParent: { vatable: 0, vat: 0, vatExempt: 0, discount: 0, netSales: 0, grossSales: 0, vatExcluded: 0, grossAfterDisc: 0 },
          diplomat: { vatable: 0, vat: 0, vatExempt: 0, discount: 0, netSales: 0, grossSales: 0, vatExcluded: 0, grossAfterDisc: 0 },
        };

        // Aggregate per discount type from items
        for (const $itm of $txn.items) {
          if (!$itm) continue;

          const itmSpecial = $itm.itmDiscType && $itm.itmDiscType !== 'regular' ? $itm.itmDiscType : null;
          const txnSpecial = $itm.txnDiscType && $itm.txnDiscType !== 'regular' ? $itm.txnDiscType : null;
          const perItemTypeDiscount: Record<string, number> = {};

          if (itmSpecial) {
            perItemTypeDiscount[itmSpecial] = (perItemTypeDiscount[itmSpecial] || 0) + ($itm.itmDiscount || 0);
          }
          if (txnSpecial) {
            perItemTypeDiscount[txnSpecial] = (perItemTypeDiscount[txnSpecial] || 0) + ($itm.txnDiscount || 0);
          }

          for (const [discType, discAmtRaw] of Object.entries(perItemTypeDiscount)) {
            if (!nonPaxTypeAgg[discType]) continue;

            const discAmt = discAmtRaw || 0;
            const qtyPrice = ($itm.quantity || 0) * ($itm.price || 0);
            const lineGross = $itm.vatType === 'vatable' ? qtyPrice / (1 + VAT_RATE) : qtyPrice;
            const lineGrossAfterDisc = lineGross - discAmt;
            const allocatedServiceFee = totalGrossAfterDisc > 0 ? (lineGrossAfterDisc / totalGrossAfterDisc) * totalServiceFee : 0;
            const lineNet = lineGrossAfterDisc + allocatedServiceFee;

            if (discType !== 'diplomat' && discAmt <= 0) continue;
            if (discType === 'diplomat' && lineGross <= 0 && discAmt <= 0) continue;

            const agg = nonPaxTypeAgg[discType];
            agg.discount += discAmt;
            agg.netSales += lineNet;
            agg.grossSales += lineGross;
            agg.grossAfterDisc += lineGrossAfterDisc;

            if ($itm.vatType === 'vatExempt') {
              agg.vatExempt += lineGross / (1 + VAT_RATE);
            } else if ($itm.vatType === 'zeroVat' || discType === 'diplomat') {
              const vatExcluded = $itm.vatExemption || ($itm.vatType === 'zeroVat' ? (lineGross / 1.12) * 0.12 : 0);
              agg.vatExcluded += vatExcluded;
            } else {
              const vatable = (lineGross - discAmt) / 1.12;
              agg.vatable += vatable;
              agg.vat += vatable * 0.12;
            }
          }
        }

        if (paxDiscount) {
          // PAX: use _parts from items
          type PartAgg = { grossSales: number; discount: number; netSales: number; vatable: number; vat: number; vatExempt: number; vatExemption: number };
          const typeAgg: Record<string, PartAgg> = {};

          for (const $itm of $txn.items) {
            if (!$itm?._parts?.values) continue;
            for (const [partDiscType, part] of Object.entries($itm._parts.values) as [string, any][]) {
              if (!['senior', 'pwd', 'ntl', 'sp', 'diplomat'].includes(partDiscType)) continue;
              if (!typeAgg[partDiscType]) {
                typeAgg[partDiscType] = { grossSales: 0, discount: 0, netSales: 0, vatable: 0, vat: 0, vatExempt: 0, vatExemption: 0 };
              }
              typeAgg[partDiscType].grossSales += part.grossSales || 0;
              typeAgg[partDiscType].discount += part.discount || 0;
              typeAgg[partDiscType].netSales += part.netSales || 0;
              typeAgg[partDiscType].vatExemption += part.vatExemption || 0;
              if (part.vatType === 'vatable') {
                typeAgg[partDiscType].vatable += part.discType === 'ntl' ? (part.grossSales || 0) : (part.netSales || 0);
                typeAgg[partDiscType].vat += part.vat || 0;
              } else if (part.vatType === 'vatExempt') {
                typeAgg[partDiscType].vatExempt += part.grossSales || 0;
              }
            }
          }

          for (const [discType, discObj] of Object.entries(paxDiscount)) {
            const typedDiscObj = discObj as any;
            if (!typedDiscObj.guestCount) continue;
            if (discType !== 'diplomat' && !typedDiscObj.percent) continue;

            const agg = typeAgg[discType];
            if (!agg) continue;
            if (discType === 'diplomat') {
              if (agg.grossSales <= 0 && agg.netSales <= 0) continue;
            } else if (agg.discount <= 0 && agg.grossSales <= 0) {
              continue;
            }

            const blockNames = (typedDiscObj.names || '').split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean);
            const blockIds = (typedDiscObj.ids || '').split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean);
            const blockTins = (typedDiscObj.tins || '').split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean);
            const blockChildNames = discType === 'sp' ? (typedDiscObj.childNames || typedDiscObj.childName || '').split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean) : [] as string[];
            const blockChildBirthDates = discType === 'sp' ? (typedDiscObj.childBirthDates || typedDiscObj.childBirthDate || '').split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean) : [] as string[];
            const blockChildAges = discType === 'sp' ? (typedDiscObj.childAges || (typedDiscObj.childAge != null ? String(typedDiscObj.childAge) : '')).split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean) : [] as string[];
            const guestCountForType = parseInt(typedDiscObj.guestCount, 10) || 1;
            const n = discType === 'sp'
              ? Math.max(blockNames.length, blockIds.length, blockTins.length, blockChildNames.length, guestCountForType) || 1
              : Math.max(blockNames.length, blockIds.length, blockTins.length, guestCountForType) || 1;

            const grossPerRow = agg.grossSales / n;
            const discountPerRow = agg.discount / n;
            const netPerRow = agg.netSales / n;
            const vatablePerRow = agg.vatable / n;
            const vatPerRow = agg.vat / n;
            const vatExemptPerRow = agg.vatExempt / n;

            const typeLabels: Record<string, string> = {
              senior: 'Senior Citizen (No ID)',
              pwd: 'PWD (No ID)',
              ntl: 'NAAC (No ID)',
              sp: 'Solo Parent (No ID)',
              diplomat: 'Diplomat (No ID)',
            };
            const defaultLabel = typeLabels[discType] || 'Guest';

            for (let i = 0; i < n; i++) {
              const name = blockNames[i] || blockIds[i] || (n > 1 ? `${defaultLabel} ${i + 1}` : defaultLabel);

              if (discType === 'senior') {
                if (!seniorData[name]) seniorData[name] = [];
                seniorData[name].push({
                  id: blockIds[i] || '',
                  tin: blockTins[i] || '',
                  date: $txn.key,
                  receiptCycle: $txn.original?.receiptCycle ?? 0,
                  receiptNo: $txn.original?.receiptNo || '',
                  vatable: vatablePerRow,
                  vat: vatPerRow,
                  vatExempt: vatExemptPerRow,
                  discount: discountPerRow,
                  netSales: netPerRow,
                });
              } else if (discType === 'pwd') {
                if (!pwdData[name]) pwdData[name] = [];
                pwdData[name].push({
                  id: blockIds[i] || '',
                  tin: blockTins[i] || '',
                  date: $txn.key,
                  receiptCycle: $txn.original?.receiptCycle ?? 0,
                  receiptNo: $txn.original?.receiptNo || '',
                  vatable: vatablePerRow,
                  vat: vatPerRow,
                  vatExempt: vatExemptPerRow,
                  discount: discountPerRow,
                  netSales: netPerRow,
                });
              } else if (discType === 'ntl') {
                if (!ntlAthleteData[name]) ntlAthleteData[name] = [];
                const naacNetSales = TransactionItem.round(grossPerRow - discountPerRow);
                ntlAthleteData[name].push({
                  id: blockIds[i] || '',
                  date: $txn.key,
                  receiptCycle: $txn.original?.receiptCycle ?? 0,
                  receiptNo: $txn.original?.receiptNo || '',
                  discount: discountPerRow,
                  grossSales: grossPerRow,
                  netSales: naacNetSales,
                });
              } else if (discType === 'sp') {
                if (!soloParentData[name]) soloParentData[name] = [];
                const soloMeta = $txn.original?.soloParentMetadata || $txn.original?.soloParentDetails;
                const childName = blockChildNames[i] || typedDiscObj.childName || soloMeta?.childName || '';
                const childBirthDate = blockChildBirthDates[i] || typedDiscObj.childBirthDate || soloMeta?.childBirthDate || '';
                const childAge = blockChildAges[i] != null && blockChildAges[i] !== '' ? blockChildAges[i] : (typedDiscObj.childAge ?? soloMeta?.childAge ?? '');
                const soloBaseAfterDiscount = grossPerRow - discountPerRow;
                const soloServiceFee = soloBaseAfterDiscount * svcRate;
                const soloNetSales = TransactionItem.round(soloBaseAfterDiscount + soloServiceFee);
                soloParentData[name].push({
                  id: blockIds[i] || '',
                  date: $txn.key,
                  receiptCycle: $txn.original?.receiptCycle ?? 0,
                  receiptNo: $txn.original?.receiptNo || '',
                  discount: discountPerRow,
                  grossSales: grossPerRow,
                  netSales: soloNetSales,
                  childName,
                  childBirthDate,
                  childAge,
                });
              } else if (discType === 'diplomat') {
                if (!diplomatData[name]) diplomatData[name] = [];
                const vatExemptPerRow = (agg.vatExemption || 0) / n;
                diplomatData[name].push({
                  id: blockIds[i] || '',
                  tin: blockTins[i] || '',
                  date: $txn.key,
                  receiptCycle: $txn.original?.receiptCycle ?? 0,
                  receiptNo: $txn.original?.receiptNo || '',
                  grossSales: grossPerRow,
                  vatExcluded: vatExemptPerRow,
                  netSales: netPerRow,
                });
              }
            }
          }
        } else {
          // Non-PAX: use seniorAndPwdMetadata names for discounts
          for (let n = 0; n < names.length; n++) {
            const name = names[n];
            if (!name) continue;

            // Senior discount
            const agg_senior = nonPaxTypeAgg.senior;
            if (agg_senior.discount > 0) {
              if (!seniorData[name]) seniorData[name] = [];
              seniorData[name].push({
                id: ids[n] || '',
                tin: tins[n] || '',
                date: $txn.key,
                receiptCycle: $txn.original?.receiptCycle ?? 0,
                receiptNo: $txn.original?.receiptNo || '',
                vatable: agg_senior.vatable,
                vat: agg_senior.vat,
                vatExempt: agg_senior.vatExempt,
                discount: agg_senior.discount,
                netSales: agg_senior.netSales,
              });
            }

            // PWD discount
            const agg_pwd = nonPaxTypeAgg.pwd;
            if (agg_pwd.discount > 0) {
              if (!pwdData[name]) pwdData[name] = [];
              pwdData[name].push({
                id: ids[n] || '',
                tin: tins[n] || '',
                date: $txn.key,
                receiptCycle: $txn.original?.receiptCycle ?? 0,
                receiptNo: $txn.original?.receiptNo || '',
                vatable: agg_pwd.vatable,
                vat: agg_pwd.vat,
                vatExempt: agg_pwd.vatExempt,
                discount: agg_pwd.discount,
                netSales: agg_pwd.netSales,
              });
            }

            // NAAC discount
            const agg_ntl = nonPaxTypeAgg.ntlAthlete;
            if (agg_ntl.discount > 0) {
              if (!ntlAthleteData[name]) ntlAthleteData[name] = [];
              const ntlGross = agg_ntl.grossSales || 0;
              ntlAthleteData[name].push({
                id: ids[n] || '',
                date: $txn.key,
                receiptCycle: $txn.original?.receiptCycle ?? 0,
                receiptNo: $txn.original?.receiptNo || '',
                discount: agg_ntl.discount,
                grossSales: ntlGross,
                netSales: agg_ntl.netSales,
              });
            }

            // Solo Parent discount
            const agg_solo = nonPaxTypeAgg.soloParent;
            if (agg_solo.discount > 0) {
              if (!soloParentData[name]) soloParentData[name] = [];
              const soloMeta = $txn.original?.soloParentMetadata || $txn.original?.soloParentDetails;
              soloParentData[name].push({
                id: ids[n] || '',
                date: $txn.key,
                receiptCycle: $txn.original?.receiptCycle ?? 0,
                receiptNo: $txn.original?.receiptNo || '',
                discount: agg_solo.discount,
                grossSales: agg_solo.grossSales,
                netSales: agg_solo.netSales,
                childName: soloMeta?.childName || '',
                childBirthDate: soloMeta?.childBirthDate || '',
                childAge: soloMeta?.childAge ?? '',
              });
            }

            // Diplomat discount
            const agg_diplomat = nonPaxTypeAgg.diplomat;
            if (agg_diplomat.grossSales > 0 || agg_diplomat.vatExcluded > 0) {
              if (!diplomatData[name]) diplomatData[name] = [];
              diplomatData[name].push({
                id: ids[n] || '',
                tin: tins[n] || '',
                date: $txn.key,
                receiptCycle: $txn.original?.receiptCycle ?? 0,
                receiptNo: $txn.original?.receiptNo || '',
                grossSales: agg_diplomat.grossSales,
                vatExcluded: agg_diplomat.vatExcluded || 0,
                netSales: agg_diplomat.netSales,
              });
            }
          }
        }
      });
    }

    const workbookData: { [sheetName: string]: any[][] } = {};
    const normalize = (val: any) => {
      if (typeof val === 'string') {
        return val.replace(/[,;:\t]/g, '');
      } else if (typeof val === 'number' && !isNaN(val)) {
        return parseFloat(val.toFixed(2));
      }
      return 0;
    };
    const round = (n: number) => TransactionItem.round(n);
    const formatReceiptNo = (cycle: number, no: string | number): string => {
      if (no === '' || no === undefined || no === null) return '';
      const cycleNum = Math.max(0, parseInt(String(cycle ?? 0), 10) || 0);
      const noNum = Math.max(0, parseInt(String(no), 10) || 0);
      const c = String(cycleNum).padStart(2, '0');
      const n6 = String(noNum).padStart(6, '0');
      return `${c}-${n6}`;
    };

    // Senior Citizens sheet (Annex E-2)
    workbookData["SeniorCitizen"] = [
      [
        'Date',
        'Name of Senior Citizen (SC)',
        'OSCA ID No./SC ID No.',
        'SC TIN',
        'SI/OR Number',
        'Sales (inclusive of VAT)',
        'VAT Amount',
        'VAT Exempt Sales',
        'Discount (5%)',
        'Discount (20%)',
        'Net Sales',
      ],
    ];
    Object.entries(seniorData).forEach(([name, rows]) => {
      rows.forEach((row) => {
        const vatExempt = row.vatExempt || 0;
        const salesInclVat = vatExempt * (1 + VAT_RATE);
        const vatAmount = 0;
        workbookData["SeniorCitizen"].push([
          normalize(Moment(row.date, 'X').format('D MMM YYYY')),
          normalize(name),
          normalize(row.id),
          normalize(row.tin?.length > 0 ? row.tin : 'N/A'),
          normalize(formatReceiptNo(row.receiptCycle ?? 0, row.receiptNo ?? '')),
          normalize(round(salesInclVat) / MP),
          normalize(round(vatAmount) / MP),
          normalize(round(vatExempt) / MP),
          normalize(0),
          normalize(round(row.discount) / MP),
          normalize(round(row.netSales) / MP),
        ]);
      });
    });

    // PWD sheet (Annex E-3)
    workbookData["PWD"] = [
      [
        'Date',
        'Name of Person with Disability (PWD)',
        'PWD ID No.',
        'PWD TIN',
        'SI/OR Number',
        'Sales (inclusive of VAT)',
        'VAT Amount',
        'VAT Exempt Sales',
        'Discount (5%)',
        'Discount (20%)',
        'Net Sales',
      ],
    ];
    Object.entries(pwdData).forEach(([name, rows]) => {
      rows.forEach((row) => {
        const vatExempt = row.vatExempt || 0;
        const salesInclVat = vatExempt * (1 + VAT_RATE);
        const vatAmount = 0;
        workbookData["PWD"].push([
          normalize(Moment(row.date, 'X').format('D MMM YYYY')),
          normalize(name),
          normalize(row.id),
          normalize(row.tin?.length > 0 ? row.tin : 'N/A'),
          normalize(formatReceiptNo(row.receiptCycle ?? 0, row.receiptNo ?? '')),
          normalize(round(salesInclVat) / MP),
          normalize(round(vatAmount) / MP),
          normalize(round(vatExempt) / MP),
          normalize(0),
          normalize(round(row.discount) / MP),
          normalize(round(row.netSales) / MP),
        ]);
      });
    });

    // NAAC sheet (Annex E-4)
    workbookData["NAAC"] = [
      [
        'Date',
        'Name of National Athlete/Coach',
        'PNSTM ID No.',
        'SI / OR Number',
        'Gross Sales/Receipts',
        'Sales Discount',
        'Net Sales',
      ],
    ];
    Object.entries(ntlAthleteData).forEach(([name, rows]) => {
      rows.forEach((row) => {
        const grossSales = row.grossSales || 0;
        const netSales = row.netSales != null ? row.netSales : (grossSales - (row.discount || 0));
        workbookData["NAAC"].push([
          normalize(Moment(row.date, 'X').format('D MMM YYYY')),
          normalize(name),
          normalize(row.id),
          normalize(formatReceiptNo(row.receiptCycle ?? 0, row.receiptNo ?? '')),
          normalize(round(grossSales) / MP),
          normalize(round(row.discount) / MP),
          normalize(round(netSales) / MP),
        ]);
      });
    });

    // Solo Parent sheet (Annex E-5)
    workbookData["SoloParent"] = [
      [
        'Date',
        'Name of Solo Parent',
        'SPIC No.',
        'Name of child',
        'Birth Date of child',
        'Age of child',
        'SI / OR Number',
        'Gross Sales',
        'Discount (5%)',
        'Discount (20%)',
        'Net Sales',
      ],
    ];
    Object.entries(soloParentData).forEach(([name, rows]) => {
      rows.forEach((row) => {
        const grossSales = row.grossSales || 0;
        const netSales = row.netSales != null ? row.netSales : (grossSales - (row.discount || 0));
        workbookData["SoloParent"].push([
          normalize(Moment(row.date, 'X').format('D MMM YYYY')),
          normalize(name),
          normalize(row.id),
          normalize(row.childName || ''),
          normalize(row.childBirthDate ? Moment(row.childBirthDate).format('D MMM YYYY') : ''),
          normalize(row.childAge?.toString() || ''),
          normalize(formatReceiptNo(row.receiptCycle ?? 0, row.receiptNo ?? '')),
          normalize(round(grossSales) / MP),
          normalize(0),
          normalize(round(row.discount) / MP),
          normalize(round(netSales) / MP),
        ]);
      });
    });

    // Diplomat sheet (Annex E-6)
    workbookData["Diplomat"] = [
      [
        'Date',
        'Name of Diplomat',
        'Diplomatic ID No.',
        'TIN',
        'SI/OR Number',
        'Gross Sales (VAT-inclusive)',
        'VAT Excluded (Zero-Rated)',
        'Net Sales (VAT-exclusive)',
      ],
    ];
    Object.entries(diplomatData).forEach(([name, rows]) => {
      rows.forEach((row) => {
        const grossSales = row.grossSales || 0;
        const vatExcluded = row.vatExcluded || 0;
        const netSales = row.netSales != null ? row.netSales : (grossSales - vatExcluded);
        workbookData["Diplomat"].push([
          normalize(Moment(row.date, 'X').format('D MMM YYYY')),
          normalize(name),
          normalize(row.id || ''),
          normalize(row.tin?.length > 0 ? row.tin : 'N/A'),
          normalize(formatReceiptNo(row.receiptCycle ?? 0, row.receiptNo ?? '')),
          normalize(round(grossSales) / MP),
          normalize(round(vatExcluded) / MP),
          normalize(round(netSales) / MP),
        ]);
      });
    });

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

    const mix = new Map<string, { item: string; option: string; category: string; quantity: number; sales: number }>();
    if (txnsSnapshot.exists()) {
      txnsSnapshot.forEach((snap: any) => {
        const txn = snap.val();
        if (!txn || txn.trainingMode || !Array.isArray(txn.items)) return;
        for (const item of txn.items) {
          if (!item) continue;
          const qty = Number(item.quantity) || 0;
          if (qty <= 0) continue; // skip adjustment clones / non-sold rows
          if (item.refunded || item.returned || item.voided || item.refund != null || item.return != null) continue;
          const title = item.title || "(unnamed)";
          const option = item.option || "";
          const category = item.categoryOriginal || item.category || "";
          const key = `${title}|${option}`;
          const sales = qty * (Number(item.price) || 0);
          const cur = mix.get(key) || { item: title, option, category, quantity: 0, sales: 0 };
          cur.quantity += qty;
          cur.sales += sales;
          mix.set(key, cur);
        }
      });
    }

    const sorted = [...mix.values()].sort((a, b) => b.sales - a.sales);
    const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
    const sheetRows: any[][] = [["Item", "Option", "Category", "Quantity Sold", "Gross Sales"]];
    let totalQty = 0;
    let totalSales = 0;
    for (const r of sorted) {
      sheetRows.push([r.item, r.option, r.category, r.quantity, round2(r.sales)]);
      totalQty += r.quantity;
      totalSales += r.sales;
    }
    sheetRows.push(["TOTAL", "", "", totalQty, round2(totalSales)]);

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
