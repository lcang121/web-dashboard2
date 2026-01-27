import React, { useState, useEffect, useCallback } from "react";
import {
  saveZ,
  saveX,
  viewJournal,
  testFtpAndNotify,
  saveJournal,
  saveSalesSummary,
  saveSpecialDiscounts,
  printExpenses,
  printZ,
  printX,
  printJournal,
  printZCustom,
  printRefunds,
  saveRefunds,
  saveZCustom,
} from "../hooks";
import {
  Printer,
  Download,
  Share2,
  Eye,
  AlertCircle,
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
  generateSampleData,
} from "../../../components/charts";
import Moment from "moment-timezone";

export default function DailyTab() {
  const { user } = useAuth();
  const [sttS, setSttS] = useState(Moment().startOf("day").toDate());
  const [endS, setEndS] = useState(Moment().endOf("day").toDate());
  const [loading, setLoading] = useState(false);
  const [isZReprint, setIsZReprint] = useState(false);
  const [journalData, setJournalData] = useState<string | null>(null);
  const [showJournalModal, setShowJournalModal] = useState(false);

  // Chart-related state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [chartsLoading, setChartsLoading] = useState(false);
  const [showCharts, setShowCharts] = useState(true);

  // Function to fetch transaction data for charts
  const fetchTransactionData = useCallback(async () => {
    if (!user?.uid) {
      // Use sample data if no user is authenticated (for demo purposes)
      setTransactions(generateSampleData());
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

      // If no real data is found, use sample data for demo
      setTransactions(
        fetchedTransactions.length > 0
          ? fetchedTransactions
          : generateSampleData(),
      );
    } catch (error) {
      console.error("Error fetching transaction data:", error);
      // Fall back to sample data on error
      setTransactions(generateSampleData());
    } finally {
      setChartsLoading(false);
    }
  }, [user?.uid, sttS, endS]);

  // Fetch data when component mounts or date range changes
  useEffect(() => {
    fetchTransactionData();
  }, [fetchTransactionData]);

  // Z-Reading handlers
  const handlePrintZ = async () => {
    try {
      setLoading(true);
      if (isZReprint) {
        await printZCustom(Moment(sttS).format("X"), Moment(endS).format("X"));
      } else {
        await printZ(Moment(sttS).format("YYMMDD"));
      }
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

  // X-Reading handlers
  const handlePrintX = async () => {
    try {
      setLoading(true);
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

  // Journal handlers
  const handleViewJournal = async () => {
    try {
      setLoading(true);
      const data = await viewJournal(
        Moment(sttS).format("YYMMDD"),
        Moment(endS).format("YYMMDD"),
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
      await printJournal(Moment(sttS).format("YYMMDD"));
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

      {/* Z-Reading Section */}
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
            Regular Z-Reading
          </button>
          <button
            onClick={() => setIsZReprint(true)}
            className={`px-4 py-2 rounded font-medium transition-colors ${
              isZReprint
                ? "bg-utak-darkseagreen text-white"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            Z-Reading Reprint
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      {/* X-Reading Section */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">X-Reading</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      {/* Refund Report Section */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          Refund Report
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

      {/* BIR eJournal Section */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          BIR eJournal
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SectionButton
            icon={Eye}
            label="VIEW"
            onClick={handleViewJournal}
            variant="secondary"
          />
          <SectionButton
            icon={Printer}
            label="Print"
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

      {/* Sales Summary Section */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          Sales Summary Report
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SectionButton
            icon={Download}
            label="Excel"
            onClick={() => handleSaveSalesSummary(false)}
            variant="success"
          />
        </div>
      </div>

      {/* Special Discounts Section */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          Special Discounts Report
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SectionButton
            icon={Download}
            label="Excel"
            onClick={() => handleSaveSpecialDiscounts(false)}
            variant="success"
          />
        </div>
      </div>

      {/* FTP Test Section */}
      {/* <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          FTP Connection
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SectionButton
            icon={AlertCircle}
            label="Test FTP"
            onClick={testFtpAndNotify}
            variant="secondary"
          />
        </div>
        <p className="text-sm text-gray-600 mt-2">
          Note: FTP functionality is not available in web environment. Files
          will be downloaded locally instead.
        </p>
      </div> */}

      {/* Journal Modal */}
      {showJournalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-96 overflow-auto">
            <div className="flex justify-between items-center p-6 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="text-xl font-bold">BIR eJournal</h2>
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
