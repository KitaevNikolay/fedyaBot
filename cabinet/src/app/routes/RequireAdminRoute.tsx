import { Spin } from 'antd';
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { adminApi } from '../../shared/api/adminApi';
import { clearAdminAccessToken, getAdminAccessToken } from '../../shared/auth/adminSession';

export function RequireAdminRoute() {
  const location = useLocation();
  const [status, setStatus] = useState<'loading' | 'allowed' | 'denied'>('loading');

  useEffect(() => {
    let isMounted = true;
    const accessToken = getAdminAccessToken();

    if (!accessToken) {
      setStatus('denied');
      return;
    }

    const verify = async () => {
      try {
        await adminApi.getCurrentAdmin();
        if (isMounted) {
          setStatus('allowed');
        }
      } catch {
        clearAdminAccessToken();
        if (isMounted) {
          setStatus('denied');
        }
      }
    };

    void verify();

    return () => {
      isMounted = false;
    };
  }, [location.pathname]);

  if (status === 'loading') {
    return (
      <div className="app-auth-loading">
        <Spin size="large" />
      </div>
    );
  }

  if (status === 'denied') {
    return <Navigate replace to="/auth" state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
