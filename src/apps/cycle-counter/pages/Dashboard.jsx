import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient.js';
import {
  Package,
  Calendar,
  ClipboardList,
  Plus,
  ChevronRight,
  Upload,
} from 'lucide-react';

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [itemCount, setItemCount] = useState(0);
  const [lastImport, setLastImport] = useState(null);
  const [openSessions, setOpenSessions] = useState([]);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    try {
      // Item count
      const { count } = await supabase
        .from('items')
        .select('*', { count: 'exact', head: true });
      setItemCount(count || 0);

      // Last import date
      const { data: lastItem } = await supabase
        .from('items')
        .select('uploaded_at')
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setLastImport(lastItem?.uploaded_at || null);

      // Open sessions
      const { data: sessions } = await supabase
        .schema('cycle_count')
        .from('sessions')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false });
      setOpenSessions(sessions || []);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateString) {
    if (!dateString) return 'Never';
    const d = new Date(dateString);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  return (
    <div>
      <h2 style={styles.pageTitle}>Dashboard</h2>

      {loading ? (
        <p style={styles.loadingText}>Loading...</p>
      ) : (
        <>
          {/* Stat Cards */}
          <div style={styles.statGrid}>
            <div style={styles.statCard}>
              <div
                style={{
                  ...styles.statIcon,
                  background: '#fef2f2',
                  color: '#c8102e',
                }}
              >
                <Package size={22} />
              </div>
              <div>
                <div style={styles.statValue}>{itemCount.toLocaleString()}</div>
                <div style={styles.statLabel}>Items Loaded</div>
              </div>
            </div>

            <div style={styles.statCard}>
              <div
                style={{
                  ...styles.statIcon,
                  background: '#eff6ff',
                  color: '#2563eb',
                }}
              >
                <Calendar size={22} />
              </div>
              <div>
                <div style={styles.statValueSmall}>
                  {formatDate(lastImport)}
                </div>
                <div style={styles.statLabel}>Last Import</div>
              </div>
            </div>
          </div>

          {/* No data warning */}
          {itemCount === 0 && (
            <div style={styles.warningCard}>
              <Upload size={20} color="#b45309" />
              <div>
                <strong style={{ color: '#92400e' }}>
                  No inventory data loaded
                </strong>
                <p style={styles.warningText}>
                  Import your Business Central data to begin counting.
                </p>
                <button
                  style={styles.warningButton}
                  onClick={() => navigate('/cycle-counter/import')}
                >
                  Import Data
                </button>
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div style={styles.actionRow}>
            <button
              style={styles.primaryAction}
              onClick={() => navigate('/cycle-counter/sessions')}
            >
              <Plus size={20} />
              New Count Session
            </button>
          </div>

          {/* Open Sessions */}
          <div style={styles.sectionHeader}>
            <h3 style={styles.sectionTitle}>Active Sessions</h3>
            <button
              style={styles.viewAllBtn}
              onClick={() => navigate('/cycle-counter/sessions')}
            >
              View All
            </button>
          </div>

          {openSessions.length === 0 ? (
            <div style={styles.emptyState}>
              <ClipboardList size={32} color="#d1d5db" />
              <p style={styles.emptyText}>No active sessions</p>
            </div>
          ) : (
            <div style={styles.sessionList}>
              {openSessions.map((session) => (
                <button
                  key={session.id}
                  style={styles.sessionCard}
                  onClick={() =>
                    navigate(`/cycle-counter/sessions/${session.id}/count`)
                  }
                >
                  <div>
                    <div style={styles.sessionName}>{session.session_name}</div>
                    <div style={styles.sessionMeta}>
                      {session.counted_by} • {formatDate(session.created_at)}
                    </div>
                  </div>
                  <ChevronRight size={20} color="#9ca3af" />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  pageTitle: {
    fontSize: '24px',
    fontWeight: '700',
    marginBottom: '20px',
  },
  loadingText: {
    color: '#6b7280',
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '20px',
  },
  statCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  statIcon: {
    width: '44px',
    height: '44px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  statValue: {
    fontSize: '24px',
    fontWeight: '700',
    lineHeight: 1,
  },
  statValueSmall: {
    fontSize: '13px',
    fontWeight: '600',
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '4px',
  },
  warningCard: {
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    gap: '12px',
    marginBottom: '20px',
  },
  warningText: {
    fontSize: '13px',
    color: '#92400e',
    margin: '4px 0 12px',
  },
  warningButton: {
    background: '#b45309',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 16px',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '14px',
  },
  actionRow: {
    marginBottom: '24px',
  },
  primaryAction: {
    width: '100%',
    background: '#c8102e',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    padding: '16px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '700',
  },
  viewAllBtn: {
    background: 'none',
    border: 'none',
    color: '#c8102e',
    fontWeight: '600',
    fontSize: '14px',
    cursor: 'pointer',
  },
  emptyState: {
    background: '#fff',
    border: '1px dashed #e5e7eb',
    borderRadius: '12px',
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: '14px',
  },
  sessionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sessionCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
  },
  sessionName: {
    fontSize: '15px',
    fontWeight: '600',
  },
  sessionMeta: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '2px',
  },
};
