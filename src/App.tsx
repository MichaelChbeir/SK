import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import MyQueue from './pages/editor/MyQueue';
import CommandCenter from './pages/manager/CommandCenter';
import Batches from './pages/Batches';
import QCQueue from './pages/qc/QCQueue';
import MediaBuyerQueue from './pages/media_buyer/MediaBuyerQueue';
import AdminPeople from './pages/admin/AdminPeople';
import AdminClients from './pages/admin/AdminClients';
import AdminProducts from './pages/admin/AdminProducts';
import AdminConfig from './pages/admin/AdminConfig';
import Profile from './pages/Profile';
import Leaderboard from './pages/Leaderboard';
import type { Role } from './lib/types';

function defaultRouteForRole(role: Role): string {
  switch (role) {
    case 'editor':
    case 'ai_creator':
    case 'scriptwriter':
    case 'lander_builder':
      return '/queue';
    case 'qc':
      return '/qc';
    case 'media_buyer':
      return '/testing';
    case 'manager':
    case 'admin':
      return '/command';
    default:
      return '/profile';
  }
}

function Router() {
  const { session, person, loading } = useAuth();
  const [route, setRoute] = useState(() => {
    const hash = window.location.hash.replace('#', '');
    return hash || '/';
  });

  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.replace('#', '');
      setRoute(hash || '/');
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  function navigate(to: string) {
    window.location.hash = to;
    setRoute(to);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!session || !person) {
    return <Login />;
  }

  // Redirect root to role's default route
  if (route === '/' || route === '') {
    const def = defaultRouteForRole(person.role);
    window.location.hash = def;
    return null;
  }

  function renderPage() {
    const role = person!.role;
    // Use roles array for access checks; fall back to primary role if array is empty
    const roles: Role[] = person!.roles?.length ? person!.roles : [role];
    const hasRole = (...check: Role[]) => check.some(r => roles.includes(r));

    // Role-based access guards
    const canManage = hasRole('manager', 'admin');
    const canAdmin = hasRole('admin');

    switch (route) {
      case '/queue':
        if (hasRole('editor', 'ai_creator', 'scriptwriter', 'lander_builder', 'manager', 'admin'))
          return <MyQueue />;
        break;
      case '/command':
        if (canManage) return <CommandCenter />;
        break;
      case '/batches':
        if (canManage) return <Batches />;
        break;
      case '/qc':
        if (hasRole('qc', 'manager', 'admin')) return <QCQueue />;
        break;
      case '/testing':
        if (hasRole('media_buyer', 'manager', 'admin')) return <MediaBuyerQueue />;
        break;
      case '/admin/people':
        if (canManage) return <AdminPeople />;
        break;
      case '/admin/clients':
        if (canManage) return <AdminClients />;
        break;
      case '/admin/products':
        if (canManage) return <AdminProducts />;
        break;
      case '/admin/config':
        if (canAdmin) return <AdminConfig />;
        break;
      case '/profile':
        return <Profile />;
      case '/leaderboard':
        return <Leaderboard />;
    }

    // Fallback to role default
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <p className="text-sm">Page not found or access denied.</p>
        <button
          onClick={() => navigate(defaultRouteForRole(person!.role))}
          className="mt-3 text-sm text-blue-400 hover:underline"
        >
          Go to my home
        </button>
      </div>
    );
  }

  return (
    <Layout route={route} navigate={navigate}>
      {renderPage()}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
