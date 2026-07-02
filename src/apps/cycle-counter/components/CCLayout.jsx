import React from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  ClipboardList,
  ChevronLeft,
} from 'lucide-react';

const navItems = [
  {
    label: 'Dashboard',
    icon: <LayoutDashboard size={22} />,
    route: '/cycle-counter/dashboard',
  },
  {
    label: 'Import',
    icon: <Upload size={22} />,
    route: '/cycle-counter/import',
  },
  {
    label: 'Sessions',
    icon: <ClipboardList size={22} />,
    route: '/cycle-counter/sessions',
  },
];

export default function CCLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div style={styles.container}>
      {/* Top Header */}
      <div style={styles.header}>
        <div style={styles.headerInner}>
          <button style={styles.backButton} onClick={() => navigate('/')}>
            <ChevronLeft size={20} color="#fff" />
            <span style={styles.backText}>Home</span>
          </button>
          <div style={styles.titleArea}>
            <span style={styles.headerIcon}>📦</span>
            <span style={styles.headerTitle}>Cycle Counter</span>
          </div>
          {/* Spacer to center title */}
          <div style={{ width: '70px' }} />
        </div>
      </div>

      {/* Page Content */}
      <div style={styles.content}>
        <Outlet />
      </div>

      {/* Bottom Tab Navigation (mobile first) */}
      <div style={styles.bottomNav}>
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.route);
          return (
            <button
              key={item.route}
              style={{
                ...styles.navItem,
                ...(isActive ? styles.navItemActive : {}),
              }}
              onClick={() => navigate(item.route)}
            >
              <span
                style={{
                  color: isActive ? '#c8102e' : '#6b7280',
                }}
              >
                {item.icon}
              </span>
              <span
                style={{
                  ...styles.navLabel,
                  color: isActive ? '#c8102e' : '#6b7280',
                  fontWeight: isActive ? '600' : '400',
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#f8f8f8',
    paddingBottom: '70px', // space for bottom nav
  },
  header: {
    backgroundColor: '#c8102e',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  headerInner: {
    maxWidth: '700px',
    margin: '0 auto',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    borderRadius: '8px',
    padding: '6px 10px',
    cursor: 'pointer',
    minHeight: '36px',
  },
  backText: {
    fontSize: '13px',
    color: '#ffffff',
    fontWeight: '500',
  },
  titleArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  headerIcon: {
    fontSize: '20px',
  },
  headerTitle: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#ffffff',
  },
  content: {
    flex: 1,
    maxWidth: '700px',
    width: '100%',
    margin: '0 auto',
    padding: '20px 16px',
  },
  bottomNav: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-around',
    padding: '8px 0',
    zIndex: 100,
    boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
  },
  navItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 20px',
    borderRadius: '8px',
    minHeight: '44px',
    justifyContent: 'center',
  },
  navItemActive: {
    backgroundColor: '#fff1f2',
  },
  navLabel: {
    fontSize: '11px',
  },
};
