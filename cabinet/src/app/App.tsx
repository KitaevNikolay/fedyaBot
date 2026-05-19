import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { AuthPage } from '../pages/AuthPage';
import { DashboardPage } from '../pages/DashboardPage';
import { GenerationSettingsPage } from '../pages/GenerationSettingsPage';
import { UserHistoryPage } from '../pages/UserHistoryPage';
import { UsersPage } from '../pages/UsersPage';
import { RequireAdminRoute } from './routes/RequireAdminRoute';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<RequireAdminRoute />}>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="generation-settings" element={<GenerationSettingsPage />} />
            <Route path="history" element={<UserHistoryPage />} />
            <Route path="users" element={<UsersPage />} />
          </Route>
        </Route>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate replace to="/auth" />} />
      </Routes>
    </BrowserRouter>
  );
}
