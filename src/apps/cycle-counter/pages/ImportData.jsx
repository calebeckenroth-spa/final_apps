import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { supabase } from '../../../lib/supabaseClient.js';
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle,
  X,
  Loader,
} from 'lucide-react';

const COLUMN_MAP = {
  item_no: ['item no.', 'item no', 'item_no', 'itemno'],
  description: ['item description', 'description', 'item_description'],
  bc_quantity: ['quantity', 'qty'],
  uom: [
    'base unit of measure',
    'unit of measure',
    'uom',
    'base_unit_of_measure',
  ],
  location_code: ['location code', 'location', 'location_code'],
  bin_code: ['bin code', 'bin', 'bin_code'],
  lot_no: ['lot no.', 'lot no', 'lot_no', 'lotno'],
  expiration_date: [
    'expiration date',
    'expiration',
    'exp date',
    'expiration_date',
  ],
};

function findColumn(headers, possibleNames) {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  for (const name of possibleNames) {
    const idx = lowerHeaders.indexOf(name);
    if (idx !== -1) return headers.at(idx);
  }
  return null;
}

function parseDate(value) {
  if (!value || value.trim() === '') return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const parts = d.toISOString().split('T');
  return parts.at(0);
}

function parseNum(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = parseFloat(String(value).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

export default function ImportData() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [parsedRows, setParsedRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [importedCount, setImportedCount] = useState(0);

  function handleFileSelect(e) {
    const file = e.target.files && e.target.files.item(0);

    if (!file) return;

    setError('');
    setDone(false);
    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      delimitersToGuess: [',', '\t', ';', '|'],
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const headers = results.meta.fields || [];

        // Build column mapping
        const mapping = {};
        for (const [field, names] of Object.entries(COLUMN_MAP)) {
          mapping[field] = findColumn(headers, names);
        }

        // Required columns check
        if (!mapping.item_no) {
          setError(
            'Could not find an "Item No." column in the CSV. Please check the file.'
          );
          return;
        }

        // Transform rows to our format
        const rows = results.data
          .map((row) => ({
            item_no: row[mapping.item_no]?.trim() || '',
            description: mapping.description
              ? row[mapping.description]?.trim() || null
              : null,
            bc_quantity: mapping.bc_quantity
              ? parseNum(row[mapping.bc_quantity])
              : 0,
            uom: mapping.uom ? row[mapping.uom]?.trim() || null : null,
            location_code: mapping.location_code
              ? row[mapping.location_code]?.trim() || null
              : null,
            bin_code: mapping.bin_code
              ? row[mapping.bin_code]?.trim() || null
              : null,
            lot_no: mapping.lot_no ? row[mapping.lot_no]?.trim() || null : null,
            expiration_date: mapping.expiration_date
              ? parseDate(row[mapping.expiration_date])
              : null,
          }))
          .filter((row) => row.item_no !== '');

        if (rows.length === 0) {
          setError('No valid rows found in the CSV.');
          return;
        }

        setError('');
        setParsedRows(rows);
      },
      error: (err) => {
        setError('Failed to parse CSV: ' + err.message);
      },
    });
  }

  async function handleImport() {
    setImporting(true);
    setError('');
    try {
      // 1. Clear existing items (replace all)
      const { error: deleteError } = await supabase
        .from('items')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
      if (deleteError) throw deleteError;

      // 2. Insert in batches of 500 (Supabase limit safety)
      const batchSize = 500;
      let inserted = 0;
      for (let i = 0; i < parsedRows.length; i += batchSize) {
        const batch = parsedRows.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from('items')
          .insert(batch);
        if (insertError) throw insertError;
        inserted += batch.length;
      }

      setImportedCount(inserted);
      setDone(true);
      setShowConfirm(false);
      setParsedRows([]);
      setFileName('');
    } catch (err) {
      console.error('Import error:', err);
      setError('Import failed: ' + err.message);
      setShowConfirm(false);
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setParsedRows([]);
    setFileName('');
    setDone(false);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div>
      <h2 style={styles.pageTitle}>Import BC Data</h2>
      <p style={styles.subtitle}>
        Upload your Business Central inventory export (CSV)
      </p>

      {/* Success message */}
      {done && (
        <div style={styles.successCard}>
          <CheckCircle size={20} color="#15803d" />
          <div>
            <strong style={{ color: '#15803d' }}>Import Complete!</strong>
            <p style={styles.successText}>
              {importedCount.toLocaleString()} items loaded successfully.
            </p>
            <button
              style={styles.successButton}
              onClick={() => navigate('/cycle-counter/dashboard')}
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={styles.errorCard}>
          <AlertTriangle size={20} color="#dc2626" />
          <span style={{ color: '#991b1b', fontSize: '14px' }}>{error}</span>
        </div>
      )}

      {/* Upload area */}
      {!done && parsedRows.length === 0 && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button
            style={styles.uploadZone}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={40} color="#c8102e" />
            <span style={styles.uploadTitle}>Tap to select CSV file</span>
            <span style={styles.uploadHint}>
              Item No, Description, Qty, UOM, Location, Bin, Lot, Expiration
            </span>
          </button>
        </div>
      )}

      {/* Preview */}
      {!done && parsedRows.length > 0 && (
        <div>
          <div style={styles.fileBar}>
            <div style={styles.fileInfo}>
              <FileText size={20} color="#6b7280" />
              <div>
                <div style={styles.fileName}>{fileName}</div>
                <div style={styles.fileCount}>
                  {parsedRows.length.toLocaleString()} rows ready
                </div>
              </div>
            </div>
            <button style={styles.clearBtn} onClick={reset}>
              <X size={18} />
            </button>
          </div>

          {/* Preview table */}
          <div style={styles.previewLabel}>Preview (first 5 rows)</div>
          <div style={styles.tableWrap} className="scroll-x">
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Item No</th>
                  <th style={styles.th}>Description</th>
                  <th style={styles.th}>Lot</th>
                  <th style={styles.th}>Loc</th>
                  <th style={styles.th}>Bin</th>
                  <th style={styles.th}>Qty</th>
                  <th style={styles.th}>UOM</th>
                  <th style={styles.th}>Exp</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{row.item_no}</td>
                    <td style={styles.td}>{row.description}</td>
                    <td style={styles.td}>{row.lot_no}</td>
                    <td style={styles.td}>{row.location_code}</td>
                    <td style={styles.td}>{row.bin_code}</td>
                    <td style={styles.td}>{row.bc_quantity}</td>
                    <td style={styles.td}>{row.uom}</td>
                    <td style={styles.td}>{row.expiration_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button style={styles.importBtn} onClick={() => setShowConfirm(true)}>
            Import {parsedRows.length.toLocaleString()} Items
          </button>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <AlertTriangle
              size={40}
              color="#b45309"
              style={{ margin: '0 auto' }}
            />
            <h3 style={styles.modalTitle}>Replace All Inventory Data?</h3>
            <p style={styles.modalText}>
              This will <strong>delete all current inventory data</strong> and
              replace it with {parsedRows.length.toLocaleString()} new items.
              <br />
              <br />
              Active count sessions will <strong>not</strong> be affected.
            </p>
            <div style={styles.modalButtons}>
              <button
                style={styles.modalCancel}
                onClick={() => setShowConfirm(false)}
                disabled={importing}
              >
                Cancel
              </button>
              <button
                style={styles.modalConfirm}
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? (
                  <>
                    <Loader size={18} className="spin" /> Importing...
                  </>
                ) : (
                  'Yes, Replace All'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  pageTitle: { fontSize: '24px', fontWeight: '700', marginBottom: '4px' },
  subtitle: { color: '#6b7280', fontSize: '14px', marginBottom: '20px' },
  uploadZone: {
    width: '100%',
    background: '#fff',
    border: '2px dashed #fca5a5',
    borderRadius: '16px',
    padding: '40px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
    minHeight: 'auto',
  },
  uploadTitle: { fontSize: '16px', fontWeight: '600', color: '#1a1a1a' },
  uploadHint: { fontSize: '12px', color: '#9ca3af', textAlign: 'center' },
  fileBar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
  },
  fileInfo: { display: 'flex', alignItems: 'center', gap: '12px' },
  fileName: { fontSize: '14px', fontWeight: '600' },
  fileCount: { fontSize: '12px', color: '#6b7280' },
  clearBtn: {
    background: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    padding: '8px',
    cursor: 'pointer',
    minHeight: 'auto',
  },
  previewLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: '8px',
  },
  tableWrap: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    marginBottom: '16px',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: '1px solid #e5e7eb',
    color: '#6b7280',
    fontWeight: '600',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #f3f4f6',
    whiteSpace: 'nowrap',
  },
  importBtn: {
    width: '100%',
    background: '#c8102e',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    padding: '16px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  successCard: {
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '12px',
    padding: '16px',
    display: 'flex',
    gap: '12px',
    marginBottom: '20px',
  },
  successText: { fontSize: '13px', color: '#15803d', margin: '4px 0 12px' },
  successButton: {
    background: '#15803d',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 16px',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '14px',
  },
  errorCard: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '12px',
    padding: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '16px',
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
  modalTitle: { fontSize: '18px', fontWeight: '700', margin: '12px 0 8px' },
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
  modalConfirm: {
    flex: 1,
    background: '#c8102e',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
  },
};
