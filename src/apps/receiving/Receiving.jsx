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
  PenLine,
  Printer,
} from 'lucide-react';
import { generatePdfFromNode } from '../../lib/pdfHelper.js';
import { TagFace, makeBarcodeSvg, labelPrintCss, buildBarcodeValue } from '../../lib/labelHelper.jsx';

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
  units_per_case: '',
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
  receiver_signature: '',
  receiver_signed_at: '',
});

export default function Receiving() {
  const navigate = useNavigate();
  const [view, setView] = useState('list');
  const [receipts, setReceipts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [vendorItems, setVendorItems] = useState([]);
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
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  // Per-line label count map, keyed by line _key
  const [labelCounts, setLabelCounts] = useState({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [recRes, vendRes, posRes, viRes] = await Promise.all([
      supabase
        .schema('procurement')
        .from('receipts')
        .select('*')
        .order('received_date', { ascending: false })
        .limit(500),
      supabase
        .schema('procurement')
        .from('vendors')
        .select('id, name, address, phone, email, primary_contact')
        .eq('active', true)
        .order('name'),
      supabase
        .schema('procurement')
        .from('pos')
        .select('id, po_number, vendor_id, vendor_name, status')
        .order('order_date', { ascending: false })
        .limit(1000),
      supabase
        .schema('procurement')
        .from('vendor_items')
        .select('vendor_id, item_no, vendor_ref_no'),
    ]);
    setReceipts(recRes.data || []);
    setVendors(vendRes.data || []);
    setPos(posRes.data || []);
    setVendorItems(viRes.data || []);
    setLoading(false);
  }

  // Lookup map: `${vendor_id}::${item_no}` -> vendor_ref_no
  const vendorRefByVendorAndItem = useMemo(() => {
    const m = new Map();
    for (const vi of vendorItems) {
      if (vi.vendor_ref_no) {
        m.set(`${vi.vendor_id}::${vi.item_no}`, vi.vendor_ref_no);
      }
    }
    return m;
  }, [vendorItems]);

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

  function addLotForItem(sourceLine) {
    // Duplicate the item info (item_no, description, uom, po_line_id) but blank
    // lot/qty/exp so the user just types the new lot + quantity.
    setLines((ls) => {
      const idx = ls.findIndex((l) => l._key === sourceLine._key);
      if (idx < 0) return [...ls, blankLine()];
      const newLot = {
        _key: Math.random().toString(36).slice(2),
        po_line_id: sourceLine.po_line_id || '',
        item_no: sourceLine.item_no || '',
        description: sourceLine.description || '',
        quantity: '',
        uom: sourceLine.uom || 'CASE',
        lot_no: '',
        expiration_date: '',
        discrepancy: '',
        notes: '',
        units_per_case: sourceLine.units_per_case || '',
      };
      // Insert right after the source line so grouping is visually preserved
      const before = ls.slice(0, idx + 1);
      const after = ls.slice(idx + 1);
      return [...before, newLot, ...after];
    });
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
      receiver_signature: r.receiver_signature || '',
      receiver_signed_at: r.receiver_signed_at || '',
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
        units_per_case: l.units_per_case ?? '',
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
        receiver_signature: header.receiver_signature || null,
        receiver_signed_at: header.receiver_signed_at || null,
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
          units_per_case:
            l.units_per_case === '' || l.units_per_case == null
              ? null
              : Number(l.units_per_case),
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

  function openLabelModal() {
    // Only lines with an item and a lot are label-worthy
    const eligible = lines.filter(
      (l) => (l.item_no || '').trim() && (l.lot_no || '').trim()
    );
    if (eligible.length === 0) {
      setMessage(
        'No printable lines yet. Add at least one item + lot before printing.'
      );
      return;
    }
    // Default: one label per case received (matches "5 cases in → 5 labels")
    const defaults = {};
    for (const l of lines) {
      if (labelCounts[l._key] != null) {
        defaults[l._key] = labelCounts[l._key];
      } else {
        defaults[l._key] = Number(l.quantity) > 0 ? Number(l.quantity) : 1;
      }
    }
    setLabelCounts(defaults);
    setShowLabelModal(true);
  }

  async function downloadReceipt() {
    if (!header.receipt_number) {
      setMessage('Save the receipt first before downloading');
      return;
    }
    if (!header.po_id) {
      setMessage(
        'Cannot download: no PO linked to this receipt. Link a PO first.'
      );
      return;
    }
    const po = pos.find((p) => p.id === header.po_id);
    if (!po || !po.po_number) {
      setMessage(
        'Cannot download: linked PO has no PO number. Update the PO first.'
      );
      return;
    }

    // Filename: {VendorName}-{PONumber}.pdf, sanitized so file systems are happy
    const clean = (s) =>
      String(s || '')
        .replace(/[^\w\s-]/g, '')  // strip punctuation
        .replace(/\s+/g, '')         // strip spaces
        .slice(0, 40);
    const vendorPart =
      clean(header.vendor_name) || clean(po.vendor_name) || 'Vendor';
    const poPart = clean(po.po_number);
    const filename = `${vendorPart}-${poPart}.pdf`;

    try {
      await generatePdfFromNode({ nodeId: 'receipt-print', filename });
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
            addLotForItem={addLotForItem}
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
            onOpenSignaturePad={() => setShowSignaturePad(true)}
            onClearSignature={() => {
              setH('receiver_signature', '');
              setH('receiver_signed_at', '');
            }}
            onPrintLabels={openLabelModal}
          />
        )}
      </div>

      {view === 'edit' && editingId ? (
        <div
          id="receipt-print"
          style={{ position: 'absolute', left: '-10000px', top: 0 }}
        >
          <ReceiptDocument
            header={header}
            lines={lines}
            vendor={vendors.find((v) => v.id === header.vendor_id) || null}
            vendorRefByItem={vendorRefByVendorAndItem}
          />
        </div>
      ) : null}

      {showSignaturePad ? (
        <SignaturePad
          title="Sign for receipt"
          onClose={() => setShowSignaturePad(false)}
          onSave={(png) => {
            setH('receiver_signature', png);
            setH('receiver_signed_at', new Date().toISOString());
            setShowSignaturePad(false);
          }}
        />
      ) : null}

      {showLabelModal ? (
        <LabelPrintModal
          lines={lines}
          header={header}
          labelCounts={labelCounts}
          setLabelCounts={setLabelCounts}
          onClose={() => setShowLabelModal(false)}
        />
      ) : null}
    </div>
  );
}

// Printable Receipt / Proof of Delivery document
function ReceiptDocument({ header, lines, vendor, vendorRefByItem }) {
  const printLines = lines.filter(
    (l) => (l.item_no || '').trim() || (l.description || '').trim()
  );
  const totalQty = printLines.reduce(
    (s, l) => s + (Number(l.quantity) || 0),
    0
  );
  const anyDiscrepancy = printLines.some((l) => l.discrepancy);
  const anyVendorRef = printLines.some(
    (l) => vendorRefByItem && vendorRefByItem.get(`${header.vendor_id}::${l.item_no}`)
  );
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
              <span style={docStyles.infoLabel}>Ship From (Vendor):</span>
              <div style={docStyles.infoStrong}>
                {header.vendor_name || (vendor && vendor.name) || ''}
              </div>
              {vendor && vendor.address ? (
                <div style={docStyles.infoAddr}>{vendor.address}</div>
              ) : null}
              {vendor && (vendor.primary_contact || vendor.phone) ? (
                <div style={docStyles.infoSmall}>
                  {vendor.primary_contact || ''}
                  {vendor.primary_contact && vendor.phone ? ' · ' : ''}
                  {vendor.phone || ''}
                </div>
              ) : null}
            </td>
            <td style={docStyles.infoCellTall}>
              <span style={docStyles.infoLabel}>Ship To (El Pinto):</span>
              <div style={docStyles.infoStrong}>El Pinto Foods LLC</div>
              <div style={docStyles.infoAddr}>
                10500 4th St NW{'\n'}Albuquerque, NM 87114
              </div>
              <div style={docStyles.infoSmall}>
                Location: {header.received_at || 'ABQEP'}
              </div>
            </td>
          </tr>
          <RowInfoPair
            shaded
            l={['Received By:', header.received_by]}
            r={['Date:', header.received_date]}
          />
          <RowInfoPair
            l={['Carrier:', header.carrier]}
            r={['Trailer #:', header.trailer_number]}
          />
          <RowInfoPair
            shaded
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
            {anyVendorRef ? (
              <th style={docStyles.th}>Vendor Ref #</th>
            ) : null}
            <th style={docStyles.th}>Description</th>
            <th style={docStyles.thR}>Qty</th>
            <th style={docStyles.th}>UoM</th>
            <th style={docStyles.th}>Lot #</th>
            <th style={docStyles.th}>Exp Date</th>
            <th style={docStyles.th}>Discrepancy</th>
          </tr>
        </thead>
        <tbody>
          {printLines.map((l, i) => {
            const ref = vendorRefByItem
              ? vendorRefByItem.get(`${header.vendor_id}::${l.item_no}`) || ''
              : '';
            return (
              <tr key={i}>
                <td style={docStyles.td}>{l.item_no}</td>
                {anyVendorRef ? (
                  <td style={docStyles.td}>{ref}</td>
                ) : null}
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
            );
          })}
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
          {header.receiver_signature ? (
            <img
              src={header.receiver_signature}
              alt="Received by"
              style={{
                maxWidth: '100%',
                maxHeight: '50px',
                display: 'block',
                marginBottom: '2px',
              }}
            />
          ) : (
            <div style={docStyles.signLine}></div>
          )}
          <div style={docStyles.signLabel}>
            Received by (signature)
            {header.receiver_signed_at
              ? ' — ' +
                new Date(header.receiver_signed_at).toLocaleDateString('en-US')
              : ''}
          </div>
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
  infoSmall: { fontSize: '10px', color: '#374151', marginTop: '3px' },
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
  addLotForItem,
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
  onOpenSignaturePad,
  onClearSignature,
  onPrintLabels,
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
          {pos
            .filter(
              (p) =>
                p.status === 'open' ||
                p.status === 'partially_received' ||
                p.id === header.po_id
            )
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.po_number} — {p.vendor_name || '(no vendor)'}
                {p.status === 'received' || p.status === 'closed'
                  ? ' (closed)'
                  : ''}
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
            <div style={styles.twoCol}>
              <div style={{ flex: 1 }}>
                <label style={styles.miniLabel}>
                  Units per case <span style={styles.optionalHint}>(optional)</span>
                </label>
                <input
                  style={styles.miniInput}
                  type="number"
                  min="0"
                  value={l.units_per_case}
                  onChange={(e) =>
                    setLine(l._key, 'units_per_case', e.target.value)
                  }
                  placeholder="e.g. 10000 labels per case"
                />
              </div>
              <div style={{ flex: 1 }} />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
              <button
                style={styles.addLotBtn}
                onClick={() => addLotForItem(l)}
                disabled={!l.item_no}
                title={
                  !l.item_no
                    ? 'Pick the item first'
                    : 'Add another lot for this same item'
                }
              >
                <Plus size={12} /> Another lot for this item
              </button>
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

      {/* Receiver signature */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Receiver signature</div>
        {header.receiver_signature ? (
          <>
            <div style={styles.sigDisplayFrame}>
              <img
                src={header.receiver_signature}
                alt="Receiver signature"
                style={styles.sigDisplayImg}
              />
            </div>
            <div style={styles.sigMeta}>
              Signed{' '}
              {header.receiver_signed_at
                ? new Date(header.receiver_signed_at).toLocaleString()
                : ''}
            </div>
            <button style={styles.sigClearBtn} onClick={onClearSignature}>
              Clear &amp; re-sign
            </button>
          </>
        ) : (
          <button style={styles.sigBtn} onClick={onOpenSignaturePad}>
            <PenLine size={18} />
            Sign to confirm receipt
          </button>
        )}
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
        <div style={styles.actionRow}>
          <button style={styles.labelsBtn} onClick={onPrintLabels}>
            <Printer size={18} />
            Print pallet labels
          </button>
        </div>
      ) : null}

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

// ---------- Signature pad (finger/stylus on tablet, saves as base64 PNG) ----------
// ---------- Label print modal (renders 4x6 labels and triggers print) ----------
function LabelPrintModal({
  lines,
  header,
  labelCounts,
  setLabelCounts,
  onClose,
}) {
  const eligible = lines.filter(
    (l) => (l.item_no || '').trim() && (l.lot_no || '').trim()
  );

  // For each eligible line we let the user set how many cases they want a
  // label for. Default = the quantity received (one label per case).
  // If units_per_case is set on the line, that's what shows as the QTY on
  // each printed label; otherwise we fall back to the raw quantity.
  const totalLabels = eligible.reduce(
    (s, l) => s + (Number(labelCounts[l._key]) || 0),
    0
  );

  const printQueue = [];
  for (const l of eligible) {
    const casesRequested = Math.max(
      0,
      Math.min(500, Number(labelCounts[l._key]) || 0)
    );
    if (casesRequested === 0) continue;

    // Per-label QTY: units_per_case if provided, otherwise the raw quantity.
    // Reason: if you have 5 cases of 10000 labels each, each printed label
    // shows 10000, not 5. If units_per_case is blank, we assume 1 case = 1
    // whatever-you-received and print the raw quantity.
    const upc = Number(l.units_per_case);
    const perLabelQty =
      upc && upc > 0 ? upc : Number(l.quantity) || l.quantity || '';

    // How many total cases we're labeling — defaults to received quantity so
    // the case counter reads "Case 1 of 5" naturally.
    const totalCases = Number(l.quantity) || casesRequested;

    const commonData = {
      shipTo: '',
      poNumber: header.receipt_number || '',
      shipDate: header.received_date || '',
      itemNo: l.item_no,
      description: l.description || '',
      lotNo: l.lot_no || '',
      expirationDate: l.expiration_date || '',
      qty: perLabelQty,
      uom: l.uom || '',
    };

    // Barcode encodes item|description|lot|exp|qty (same for every label of
    // this line, since scan should pop up item data regardless of case index)
    const barcodeValue = buildBarcodeValue({
      itemNo: l.item_no,
      description: l.description || '',
      lotNo: l.lot_no || '',
      expirationDate: l.expiration_date || '',
      qty: perLabelQty,
    });
    const barcodeSvg = makeBarcodeSvg(barcodeValue);

    for (let i = 0; i < casesRequested; i++) {
      const caseIndex = i + 1;
      printQueue.push({
        data: {
          ...commonData,
          caseCounter: { index: caseIndex, total: totalCases },
        },
        barcodeSvg,
        key: `${l._key}-${caseIndex}`,
      });
    }
  }

  function handlePrint() {
    if (printQueue.length === 0) return;
    setTimeout(() => window.print(), 100);
  }

  return (
    <>
      <style>{labelPrintCss('receiving-labels-print')}</style>
      <div className="screen-only" style={styles.overlay}>
        <div style={{ ...styles.modal, maxHeight: '90vh' }}>
          <div style={styles.modalHead}>
            <span style={styles.modalTitle}>Print case labels</span>
            <button style={styles.iconBtn} onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <p style={styles.helpHint}>
            One label per case, showing the units per case on the label.
            The barcode encodes item, description, lot, expiration, and qty
            (pipe-delimited) so a scanner can auto-fill fields.
          </p>

          {eligible.length === 0 ? (
            <div style={{ padding: '20px 0', textAlign: 'center', color: '#9ca3af' }}>
              No printable lines yet. Each label needs an item # and a lot #.
            </div>
          ) : (
            <div style={styles.labelListWrap}>
              {eligible.map((l) => {
                const cases = Number(l.quantity) || 0;
                const upc = Number(l.units_per_case) || 0;
                const perLabel = upc > 0 ? upc : cases;
                return (
                  <div key={l._key} style={styles.labelRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.labelRowItem}>{l.item_no}</div>
                      <div style={styles.labelRowDesc}>{l.description}</div>
                      <div style={styles.labelRowMeta}>
                        Lot <strong>{l.lot_no}</strong>
                      </div>
                      <div style={styles.labelRowMeta}>
                        Received: <strong>{cases}</strong> {l.uom || 'CASE'}
                        {upc > 0 ? (
                          <>
                            {' '}
                            · <strong>{upc.toLocaleString()}</strong> per case
                          </>
                        ) : null}
                      </div>
                      <div style={styles.labelRowMeta}>
                        Each label will show QTY = <strong>{perLabel || '—'}</strong>
                      </div>
                    </div>
                    <div style={styles.labelCountArea}>
                      <label style={styles.miniLabel}># labels (= cases)</label>
                      <input
                        style={styles.labelCountInput}
                        type="number"
                        min="0"
                        max="500"
                        value={labelCounts[l._key] ?? cases}
                        onChange={(e) =>
                          setLabelCounts({
                            ...labelCounts,
                            [l._key]: e.target.value,
                          })
                        }
                      />
                      <div style={styles.labelCountQuickRow}>
                        <button
                          style={styles.quickBtn}
                          onClick={() =>
                            setLabelCounts({ ...labelCounts, [l._key]: 1 })
                          }
                        >
                          1
                        </button>
                        {cases ? (
                          <button
                            style={styles.quickBtn}
                            onClick={() =>
                              setLabelCounts({
                                ...labelCounts,
                                [l._key]: cases,
                              })
                            }
                          >
                            {cases}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={styles.labelTotalRow}>
            Total labels: <strong>{totalLabels}</strong>
          </div>

          <div style={styles.actionRow}>
            <button style={styles.altBtn} onClick={onClose}>
              Cancel
            </button>
            <button
              style={{
                ...styles.saveBtn,
                ...(totalLabels > 0
                  ? {}
                  : { background: '#d1d5db', cursor: 'not-allowed' }),
              }}
              disabled={totalLabels === 0}
              onClick={handlePrint}
            >
              <Printer size={18} />
              Print {totalLabels} label{totalLabels === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>

      {/* Print-only container — the CSS above hides it on screen */}
      <div id="receiving-labels-print">
        {printQueue.map((q) => (
          <TagFace
            key={q.key}
            data={q.data}
            barcodeSvg={q.barcodeSvg}
            title="RECEIVING TAG"
          />
        ))}
      </div>
    </>
  );
}

function SignaturePad({ title, onClose, onSave }) {
  const canvasRef = React.useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#111';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  function getPos(e) {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    const t = e.touches && e.touches[0];
    const x = (t ? t.clientX : e.clientX) - rect.left;
    const y = (t ? t.clientY : e.clientY) - rect.top;
    return { x, y };
  }

  function start(e) {
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawing(true);
  }

  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) setHasInk(true);
  }

  function end() {
    setDrawing(false);
  }

  function clearPad() {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    const rect = c.getBoundingClientRect();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    setHasInk(false);
  }

  function save() {
    if (!hasInk) return;
    const png = canvasRef.current.toDataURL('image/png');
    onSave(png);
  }

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, maxHeight: '90vh' }}>
        <div style={styles.modalHead}>
          <span style={styles.modalTitle}>{title || 'Sign here'}</span>
          <button style={styles.iconBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p style={{ ...styles.helpHint, marginTop: 0 }}>
          Sign with your finger or a stylus. Tap Save when done.
        </p>

        <div style={styles.sigPadFrame}>
          <canvas
            ref={canvasRef}
            style={styles.sigPadCanvas}
            onMouseDown={start}
            onMouseMove={move}
            onMouseUp={end}
            onMouseLeave={end}
            onTouchStart={start}
            onTouchMove={move}
            onTouchEnd={end}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button style={styles.altBtn} onClick={clearPad}>
            Clear
          </button>
          <button
            style={{
              ...styles.saveBtn,
              ...(hasInk ? {} : { background: '#d1d5db', cursor: 'not-allowed' }),
            }}
            onClick={save}
            disabled={!hasInk}
          >
            <Save size={18} />
            Save signature
          </button>
        </div>
      </div>
    </div>
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
  optionalHint: { fontSize: '10px', fontWeight: 500, color: '#9ca3af', fontStyle: 'italic' },
  miniInput: { width: '100%', border: '1px solid #d1d5db', borderRadius: '8px', padding: '6px 8px', fontSize: '13px', boxSizing: 'border-box', background: '#fff' },
  removeLineBtn: { display: 'flex', alignItems: 'center', gap: '3px', background: 'transparent', color: '#c8102e', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: '4px' },
  addLotBtn: { display: 'inline-flex', alignItems: 'center', gap: '3px', background: '#f0fdf4', color: '#065f46', border: '1px solid #99f6e4', borderRadius: '8px', padding: '4px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' },
  addLineBtn: { display: 'flex', alignItems: 'center', gap: '4px', background: '#fff1f2', color: '#c8102e', border: '1px dashed #fecdd3', borderRadius: '10px', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', width: '100%', justifyContent: 'center' },

  message: { fontSize: '14px', fontWeight: '600', marginBottom: '10px' },
  actionRow: { display: 'flex', gap: '10px', marginTop: '10px' },
  saveBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  altBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  deleteLinkBtn: { display: 'block', width: '100%', background: 'transparent', color: '#c8102e', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '20px 8px 8px', textAlign: 'center', textDecoration: 'underline' },
  deleteConfirmBox: { background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '12px', padding: '14px', marginTop: '16px' },
  deleteConfirmText: { fontSize: '14px', fontWeight: '600', color: '#9f1239', marginBottom: '12px', textAlign: 'center' },
  deleteBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },

  sigBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', background: '#fff', color: '#c8102e', border: '1px dashed #fecdd3', borderRadius: '12px', padding: '18px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  sigDisplayFrame: { border: '1px solid #d1d5db', borderRadius: '10px', background: '#fff', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  sigDisplayImg: { maxWidth: '100%', maxHeight: '120px', display: 'block' },
  sigMeta: { fontSize: '12px', color: '#6b7280', marginTop: '6px' },
  sigClearBtn: { display: 'block', width: '100%', background: 'transparent', color: '#c8102e', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '10px', textAlign: 'center', textDecoration: 'underline' },
  sigPadFrame: { border: '1px solid #d1d5db', borderRadius: '12px', background: '#fff', padding: '4px', height: '260px' },
  sigPadCanvas: { width: '100%', height: '100%', touchAction: 'none', background: '#fff', borderRadius: '10px', display: 'block' },

  labelsBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  labelListWrap: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '55vh', overflowY: 'auto', paddingRight: '2px' },
  labelRow: { display: 'flex', gap: '10px', alignItems: 'flex-start', background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px' },
  labelRowItem: { fontSize: '14px', fontWeight: 700 },
  labelRowDesc: { fontSize: '12px', color: '#6b7280' },
  labelRowMeta: { fontSize: '12px', color: '#374151', marginTop: '2px' },
  labelCountArea: { width: '110px', display: 'flex', flexDirection: 'column', alignItems: 'stretch' },
  labelCountInput: { width: '100%', border: '1px solid #d1d5db', borderRadius: '8px', padding: '6px 8px', fontSize: '15px', boxSizing: 'border-box', background: '#fff', textAlign: 'center', fontWeight: 700 },
  labelCountQuickRow: { display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' },
  quickBtn: { flex: 1, fontSize: '11px', fontWeight: 600, background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '3px 6px', cursor: 'pointer', minWidth: 0 },
  labelTotalRow: { fontSize: '14px', color: '#374151', marginTop: '10px', textAlign: 'right' },
};