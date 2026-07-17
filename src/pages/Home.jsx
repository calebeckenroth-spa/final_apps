import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  FileText,
  Truck,
  LayoutDashboard,
  History,
  Users,
  AlertCircle,
  ShoppingCart,
  PackageCheck,
  Calendar,
  Plus,
  ChevronRight,
} from 'lucide-react';

const apps = [
  // Ops
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'Operations overview & alerts',
    icon: <LayoutDashboard size={32} />,
    color: '#0f766e',
    route: '/dashboard',
    available: true,
    group: 'Operations',
  },
  {
    id: 'cycle-counter',
    name: 'Cycle Counter',
    description: 'Count inventory and track variances',
    icon: <ClipboardList size={32} />,
    color: '#c8102e',
    route: '/cycle-counter/dashboard',
    available: true,
    group: 'Operations',
  },
  // Shipping
  {
    id: 'bol-manifest',
    name: 'BOL Maker',
    description: 'Create and save bills of lading',
    icon: <FileText size={32} />,
    color: '#c8102e',
    route: '/bol',
    available: true,
    group: 'Shipping',
  },
  {
    id: 'historical-bols',
    name: 'Historical BOLs',
    description: 'Reconstruct past BOLs from BC records',
    icon: <History size={32} />,
    color: '#78350f',
    route: '/historical-bols',
    available: true,
    group: 'Shipping',
  },
  {
    id: 'shipping',
    name: 'Shipping Tags',
    description: 'Create and print 4x6 shipping tags',
    icon: <Truck size={32} />,
    color: '#c8102e',
    route: '/shipping-tags',
    available: true,
    group: 'Shipping',
  },
  // Procurement
  {
    id: 'po-calendar',
    name: 'PO Calendar',
    description: 'Drag POs onto arrival dates',
    icon: <Calendar size={32} />,
    color: '#1d4ed8',
    route: '/po-calendar',
    available: true,
    group: 'Procurement',
  },
  {
    id: 'reorder',
    name: 'Reorder Watch',
    description: "What's low, what to buy",
    icon: <AlertCircle size={32} />,
    color: '#a16207',
    route: '/reorder',
    available: true,
    group: 'Procurement',
  },
  {
    id: 'po-tracker',
    name: 'PO Tracker',
    description: 'Purchase orders in and out',
    icon: <ShoppingCart size={32} />,
    color: '#1d4ed8',
    route: '/po-tracker',
    available: true,
    group: 'Procurement',
  },
  {
    id: 'receiving',
    name: 'Receiving',
    description: 'Log inbound shipments & lots',
    icon: <PackageCheck size={32} />,
    color: '#065f46',
    route: '/receiving',
    available: true,
    group: 'Procurement',
  },
  {
    id: 'vendors',
    name: 'Vendors',
    description: 'Directory of suppliers & contacts',
    icon: <Users size={32} />,
    color: '#1d4ed8',
    route: '/vendors',
    available: true,
    group: 'Procurement',
  },
  {
    id: 'more',
    name: 'More Coming Soon',
    description: 'Additional tools in development',
    icon: <Plus size={32} />,
    color: '#6b7280',
    route: null,
    available: false,
    group: 'Other',
  },
];

const GROUP_ORDER = ['Operations', 'Shipping', 'Procurement', 'Other'];

export default function Home() {
  const navigate = useNavigate();
  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    apps: apps.filter((a) => a.group === g),
  })).filter((g) => g.apps.length > 0);

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
        {grouped.map((section) => (
          <div key={section.group} style={styles.groupBlock}>
            <h2 style={styles.sectionTitle}>{section.group}</h2>
            <div style={styles.grid}>
              {section.apps.map((app) => (
                <button
                  key={app.id}
                  style={{
                    ...styles.appCard,
                    ...(app.available
                      ? styles.appCardActive
                      : styles.appCardDisabled),
                  }}
                  onClick={() => app.available && navigate(app.route)}
                  disabled={!app.available}
                >
                  <div style={styles.cardHeader}>
                    <div
                      style={{
                        ...styles.iconWrapper,
                        backgroundColor: app.available
                          ? `${app.color}15`
                          : '#f3f4f6',
                        color: app.available ? app.color : '#9ca3af',
                      }}
                    >
                      {app.icon}
                    </div>
                    {app.available && <ChevronRight size={20} color="#9ca3af" />}
                    {!app.available && (
                      <span style={styles.comingSoonBadge}>Soon</span>
                    )}
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
        ))}
      </div>

      <div style={styles.footer}>
        <p style={styles.footerText}>
          El Pinto Foods © {new Date().getFullYear()}
        </p>
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
  content: { flex: 1, maxWidth: '600px', width: '100%', margin: '0 auto', padding: '20px 16px' },
  groupBlock: { marginBottom: '24px' },
  sectionTitle: { fontSize: '13px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' },
  appCard: { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s ease', width: '100%', minHeight: '44px' },
  appCardActive: { boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  appCardDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' },
  iconWrapper: { width: '52px', height: '52px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  comingSoonBadge: { fontSize: '11px', fontWeight: '600', color: '#9ca3af', backgroundColor: '#f3f4f6', padding: '2px 8px', borderRadius: '999px', textTransform: 'uppercase', letterSpacing: '0.05em' },
  cardBody: { display: 'flex', flexDirection: 'column', gap: '2px' },
  appName: { fontSize: '15px', fontWeight: '600' },
  appDescription: { fontSize: '12px', color: '#6b7280', lineHeight: '1.4' },
  footer: { padding: '16px', textAlign: 'center' },
  footerText: { fontSize: '12px', color: '#9ca3af' },
};