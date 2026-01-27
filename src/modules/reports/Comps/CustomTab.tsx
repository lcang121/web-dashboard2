import React, { useState } from "react";
import {
  saveX,
  saveJournal,
  saveSalesSummary,
  saveSpecialDiscounts,
  viewJournal,
  printX,
  printJournal,
} from "../hooks";
import Moment from "moment-timezone";
import { Download, Share2, Loader, Eye, Printer } from "lucide-react";

export default function CustomTab() {
  const [sttS, setSttS] = useState(
    Moment().subtract(7, "days").startOf("day").toDate(),
  );
  const [endS, setEndS] = useState(Moment().endOf("day").toDate());
  const [loading, setLoading] = useState(false);
  const [journalData, setJournalData] = useState<string | null>(null);
  const [showJournalModal, setShowJournalModal] = useState(false);

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
    variant = "secondary",
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionButton
            icon={Download}
            label="Excel"
            onClick={() => handleSaveSalesSummary(false)}
            variant="success"
          />
          <SectionButton
            icon={Share2}
            label="Upload to FTP"
            onClick={() => handleSaveSalesSummary(true)}
            variant="secondary"
          />
        </div>
      </div>

      {/* Special Discounts Section */}
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          Special Discounts Report
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionButton
            icon={Download}
            label="Excel"
            onClick={() => handleSaveSpecialDiscounts(false)}
            variant="success"
          />
          <SectionButton
            icon={Share2}
            label="Upload to FTP"
            onClick={() => handleSaveSpecialDiscounts(true)}
            variant="secondary"
          />
        </div>
      </div>

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
