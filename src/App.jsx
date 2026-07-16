import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Home
import Home from './pages/Home.jsx';

// Cycle Counter
import CCLayout from './apps/cycle-counter/components/CCLayout.jsx';
import CCDashboard from './apps/cycle-counter/pages/Dashboard.jsx';
import ImportData from './apps/cycle-counter/pages/ImportData.jsx';
import Sessions from './apps/cycle-counter/pages/Sessions.jsx';
import CountEntry from './apps/cycle-counter/pages/CountEntry.jsx';
import ReviewSession from './apps/cycle-counter/pages/ReviewSession.jsx';
import Export from './apps/cycle-counter/pages/Export.jsx';

// Shipping Tags
import ShippingTags from './apps/shipping-tags/ShippingTags.jsx';

// BOL Maker (current shipments)
import BOLMaker from './apps/bol/BOLMaker.jsx';

// Historical BOLs (audit reconstruction)
import HistoricalBOLs from './apps/historical-bols/HistoricalBOLs.jsx';

// Ops Dashboard
import Dashboard from './apps/dashboard/Dashboard.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Home */}
        <Route path="/" element={<Home />} />

        {/* Cycle Counter */}
        <Route path="/cycle-counter" element={<CCLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<CCDashboard />} />
          <Route path="import" element={<ImportData />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="sessions/:id/count" element={<CountEntry />} />
          <Route path="sessions/:id/review" element={<ReviewSession />} />
          <Route path="sessions/:id/export" element={<Export />} />
        </Route>

        {/* Shipping Tags */}
        <Route path="/shipping-tags" element={<ShippingTags />} />

        {/* BOL Maker (current) */}
        <Route path="/bol" element={<BOLMaker />} />

        {/* Historical BOLs (audit reconstruction) */}
        <Route path="/historical-bols" element={<HistoricalBOLs />} />

        {/* Ops Dashboard */}
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}