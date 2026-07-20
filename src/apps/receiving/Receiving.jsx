import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';
import {
  ChevronLeft,
  Search,
  Plus,
  Trash2,
  Save,
  X,
  PackageCheck,
  Calendar,
  Download,
} from 'lucide-react';
import { generatePdfFromNode } from '../../lib/pdfHelper.js';

const DISCREPANCIES = [
  { value: '', label: 'None' },
  { value: 'short', label: 'Short' },
  { value: 'over', label: 'Over' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'wrong_item', label: 'Wrong item' },
];

const blankLine = () => ({
  _key: Math.random().toString(36).slice(2),
  po_line_id: '',
  item_no: '',
  description: '',
  quantity: '',
  uom: 'CASE',
  lot_no: '',
  expiration_date: '',
  discrepancy: '',
  notes: '',
});

const blankReceipt = () => ({
  receipt_number: '',
  po_id: '',
  vendor_id: '',
  vendor_name: '',
  received_date: new Date().toISOString().slice(0, 10),
  received_by: '',
  carrier: '',
  trailer_number: '',
  seal_number: '',
  temp_at_arrival: '',
  notes: '',
});

export default function Receiving() {
  const navigate = useNavigate();
  const [view, setView] = useState('list');
  const [receipts, setReceipts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [header, setHeader] = useState(blankReceipt());
  const [lines, setLines] = useState([blankLine()]);
  const [poLinesForSelectedPo, setPoLinesForSelectedPo] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [recRes, vendRes, posRes] = await Promise.all([
      supabase
        .schema('procurement')
        .from('receipts')
        .select('*')
        .order('received_date', { ascending: false })
        .limit(500),
      supabase
        .schema('procurement')
        .from('vendors')
        .select('id, name')
        .eq('active', true)
        .order('name'),
      supabase
        .schema('procurement')
        .from('pos')
        .select('id, po_number, vendor_id, vendor_name, status')
        .in('status', ['open', 'partially_received'])
        .order('order_date', { ascending: false })
        .limit(500),
    ]);
    setReceipts(recRes.data || []);
    setVendors(vendRes.data || []);
    setPos(posRes.data || []);
    setLoading(false);
  }

  const vendorNameById = useMemo(() => {
    const m = new Map();
    for (const v of vendors) m.set(v.id, v.name);
    return m;
  }, [vendors]);

  const poByIdMap = useMemo(() => {
    const m = new Map();
    for (const p of pos) m.set(p.id, p);
    return m;
  }, [pos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return receipts.filter((r) => {
      if (!q) return true;
      return (
        (r.receipt_number || '').toLowerCase().includes(q) ||
        (r.vendor_name || '').toLowerCase().includes(q) ||
        (r.carrier || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q)
      );
    });
  }, [receipts, search]);

  function setH(field, value) {
    setHeader((h) => ({ ...h, [field]: value }));
  }
  function setLine(key, field, value) {
    setLines((ls) => ls.map((l) => (l._key === key ? { ...l, [field]: value } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, blankLine()]);
  }
  function removeLine(key) {
    setLines((ls) => ls.filter((l) => l._key !== key));
  }

  async function selectPo(poId) {
    setH('po_id', poId);
    if (!poId) {
      setPoLinesForSelectedPo([]);
      return;
    }
    const p = poByIdMap.get(poId);
    if (p) {
      setH('vendor_id', p.vendor_id || '');
      setH('vendor_name', p.vendor_name || vendorNameById.get(p.vendor_id) || '');
    }
    const { data } = await supabase
      .schema('procurement')
      .from('po_lines')
      .select('*')
      .eq('po_id', poId)
      .order('line_no');
    setPoLinesForSelectedPo(data || []);
    // Auto-populate receipt lines from PO lines (user can adjust actual qty received)
    if (data && data.length > 0) {
      setLines(
        data.map((l) => ({
          _key: Math.random().toString(36).slice(2),
          po_line_id: l.id,
          item_no: l.item_no || '',
          description: l.description || '',
          quantity: '',  // user types actual received qty
          uom: l.uom || 'CASE',
          lot_no: '',
          expiration_date: '',
          discrepancy: '',
          notes: '',
        }))
      );
    }
  }

  function startNew() {
    setEditingId(null);
    const year = new Date().getFullYear();
    const seq = String(receipts.length + 1).padStart(4, '0');
    setHeader({ ...blankReceipt(), receipt_number: `EPREC-${year}-${seq}` });
    setLines([blankLine()]);
    setPoLinesForSelectedPo([]);
    setMessage('');
    setConfirmDelete(false);
    setView('edit');
  }

  async function openReceipt(r) {
    setEditingId(r.id);
    setHeader({
      receipt_number: r.receipt_number || '',
      po_id: r.po_id || '',
      vendor_id: r.vendor_id || '',
      vendor_name: r.vendor_name || '',
      received_date: r.received_date || '',
      received_by: r.received_by || '',
      carrier: r.carrier || '',
      trailer_number: r.trailer_number || '',
      seal_number: r.seal_number || '',
      temp_at_arrival: r.temp_at_arrival || '',
      notes: r.notes || '',
    });
    const { data: lineRows } = await supabase
      .schema('procurement')
      .from('receipt_lines')
      .select('*')
      .eq('receipt_id', r.id);
    setLines(
      (lineRows || []).map((l) => ({
        _key: l.id,
        id: l.id,
        po_line_id: l.po_line_id || '',
        item_no: l.item_no || '',
        description: l.description || '',
        quantity: l.quantity ?? '',
        uom: l.uom || 'CASE',
        lot_no: l.lot_no || '',
        expiration_date: l.expiration_date || '',
        discrepancy: l.discrepancy || '',
        notes: l.notes || '',
      }))
    );
    setMessage('');
    setConfirmDelete(false);
    setView('edit');
  }

  async function saveReceipt() {
    if (!header.receipt_number.trim()) {
      setMessage('Receipt number is required');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const row = {
        receipt_number: header.receipt_number.trim(),
        po_id: header.po_id || null,
        vendor_id: header.vendor_id || null,
        vendor_name:
          header.vendor_name || vendorNameById.get(header.vendor_id) || null,
        received_date: header.received_date || null,
        received_by: header.received_by || null,
        carrier: header.carrier || null,
        trailer_number: header.trailer_number || null,
        seal_number: header.seal_number || null,
        temp_at_arrival: header.temp_at_arrival || null,
        notes: header.notes || null,
      };
      let receiptId;
      if (editingId) {
        const { error } = await supabase
          .schema('procurement')
          .from('receipts')
          .update(row)
          .eq('id', editingId);
        if (error) throw error;
        receiptId = editingId;
      } else {
        const { data, error } = await supabase
          .schema('procurement')
          .from('receipts')
          .insert(row)
          .select()
          .single();
        if (error) throw error;
        receiptId = data.id;
        setEditingId(receiptId);
      }

      // Replace lines
      await supabase
        .schema('procurement')
        .from('receipt_lines')
        .delete()
        .eq('receipt_id', receiptId);

      const lineRows = lines
        .filter((l) => (l.item_no || '').trim() || (l.description || '').trim())
        .map((l) => ({
          receipt_id: receiptId,
          po_line_id: l.po_line_id || null,
          item_no: l.item_no || null,
          description: l.description || null,
          quantity: l.quantity === '' ? null : Number(l.quantity),
          uom: l.uom || null,
          lot_no: l.lot_no || null,
          expiration_date: l.expiration_date || null,
          discrepancy: l.discrepancy || null,
          notes: l.notes || null,
        }));
      if (lineRows.length > 0) {
        const { error: le } = await supabase
          .schema('procurement')
          .from('receipt_lines')
          .insert(lineRows);
        if (le) throw le;
      }

      // Roll up received_qty on PO lines that were referenced
      if (header.po_id) {
        await rollUpReceivedQty(header.po_id);
      }

      setMessage('Saved \u2713');
      load();
    } catch (e) {
      setMessage('Error saving: ' + (e.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }

  // Sum receipt_lines.quantity per po_line_id -> update po_lines.received_qty.
  // Then update the PO status based on whether all lines are fully received.
  async function rollUpReceivedQty(poId) {
    try {
      // Get PO lines
      const { data: poLines } = await supabase
        .schema('procurement')
        .from('po_lines')
        .select('*')
        .eq('po_id', poId);
      if (!poLines || poLines.length === 0) return;

      // Get all receipt lines pointing at those po_line ids
      const poLineIds = poLines.map((l) => l.id);
      const { data: allRcvLines } = await supabase
        .schema('procurement')
        .from('receipt_lines')
        .select('po_line_id, quantity')
        .in('po_line_id', poLineIds);

      const sumByLine = new Map();
      for (const rl of allRcvLines || []) {
        if (!rl.po_line_id) continue;
        sumByLine.set(
          rl.po_line_id,
          (sumByLine.get(rl.po_line_id) || 0) + (Number(rl.quantity) || 0)
        );
      }

      // Update each po_line
      let allComplete = true;
      let anyReceived = false;
      for (const pl of poLines) {
        const received = sumByLine.get(pl.id) || 0;
        if (received > 0) anyReceived = true;
        if (received < (Number(pl.quantity) || 0)) allComplete = false;
        await supabase
          .schema('procurement')
          .from('po_lines')
          .update({ received_qty: received })
          .eq('id', pl.id);
      }

      // Update PO status
      const newStatus = allComplete
        ? 'received'
        : anyReceived
          ? 'partially_received'
          : 'open';
      await supabase
        .schema('procurement')
        .from('pos')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', poId);
    } catch (e) {
      // Non-fatal: receipt is already saved.
      console.warn('Roll-up failed:', e);
    }
  }

  async function downloadReceipt() {
    if (!header.receipt_number) {
      setMessage('Save the receipt first before downloading');
      return;
    }
    try {
      await generatePdfFromNode({
        nodeId: 'receipt-print',
        filename: `${header.receipt_number}.pdf`,
      });
    } catch (e) {
      setMessage('Error making PDF: ' + (e.message || 'unknown'));
    }
  }

  async function deleteReceipt() {
    if (!editingId) return;
    setSaving(true);
    try {
      const poId = header.po_id;
      const { error } = await supabase
        .schema('procurement')
        .from('receipts')
        .delete()
        .eq('id', editingId);
      if (error) throw error;
      if (poId) await rollUpReceivedQty(poId);
      setEditingId(null);
      setView('list');
      load();
    } catch (e) {
      setMessage('Error deleting: ' + (e.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerInner}>
          <button
            style={styles.backButton}
            onClick={() => (view === 'edit' ? setView('list') : navigate('/'))}
          >
            <ChevronLeft size={20} color="#fff" />
            <span style={styles.backText}>
              {view === 'edit' ? 'Receiving' : 'Home'}
            </span>
          </button>
          <div style={styles.titleArea}>
            <PackageCheck size={18} color="#fff" />
            <span style={styles.headerTitle}>
              {view === 'edit'
                ? editingId
                  ? 'Edit receipt'
                  : 'New receipt'
                : 'Receiving'}
            </span>
          </div>
          <div style={{ width: '70px' }} />
        </div>
      </div>

      <div style={styles.content}>
        {view === 'list' ? (
          <ListView
            receipts={filtered}
            total={receipts.length}
            loading={loading}
            search={search}
            setSearch={setSearch}
            onNew={startNew}
            onOpen={openReceipt}
            vendorNameById={vendorNameById}
          />
        ) : (
          <EditView
            header={header}
            setH={setH}
            lines={lines}
            setLine={setLine}
            addLine={addLine}
            removeLine={removeLine}
            vendors={vendors}
            pos={pos}
            selectPo={selectPo}
            saving={saving}
            message={message}
            editingId={editingId}
            confirmDelete={confirmDelete}
            onSave={saveReceipt}
            onDownload={downloadReceipt}
            onRequestDelete={() => setConfirmDelete(true)}
            onCancelDelete={() => setConfirmDelete(false)}
            onConfirmDelete={deleteReceipt}
          />
        )}
      </div>

      {view === 'edit' && editingId ? (
        <div
          id="receipt-print"
          style={{ position: 'absolute', left: '-10000px', top: 0 }}
        >
          <ReceiptDocument header={header} lines={lines} />
        </div>
      ) : null}
    </div>
  );
}

// Printable Receipt / Proof of Delivery document
function ReceiptDocument({ header, lines }) {
  const printLines = lines.filter(
    (l) => (l.item_no || '').trim() || (l.description || '').trim()
  );
  const totalQty = printLines.reduce(
    (s, l) => s + (Number(l.quantity) || 0),
    0
  );
  const anyDiscrepancy = printLines.some((l) => l.discrepancy);
  return (
    <div style={docStyles.page}>
      <div style={docStyles.headerRow}>
        <div>
          <div style={docStyles.brand}>El Pinto Foods LLC</div>
          <div style={docStyles.brandAddr}>
            10500 4th St NW<br />Albuquerque, NM 87114
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={docStyles.docTitle}>RECEIVING RECORD</div>
          <div style={docStyles.docNumber}>{header.receipt_number}</div>
        </div>
      </div>

      <table style={docStyles.infoTable}>
        <tbody>
          <tr>
            <td style={docStyles.infoCellTall}>
              <span style={docStyles.infoLabel}>Vendor:</span>
              <div style={docStyles.infoStrong}>
                {header.vendor_name || ''}
              </div>
            </td>
            <td style={docStyles.infoCellTall}>
              <span style={docStyles.infoLabel}>Received By:</span>
              <div style={docStyles.infoStrong}>
                {header.received_by || ''}
              </div>
              <div style={docStyles.infoAddr}>
                Date: {header.received_date}
              </div>
            </td>
          </tr>
          <RowInfoPair
            shaded
            l={['Carrier:', header.carrier]}
            r={['Trailer #:', header.trailer_number]}
          />
          <RowInfoPair
            l={['Seal #:', header.seal_number]}
            r={['Temp at arrival:', header.temp_at_arrival]}
          />
        </tbody>
      </table>

      <div style={docStyles.heading}>What Arrived</div>
      <table style={docStyles.linesTable}>
        <thead>
          <tr>
            <th style={docStyles.th}>Item #</th>
            <th style={docStyles.th}>Description</th>
            <th style={docStyles.thR}>Qty</th>
            <th style={docStyles.th}>UoM</th>
            <th style={docStyles.th}>Lot #</th>
            <th style={docStyles.th}>Exp Date</th>
            <th style={docStyles.th}>Discrepancy</th>
          </tr>
        </thead>
        <tbody>
          {printLines.map((l, i) => (
            <tr key={i}>
              <td style={docStyles.td}>{l.item_no}</td>
              <td style={docStyles.td}>{l.description}</td>
              <td style={docStyles.tdR}>{l.quantity}</td>
              <td style={docStyles.td}>{l.uom}</td>
              <td style={docStyles.td}>{l.lot_no}</td>
              <td style={docStyles.td}>{l.expiration_date}</td>
              <td style={docStyles.td}>
                {l.discrepancy ? (
                  <span style={docStyles.flagBad}>
                    {l.discrepancy}
                    {l.notes ? ' — ' + l.notes : ''}
                  </span>
                ) : (
                  ''
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={docStyles.totalsRow}>
        <div style={docStyles.totalLabel}>TOTAL UNITS:</div>
        <div style={docStyles.totalValue}>{totalQty}</div>
      </div>

      {anyDiscrepancy ? (
        <div style={docStyles.discrepancyBlock}>
          <strong>Discrepancies noted above.</strong> Please review before
          final acceptance.
        </div>
      ) : null}

      {header.notes ? (
        <div style={docStyles.notes}>
          <strong>Notes:</strong> {header.notes}
        </div>
      ) : null}

      <div style={docStyles.signRow}>
        <div style={docStyles.signBox}>
          <div style={docStyles.signLine}></div>
          <div style={docStyles.signLabel}>Received by (signature)</div>
        </div>
        <div style={docStyles.signBox}>
          <div style={docStyles.signLine}></div>
          <div style={docStyles.signLabel}>Driver / delivering agent</div>
        </div>
      </div>

      <div style={docStyles.footer}>
        Generated {new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}
      </div>
    </div>
  );
}

function RowInfoPair({ l, r, shaded }) {
  const cell = shaded
    ? { ...docStyles.infoCell, background: '#e8e8e8' }
    : docStyles.infoCell;
  return (
    <tr>
      <td style={cell}>
        <span style={docStyles.infoLabel}>{l[0]}</span>{' '}
        <span>{l[1] == null ? '' : String(l[1])}</span>
      </td>
      <td style={cell}>
        <span style={docStyles.infoLabel}>{r[0]}</span>{' '}
        <span>{r[1] == null ? '' : String(r[1])}</span>
      </td>
    </tr>
  );
}

const docStyles = {
  page: { width: '7.5in', color: '#000', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '11px', padding: '10px' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', borderBottom: '2px solid #c8102e', paddingBottom: '10px' },
  brand: { fontSize: '18px', fontWeight: 700, color: '#c8102e' },
  brandAddr: { fontSize: '11px', color: '#374151', marginTop: '4px' },
  docTitle: { fontSize: '20px', fontWeight: 700, color: '#111' },
  docNumber: { fontSize: '14px', fontWeight: 600, color: '#c8102e', marginTop: '2px' },
  infoTable: { width: '100%', borderCollapse: 'collapse', border: '1px solid #999', marginBottom: '12px', tableLayout: 'fixed' },
  infoCellTall: { border: '1px solid #ccc', padding: '6px 8px', verticalAlign: 'top', width: '50%' },
  infoCell: { border: '1px solid #ccc', padding: '4px 8px', verticalAlign: 'top', width: '50%', fontSize: '11px' },
  infoLabel: { fontWeight: 700 },
  infoStrong: { fontWeight: 700, fontSize: '12px', marginTop: '2px' },
  infoAddr: { fontSize: '11px', whiteSpace: 'pre-wrap' },
  heading: { fontSize: '15px', fontWeight: 700, margin: '14px 0 6px' },
  linesTable: { width: '100%', borderCollapse: 'collapse', marginBottom: '10px' },
  th: { border: '1px solid #999', padding: '5px 6px', textAlign: 'left', background: '#f0f0f0', fontSize: '10px', fontFamily: 'Arial, sans-serif' },
  thR: { border: '1px solid #999', padding: '5px 6px', textAlign: 'right', background: '#f0f0f0', fontSize: '10px', fontFamily: 'Arial, sans-serif' },
  td: { border: '1px solid #ccc', padding: '4px 6px', fontSize: '10px', fontFamily: 'Arial, sans-serif' },
  tdR: { border: '1px solid #ccc', padding: '4px 6px', fontSize: '10px', textAlign: 'right', fontFamily: 'Arial, sans-serif' },
  totalsRow: { display: 'flex', justifyContent: 'flex-end', gap: '12px', alignItems: 'center', padding: '8px 12px', background: '#f9fafb', borderRadius: '4px', marginBottom: '12px' },
  totalLabel: { fontSize: '13px', fontWeight: 700 },
  totalValue: { fontSize: '16px', fontWeight: 800, color: '#c8102e' },
  flagBad: { color: '#c8102e', fontWeight: 700 },
  discrepancyBlock: { border: '2px solid #c8102e', background: '#fff1f2', padding: '8px', fontSize: '11px', marginBottom: '10px', fontFamily: 'Arial, sans-serif' },
  notes: { border: '1px solid #999', padding: '8px', fontSize: '11px', marginBottom: '10px', fontFamily: 'Arial, sans-serif' },
  signRow: { display: 'flex', gap: '24px', marginTop: '30px' },
  signBox: { flex: 1 },
  signLine: { borderBottom: '1px solid #000', height: '30px' },
  signLabel: { fontSize: '10px', color: '#374151', marginTop: '4px', fontFamily: 'Arial, sans-serif' },
  footer: { fontSize: '9px', color: '#6b7280', textAlign: 'right', marginTop: '10px', fontFamily: 'Arial, sans-serif' },
};

function ListView({
  receipts,
  total,
  loading,
  search,
  setSearch,
  onNew,
  onOpen,
  vendorNameById,
}) {
  return (
    <>
      <div style={styles.topRow}>
        <h2 style={styles.pageTitle}>Receipts ({total})</h2>
        <button style={styles.primaryBtn} onClick={onNew}>
          <Plus size={18} />
          New receipt
        </button>
      </div>
      <div style={styles.searchWrap}>
        <Search size={18} color="#9ca3af" />
        <input
          style={styles.searchInput}
          placeholder="Search receipt #, vendor, carrier..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading...</p>
      ) : receipts.length === 0 ? (
        <div style={styles.empty}>
          <PackageCheck size={32} color="#d1d5db" />
          <p style={{ color: '#9ca3af', marginTop: '8px' }}>
            No receipts logged yet. Tap "New receipt" when a truck arrives.
          </p>
        </div>
      ) : (
        <div style={styles.list}>
          {receipts.map((r) => (
            <button key={r.id} style={styles.card} onClick={() => onOpen(r)}>
              <div style={styles.cardTop}>
                <span style={styles.recNumber}>{r.receipt_number}</span>
                <span style={styles.recDate}>
                  <Calendar size={11} /> {r.received_date}
                </span>
              </div>
              <div style={styles.recVendor}>
                {r.vendor_name || vendorNameById.get(r.vendor_id) || '(no vendor)'}
              </div>
              <div style={styles.recMeta}>
                {r.carrier ? <span>Carrier: {r.carrier}</span> : null}
                {r.trailer_number ? <span>Trailer #{r.trailer_number}</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function EditView({
  header,
  setH,
  lines,
  setLine,
  addLine,
  removeLine,
  vendors,
  pos,
  selectPo,
  saving,
  message,
  editingId,
  confirmDelete,
  onSave,
  onDownload,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}) {
  return (
    <>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Receipt details</div>
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Receipt # *</label>
            <input
              style={styles.input}
              value={header.receipt_number}
              onChange={(e) => setH('receipt_number', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Received date</label>
            <input
              style={styles.input}
              type="date"
              value={header.received_date || ''}
              onChange={(e) => setH('received_date', e.target.value)}
            />
          </div>
        </div>

        <label style={styles.fieldLabel}>Link to open PO (optional)</label>
        <select
          style={styles.input}
          value={header.po_id || ''}
          onChange={(e) => selectPo(e.target.value)}
        >
          <option value="">(no PO — record freely)</option>
          {pos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.po_number} — {p.vendor_name || '(no vendor)'}
            </option>
          ))}
        </select>
        <p style={styles.helpHint}>
          Selecting a PO auto-fills the vendor and drops in the ordered line
          items so you only enter what actually arrived.
        </p>

        <label style={styles.fieldLabel}>Vendor</label>
        <select
          style={styles.input}
          value={header.vendor_id || ''}
          onChange={(e) => {
            const id = e.target.value;
            const v = vendors.find((x) => x.id === id);
            setH('vendor_id', id);
            if (v) setH('vendor_name', v.name);
          }}
        >
          <option value="">(select vendor)</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>

        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Received by</label>
            <input
              style={styles.input}
              value={header.received_by}
              onChange={(e) => setH('received_by', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Carrier</label>
            <input
              style={styles.input}
              value={header.carrier}
              onChange={(e) => setH('carrier', e.target.value)}
            />
          </div>
        </div>
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Trailer #</label>
            <input
              style={styles.input}
              value={header.trailer_number}
              onChange={(e) => setH('trailer_number', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Seal #</label>
            <input
              style={styles.input}
              value={header.seal_number}
              onChange={(e) => setH('seal_number', e.target.value)}
            />
          </div>
        </div>
        <label style={styles.fieldLabel}>Temp at arrival</label>
        <input
          style={styles.input}
          value={header.temp_at_arrival}
          onChange={(e) => setH('temp_at_arrival', e.target.value)}
          placeholder="e.g. 38°F"
        />
        <label style={styles.fieldLabel}>Notes</label>
        <textarea
          style={styles.textarea}
          value={header.notes}
          onChange={(e) => setH('notes', e.target.value)}
        />
      </div>

      <div style={styles.section}>
        <div style={styles.lineHeadRow}>
          <div style={styles.sectionTitle}>What arrived</div>
          <span style={styles.pill}>
            {lines.length} line{lines.length === 1 ? '' : 's'}
          </span>
        </div>
        {lines.map((l) => (
          <div key={l._key} style={styles.lineCard}>
            <div style={styles.twoCol}>
              <div style={{ flex: 1 }}>
                <label style={styles.miniLabel}>Item #</label>
                <input
                  style={styles.miniInput}
                  value={l.item_no}
                  onChange={(e) => setLine(l._key, 'item_no', e.target.value)}
                />
              </div>
              <div style={{ flex: 2 }}>
                <label style={styles.miniLabel}>Description</label>
                <input
                  style={styles.miniInput}
                  value={l.description}
                  onChange={(e) =>
                    setLine(l._key, 'description', e.target.value)
                  }
                />
              </div>
            </div>
            <div style={styles.twoCol}>
              <div style={{ flex: 1 }}>
                <label style={styles.miniLabel}>Qty received</label>
                <input
                  style={styles.miniInput}
                  type="number"
                  value={l.quantity}
                  onChange={(e) => setLine(l._key, 'quantity', e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.miniLabel}>UoM</label>
                <input
                  style={styles.miniInput}
                  value={l.uom}
                  onChange={(e) => setLine(l._key, 'uom', e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.miniLabel}>Discrepancy</label>
                <select
                  style={styles.miniInput}
                  value={l.discrepancy || ''}
                  onChange={(e) =>
                    setLine(l._key, 'discrepancy', e.target.value)
                  }
                >
                  {DISCREPANCIES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={styles.twoCol}>
              <div style={{ flex: 1 }}>
                <label style={styles.miniLabel}>Lot #</label>
                <input
                  style={styles.miniInput}
                  value={l.lot_no}
                  onChange={(e) => setLine(l._key, 'lot_no', e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.miniLabel}>Exp date</label>
                <input
                  style={styles.miniInput}
                  type="date"
                  value={l.expiration_date || ''}
                  onChange={(e) =>
                    setLine(l._key, 'expiration_date', e.target.value)
                  }
                />
              </div>
            </div>
            {l.discrepancy ? (
              <>
                <label style={styles.miniLabel}>Discrepancy note</label>
                <input
                  style={styles.miniInput}
                  value={l.notes}
                  onChange={(e) => setLine(l._key, 'notes', e.target.value)}
                  placeholder="What was wrong?"
                />
              </>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                style={styles.removeLineBtn}
                onClick={() => removeLine(l._key)}
              >
                <X size={12} /> Remove line
              </button>
            </div>
          </div>
        ))}
        <button style={styles.addLineBtn} onClick={addLine}>
          <Plus size={14} /> Add line
        </button>
      </div>

      {message && (
        <div
          style={{
            ...styles.message,
            color: message.startsWith('Error') ? '#c8102e' : '#15803d',
          }}
        >
          {message}
        </div>
      )}

      <div style={styles.actionRow}>
        <button style={styles.saveBtn} onClick={onSave} disabled={saving}>
          <Save size={18} />
          {saving ? 'Saving...' : editingId ? 'Update receipt' : 'Save receipt'}
        </button>
        {editingId ? (
          <button style={styles.altBtn} onClick={onDownload}>
            <Download size={18} />
            Download PDF
          </button>
        ) : null}
      </div>

      {editingId ? (
        confirmDelete ? (
          <div style={styles.deleteConfirmBox}>
            <div style={styles.deleteConfirmText}>
              Delete this receipt permanently?
            </div>
            <div style={styles.actionRow}>
              <button style={styles.altBtn} onClick={onCancelDelete}>
                Cancel
              </button>
              <button style={styles.deleteBtn} onClick={onConfirmDelete}>
                <Trash2 size={18} />
                Yes, delete receipt
              </button>
            </div>
          </div>
        ) : (
          <button style={styles.deleteLinkBtn} onClick={onRequestDelete}>
            Delete this receipt
          </button>
        )
      ) : null}
      <div style={{ height: '40px' }} />
    </>
  );
}

const styles = {
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f8f8' },
  header: { backgroundColor: '#c8102e', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  headerInner: { maxWidth: '820px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' },
  backText: { fontSize: '13px', color: '#fff', fontWeight: '500' },
  titleArea: { display: 'flex', alignItems: 'center', gap: '8px' },
  headerTitle: { fontSize: '18px', fontWeight: '700', color: '#fff' },
  content: { flex: 1, maxWidth: '820px', width: '100%', margin: '0 auto', padding: '16px' },

  topRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  pageTitle: { fontSize: '20px', fontWeight: '700' },
  primaryBtn: { display: 'flex', alignItems: 'center', gap: '6px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  searchWrap: { display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '16px', background: 'transparent' },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px', textAlign: 'left', cursor: 'pointer', width: '100%' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
  recNumber: { fontSize: '15px', fontWeight: 700, color: '#c8102e' },
  recDate: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#6b7280' },
  recVendor: { fontSize: '15px', fontWeight: '600', marginBottom: '4px' },
  recMeta: { display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12px', color: '#6b7280' },

  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginBottom: '12px' },
  sectionTitle: { fontSize: '13px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' },
  fieldLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px', marginTop: '10px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '15px', boxSizing: 'border-box', marginBottom: '4px' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '14px', boxSizing: 'border-box', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' },
  twoCol: { display: 'flex', gap: '10px' },
  helpHint: { fontSize: '12px', color: '#6b7280', marginTop: '4px', marginBottom: '2px', lineHeight: 1.4 },

  lineHeadRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' },
  pill: { fontSize: '12px', fontWeight: 700, background: '#f3f4f6', color: '#374151', borderRadius: '999px', padding: '2px 10px' },
  lineCard: { border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px', marginBottom: '8px', background: '#fafafa' },
  miniLabel: { display: 'block', fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '2px', marginTop: '6px' },
  miniInput: { width: '100%', border: '1px solid #d1d5db', borderRadius: '8px', padding: '6px 8px', fontSize: '13px', boxSizing: 'border-box', background: '#fff' },
  removeLineBtn: { display: 'flex', alignItems: 'center', gap: '3px', background: 'transparent', color: '#c8102e', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: '4px' },
  addLineBtn: { display: 'flex', alignItems: 'center', gap: '4px', background: '#fff1f2', color: '#c8102e', border: '1px dashed #fecdd3', borderRadius: '10px', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', width: '100%', justifyContent: 'center' },

  message: { fontSize: '14px', fontWeight: '600', marginBottom: '10px' },
  actionRow: { display: 'flex', gap: '10px', marginTop: '10px' },
  saveBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  altBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  deleteLinkBtn: { display: 'block', width: '100%', background: 'transparent', color: '#c8102e', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '20px 8px 8px', textAlign: 'center', textDecoration: 'underline' },
  deleteConfirmBox: { background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '12px', padding: '14px', marginTop: '16px' },
  deleteConfirmText: { fontSize: '14px', fontWeight: '600', color: '#9f1239', marginBottom: '12px', textAlign: 'center' },
  deleteBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
};