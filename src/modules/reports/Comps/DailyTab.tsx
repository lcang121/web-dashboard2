import React, { useState, useEffect, useCallback } from "react";
import {
  saveZ,
  saveX,
  viewJournal,
  saveJournal,
  saveSalesSummary,
  saveDetailedSalesReport,
  saveSpecialDiscounts,
  saveProductMix,
  printExpenses,
  printZ,
  printX,
  printJournal,
  printZCustom,
  printRefunds,
  saveRefunds,
  saveZCustom,
  getZReadingHistory,
  getXReadingHistory,
} from "../hooks";
import {
  Printer,
  Download,
  Eye,
  Loader,
  BarChart3,
} from "lucide-react";
import { ref, query, orderByKey, startAt, endAt, get } from "firebase/database";
import { database } from "../../../config/firebase";
import { useAuth } from "../../../contexts/AuthContext";
import Transaction from "../../../models/Transaction";
import {
  RevenueOverview,
  DailySalesTrend,
  PaymentMethods,
  SalesBreakdown,
  generateRevenueOverview,
  generateDailySalesTrend,
  generatePaymentMethodData,
  generateSalesBreakdownData,
} from "../../../components/charts";
import Moment from "moment-timezone";

export default function DailyTab() {
  const { user } = useAuth();
  const [sttS, setSttS] = useState(Moment().startOf("day").toDate());
  const [endS, setEndS] = useState(Moment().endOf("day").toDate());
  const [loading, setLoading] = useState(false);
  const [isZReprint, setIsZReprint] = useState(false);
  const [xReadingMode, setXReadingMode] = useState<"regular" | "history">("regular");
  const [journalType, setJournalType] = useState<"all" | "z" | "x" | "orderslip" | "billout">("all");
  const [journalData, setJournalData] = useState<string | null>(null);
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [zHistoryModal, setZHistoryModal] = useState<{ open: boolean; data: any[] }>({ open: false, data: [] });
  const [xHistoryModal, setXHistoryModal] = useState<{ open: boolean; data: any[] }>({ open: false, data: [] });

  // Chart-related state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [chartsLoading, setChartsLoading] = useState(false);
  const [showCharts, setShowCharts] = useState(true);

  // Function to fetch transaction data for charts
  const fetchTransactionData = useCallback(async () => {
    if (!user?.uid) {
      setTransactions([]);
      return;
    }

    setChartsLoading(true);
    try {
      const sttTimestamp = Moment(sttS).startOf("day").format("X");
      const endTimestamp = Moment(endS).endOf("day").format("X");

      const transactionsRef = ref(database, `${user.uid}/transactions`);
      const transactionsQuery = query(
        transactionsRef,
        orderByKey(),
        startAt(sttTimestamp),
        endAt(endTimestamp),
      );

      const snapshot = await get(transactionsQuery);
      const fetchedTransactions: Transaction[] = [];

      if (snapshot.exists()) {
        snapshot.forEach((childSnapshot) => {
          const txn = new Transaction({
            key: childSnapshot.key,
            val: childSnapshot.val(),
          });
          fetchedTransactions.push(txn);
        });
      }

      setTransactions(fetchedTransactions);
    } catch (error) {
      console.error("Error fetching transaction data:", error);
      setTransactions([]);
    } finally {
      setChartsLoading(false);
    }
  }, [user?.uid, sttS, endS]);

  // Fetch data when component mounts or date range changes
  useEffect(() => {
    fetchTransactionData();
  }, [fetchTransactionData]);

  // Z-Reading handlers (aligns with utakmobile)
  const handleOpenZHistory = async () => {
    try {
      setLoading(true);
      const history = await getZReadingHistory();
      const historyArray = Object.keys(history)
        .map((key) => ({ ...history[key], key }))
        .sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
      setZHistoryModal({ open: true, data: historyArray });
    } catch (e) {
      alert("Failed to load Z-Reading history: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handlePrintZ = async () => {
    try {
      setLoading(true);
      if (isZReprint) {
        await handleOpenZHistory();
        return;
      }
      await printZ(Moment(sttS).format("YYMMDD"));
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handleReprintZFromHistory = async (item: any) => {
    try {
      setLoading(true);
      setZHistoryModal({ open: false, data: [] });
      // Web: regenerate Z-reading for the history item's date
      const ts = item.generatedAt || parseInt(item.key, 10) || Moment().unix();
      const startX = Moment.unix(ts).startOf("day").format("X");
      const endX = Moment.unix(ts).endOf("day").format("X");
      await printZCustom(startX, endX);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveZ = async (upload = false) => {
    try {
      setLoading(true);
      if (isZReprint) {
        await saveZCustom(
          Moment(sttS).format("X"),
          Moment(endS).format("X"),
          upload,
        );
      } else {
        await saveZ(Moment(sttS).format("YYMMDD"), upload);
      }
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  // X-Reading handlers (aligns with utakmobile - Regular vs Reprint History)
  const handleOpenXHistory = async () => {
    try {
      setLoading(true);
      const history = await getXReadingHistory();
      const historyArray = Object.keys(history)
        .map((key) => ({ ...history[key], key }))
        .sort((a, b) => (b.generatedAt || 0) - (a.generatedAt || 0));
      setXHistoryModal({ open: true, data: historyArray });
    } catch (e) {
      alert("Failed to load X-Reading history: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handlePrintX = async () => {
    try {
      setLoading(true);
      if (xReadingMode === "history") {
        await handleOpenXHistory();
        return;
      }
      await printX(
        Moment(sttS).format("YYMMDD"),
        Moment(endS).format("YYMMDD"),
      );
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handleReprintXFromHistory = async (item: any) => {
    try {
      setLoading(true);
      setXHistoryModal({ open: false, data: [] });
      const ts = item.generatedAt || parseInt(item.key, 10) || Moment().unix();
      const dateStr = Moment.unix(ts).format("YYMMDD");
      await printX(dateStr, dateStr);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveX = async (upload = false) => {
    try {
      setLoading(true);
      await saveX(
        Moment(sttS).format("YYMMDD"),
        Moment(endS).format("YYMMDD"),
        upload,
      );
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  // Expenses handler
  const handlePrintExpenses = async () => {
    try {
      setLoading(true);
      await printExpenses(Moment(sttS).format("X"), Moment(endS).format("X"));
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  // Refund handlers
  const handlePrintRefunds = async () => {
    try {
      setLoading(true);
      await printRefunds(Moment(sttS).format("X"), Moment(endS).format("X"));
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRefunds = async (upload = false) => {
    try {
      setLoading(true);
      await saveRefunds(
        Moment(sttS).format("YYMMDD"),
        Moment(endS).format("YYMMDD"),
        upload,
      );
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  // Journal handlers (with type: all | z | x - aligns with utakmobile)
  const handleViewJournal = async () => {
    try {
      setLoading(true);
      const data = await viewJournal(
        Moment(sttS).format("YYMMDD"),
        Moment(endS).format("YYMMDD"),
        journalType,
      );
      setJournalData(data);
      setShowJournalModal(true);
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveJournal = async (upload = false) => {
    try {
      setLoading(true);
      await saveJournal(
        Moment(sttS).format("YYMMDD"),
        Moment(endS).format("YYMMDD"),
        upload,
        journalType,
      );
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handlePrintJournal = async () => {
    try {
      setLoading(true);
      await printJournal(
        Moment(sttS).format("YYMMDD"),
        Moment(endS).format("YYMMDD"),
        journalType,
      );
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSalesSummary = async (upload = false) => {
    try {
      setLoading(true);
      await saveSalesSummary(
        Moment(sttS).format("YYMMDD"),
        Moment(endS).format("YYMMDD"),
        upload,
      );
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSpecialDiscounts = async (upload = false) => {
    try {
      setLoading(true);
      await saveSpecialDiscounts(
        Moment(sttS).format("YYMMDD"),
        Moment(endS).format("YYMMDD"),
        upload,
      );
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProductMix = async (upload = false) => {
    try {
      setLoading(true);
      await saveProductMix(
        Moment(sttS).format("YYMMDD"),
        Moment(endS).format("YYMMDD"),
        upload,
      );
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDetailed = async (upload = false) => {
    try {
      setLoading(true);
      await saveDetailedSalesReport(
        Moment(sttS).format("YYMMDD"),
        Moment(endS).format("YYMMDD"),
        upload,
      );
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const SectionButton = ({
    icon: Icon,
    label,
    onClick,
    variant = "primary",
    disabled = false,
  }) => {
    const baseClasses =
      "flex items-center justify-center gap-2 px-4 py-3 rounded font-semibold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed";
    const variants = {
      primary: "bg-orange-500 hover:bg-orange-600",
      secondary: "bg-pink-500 hover:bg-pink-600",
      success: "bg-green-600 hover:bg-green-700",
    };

    return (
      <button
        onClick={onClick}
        disabled={disabled || loading}
        className={`${baseClasses} ${variants[variant]}`}
      >
        {loading ? (
          <Loader size={20} className="animate-spin" />
        ) : (
          <Icon size={20} />
        )}
        {label}
      </button>
    );
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Date Selection */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">Date Range</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Start Date
            </label>
            <input
              type="datetime-local"
              value={Moment(sttS).format("YYYY-MM-DDTHH:mm")}
              onChange={(e) => setSttS(new Date(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-utak-darkseagreen focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              End Date
            </label>
            <input
              type="datetime-local"
              value={Moment(endS).format("YYYY-MM-DDTHH:mm")}
              onChange={(e) => setEndS(new Date(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-utak-darkseagreen focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Charts Toggle */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-800">
            Analytics Dashboard
          </h3>
          <button
            onClick={() => setShowCharts(!showCharts)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <BarChart3 size={20} />
            {showCharts ? "Hide Charts" : "Show Charts"}
          </button>
        </div>
      </div>

      {/* Charts Section */}
      {showCharts && (
        <div className="space-y-6 mb-6">
          {/* Revenue Overview */}
          <RevenueOverview
            data={generateRevenueOverview(transactions)}
            isLoading={chartsLoading}
          />

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DailySalesTrend
              data={generateDailySalesTrend(transactions, {
                start: sttS,
                end: endS,
              })}
              isLoading={chartsLoading}
              height={350}
            />
            <PaymentMethods
              data={generatePaymentMethodData(transactions)}
              isLoading={chartsLoading}
              height={350}
            />
          </div>

          {/* Sales Breakdown */}
          <SalesBreakdown
            data={generateSalesBreakdownData(transactions)}
            isLoading={chartsLoading}
            height={300}
          />
        </div>
      )}

      {/* Z-Reading Section (aligns with utakmobile) */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">Z-Reading</h3>

        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setIsZReprint(false)}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              !isZReprint
                ? "bg-utak-darkseagreen text-white"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            Regular
          </button>
          <button
            onClick={() => setIsZReprint(true)}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              isZReprint
                ? "bg-utak-darkseagreen text-white"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            Reprint History
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionButton
            icon={Printer}
            label="Print"
            onClick={handlePrintZ}
            variant="primary"
          />
          <SectionButton
            icon={Download}
            label="CSV"
            onClick={() => handleSaveZ(false)}
            variant="secondary"
          />
        </div>
      </div>

      {/* X-Reading Section (aligns with utakmobile - Regular vs Reprint History) */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">X-Reading</h3>

        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setXReadingMode("regular")}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              xReadingMode === "regular"
                ? "bg-utak-darkseagreen text-white"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            Regular
          </button>
          <button
            onClick={() => setXReadingMode("history")}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              xReadingMode === "history"
                ? "bg-utak-darkseagreen text-white"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            Reprint History
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionButton
            icon={Printer}
            label="Print"
            onClick={handlePrintX}
            variant="primary"
          />
          <SectionButton
            icon={Download}
            label="CSV"
            onClick={() => handleSaveX(false)}
            variant="secondary"
          />
        </div>
      </div>

      {/* Expenses Section */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">Expenses</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SectionButton
            icon={Printer}
            label="Print"
            onClick={handlePrintExpenses}
            variant="primary"
          />
        </div>
      </div>

      {/* Refund Report Section (aligns with utakmobile) */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          Refund Report
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionButton
            icon={Printer}
            label="Print"
            onClick={handlePrintRefunds}
            variant="primary"
          />
          <SectionButton
            icon={Download}
            label="CSV"
            onClick={() => handleSaveRefunds(false)}
            variant="secondary"
          />
        </div>
      </div>

      {/* BIR eJournal Section (aligns with utakmobile - Transaction/Z-READ/X-READ) */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          BIR eJournal
        </h3>

        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setJournalType("all")}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              journalType === "all"
                ? "bg-utak-darkseagreen text-white"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            Transaction
          </button>
          <button
            onClick={() => setJournalType("z")}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              journalType === "z"
                ? "bg-utak-darkseagreen text-white"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            Z-READ
          </button>
          <button
            onClick={() => setJournalType("x")}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              journalType === "x"
                ? "bg-utak-darkseagreen text-white"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            X-READ
          </button>
          <button
            onClick={() => setJournalType("orderslip")}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              journalType === "orderslip"
                ? "bg-utak-darkseagreen text-white"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            Order Slips
          </button>
          <button
            onClick={() => setJournalType("billout")}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              journalType === "billout"
                ? "bg-utak-darkseagreen text-white"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            Bill Outs
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SectionButton
            icon={Eye}
            label="VIEW"
            onClick={handleViewJournal}
            variant="secondary"
          />
          <SectionButton
            icon={Printer}
            label="PRINT"
            onClick={handlePrintJournal}
            variant="primary"
          />
          <SectionButton
            icon={Download}
            label="TXT"
            onClick={() => handleSaveJournal(false)}
            variant="secondary"
          />
        </div>
      </div>

      {/* Sales Summary Section (aligns with utakmobile) */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          Sales Summary Report
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionButton
            icon={Download}
            label="XLSX"
            onClick={() => handleSaveSalesSummary(false)}
            variant="primary"
          />
        </div>
      </div>

      {/* Detailed Sales Summary Section (aligns with utakmobile) */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          Detailed Sales Summary (Per-Transaction)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionButton
            icon={Download}
            label="XLSX"
            onClick={() => handleSaveDetailed(false)}
            variant="primary"
          />
        </div>
      </div>

      {/* Special Discounts Section (aligns with utakmobile) */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          Special Discounts Report
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionButton
            icon={Download}
            label="XLSX"
            onClick={() => handleSaveSpecialDiscounts(false)}
            variant="primary"
          />
        </div>
      </div>

      {/* Product Mix Section (aligns with utakmobile) */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          Product Mix
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionButton
            icon={Download}
            label="XLSX"
            onClick={() => handleSaveProductMix(false)}
            variant="primary"
          />
        </div>
      </div>

      {/* Z-Reading History Modal */}
      {zHistoryModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="flex justify-between items-center p-6 border-b border-gray-200 sticky top-0 bg-white">
              <div>
                <h2 className="text-xl font-bold">Z-Reading History</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Select a Z-Reading to reprint
                </p>
              </div>
              <button
                onClick={() => setZHistoryModal({ open: false, data: [] })}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="p-6 max-h-96 overflow-y-auto">
              {zHistoryModal.data.length > 0 ? (
                <div className="space-y-3">
                  {zHistoryModal.data.map((item: any, index: number) => (
                    <button
                      key={item.key || index}
                      onClick={() => handleReprintZFromHistory(item)}
                      className="w-full text-left p-4 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-utak-darkseagreen transition-colors"
                    >
                      <div className="font-semibold text-utak-darkseagreen">
                        Z-Read #{item.zReadNo ?? "—"}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        Generated:{" "}
                        {Moment.unix(item.generatedAt || 0).format(
                          "MMM DD, YYYY hh:mm A",
                        )}
                      </p>
                      <p className="text-sm text-gray-600">
                        Date Range: {item.dateRange || "—"}
                      </p>
                      <p className="text-sm text-gray-600">
                        Cashier: {item.cashier || "N/A"}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">
                  No Z-Reading history found.
                  <br />
                  Generate a Z-Reading first to see it here.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* X-Reading History Modal */}
      {xHistoryModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="flex justify-between items-center p-6 border-b border-gray-200 sticky top-0 bg-white">
              <div>
                <h2 className="text-xl font-bold">X-Reading History</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Select an X-Reading to reprint
                </p>
              </div>
              <button
                onClick={() => setXHistoryModal({ open: false, data: [] })}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="p-6 max-h-96 overflow-y-auto">
              {xHistoryModal.data.length > 0 ? (
                <div className="space-y-3">
                  {xHistoryModal.data.map((item: any, index: number) => (
                    <button
                      key={item.key || index}
                      onClick={() => handleReprintXFromHistory(item)}
                      className="w-full text-left p-4 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-utak-darkseagreen transition-colors"
                    >
                      <div className="font-semibold text-utak-darkseagreen">
                        X-Reading
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        Generated:{" "}
                        {Moment.unix(item.generatedAt || 0).format(
                          "MMM DD, YYYY hh:mm A",
                        )}
                      </p>
                      <p className="text-sm text-gray-600">
                        Date: {item.dateRange || "—"}
                      </p>
                      <p className="text-sm text-gray-600">
                        Cashier: {item.cashier || "N/A"}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">
                  No X-Reading history found.
                  <br />
                  Generate an X-Reading first to see it here.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Journal Modal */}
      {showJournalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-96 overflow-auto">
            <div className="flex justify-between items-center p-6 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="text-xl font-bold">
                BIR eJournal{" "}
                {journalType === "z"
                  ? "(Z-READ)"
                  : journalType === "x"
                    ? "(X-READ)"
                    : "(Transactions)"}
              </h2>
              <button
                onClick={() => setShowJournalModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="p-6">
              {journalData ? (
                <pre className="text-sm text-gray-700 font-mono whitespace-pre-wrap break-words">
                  {journalData}
                </pre>
              ) : (
                <p className="text-gray-500 text-center">No Data</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
