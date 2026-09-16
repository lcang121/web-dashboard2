import React, { useState } from "react";
import {
  saveSalesSummary,
  saveDetailedSalesReport,
  saveSpecialDiscounts,
  saveProductMix,
  saveRefunds,
  saveJournal,
} from "../hooks";
import Moment from "moment-timezone";
import { Download, Loader } from "lucide-react";

/**
 * Monthly (consolidated) reports. Picks a calendar month and produces the same
 * report set as the mobile Monthly tab, with the Sales Summary collapsed into a
 * single consolidated row (consolidate = true).
 */
export default function MonthlyTab() {
  const [month, setMonth] = useState(Moment().format("YYYY-MM"));
  const [loading, setLoading] = useState(false);

  const range = () => {
    const start = Moment(month, "YYYY-MM").startOf("month");
    const end = Moment(month, "YYYY-MM").endOf("month");
    return {
      sttYYMMDD: start.format("YYMMDD"),
      endYYMMDD: end.format("YYMMDD"),
    };
  };

  const run = async (fn: () => Promise<any>) => {
    try {
      setLoading(true);
      await fn();
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  const { sttYYMMDD, endYYMMDD } = range();

  const SectionButton = ({
    label,
    onClick,
  }: {
    label: string;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center justify-center gap-2 px-4 py-3 rounded font-semibold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed bg-utak-darkseagreen hover:bg-utak-darkgreen"
    >
      {loading ? <Loader size={20} className="animate-spin" /> : <Download size={20} />}
      {label}
    </button>
  );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">Month</h3>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-full md:w-64 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-utak-darkseagreen focus:border-transparent"
        />
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-800">
          Monthly Consolidated Reports
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionButton
            label="Sales Summary (Consolidated)"
            onClick={() => run(() => saveSalesSummary(sttYYMMDD, endYYMMDD, false, true))}
          />
          <SectionButton
            label="Detailed Sales Summary"
            onClick={() => run(() => saveDetailedSalesReport(sttYYMMDD, endYYMMDD, false))}
          />
          <SectionButton
            label="Product Mix"
            onClick={() => run(() => saveProductMix(sttYYMMDD, endYYMMDD, false))}
          />
          <SectionButton
            label="Special Discounts"
            onClick={() => run(() => saveSpecialDiscounts(sttYYMMDD, endYYMMDD, false))}
          />
          <SectionButton
            label="Refunds"
            onClick={() => run(() => saveRefunds(sttYYMMDD, endYYMMDD, false))}
          />
          <SectionButton
            label="eJournal (TXT)"
            onClick={() => run(() => saveJournal(sttYYMMDD, endYYMMDD, false))}
          />
        </div>
      </div>
    </div>
  );
}
