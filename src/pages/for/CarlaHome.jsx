import React from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, ChevronRight } from 'lucide-react';

// Personal landing page for Carla. Deliberately minimal: a warm greeting,
// her tools, and nothing else. No platform-wide navigation, no warehouse
// apps she doesn't use. Pattern we'll reuse for other coworkers:
// /for/<name> -> their own small home with just what they need.
export default function CarlaHome() {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.brand}>El Pinto Foods</div>
        </div>
      </div>

      <div style={styles.content}>
        <h1 style={styles.greeting}>Hi Carla 👋</h1>
        <p style={styles.sub}>Here's your tool. Pick the one you need.</p>

        <div style={styles.toolList}>
          <Link to="/for/carla/employee-hours" style={styles.toolCard}>
            <div style={styles.toolIcon}>
              <FileSpreadsheet size={32} color="#c8102e" />
            </div>
            <div style={styles.toolTextCol}>
              <div style={styles.toolTitle}>Employee Hours Report</div>
              <div style={styles.toolDesc}>
                Upload the weekly timesheet CSV and get back a clean Excel
                file, sorted by employee with totals.
              </div>
            </div>
            <ChevronRight size={22} color="#9ca3af" />
          </Link>
        </div>

        <p style={styles.footerNote}>
          If anything looks wrong or you get stuck, text Caleb.
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: { minHeight: '100vh', background: '#f8f8f8', display: 'flex', flexDirection: 'column' },
  header: { background: '#c8102e', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' },
  headerInner: { maxWidth: '720px', margin: '0 auto', padding: '14px 20px' },
  brand: { color: '#fff', fontWeight: 800, fontSize: '18px', letterSpacing: '0.5px' },
  content: { flex: 1, maxWidth: '720px', width: '100%', margin: '0 auto', padding: '32px 20px' },
  greeting: { fontSize: '30px', fontWeight: 800, marginBottom: '6px', color: '#1a1a1a' },
  sub: { fontSize: '16px', color: '#6b7280', marginBottom: '28px' },
  toolList: { display: 'flex', flexDirection: 'column', gap: '12px' },
  toolCard: { display: 'flex', alignItems: 'center', gap: '16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '18px 20px', textDecoration: 'none', color: 'inherit', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' },
  toolIcon: { width: '52px', height: '52px', borderRadius: '12px', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  toolTextCol: { flex: 1 },
  toolTitle: { fontSize: '18px', fontWeight: 700, color: '#1a1a1a' },
  toolDesc: { fontSize: '14px', color: '#6b7280', marginTop: '4px', lineHeight: 1.4 },
  footerNote: { fontSize: '13px', color: '#9ca3af', marginTop: '28px', textAlign: 'center' },
};