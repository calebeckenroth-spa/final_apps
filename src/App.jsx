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
import ReceivingTags from './apps/receiving-tags/ReceivingTags.jsx';

// BOL Maker (current shipments)
import BOLMaker from './apps/bol/BOLMaker.jsx';

// Historical BOLs (audit reconstruction)
import HistoricalBOLs from './apps/historical-bols/HistoricalBOLs.jsx';

// Ops Dashboard
import Dashboard from './apps/dashboard/Dashboard.jsx';

// Procurement suite
import Vendors from './apps/vendors/Vendors.jsx';
import ReorderWatch from './apps/reorder/ReorderWatch.jsx';
import POTracker from './apps/po-tracker/POTracker.jsx';
import Receiving from './apps/receiving/Receiving.jsx';
import POCalendar from './apps/po-calendar/POCalendar.jsx';
import PurchaseReminders from './apps/purchase-reminders/PurchaseReminders.jsx';

// Personal landing pages — a /for/<name> pattern for coworkers who only
// need one or two tools. Keeps them away from the big Home grid so they
// don't get overwhelmed.
import CarlaHome from './pages/for/CarlaHome.jsx';
import EmployeeHoursReport from './apps/employee-hours/EmployeeHoursReport.jsx';

// Production suite
import RecipeLearner from './apps/recipe-learner/RecipeLearner.jsx';
import ProductionSchedule from './apps/production-schedule/ProductionSchedule.jsx';
import IngredientForecast from './apps/ingredient-forecast/IngredientForecast.jsx';

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
        <Route path="/receiving-tags" element={<ReceivingTags />} />
        {/* Old shipping-tags URL redirects to the renamed receiving-tags app */}
        <Route
          path="/shipping-tags"
          element={<Navigate to="/receiving-tags" replace />}
        />

        {/* BOL Maker (current) */}
        <Route path="/bol" element={<BOLMaker />} />

        {/* Historical BOLs (audit reconstruction) */}
        <Route path="/historical-bols" element={<HistoricalBOLs />} />

        {/* Ops Dashboard */}
        <Route path="/dashboard" element={<Dashboard />} />

        {/* Procurement */}
        <Route path="/vendors" element={<Vendors />} />
        <Route path="/reorder" element={<ReorderWatch />} />
        <Route path="/po-tracker" element={<POTracker />} />
        <Route path="/receiving" element={<Receiving />} />
        <Route path="/po-calendar" element={<POCalendar />} />
        <Route path="/purchase-reminders" element={<PurchaseReminders />} />

        {/* Personal landing pages (one-off tools for specific coworkers) */}
        <Route path="/for/carla" element={<CarlaHome />} />
        <Route
          path="/for/carla/employee-hours"
          element={<EmployeeHoursReport />}
        />

        {/* Production */}
        <Route path="/recipe-learner" element={<RecipeLearner />} />
        <Route path="/production-schedule" element={<ProductionSchedule />} />
        <Route path="/ingredient-forecast" element={<IngredientForecast />} />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}