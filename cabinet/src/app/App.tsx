import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { GenerationSettingsPage } from '../pages/GenerationSettingsPage';
import { UserHistoryPage } from '../pages/UserHistoryPage';
import { UsersPage } from '../pages/UsersPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="generation-settings" element={<GenerationSettingsPage />} />
          <Route path="history" element={<UserHistoryPage />} />
          <Route path="users" element={<UsersPage />} />
        </Route>
        <Route path="/auth" element={<Navigate replace to="/" />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
