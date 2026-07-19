import React, { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import TransactionsTab from './Comps/TransactionsTab';
import DailyTab from './Comps/DailyTab';
import CustomTab from './Comps/CustomTab';
import RefundsTab from './Comps/RefundsTab';
import ReturnsTab from './Comps/ReturnsTab';
import VoidsTab from './Comps/VoidsTab';
import MonthlyTab from './Comps/MonthlyTab';
import AuditTrailTab from './Comps/AuditTrailTab';
import ManualTab from './Comps/ManualTransactions';
import ProductMixTab from './Comps/ProductMixTab';

export default function ReportsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('daily');
  
  const tabs = [
    { id: 'daily', label: 'Daily Totals', path: 'daily' },
    { id: 'transactions', label: 'Transactions', path: 'transactions' },
    { id: 'manual', label: 'Manual OR/SI', path: 'manual' },
    { id: 'custom', label: 'Custom', path: 'custom' },
    { id: 'refunds', label: 'Refunds', path: 'refunds' },
    { id: 'returns', label: 'Returns', path: 'returns' },
    { id: 'voids', label: 'Voids', path: 'voids' },
    { id: 'productmix', label: 'Product Mix', path: 'productmix' },
    { id: 'monthly', label: 'Monthly', path: 'monthly' },
    { id: 'audit', label: 'Audit Trail', path: 'audit' },
  ];

  // Update active tab based on current URL
  useEffect(() => {
    const currentPath = location.pathname.split('/').pop() || 'daily';
    setActiveTab(currentPath);
  }, [location.pathname]);

  const handleTabClick = (tabId: string) => {
    navigate(tabId);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-300 sticky top-0 z-10">
        <div className="flex overflow-x-auto px-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.path)}
              className={`px-4 py-3 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.path
                  ? 'border-utak-darkseagreen text-utak-darkseagreen'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <Routes>
          <Route path="daily" element={<DailyTab />} />
          <Route path="transactions" element={<TransactionsTab />} />
          <Route path="manual" element={<ManualTab />} />
          <Route path="custom" element={<CustomTab />} />
          <Route path="refunds" element={<RefundsTab />} />
          <Route path="returns" element={<ReturnsTab />} />
          <Route path="voids" element={<VoidsTab />} />
          <Route path="productmix" element={<ProductMixTab />} />
          <Route path="monthly" element={<MonthlyTab />} />
          <Route path="audit" element={<AuditTrailTab />} />
          <Route index element={<DailyTab />} />
        </Routes>
      </div>
    </div>
  );
}
