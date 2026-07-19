import React, { useState, useEffect } from 'react';
import { saveVoidsReport } from '../hooks';
import Moment from 'moment-timezone';
import { Menu, Download, Loader } from 'lucide-react';
import { ref, query, orderByKey, startAt, endAt, onValue, off } from 'firebase/database';
import { database } from '../../../config/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import Transaction from '../../../models/Transaction';
import _ from 'lodash-es';

export default function VoidsTab() {
  const { user } = useAuth();
  const [sttS, setSttS] = useState(() =>
    Math.floor(Moment().subtract(6, 'days').startOf('day').unix())
  );
  const [endS, setEndS] = useState(() =>
    Math.floor(Moment().endOf('day').unix())
  );

  const [voidsData, setVoidsData] = useState({
    loading: true,
    value: [] as Transaction[],
  });

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const startDateString = Moment.unix(sttS).format('YYYY-MM-DDTHH:mm');
  const endDateString = Moment.unix(endS).format('YYYY-MM-DDTHH:mm');

  useEffect(() => {
    if (!user?.uid) {
      setVoidsData({ loading: false, value: [] });
      return;
    }

    setVoidsData(v => ({ ...v, loading: true }));

    const voidsRef = ref(database, `${user.uid}/voids`);
    const voidsQuery = query(voidsRef, orderByKey(), startAt(`${sttS}`), endAt(`${endS}`));

    const handleVoidsUpdate = _.debounce((snapshot: any) => {
      const voids: Transaction[] = [];
      if (snapshot.exists()) {
        const data = snapshot.val();
        Object.entries(data).forEach(([key, val]) => {
          if ((val as any)?.trainingMode) return;
          const transaction = new Transaction({ key: parseInt(key), val: val as any });
          voids.unshift(transaction);
        });
      }
      setVoidsData({ loading: false, value: voids });
    }, 500);

    onValue(voidsQuery, handleVoidsUpdate);

    return () => {
      off(voidsQuery, 'value', handleVoidsUpdate);
    };
  }, [sttS, endS, user?.uid]);

  const handleDownload = async () => {
    try {
      setDownloadLoading(true);
      await saveVoidsReport(sttS, endS, false);
    } catch (error) {
      console.error('Error downloading voids report:', error);
      alert('Error downloading report: ' + error);
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleDateChange = (type: 'start' | 'end', value: string) => {
    const date = new Date(value);
    const timestamp = Math.floor(date.getTime() / 1000);
    if (type === 'start') setSttS(timestamp);
    else setEndS(timestamp);
  };

  const getVoidedAmount = (transaction: Transaction) => {
    let amount = 0;
    transaction.items.forEach(item => {
      if (item && (item as any).voided) {
        amount += Math.abs(item.quantity * item.price);
      }
    });
    return amount / Transaction.MONEY_PRECISION;
  };

  const getVoidedItemsCount = (transaction: Transaction) =>
    transaction.items.filter(item => item && (item as any).voided).length;

  const totalPages = Math.ceil(voidsData.value.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedVoids = voidsData.value.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [sttS, endS]);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-2">
            <Menu size={28} className="text-gray-600" />
          </div>

          <div className="flex flex-col md:flex-row gap-4 flex-1 md:max-w-2xl">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">From:</label>
              <input
                type="datetime-local"
                value={startDateString}
                onChange={(e) => handleDateChange('start', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-utak-darkseagreen focus:border-transparent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">To:</label>
              <input
                type="datetime-local"
                value={endDateString}
                onChange={(e) => handleDateChange('end', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-utak-darkseagreen focus:border-transparent"
              />
            </div>
          </div>

          <button
            onClick={handleDownload}
            disabled={!voidsData.value.length || downloadLoading}
            className="flex items-center justify-center gap-2 px-6 py-2 rounded-lg font-semibold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700">
            {downloadLoading ? <Loader size={20} className="animate-spin" /> : <Download size={20} />}
            {downloadLoading ? 'Saving...' : 'Save Report'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {voidsData.loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-2">
              <Loader size={32} className="animate-spin text-utak-darkseagreen" />
              <p className="text-gray-600">Loading voids...</p>
            </div>
          </div>
        ) : voidsData.value.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500 text-center">No voids found for the selected date range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Time</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-orange-700 uppercase">Voided Amount</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-green-700 uppercase">Original Total</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">Voided Items</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paginatedVoids.map((voidTxn, idx) => (
                  <tr key={`${voidTxn.key}-${idx}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {Moment.unix(Number(voidTxn.key)).format('DD MMM YYYY')}
                    </td>
                    <td className="px-6 py-4 text-sm text-utak-darkseagreen font-medium">
                      {Moment.unix(Number(voidTxn.key)).format('h:mm a')}
                    </td>
                    <td className="px-6 py-4 text-sm text-orange-600 font-medium text-right">
                      ₱{getVoidedAmount(voidTxn).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-sm text-green-600 font-medium text-right">
                      {voidTxn.getFormattedCurrency('$amountDue')}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 text-right">
                      {getVoidedItemsCount(voidTxn)} of {voidTxn.items?.length || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!voidsData.loading && voidsData.value.length > 0 && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing <span className="font-semibold">{startIndex + 1}</span> to{' '}
                <span className="font-semibold">{Math.min(endIndex, voidsData.value.length)}</span> of{' '}
                <span className="font-semibold">{voidsData.value.length}</span> records
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="First page">⟨⟨</button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">← Previous</button>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Page</span>
                  <input
                    type="number"
                    min="1"
                    max={totalPages}
                    value={currentPage}
                    onChange={(e) => {
                      const page = parseInt(e.target.value) || 1;
                      setCurrentPage(Math.min(Math.max(1, page), totalPages));
                    }}
                    className="w-12 px-2 py-1 text-sm border border-gray-300 rounded text-center"
                  />
                  <span className="text-sm text-gray-600">of {totalPages}</span>
                </div>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">Next →</button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Last page">⟩⟩</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
