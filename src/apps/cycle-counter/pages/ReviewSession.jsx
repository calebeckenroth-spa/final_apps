import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient.js';
import {
  ChevronLeft,
  Download,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'short', label: '🔴 Short' },
  { key: 'over', label: '🟢 Over' },
  { key: 'match', label: '⚪ Match' },
  { key: 'uncounted', label: '🟡 Not Counted' },
];

function getVariance(entry) {
  return Number(entry.counted_quantity) - Number(entry.bc_quantity);
}

function getStatus(entry) {
  const v = getVariance(entry);
  if (v === 0) return 'match';
  if (v < 0) return 'short';
  return 'over';
}

export default function ReviewSession() {
  const navigate = useNavigate();
  const { id: sessionId } = useParams();

  const [session, setSession] = useState(null);
  const [entries, setEntries] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [completing, setCompleting] = useState(false);
  const [showComplete, setShowComplete] = useState(false);

  useEffect(() => {
    loadAll();
  }, [sessionId]);

  async function loadAll() {
    setLoading(true);
    try {
      const sessionReq = supabase
        .schema('cycle_count')
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
      const entriesReq = supabase
        .schema('cycle_count')
        .from('count_entries')
        .select('*')
        .eq('session_id', sessionId)
        .order('item_no');
      const itemsReq = supabase
        .from('items')
        .select('*')
        .order('item_no')
        .limit(5000);

      const results = await Promise.all([sessionReq, entriesReq, itemsReq]);
      setSession(results.at(0).data);
      setEntries(results.at(1).data || []);
      setItems(results.at(2).data || []);
    } catch (err) {
      console.error('Review load error:', err);
    } finally {
      setLoading(false);
    }
  }

  const uncounted = useMemo(() => {
    const countedKeys = new Set(
      entries.map((e) => `${e.item_no}|${e.lot_no || ''}`)
    );
    return items.filter(
      (it) => !countedKeys.has(`${it.item_no}|${it.lot_no || ''}`)
    );
  }, [entries, items]);

  const stats = useMemo(() => {
    let short = 0,
      over = 0,
      match = 0;
    for (const e of entries) {
      const s = getStatus(e);
      if (s === 'short') short++;
      else if (s === 'over') over++;
      else match++;
    }
    return { short, over, match, uncounted: uncounted.length };
  }, [entries, uncounted]);

  const displayEntries = useMemo(() => {
    if (filter === 'uncounted') return [];
    if (filter === 'all') return entries;
    return entries.filter((e) => getStatus(e) === filter);
  }, [entries, filter]);

  async function markComplete() {
    setCompleting(true);
    try {
      await supabase
        .schema('cycle_count')
        .from('sessions')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
      await loadAll();
    } catch (err) {
      console.error('Complete error:', err);
    } finally {
      setCompleting(false);
      setShowComplete(false);
    }
  }

  const statusStyles = {
    short: { color: '#dc2626', bg: '#fef2f2', label: 'SHORT' },
    over: { color: '#15803d', bg: '#f0fdf4', label: 'OVER' },
    match: { color: '#6b7280', bg: '#f3f4f6', label: 'MATCH' },
  };

  if (loading)
    return <p style={{ color: '#6b7280', padding: '20px' }}>Loading...</p>;

  if (!session)
    return (
      <div style={{ padding: '20px' }}>
        <p style={{ color: '#dc2626' }}>Session not found.</p>
        <button
          style={styles.backLink}
          onClick={() => navigate('/cycle-counter/sessions')}
        >
          <ChevronLeft size={16} /> Back to Sessions
        </button>
      </div>
    );

  return (
    <div>
      {/* Back link */}
      <button
        style={styles.backLink}
        onClick={() => navigate('/cycle-counter/sessions')}
      >
        <ChevronLeft size={16} /> Sessions
      </button>

      {/* Header */}
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.pageTitle}>{session.session_name}</h2>
          <p style={styles.subtitle}>
            {session.counted_by} • {entries.length}{' '}
            {entries.length === 1 ? 'entry' : 'entries'} •{' '}
            {session.status === 'open' ? '🟢 Open' : '✅ Completed'}
          </p>
        </div>
      </div>

      {/* Stat summary */}
      <div style={styles.statRow}>
        <div style={{ ...styles.statBox, background: '#fef2f2' }}>
          <div style={{ ...styles.statNum, color: '#dc2626' }}>
            {stats.short}
          </div>
          <div style={styles.statLabel}>Short</div>
        </div>
        <div style={{ ...styles.statBox, background: '#f0fdf4' }}>
          <div style={{ ...styles.statNum, color: '#15803d' }}>
            {stats.over}
          </div>
          <div style={styles.statLabel}>Over</div>
        </div>
        <div style={{ ...styles.statBox, background: '#f3f4f6' }}>
          <div style={{ ...styles.statNum, color: '#4b5563' }}>
            {stats.match}
          </div>
          <div style={styles.statLabel}>Match</div>
        </div>
        <div style={{ ...styles.statBox, background: '#fffbeb' }}>
          <div style={{ ...styles.statNum, color: '#b45309' }}>
            {stats.uncounted}
          </div>
          <div style={styles.statLabel}>Uncounted</div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={styles.actionRow}>
        <button
          style={styles.exportBtn}
          onClick={() =>
            navigate(`/cycle-counter/sessions/${sessionId}/export`)
          }
        >
          <Download size={18} />
          Export
        </button>
        {session.status === 'open' && (
          <button
            style={styles.completeBtn}
            onClick={() => setShowComplete(true)}
          >
            <CheckCircle size={18} />
            Mark Complete
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div style={styles.filterRow} className="scroll-x">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            style={{
              ...styles.filterTab,
              ...(filter === f.key ? styles.filterTabActive : {}),
            }}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Counted entries ── */}
      {filter !== 'uncounted' && (
        <div style={styles.list}>
          {displayEntries.length === 0 ? (
            <div style={styles.emptyState}>
              <p style={styles.noResults}>No entries in this filter</p>
            </div>
          ) : (
            displayEntries.map((e) => {
              const status = getStatus(e);
              const ss = statusStyles[status];
              const v = getVariance(e);
              const binMismatch =
                e.bc_bin && e.physical_bin && e.bc_bin !== e.physical_bin;

              return (
                <div key={e.id} style={styles.entryCard}>
                  {/* Top row */}
                  <div style={styles.entryTop}>
                    <div style={styles.entryTitle}>
                      {e.item_no} — {e.description}
                    </div>
                    <span
                      style={{
                        ...styles.statusBadge,
                        color: ss.color,
                        background: ss.bg,
                      }}
                    >
                      {ss.label}
                    </span>
                  </div>

                  {/* Lot + expiration */}
                  <div style={styles.entryMeta}>
                    Lot: {e.lot_no || '—'}
                    {e.expiration_date ? ` • Exp: ${e.expiration_date}` : ''}
                    {e.uom ? ` • ${e.uom}` : ''}
                  </div>

                  {/* Qty row */}
                  <div style={styles.qtyRow}>
                    <div style={styles.qtyCell}>
                      <span style={styles.qtyLabel}>BC Qty</span>
                      <span style={styles.qtyValue}>{e.bc_quantity}</span>
                    </div>
                    <div style={styles.qtyCell}>
                      <span style={styles.qtyLabel}>Counted</span>
                      <span style={styles.qtyValue}>{e.counted_quantity}</span>
                    </div>
                    <div style={styles.qtyCell}>
                      <span style={styles.qtyLabel}>Variance</span>
                      <span
                        style={{
                          ...styles.qtyValue,
                          color: ss.color,
                        }}
                      >
                        {v > 0 ? `+${v}` : v}
                      </span>
                    </div>
                  </div>

                  {/* Bin row */}
                  <div style={styles.locRow}>
                    <span
                      style={binMismatch ? styles.locMismatch : styles.locOk}
                    >
                      {binMismatch && <AlertTriangle size={12} />}
                      BC Bin: {e.bc_bin || '—'} → Physical Bin Found:{' '}
                      {e.physical_bin || '—'}
                    </span>
                  </div>

                  {/* Notes */}
                  {e.notes && <div style={styles.notes}>📝 {e.notes}</div>}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Uncounted items ── */}
      {filter === 'uncounted' && (
        <div style={styles.list}>
          {uncounted.length === 0 ? (
            <div style={styles.emptyState}>
              <p style={styles.noResults}>Everything was counted! 🎉</p>
            </div>
          ) : (
            uncounted.map((it) => (
              <div
                key={it.id}
                style={{ ...styles.entryCard, background: '#fffbeb' }}
              >
                <div style={styles.entryTitle}>
                  {it.item_no} — {it.description}
                </div>
                <div style={styles.entryMeta}>
                  Lot: {it.lot_no || '—'} • {it.location_code || '—'} /{' '}
                  {it.bin_code || '—'} • BC Qty: {it.bc_quantity} {it.uom}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Complete confirmation modal ── */}
      {showComplete && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <CheckCircle
              size={40}
              color="#15803d"
              style={{ margin: '0 auto' }}
            />
            <h3 style={styles.modalTitle}>Complete This Session?</h3>
            <p style={styles.modalText}>
              This marks the session as completed. You can still view and export
              it afterward.
            </p>
            <div style={styles.modalButtons}>
              <button
                style={styles.modalCancel}
                onClick={() => setShowComplete(false)}
                disabled={completing}
              >
                Cancel
              </button>
              <button
                style={styles.modalConfirmGreen}
                onClick={markComplete}
                disabled={completing}
              >
                {completing ? 'Saving...' : 'Complete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  backLink: {
    background: 'none',
    border: 'none',
    color: '#c8102e',
    fontWeight: '600',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '4px 0',
    marginBottom: '12px',
    minHeight: 'auto',
  },
  headerRow: { marginBottom: '16px' },
  pageTitle: { fontSize: '22px', fontWeight: '700' },
  subtitle: { fontSize: '13px', color: '#6b7280', marginTop: '4px' },
  statRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '8px',
    marginBottom: '16px',
  },
  statBox: {
    borderRadius: '12px',
    padding: '12px 8px',
    textAlign: 'center',
  },
  statNum: { fontSize: '22px', fontWeight: '700' },
  statLabel: { fontSize: '11px', color: '#6b7280', marginTop: '2px' },
  actionRow: {
    display: 'flex',
    gap: '10px',
    marginBottom: '16px',
  },
  exportBtn: {
    flex: 1,
    background: '#1a1a1a',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    padding: '14px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  completeBtn: {
    flex: 1,
    background: '#15803d',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    padding: '14px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  filterRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '14px',
    paddingBottom: '4px',
  },
  filterTab: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '999px',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: '500',
    color: '#6b7280',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    minHeight: 'auto',
    flexShrink: 0,
  },
  filterTabActive: {
    background: '#1a1a1a',
    borderColor: '#1a1a1a',
    color: '#fff',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  emptyState: {
    background: '#fff',
    border: '1px dashed #e5e7eb',
    borderRadius: '12px',
    padding: '32px',
    textAlign: 'center',
  },
  noResults: {
    color: '#9ca3af',
    fontSize: '14px',
  },
  entryCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '14px',
  },
  entryTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '4px',
  },
  entryTitle: {
    fontSize: '14px',
    fontWeight: '600',
    flex: 1,
  },
  statusBadge: {
    fontSize: '10px',
    fontWeight: '700',
    padding: '3px 8px',
    borderRadius: '999px',
    flexShrink: 0,
  },
  entryMeta: {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '10px',
  },
  qtyRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '8px',
    background: '#f9fafb',
    borderRadius: '8px',
    padding: '10px',
    marginBottom: '8px',
  },
  qtyCell: { textAlign: 'center' },
  qtyLabel: {
    display: 'block',
    fontSize: '10px',
    color: '#9ca3af',
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: '2px',
  },
  qtyValue: { fontSize: '16px', fontWeight: '700' },
  locRow: { marginTop: '4px' },
  locOk: {
    fontSize: '12px',
    color: '#6b7280',
  },
  locMismatch: {
    fontSize: '12px',
    color: '#b45309',
    fontWeight: '600',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
  },
  notes: {
    fontSize: '12px',
    color: '#4b5563',
    marginTop: '8px',
    fontStyle: 'italic',
  },
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
    textAlign: 'center',
  },
  modalTitle: {
    fontSize: '18px',
    fontWeight: '700',
    margin: '12px 0 8px',
  },
  modalText: {
    fontSize: '14px',
    color: '#4b5563',
    lineHeight: '1.5',
    marginBottom: '20px',
  },
  modalButtons: { display: 'flex', gap: '12px' },
  modalCancel: {
    flex: 1,
    background: '#f3f4f6',
    color: '#1a1a1a',
    border: 'none',
    borderRadius: '10px',
    padding: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  modalConfirmGreen: {
    flex: 1,
    background: '#15803d',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
};
