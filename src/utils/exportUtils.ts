// Web-compatible export utilities for CSV and XLSX files
import * as XLSX from 'xlsx';
import Transaction from '../models/Transaction';
import Moment from 'moment-timezone';

export interface ExportOptions {
  filename?: string;
  trainingMode?: boolean;
}

// Normalize function to clean CSV data (from mobile implementation)
function normalize(str: any): string | number {
  if (typeof str === 'string') {
    return str.replace(/[,;:\t]/g, '');
  } else {
    return parseFloat((str || 0).toFixed(2));
  }
}

// Browser download helper
function downloadFile(content: string | ArrayBuffer, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

// CSV Export Functions
export async function downloadCsvFile(csvContent: string[][], filename: string, options: ExportOptions = {}) {
  try {
    if (!csvContent || !Array.isArray(csvContent) || csvContent.length === 0) {
      throw new Error('No data to export');
    }

    const csvString = csvContent.map(row =>
      Array.isArray(row) ? row.join(',') : String(row)
    ).join('\n');

    const finalFilename = `${options.trainingMode ? '[TRAINING MODE] ' : ''}${filename}.csv`;

    downloadFile(csvString, finalFilename, 'text/csv;charset=utf-8;');

    return Promise.resolve(finalFilename);
  } catch (error) {
    console.error('Error downloading CSV file:', error);
    throw new Error(`Failed to download CSV: ${error.message || 'Unknown error'}`);
  }
}

// XLSX Export Function
export async function downloadExcelFile(
  workbookData: { [sheetName: string]: any[][] },
  filename: string,
  options: ExportOptions = {}
) {
  try {
    if (!workbookData || typeof workbookData !== 'object' || Object.keys(workbookData).length === 0) {
      throw new Error('No data to export');
    }

    // Create a new workbook
    const wb = XLSX.utils.book_new();

    // Add each sheet to the workbook
    Object.entries(workbookData).forEach(([sheetName, data]) => {
      if (data && Array.isArray(data) && data.length > 0) {
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }
    });

    // Generate file
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const finalFilename = `${options.trainingMode ? '[TRAINING MODE] ' : ''}${filename}.xlsx`;

    downloadFile(wbout, finalFilename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    return Promise.resolve(finalFilename);
  } catch (error) {
    console.error('Error downloading Excel file:', error);
    throw new Error(`Failed to download Excel: ${error.message || 'Unknown error'}`);
  }
}

// Transaction CSV generation (equivalent to mobile transactions function)
export function generateTransactionsCsv(transactions: any[], isManual = false): string[][] {
  const headers = !isManual
    ? ['Date', 'Time', 'Amount Due', 'Service']
    : ['Date', 'Time', 'Manual SI/OR', 'Receipt Number', 'Amount Due', 'Service'];

  const data = [headers];
  const MP = Transaction.MONEY_PRECISION;

  transactions.forEach(txnData => {
    let txn: Transaction;

    // Handle both plain objects and Transaction instances
    if (txnData instanceof Transaction) {
      txn = txnData;
    } else {
      // Create Transaction from Firebase data or plain object
      const key = txnData.key || (typeof txnData === 'object' && Object.keys(txnData)[0]);
      const val = txnData.val ? txnData.val() : txnData;
      txn = new Transaction({ key, val });
    }

    const time = Moment.unix(Number(txn.key));
    const row = [];

    row.push(normalize(time.format('D MMM YYYY')));
    row.push(normalize(time.format('h:mma')));

    if (isManual) {
      row.push(txn.original.manualReference || '');
      row.push(txn.original.receiptNo || '');
    }

    row.push(normalize(txn.$amountDue / MP));
    row.push(normalize(txn.$service / MP));

    data.push(row);
  });

  return data;
}

// Generate refunds CSV (placeholder - would need actual implementation)
export function generateRefundsCsv(startTimestamp: number, endTimestamp: number): string[][] {
  // This would need to be implemented with actual refunds data from Firebase
  // For now, return basic structure
  const headers = ['Date', 'Time', 'Original Receipt', 'Refund Amount', 'Reason'];
  return [headers];
}

// Generate Z Reading CSV (placeholder - would need actual implementation)
export function generateZCsv(date: string): string[][] {
  const headers = ['Z Reading Report', `Date: ${date}`];
  return [headers];
}

// Generate X Reading CSV (placeholder - would need actual implementation)
export function generateXCsv(startDate: string, endDate?: string): string[][] {
  const headers = ['X Reading Report', `Period: ${startDate}${endDate ? ` to ${endDate}` : ''}`];
  return [headers];
}

// Web utility to get current user settings (placeholder)
export function getUserSettings() {
  // This would need to be implemented with actual user settings from context/store
  return {
    name: 'Business Name',
    address: 'Business Address',
    receiptDetails: {
      VATTIN: '000-000-000-000',
      NONVATTIN: '',
      SN: 'SN123456',
      MIN: 'MIN123456',
      receiptType: 'OR'
    },
    account: 'user@example.com'
  };
}

// Format time range for filenames
export function formatTimeRange(startTimestamp: number, endTimestamp: number): { start: string; end: string } {
  return {
    start: Moment.unix(startTimestamp).format('MM-DD ha'),
    end: Moment.unix(endTimestamp).format('MM-DD ha')
  };
}

export default {
  downloadCsvFile,
  downloadExcelFile,
  generateTransactionsCsv,
  generateRefundsCsv,
  generateZCsv,
  generateXCsv,
  getUserSettings,
  formatTimeRange
};