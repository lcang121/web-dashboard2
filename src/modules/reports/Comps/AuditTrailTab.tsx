import React, { useEffect, useMemo, useState } from 'react';
import Moment from 'moment-timezone';
import { Loader } from 'lucide-react';
import { ref, query, orderByKey, startAt, endAt, onValue, off } from 'firebase/database';
import { database } from '../../../config/firebase';
import { useAuth } from '../../../contexts/AuthContext';

const extract = (extraInfo: any, label: string): string => {
  if (!extraInfo) return '';
  const m = String(extraInfo).match(new RegExp(`${label}\\(([^)]+)\\)`));
  return m ? m[1] : '';
};
const removeRefs = (extraInfo: any): string => {
  if (!extraInfo) return '';
  return String(extraInfo)
    .replace(/\s*SINum\([^)]+\)\s*/g, ' ')
    .replace(/\s*ORNum\([^)]+\)\s*/g, ' ')
    .replace(/\s*UtakNum\([^)]+\)\s*/g, ' ')
    .replace(/\s*OrderNum\([^)]+\)\s*/g, ' ')
    .replace(/\s*BillOutNum\([^)]+\)\s*/g, ' ')
    .replace(/\bundefined\b/gi, ' ')
    .replace(/\bnull\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
const txnNo = (obj: any): string => {
  if (obj?.transactionNo != null) return String(obj.transactionNo).padStart(6, '0');
  if (obj?.txnNo != null) return String(obj.txnNo).padStart(6, '0');
  return extract(obj?.extraInfo, 'TxnNo');
};

interface AuditEntry {
  key: string;
  auditNo?: number;
  cashier?: string;
  activity?: string;
  extraInfo?: string;
}

const PAGE_SIZE = 25;

export default function AuditTrailTab() {
  const { user } = useAuth();
  const [sttS, setSttS] = useState(() => Math.floor(Moment().subtract(2, 'days').startOf('day').unix()));
  const [endS, setEndS] = useState(() => Math.floor(Moment().endOf('day').unix()));
  const [entries, setEntries] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const startDateString = Moment.unix(sttS).format('YYYY-MM-DDTHH:mm');
  const endDateString = Moment.unix(endS).format('YYYY-MM-DDTHH:mm');

  useEffect(() => {
    if (!user?.uid) {
      setEntries({});
      setLoading(false);
      return;
    }
    setLoading(true);
    const auditRef = ref(database, `${user.uid}/auditTrail`);
    const auditQuery = query(auditRef, orderByKey(), startAt(`${sttS}`), endAt(`${endS}`));
    const cb = (snapshot: any) => {
      const val = snapshot.exists() ? snapshot.val() : {};
      // Firebase key-range only bounds the leading unix seconds; enforce the exact
      // range against parseInt so suffixed keys (`${unix}-abc`) are filtered right.
      const filtered: Record<string, any> = {};
      Object.entries(val).forEach(([k, v]) => {
        const ts = parseInt(k, 10);
        if (ts >= sttS && ts <= endS) filtered[k] = v;
      });
      setEntries(filtered);
      setLoading(false);
    };
    onValue(auditQuery, cb);
    return () => off(auditQuery, 'value', cb);
  }, [sttS, endS, user?.uid]);

  useEffect(() => setPage(0), [sttS, endS]);

  // Newest-first, numeric sort by the key's leading timestamp.
  const sorted = useMemo<AuditEntry[]>(
    () =>
      Object.entries(entries)
        .map(([key, v]) => ({ key, ...(v as any) }))
        .sort((a, b) => (parseInt(b.key, 10) || 0) - (parseInt(a.key, 10) || 0)),
    [entries],
  );

  // Permanent Audit # = stored auditNo; fall back to global chronological position.
  const auditNoFor = useMemo(() => {
    const ascending = [...sorted].sort((a, b) => (parseInt(a.key, 10) || 0) - (parseInt(b.key, 10) || 0));
    const map: Record<string, number> = {};
    let maxAssigned = 0;
    ascending.forEach((e) => {
      if (e.auditNo != null) map[e.key] = Number(e.auditNo);
      if (Number(e.auditNo) > maxAssigned) maxAssigned = Number(e.auditNo);
    });
    let running = maxAssigned;
    ascending.forEach((e) => {
      if (map[e.key] == null) map[e.key] = ++running;
    });
    return map;
  }, [sorted]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = sorted.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const handleDateChange = (type: 'start' | 'end', value: string) => {
    const ts = Math.floor(new Date(value).getTime() / 1000);
    if (type === 'start') setSttS(ts);
    else setEndS(ts);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <div className="flex flex-col md:flex-row gap-4 md:max-w-2xl">
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
      </div>

      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader size={32} className="animate-spin text-utak-darkseagreen" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-500">No audit entries for the selected date range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-medium text-utak-blue uppercase">Audit #</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-utak-blue uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-utak-darkgreen uppercase">Cashier</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-utak-pink uppercase">Activity</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-utak-orange uppercase">Utak Ref</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-utak-orange uppercase">SI #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-utak-orange uppercase">Txn #</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Activity Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {paged.map((e) => (
                  <tr key={e.key} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-center text-utak-blue font-medium">{auditNoFor[e.key]}</td>
                    <td className="px-4 py-3 text-center text-utak-blue">
                      {Moment.unix(parseInt(e.key, 10)).format('MM/DD/YYYY HH:mm:ss')}
                    </td>
                    <td className="px-4 py-3 text-utak-darkgreen">{(e.cashier ?? 'Unknown').toString()}</td>
                    <td className="px-4 py-3 text-utak-pink">{(e.activity ?? '').toString()}</td>
                    <td className="px-4 py-3 text-utak-orange">{extract(e.extraInfo, 'UtakNum')}</td>
                    <td className="px-4 py-3 text-utak-orange">{extract(e.extraInfo, 'SINum')}</td>
                    <td className="px-4 py-3 text-utak-orange">{txnNo(e)}</td>
                    <td className="px-4 py-3 text-gray-700 font-mono">{removeRefs(e.extraInfo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sorted.length > 0 && (
          <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex items-center justify-center gap-4">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={currentPage <= 0}
              className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">
              ← Prev
            </button>
            <span className="text-sm text-gray-600">
              Page {currentPage + 1} of {pageCount} ({sorted.length})
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={currentPage >= pageCount - 1}
              className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed">
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
