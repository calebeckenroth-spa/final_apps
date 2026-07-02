import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient.js';
import {
  Plus,
  ChevronRight,
  ClipboardList,
  CheckCircle,
  X,
} from 'lucide-react';

export default function Sessions() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState('open');

  // New session form
  const [sessionName, setSessionName] = useState('');
  const [counterName, setCounterName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setLoading(true);
    const { data, error } = await supabase
      .schema('cycle_count')
      .from('sessions')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error) setSessions(data || []);
    setLoading(false);
  }

  async function createSession() {
    if (!sessionName.trim() || !counterName.trim()) {
      setFormError('Please fill in both fields.');
      return;
    }
    setSaving(true);
    setFormError('');
    const { data, error } = await supabase
      .schema('cycle_count')
      .from('sessions')
      .insert({
        session_name: sessionName.trim(),
        counted_by: counterName.trim(),
        status: 'open',
      })
      .select()
      .single();

    setSaving(false);
    if (error) {
      setFormError('Failed to create session: ' + error.message);
      return;
    }
    // Go straight to counting
    navigate(`/cycle-counter/sessions/${data.id}/count`);
  }

  function formatDate(dateString) {
    const d = new Date(dateString);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  const filtered = sessions.filter((s) =>
    filter === 'all' ? true : s.status === filter
  );

  return (
    <div>
      <h2 style={styles.pageTitle}>Count Sessions</h2>

      {/* New Session Button */}
      <button style={styles.newBtn} onClick={() => setShowCreate(true)}>
        <Plus size={20} />
        New Count Session
      </button>

      {/* Filter Tabs */}
      <div style={styles.filterRow}>
        {['open', 'completed', 'all'].map((f) => (
          <button
            key={f}
            style={{
              ...styles.filterTab,
              ...(filter === f ? styles.filterTabActive : {}),
            }}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Session List */}
      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading...</p>
      ) : filtered.length === 0 ? (
        <div style={styles.emptyState}>
          <ClipboardList size={32} color="#d1d5db" />
          <p style={styles.emptyText}>
            No {filter !== 'all' ? filter : ''} sessions
          </p>
        </div>
      ) : (
        <div style={styles.list}>
          {filtered.map((session) => (
            <button
              key={session.id}
              style={styles.sessionCard}
              onClick={() =>
                navigate(
                  session.status === 'open'
                    ? `/cycle-counter/sessions/${session.id}/count`
                    : `/cycle-counter/sessions/${session.id}/review`
                )
              }
            >
              <div style={{ flex: 1 }}>
                <div style={styles.cardTopRow}>
                  <span style={styles.sessionName}>{session.session_name}</span>
                  <span
                    style={{
                      ...styles.statusBadge,
                      ...(session.status === 'open'
                        ? styles.statusOpen
                        : styles.statusDone),
                    }}
                  >
                    {session.status === 'open' ? 'Open' : 'Completed'}
                  </span>
                </div>
                <div style={styles.sessionMeta}>
                  {session.counted_by} • {formatDate(session.created_at)}
                </div>
              </div>
              <ChevronRight size={20} color="#9ca3af" />
            </button>
          ))}
        </div>
      )}

      {/* Create Session Modal */}
      {showCreate && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>New Count Session</h3>
              <button
                style={styles.modalClose}
                onClick={() => {
                  setShowCreate(false);
                  setFormError('');
                }}
              >
                <X size={20} />
              </button>
            </div>

            {formError && <div style={styles.formError}>{formError}</div>}

            <label style={styles.label}>Session Name</label>
            <input
              style={styles.input}
              placeholder="e.g. Freezer Count 6-12"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
            />

            <label style={styles.label}>Counter Name</label>
            <input
              style={styles.input}
              placeholder="Who is counting?"
              value={counterName}
              onChange={(e) => setCounterName(e.target.value)}
            />

            <button
              style={styles.createBtn}
              onClick={createSession}
              disabled={saving}
            >
              {saving ? 'Creating...' : 'Create & Start Counting'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  pageTitle: { fontSize: '24px', fontWeight: '700', marginBottom: '16px' },
  newBtn: {
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
    marginBottom: '20px',
  },
  filterRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
  },
  filterTab: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '999px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#6b7280',
    cursor: 'pointer',
    minHeight: 'auto',
  },
  filterTabActive: {
    background: '#c8102e',
    borderColor: '#c8102e',
    color: '#fff',
  },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  sessionCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
  },
  cardTopRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  sessionName: { fontSize: '15px', fontWeight: '600' },
  statusBadge: {
    fontSize: '11px',
    fontWeight: '600',
    padding: '2px 10px',
    borderRadius: '999px',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  statusOpen: { background: '#dcfce7', color: '#15803d' },
  statusDone: { background: '#f3f4f6', color: '#6b7280' },
  sessionMeta: { fontSize: '12px', color: '#6b7280', marginTop: '4px' },
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
  emptyText: { color: '#9ca3af', fontSize: '14px' },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 1000,
  },
  modal: {
    background: '#fff',
    borderRadius: '16px',
    padding: '24px',
    maxWidth: '380px',
    width: '100%',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
  },
  modalTitle: { fontSize: '18px', fontWeight: '700' },
  modalClose: {
    background: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    padding: '6px',
    cursor: 'pointer',
    minHeight: 'auto',
  },
  formError: {
    background: '#fef2f2',
    color: '#991b1b',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '13px',
    marginBottom: '12px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '6px',
    marginTop: '12px',
  },
  input: {
    width: '100%',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '12px 14px',
    fontSize: '16px',
  },
  createBtn: {
    width: '100%',
    background: '#c8102e',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    padding: '16px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '20px',
  },
};
