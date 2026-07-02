import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient.js';
import { ChevronLeft, Download, FileText } from 'lucide-react';

function getVariance(entry) {
  return Number(entry.counted_quantity) - Number(entry.bc_quantity);
}

function getStatus(entry) {
  const v = getVariance(entry);
  if (v === 0) return 'match';
  if (v < 0) return 'short';
  return 'over';
}

function toCSV(rows, columns) {
  const header = columns.map((c) => c.label).join(',');
  const lines = rows.map((row) =>
    columns
      .map((c) => {
        const val =
          row[c.key] !== null && row[c.key] !== undefined
            ? String(row[c.key])
            : '';
        // Wrap in quotes if contains comma, quote, or newline
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      })
      .join(',')
  );
  return [header, ...lines].join('\n');
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const COLUMNS = [
  { key: 'session_name', label: 'Session Name' },
  { key: 'session_date', label: 'Session Date' },
  { key: 'counted_by', label: 'Counted By' },
  { key: 'item_no', label: 'Item No' },
  { key: 'description', label: 'Description' },
  { key: 'lot_no', label: 'Lot No' },
  { key: 'expiration_date', label: 'Expiration Date' },
  { key: 'uom', label: 'UOM' },
  { key: 'bc_location', label: 'BC Location' },
  { key: 'bc_bin', label: 'BC Bin' },
  { key: 'physical_bin', label: 'Physical Bin Found' },
  { key: 'bc_quantity', label: 'BC Qty' },
  { key: 'counted_quantity', label: 'Counted Qty' },
  { key: 'variance', label: 'Variance' },
  { key: 'status', label: 'Status' },
  { key: 'notes', label: 'Notes' },
];

const UNCOUNTED_COLUMNS = [
  { key: 'item_no', label: 'Item No' },
  { key: 'description', label: 'Description' },
  { key: 'lot_no', label: 'Lot No' },
  { key: 'expiration_date', label: 'Expiration Date' },
  { key: 'uom', label: 'UOM' },
  { key: 'location_code', label: 'BC Location' },
  { key: 'bin_code', label: 'BC Bin' },
  { key: 'bc_quantity', label: 'BC Qty' },
];

export default function Export() {
  const navigate = useNavigate();
  const { id: sessionId } = useParams();

  const [session, setSession] = useState(null);
  const [entries, setEntries] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

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
      console.error('Export load error:', err);
    } finally {
      setLoading(false);
    }
  }

  // ── Build export rows (entries with variance) ──
  const exportRows = useMemo(() => {
    if (!session) return [];
    return entries.map((e) => ({
      session_name: session.session_name,
      session_date: new Date(session.created_at).toLocaleDateString('en-US'),
      counted_by: session.counted_by,
      item_no: e.item_no,
      description: e.description || '',
      lot_no: e.lot_no || '',
      expiration_date: e.expiration_date || '',
      uom: e.uom || '',
      bc_location: e.bc_location || '',
      bc_bin: e.bc_bin || '',
      physical_bin: e.physical_bin || '',
      bc_quantity: e.bc_quantity,
      counted_quantity: e.counted_quantity,
      variance: getVariance(e),
      status: getStatus(e).toUpperCase(),
      notes: e.notes || '',
    }));
  }, [entries, session]);

  // ── Variance only rows ──
  const varianceRows = useMemo(() => {
    return exportRows.filter((r) => r.variance !== 0);
  }, [exportRows]);

  // ── Uncounted items ──
  const uncounted = useMemo(() => {
    const countedKeys = new Set(
      entries.map((e) => `${e.item_no}|${e.lot_no || ''}`)
    );
    return items.filter(
      (it) => !countedKeys.has(`${it.item_no}|${it.lot_no || ''}`)
    );
  }, [entries, items]);

  function formatFilename(suffix) {
    const name = session?.session_name?.replace(/\s+/g, '_') || 'session';
    const date = new Date().toISOString().split('T').at(0);
    return `${name}_${suffix}_${date}.csv`;
  }

  function handleExportAll() {
    const csv = toCSV(exportRows, COLUMNS);
    downloadCSV(csv, formatFilename('full'));
  }

  function handleExportVariances() {
    const csv = toCSV(varianceRows, COLUMNS);
    downloadCSV(csv, formatFilename('variances'));
  }

  function handleExportUncounted() {
    const csv = toCSV(uncounted, UNCOUNTED_COLUMNS);
    downloadCSV(csv, formatFilename('uncounted'));
  }

  if (loading)
    return <p style={{ color: '#6b7280', padding: '20px' }}>Loading...</p>;

  if (!session)
    return (
      <div style={{ padding: '20px' }}>
        <p style={{ color: '#dc2626' }}>Session not found.</p>
      </div>
    );

  const sessionDate = new Date(session.created_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div>
      {/* Back */}
      <button
        style={styles.backLink}
        onClick={() => navigate(`/cycle-counter/sessions/${sessionId}/review`)}
      >
        <ChevronLeft size={16} /> Review
      </button>

      <h2 style={styles.pageTitle}>Export</h2>
      <p style={styles.subtitle}>
        {session.session_name} • {session.counted_by} • {sessionDate}
      </p>

      {/* Summary */}
      <div style={styles.summaryCard}>
        <div style={styles.summaryRow}>
          <span style={styles.summaryLabel}>Total Entries</span>
          <span style={styles.summaryValue}>{entries.length}</span>
        </div>
        <div style={styles.summaryRow}>
          <span style={styles.summaryLabel}>With Variances</span>
          <span style={{ ...styles.summaryValue, color: '#c8102e' }}>
            {varianceRows.length}
          </span>
        </div>
        <div style={styles.summaryRow}>
          <span style={styles.summaryLabel}>Uncounted Items</span>
          <span style={{ ...styles.summaryValue, color: '#b45309' }}>
            {uncounted.length}
          </span>
        </div>
      </div>

      {/* Export options */}
      <div style={styles.sectionTitle}>Download Options</div>

      {/* Full export */}
      <div style={styles.exportCard}>
        <div style={styles.exportCardLeft}>
          <div
            style={{
              ...styles.exportIcon,
              background: '#eff6ff',
              color: '#2563eb',
            }}
          >
            <FileText size={22} />
          </div>
          <div>
            <div style={styles.exportName}>Full Session Export</div>
            <div style={styles.exportDesc}>
              All {entries.length} counted entries with variances
            </div>
          </div>
        </div>
        <button style={styles.downloadBtn} onClick={handleExportAll}>
          <Download size={18} />
        </button>
      </div>

      {/* Variances only */}
      <div style={styles.exportCard}>
        <div style={styles.exportCardLeft}>
          <div
            style={{
              ...styles.exportIcon,
              background: '#fef2f2',
              color: '#dc2626',
            }}
          >
            <FileText size={22} />
          </div>
          <div>
            <div style={styles.exportName}>Variances Only</div>
            <div style={styles.exportDesc}>
              {varianceRows.length} items where counted ≠ BC quantity
            </div>
          </div>
        </div>
        <button style={styles.downloadBtn} onClick={handleExportVariances}>
          <Download size={18} />
        </button>
      </div>

      {/* Uncounted */}
      <div style={styles.exportCard}>
        <div style={styles.exportCardLeft}>
          <div
            style={{
              ...styles.exportIcon,
              background: '#fffbeb',
              color: '#b45309',
            }}
          >
            <FileText size={22} />
          </div>
          <div>
            <div style={styles.exportName}>Uncounted Items</div>
            <div style={styles.exportDesc}>
              {uncounted.length} BC items not counted in this session
            </div>
          </div>
        </div>
        <button style={styles.downloadBtn} onClick={handleExportUncounted}>
          <Download size={18} />
        </button>
      </div>

      {/* Column preview */}
      <div style={styles.sectionTitle}>Export Columns Included</div>
      <div style={styles.columnList}>
        {COLUMNS.map((c) => (
          <span key={c.key} style={styles.columnPill}>
            {c.label}
          </span>
        ))}
      </div>

      {/* Back to review */}
      <button
        style={styles.reviewBtn}
        onClick={() => navigate(`/cycle-counter/sessions/${sessionId}/review`)}
      >
        Back to Review
      </button>
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
  pageTitle: {
    fontSize: '24px',
    fontWeight: '700',
    marginBottom: '4px',
  },
  subtitle: {
    fontSize: '13px',
    color: '#6b7280',
    marginBottom: '20px',
  },
  summaryCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '24px',
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  summaryLabel: {
    fontSize: '14px',
    color: '#4b5563',
  },
  summaryValue: {
    fontSize: '18px',
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '12px',
  },
  exportCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px',
  },
  exportCardLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    flex: 1,
  },
  exportIcon: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  exportName: {
    fontSize: '15px',
    fontWeight: '600',
  },
  exportDesc: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '2px',
  },
  downloadBtn: {
    background: '#c8102e',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    width: '44px',
    height: '44px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    minHeight: 'auto',
  },
  columnList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginBottom: '24px',
  },
  columnPill: {
    background: '#f3f4f6',
    color: '#4b5563',
    fontSize: '11px',
    fontWeight: '500',
    padding: '4px 10px',
    borderRadius: '999px',
  },
  reviewBtn: {
    width: '100%',
    background: '#1a1a1a',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    padding: '16px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    marginBottom: '24px',
  },
};
