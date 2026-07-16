import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  FileText,
  Truck,
  LayoutDashboard,
  History,
  Plus,
  ChevronRight,
} from 'lucide-react';

const apps = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'Operations overview & alerts',
    icon: <LayoutDashboard size={32} />,
    color: '#0f766e',
    route: '/dashboard',
    available: true,
  },
  {
    id: 'cycle-counter',
    name: 'Cycle Counter',
    description: 'Count inventory and track variances',
    icon: <ClipboardList size={32} />,
    color: '#c8102e',
    route: '/cycle-counter/dashboard',
    available: true,
  },
  {
    id: 'bol-manifest',
    name: 'BOL Maker',
    description: 'Create and save bills of lading',
    icon: <FileText size={32} />,
    color: '#c8102e',
    route: '/bol',
    available: true,
  },
  {
    id: 'historical-bols',
    name: 'Historical BOLs',
    description: 'Reconstruct past BOLs from BC records',
    icon: <History size={32} />,
    color: '#78350f',
    route: '/historical-bols',
    available: true,
  },
  {
    id: 'shipping',
    name: 'Shipping Tags',
    description: 'Create and print 4x6 shipping tags',
    icon: <Truck size={32} />,
    color: '#c8102e',
    route: '/shipping-tags',
    available: true,
  },
  {
    id: 'more',
    name: 'More Coming Soon',
    description: 'Additional tools in development',
    icon: <Plus size={32} />,
    color: '#6b7280',
    route: null,
    available: false,
  },
];

export default function Home() {
  const navigate = useNavigate();

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logoArea}>
            <span style={styles.logoIcon}>🌶️</span>
            <div>
              <h1 style={styles.companyName}>El Pinto Foods</h1>
              <p style={styles.platformName}>Operations Platform</p>
            </div>
          </div>
        </div>
      </div>

      <div style={styles.content}>
        <h2 style={styles.sectionTitle}>Select an App</h2>

        <div style={styles.grid}>
          {apps.map((app) => (
            <button
              key={app.id}
              style={{
                ...styles.appCard,
                ...(app.available ? styles.appCardActive : styles.appCardDisabled),
              }}
              onClick={() => app.available && navigate(app.route)}
              disabled={!app.available}
            >
              <div style={styles.cardHeader}>
                <div
                  style={{
                    ...styles.iconWrapper,
                    backgroundColor: app.available ? `${app.color}15` : '#f3f4f6',
                    color: app.available ? app.color : '#9ca3af',
                  }}
                >
                  {app.icon}
                </div>
                {app.available && <ChevronRight size={20} color="#9ca3af" />}
                {!app.available && <span style={styles.comingSoonBadge}>Soon</span>}
              </div>
              <div style={styles.cardBody}>
                <h3
                  style={{
                    ...styles.appName,
                    color: app.available ? '#1a1a1a' : '#9ca3af',
                  }}
                >
                  {app.name}
                </h3>
                <p style={styles.appDescription}>{app.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div style={styles.footer}>
        <p style={styles.footerText}>El Pinto Foods © {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}

const styles = {
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f8f8' },
  header: { backgroundColor: '#c8102e', padding: '0', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' },
  headerInner: { maxWidth: '600px', margin: '0 auto', padding: '20px 16px' },
  logoArea: { display: 'flex', alignItems: 'center', gap: '12px' },
  logoIcon: { fontSize: '40px', lineHeight: 1 },
  companyName: { fontSize: '24px', fontWeight: '700', color: '#ffffff', letterSpacing: '-0.5px' },
  platformName: { fontSize: '13px', color: 'rgba(255,255,255,0.75)', marginTop: '2px' },
  content: { flex: 1, maxWidth: '600px', width: '100%', margin: '0 auto', padding: '24px 16px' },
  sectionTitle: { fontSize: '14px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' },
  appCard: { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s ease', width: '100%', minHeight: '44px' },
  appCardActive: { boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  appCardDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  iconWrapper: { width: '56px', height: '56px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  comingSoonBadge: { fontSize: '11px', fontWeight: '600', color: '#9ca3af', backgroundColor: '#f3f4f6', padding: '2px 8px', borderRadius: '999px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  cardBody: { display: 'flex', flexDirection: 'column', gap: '4px' },
  appName: { fontSize: '16px', fontWeight: '600' },
  appDescription: { fontSize: '13px', color: '#6b7280', lineHeight: '1.4' },
  footer: { padding: '16px', textAlign: 'center' },
  footerText: { fontSize: '12px', color: '#9ca3af' },
};