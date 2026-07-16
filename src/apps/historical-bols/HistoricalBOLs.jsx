import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';
import Papa from 'papaparse';
import {
  ChevronLeft,
  Search,
  Printer,
  X,
  FileText,
  Save,
  Upload,
  Download,
  Mail,
  History,
} from 'lucide-react';

// ---------- constants (mirror the BOL Maker for consistency) ----------
const TEMP_WARNING_DEFAULT =
  '*PLEASE MAINTAIN PRODUCT BELOW 90 DEGREES WHEN SHIPPING/STORING. DO NOT ALLOW PRODUCT TO SIT IN HOT TRAILER.*';

const LEGAL_NOTE =
  'Note: Liability Limitation for loss or damage in this shipment may be applicable. See 49 USC 14706(c)(1)(A) and (B)';

const CERT_LEFT =
  'Received, subject to individually determined rates or contracts that have been agreed upon in writing between the carrier and shipper, if applicable, otherwise to the rates, classifications, and rules that have been established by the carrier and are available to the shipper, on request, and to all applicable state and federal regulations.';

const CERT_RIGHT =
  'This is to certify that the above-named materials are properly classified, described, packaged, marked and labeled and are in proper condition for transportation according to the applicable regulations of the Department of Transportation';

const SHIP_LOCATION = 'ABQEP';

const DEFAULT_EMAIL_RECIPIENTS = [
  'caleb@elpinto.com',
  'warehouse@elpinto.com',
];

// ---------- CSV / OData helpers (identical patterns to BOL Maker) ----------
function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data || []),
      error: (err) => reject(err),
    });
  });
}

function lower(row) {
  const o = {};
  for (const k of Object.keys(row || {})) o[k.toLowerCase().trim()] = row[k];
  return o;
}

function pick(lrow, names) {
  for (const n of names) {
    const key = n.toLowerCase().trim();
    for (const k of [key, key + '_']) {
      const v = lrow[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

function toNum(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return isNaN(n) ? null : n;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// ---------- audit footer ----------
function reconstructedFooter(originalDate) {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const orig = originalDate
    ? new Date(originalDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '(unknown)';
  return `Reconstructed on ${today} from Business Central records — original shipment date: ${orig}`;
}

// ---------- PDF generation (same pattern as BOL Maker) ----------
async function generateHistoricalPdf({ filename, downloadIt }) {
  const node = document.getElementById('historical-bol-print');
  if (!node) throw new Error('BOL preview not found');
  const [{ default: html2canvas }, jspdfMod] = await Promise.all([
    import('https://esm.sh/html2canvas@1.4.1'),
    import('https://esm.sh/jspdf@2.5.1'),
  ]);
  const { jsPDF } = jspdfMod;

  const saved = {
    position: node.style.position,
    left: node.style.left,
    top: node.style.top,
    background: node.style.background,
  };
  node.style.position = 'fixed';
  node.style.left = '0';
  node.style.top = '0';
  node.style.background = '#fff';

  let canvas;
  try {
    canvas = await html2canvas(node, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });
  } finally {
    node.style.position = saved.position;
    node.style.left = saved.left;
    node.style.top = saved.top;
    node.style.background = saved.background;
  }

  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  const imgW = pageW - margin * 2;
  const ratio = imgW / canvas.width;
  const imgH = canvas.height * ratio;
  const imgData = canvas.toDataURL('image/png');

  if (imgH <= pageH - margin * 2) {
    pdf.addImage(imgData, 'PNG', margin, margin, imgW, imgH);
  } else {
    let y = margin;
    let remaining = imgH;
    let offset = 0;
    while (remaining > 0) {
      pdf.addImage(imgData, 'PNG', margin, y - offset, imgW, imgH);
      remaining -= pageH - margin * 2;
      offset += pageH - margin * 2;
      if (remaining > 0) {
        pdf.addPage();
        y = margin;
      }
    }
  }

  if (downloadIt) {
    pdf.save(filename || 'HistoricalBOL.pdf');
    return null;
  }
  return pdf.output('blob');
}

function openEmailDraft({ to, subject, body }) {
  const url =
    'mailto:' +
    encodeURIComponent((to || []).join(',')) +
    '?subject=' + encodeURIComponent(subject || '') +
    '&body=' + encodeURIComponent(body || '');
  window.location.href = url;
}

// ============================================================
export default function HistoricalBOLs() {
  const navigate = useNavigate();

  const [view, setView] = useState('list'); // list | edit
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const [selected, setSelected] = useState(null);   // the picked shipment
  const [selectedLines, setSelectedLines] = useState([]); // its lines with allocated lots
  const [message, setMessage] = useState('');

  // extra BOL-editable fields for the reconstruction
  const [qa, setQa] = useState({
    conditionOfTrailer: '',
    odor: '',
    tempLogger: '',
    truckTemp: '',
    comments: '',
  });
  const [notes, setNotes] = useState('');
  // Editable ship-to override — pre-filled from CSV, but the user can type
  // over these for a specific reconstruction. What's here is what gets
  // printed and saved.
  const [editShipTo, setEditShipTo] = useState({ name: '', address: '' });

  useEffect(() => {
    loadShipments();
  }, []);

  async function loadShipments() {
    setLoading(true);
    const { data, error } = await supabase
      .schema('shipping')
      .from('bc_historical_shipments')
      .select('*')
      .order('posting_date', { ascending: false })
      .limit(2000);
    if (!error) setShipments(data || []);
    setLoading(false);
  }

  // ----- CSV import (headers + lines + item ledger) -----
  async function importFiles({ hdrFile, linesFile, ledgerFile }) {
    setImporting(true);
    setImportMsg('');
    try {
      const [hdrRows, lineRows, ledgerRows] = await Promise.all([
        parseCsv(hdrFile),
        parseCsv(linesFile),
        parseCsv(ledgerFile),
      ]);

      // Headers
      const headers = [];
      for (const r of hdrRows) {
        const lr = lower(r);
        const shipNo = pick(lr, ['No', 'Document_No']);
        if (!shipNo) continue;
        // Ship-to fields — try ship_to_* first, fall back to bill_to_*, then sell_to_*
        const shipToName =
          pick(lr, ['Ship_to_Name']) ||
          pick(lr, ['Bill_to_Name']) ||
          pick(lr, ['Sell_to_Customer_Name']);
        const shipAddrLines = [
          pick(lr, ['Ship_to_Address']) || pick(lr, ['Bill_to_Address']),
          pick(lr, ['Ship_to_Address_2']) || pick(lr, ['Bill_to_Address_2']),
          [
            pick(lr, ['Ship_to_City']) || pick(lr, ['Bill_to_City']),
            pick(lr, ['Ship_to_County']) || pick(lr, ['Bill_to_County']),
            pick(lr, ['Ship_to_Post_Code']) || pick(lr, ['Bill_to_Post_Code']),
          ]
            .filter(Boolean)
            .join(' '),
        ]
          .filter(Boolean)
          .join('\n');
        headers.push({
          shipment_no: shipNo,
          order_no: pick(lr, ['Order_No']),
          // Try Posting_Date, then Shipment_Date, then Document_Date
          posting_date:
            pick(lr, ['Posting_Date', 'Shipment_Date', 'Document_Date']) ||
            null,
          customer_name: pick(lr, ['Sell_to_Customer_Name', 'Bill_to_Name']),
          ship_to_name: shipToName,
          ship_to_address: shipAddrLines,
          bill_to_name: pick(lr, ['Bill_to_Name']),
          bill_to_address: [
            pick(lr, ['Bill_to_Address']),
            pick(lr, ['Bill_to_Address_2']),
            [
              pick(lr, ['Bill_to_City']),
              pick(lr, ['Bill_to_County']),
              pick(lr, ['Bill_to_Post_Code']),
            ]
              .filter(Boolean)
              .join(' '),
          ]
            .filter(Boolean)
            .join('\n'),
          // No customer_po field on the current ZACK page - leave empty for now
          customer_po: pick(lr, ['External_Document_No']),
          carrier: pick(lr, [
            'Shipping_Agent_Code',
            'Shipping_Agent_Service_Code',
          ]),
          tracking_no: pick(lr, ['Package_Tracking_No']),
          location_code: pick(lr, ['Location_Code']),
          raw: r,
        });
      }

      // Lines (only ABQEP)
      const lines = [];
      for (const r of lineRows) {
        const lr = lower(r);
        const loc = pick(lr, ['Location_Code']);
        if (loc && loc.toUpperCase() !== SHIP_LOCATION) continue;
        const shipNo = pick(lr, ['Document_No']);
        const itemNo = pick(lr, ['No', 'Item_No']);
        if (!shipNo || !itemNo) continue;
        lines.push({
          shipment_no: shipNo,
          line_no: pick(lr, ['Line_No']),
          item_no: itemNo,
          description: pick(lr, ['Description']),
          quantity: toNum(pick(lr, ['Quantity', 'Qty_Shipped'])),
          uom: pick(lr, ['Unit_of_Measure_Code']),
          location_code: loc,
          raw: r,
        });
      }

      // Item ledger — the lot payoff
      const lots = [];
      for (const r of ledgerRows) {
        const lr = lower(r);
        const entryType = pick(lr, ['Entry_Type']);
        // For sales shipments the entry type is "Sale"
        if (entryType && entryType.toLowerCase() !== 'sale') continue;
        const shipNo = pick(lr, ['Document_No']);
        const itemNo = pick(lr, ['Item_No']);
        const lotNo = pick(lr, ['Lot_No']);
        if (!shipNo || !itemNo) continue;
        // Skip ledger entries where no lot was tracked
        if (!lotNo) continue;
        lots.push({
          shipment_no: shipNo,
          item_no: itemNo,
          lot_no: lotNo,
          quantity: toNum(pick(lr, ['Quantity'])),
          posting_date: pick(lr, ['Posting_Date']) || null,
          expiration_date: pick(lr, ['Expiration_Date']) || null,
          location_code: pick(lr, ['Location_Code']),
          raw: r,
        });
      }

      // Only keep shipments that have at least one line (avoid empty imports)
      const shipsWithLines = new Set(lines.map((l) => l.shipment_no));
      const keptHeaders = headers.filter((h) =>
        shipsWithLines.has(h.shipment_no)
      );

      // Replace snapshot (clean import each time)
      await supabase
        .schema('shipping')
        .from('bc_historical_lots')
        .delete()
        .gte('imported_at', '1970-01-01');
      await supabase
        .schema('shipping')
        .from('bc_historical_shipment_lines')
        .delete()
        .gte('imported_at', '1970-01-01');
      await supabase
        .schema('shipping')
        .from('bc_historical_shipments')
        .delete()
        .gte('imported_at', '1970-01-01');

      for (const part of chunk(keptHeaders, 500)) {
        const { error } = await supabase
          .schema('shipping')
          .from('bc_historical_shipments')
          .insert(part);
        if (error) throw error;
      }
      for (const part of chunk(lines, 500)) {
        const { error } = await supabase
          .schema('shipping')
          .from('bc_historical_shipment_lines')
          .insert(part);
        if (error) throw error;
      }
      for (const part of chunk(lots, 500)) {
        const { error } = await supabase
          .schema('shipping')
          .from('bc_historical_lots')
          .insert(part);
        if (error) throw error;
      }

      await loadShipments();
      setImportMsg(
        `Imported ${keptHeaders.length} shipments, ${lines.length} lines, ${lots.length} lot entries \u2713`
      );
    } catch (e) {
      setImportMsg('Import error: ' + (e.message || 'unknown error'));
    } finally {
      setImporting(false);
    }
  }

  // ----- open a shipment: join lines with lots -----
  async function openShipment(hdr) {
    setSelected(hdr);
    setMessage('');

    const [linesRes, lotsRes] = await Promise.all([
      supabase
        .schema('shipping')
        .from('bc_historical_shipment_lines')
        .select('*')
        .eq('shipment_no', hdr.shipment_no)
        .order('line_no', { ascending: true }),
      supabase
        .schema('shipping')
        .from('bc_historical_lots')
        .select('*')
        .eq('shipment_no', hdr.shipment_no),
    ]);

    const rawLines = linesRes.data || [];
    const rawLots = lotsRes.data || [];

    // Group lots by item_no
    const lotsByItem = new Map();
    for (const lot of rawLots) {
      const arr = lotsByItem.get(lot.item_no) || [];
      arr.push(lot);
      lotsByItem.set(lot.item_no, arr);
    }

    // For each line, attach the corresponding lot allocations
    const composed = rawLines.map((l) => {
      const itemLots = lotsByItem.get(l.item_no) || [];
      // ILE quantity is negative for sales — normalize to positive
      const allocs = itemLots.map((lot) => ({
        lot_no: lot.lot_no,
        quantity: Math.abs(Number(lot.quantity) || 0),
      }));
      return {
        line_no: l.line_no,
        item_no: l.item_no,
        description: l.description,
        quantity: l.quantity,
        uom: l.uom,
        allocations: allocs,
      };
    });

    setSelectedLines(composed);
    setEditShipTo({
      name: hdr.ship_to_name || '',
      address: hdr.ship_to_address || '',
    });
    setView('edit');
  }

  // ----- save reconstruction into shipping.bols -----
  async function saveReconstruction() {
    if (!selected) return;
    setMessage('');
    try {
      const totalCases = selectedLines.reduce(
        (s, l) => s + (Number(l.quantity) || 0),
        0
      );

      const headerRow = {
        bol_number: `RECON-${selected.shipment_no}`,
        sales_order_no: selected.order_no,
        bol_date: selected.posting_date,
        due_date: selected.posting_date,
        status: 'shipped',
        ship_from_name: 'El Pinto Foods LLC',
        ship_from_address: '10500 4th St NW\nAlbuquerque, NM 87114',
        ship_to_name: editShipTo.name || selected.ship_to_name,
        ship_to_address: editShipTo.address || selected.ship_to_address,
        bill_to_name: selected.bill_to_name,
        bill_to_address: selected.bill_to_address,
        customer_po: selected.customer_po,
        carrier_name: selected.carrier,
        temp_warning: TEMP_WARNING_DEFAULT,
        special_instructions: notes || null,
        qa: qa,
        total_pieces: totalCases,
        is_reconstructed: true,
        reconstructed_at: new Date().toISOString(),
        source_shipment_no: selected.shipment_no,
      };

      const { data: inserted, error: insErr } = await supabase
        .schema('shipping')
        .from('bols')
        .insert(headerRow)
        .select()
        .single();
      if (insErr) throw insErr;
      const bolId = inserted.id;

      // Store each allocation as its own bol_lines row (recall traceability)
      const lineRows = [];
      let groupCounter = 1;
      for (const l of selectedLines) {
        const groupId = groupCounter++;
        const allocs =
          l.allocations && l.allocations.length > 0
            ? l.allocations
            : [{ lot_no: '', quantity: l.quantity }];
        for (const a of allocs) {
          lineRows.push({
            bol_id: bolId,
            line_group: groupId,
            item_no: l.item_no,
            description: l.description,
            lot_no: a.lot_no || '',
            quantity: a.quantity,
            uom: l.uom || null,
          });
        }
      }
      if (lineRows.length > 0) {
        const { error: lineErr } = await supabase
          .schema('shipping')
          .from('bol_lines')
          .insert(lineRows);
        if (lineErr) throw lineErr;
      }

      setMessage('Saved reconstruction \u2713');
    } catch (e) {
      setMessage('Error saving: ' + (e.message || 'unknown error'));
    }
  }

  async function handleDownloadPdf() {
    if (!selected) return;
    try {
      await generateHistoricalPdf({
        filename: `HistoricalBOL-${selected.shipment_no}.pdf`,
        downloadIt: true,
      });
    } catch (e) {
      setMessage('Error making PDF: ' + (e.message || 'unknown error'));
    }
  }

  async function handleEmail() {
    if (!selected) return;
    const filename = `HistoricalBOL-${selected.shipment_no}.pdf`;
    try {
      await generateHistoricalPdf({ filename, downloadIt: true });
    } catch (e) {
      setMessage('Error making PDF: ' + (e.message || 'unknown error'));
      return;
    }
    openEmailDraft({
      to: DEFAULT_EMAIL_RECIPIENTS,
      subject: `Reconstructed BOL — ${selected.shipment_no}`,
      body:
        `Reconstructed BOL for shipment ${selected.shipment_no}\n` +
        `Original ship date: ${formatDate(selected.posting_date)}\n` +
        `Customer: ${selected.customer_name || ''}\n\n` +
        `PDF attached: ${filename}\n(Saved to your Downloads — drag it onto this email.)`,
    });
  }

  function handlePrint() {
    window.print();
  }

  // ---------- filtered list ----------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shipments;
    return shipments.filter((s) => {
      return (
        (s.shipment_no || '').toLowerCase().includes(q) ||
        (s.order_no || '').toLowerCase().includes(q) ||
        (s.customer_name || '').toLowerCase().includes(q) ||
        (s.ship_to_name || '').toLowerCase().includes(q) ||
        (s.customer_po || '').toLowerCase().includes(q)
      );
    });
  }, [shipments, search]);

  const totalCases = useMemo(
    () => selectedLines.reduce((s, l) => s + (Number(l.quantity) || 0), 0),
    [selectedLines]
  );

  return (
    <>
      <style>{printCss}</style>

      <div className="screen-only" style={styles.container}>
        <div style={styles.header}>
          <div style={styles.headerInner}>
            <button
              style={styles.backButton}
              onClick={() =>
                view === 'edit' ? setView('list') : navigate('/')
              }
            >
              <ChevronLeft size={20} color="#fff" />
              <span style={styles.backText}>
                {view === 'edit' ? 'Shipments' : 'Home'}
              </span>
            </button>
            <div style={styles.titleArea}>
              <History size={18} color="#fff" />
              <span style={styles.headerTitle}>
                {view === 'edit'
                  ? 'Reconstructed BOL'
                  : 'Historical BOLs'}
              </span>
            </div>
            <div style={{ width: '70px' }} />
          </div>
        </div>

        <div style={styles.content}>
          {view === 'list' ? (
            <>
              <p style={styles.hint}>
                Reconstruct past BOLs from Business Central shipment records.
                Every printed document is stamped as reconstructed for audit
                transparency.
              </p>

              <div style={styles.bcBar}>
                <button
                  style={styles.bcSecondaryBtn}
                  onClick={() => {
                    setImportMsg('');
                    setShowImport(true);
                  }}
                >
                  <Upload size={16} />
                  Import BC shipments
                </button>
              </div>

              <div style={styles.searchWrap}>
                <Search size={18} color="#9ca3af" />
                <input
                  style={styles.searchInput}
                  placeholder="Search shipment #, order #, customer, PO..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {loading ? (
                <p style={{ color: '#6b7280' }}>Loading...</p>
              ) : filtered.length === 0 ? (
                <div style={styles.empty}>
                  <FileText size={32} color="#d1d5db" />
                  <p style={{ color: '#9ca3af', marginTop: '8px' }}>
                    No shipments imported yet. Tap "Import BC shipments" to
                    load past shipment records.
                  </p>
                </div>
              ) : (
                <div style={styles.list}>
                  {filtered.map((s) => (
                    <button
                      key={s.shipment_no}
                      style={styles.card}
                      onClick={() => openShipment(s)}
                    >
                      <div style={styles.cardTop}>
                        <span style={styles.shipNo}>{s.shipment_no}</span>
                        <span style={styles.shipDate}>
                          {formatDate(s.posting_date)}
                        </span>
                      </div>
                      <div style={styles.shipCustomer}>
                        {s.ship_to_name || s.customer_name || '(no customer)'}
                      </div>
                      <div style={styles.shipMeta}>
                        {s.order_no ? 'Order ' + s.order_no + ' · ' : ''}
                        {s.customer_po ? 'PO ' + s.customer_po : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            selected && (
              <EditView
                shipment={selected}
                lines={selectedLines}
                totalCases={totalCases}
                qa={qa}
                setQa={setQa}
                notes={notes}
                setNotes={setNotes}
                editShipTo={editShipTo}
                setEditShipTo={setEditShipTo}
                message={message}
                onSave={saveReconstruction}
                onPrint={handlePrint}
                onDownloadPdf={handleDownloadPdf}
                onEmail={handleEmail}
              />
            )
          )}
        </div>

        {showImport && (
          <ImportModal
            importing={importing}
            importMsg={importMsg}
            onImport={importFiles}
            onClose={() => setShowImport(false)}
          />
        )}
      </div>

      {selected && (
        <div id="historical-bol-print">
          <BolDocument
            shipment={selected}
            lines={selectedLines}
            totalCases={totalCases}
            qa={qa}
            notes={notes}
            editShipTo={editShipTo}
          />
        </div>
      )}
    </>
  );
}

// ---------- Import modal (three files) ----------
function ImportModal({ importing, importMsg, onImport, onClose }) {
  const [hdrFile, setHdrFile] = useState(null);
  const [linesFile, setLinesFile] = useState(null);
  const [ledgerFile, setLedgerFile] = useState(null);
  const ready = hdrFile && linesFile && ledgerFile && !importing;
  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHead}>
          <span style={styles.modalTitle}>Import BC shipments</span>
          <button style={styles.iconBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p style={styles.helpText}>
          Export three queries from Power Query as CSV and pick them here:
        </p>

        <label style={styles.fileLabel}>1. SalesShipmentHdr (ZACK) CSV</label>
        <input
          type="file"
          accept=".csv"
          style={styles.fileInput}
          onChange={(e) => setHdrFile(e.target.files?.[0] || null)}
        />

        <label style={styles.fileLabel}>2. SalesShipmentLines CSV</label>
        <input
          type="file"
          accept=".csv"
          style={styles.fileInput}
          onChange={(e) => setLinesFile(e.target.files?.[0] || null)}
        />

        <label style={styles.fileLabel}>
          3. ItemLedgerEntries CSV (has Lot_No)
        </label>
        <input
          type="file"
          accept=".csv"
          style={styles.fileInput}
          onChange={(e) => setLedgerFile(e.target.files?.[0] || null)}
        />

        {importMsg && (
          <div
            style={{
              ...styles.message,
              marginTop: '12px',
              color: importMsg.startsWith('Import error') ? '#c8102e' : '#15803d',
            }}
          >
            {importMsg}
          </div>
        )}

        <button
          style={{
            ...styles.saveBtn,
            marginTop: '14px',
            ...(ready ? {} : styles.btnDisabled),
          }}
          disabled={!ready}
          onClick={() => onImport({ hdrFile, linesFile, ledgerFile })}
        >
          <Upload size={18} />
          {importing ? 'Importing...' : 'Import'}
        </button>
      </div>
    </div>
  );
}

// ---------- Edit view ----------
function EditView({
  shipment,
  lines,
  totalCases,
  qa,
  setQa,
  notes,
  setNotes,
  editShipTo,
  setEditShipTo,
  message,
  onSave,
  onPrint,
  onDownloadPdf,
  onEmail,
}) {
  const missingLots = lines.filter(
    (l) => !l.allocations || l.allocations.length === 0
  ).length;
  return (
    <>
      <div style={styles.reconBanner}>
        This BOL is being <strong>reconstructed</strong> from BC records. The
        printed document is stamped accordingly.
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Shipment</div>
        <KV label="Shipment #" value={shipment.shipment_no} />
        <KV label="Order #" value={shipment.order_no} />
        <KV label="Original ship date" value={formatDate(shipment.posting_date)} />
        <KV label="Carrier" value={shipment.carrier} />
        <KV label="Customer PO" value={shipment.customer_po} />
        <KV label="Tracking #" value={shipment.tracking_no} />
      </div>

      <div style={styles.section}>
        <div style={styles.lineHeadRow}>
          <div style={styles.sectionTitle}>Ship To</div>
          <button
            style={styles.linkAction}
            onClick={() =>
              setEditShipTo({
                name: shipment.ship_to_name || '',
                address: shipment.ship_to_address || '',
              })
            }
          >
            Reset to imported
          </button>
        </div>
        <label style={styles.fieldLabel}>Ship-to name</label>
        <input
          style={styles.input}
          value={editShipTo.name}
          onChange={(e) =>
            setEditShipTo({ ...editShipTo, name: e.target.value })
          }
          placeholder="Customer / consignee name"
        />
        <label style={styles.fieldLabel}>Ship-to address</label>
        <textarea
          style={styles.textarea}
          value={editShipTo.address}
          onChange={(e) =>
            setEditShipTo({ ...editShipTo, address: e.target.value })
          }
          placeholder="Street address, city, state, zip"
        />
        <p style={styles.helpHint}>
          Pre-filled from BC. Edit here if the imported address is wrong or
          missing — this is what prints and saves on the BOL.
        </p>
      </div>

      <div style={styles.section}>
        <div style={styles.lineHeadRow}>
          <div style={styles.sectionTitle}>Items &amp; Lots (from BC)</div>
          <span style={styles.pill}>{totalCases} cases total</span>
        </div>
        {missingLots > 0 && (
          <div style={styles.warnLine}>
            {missingLots} item{missingLots === 1 ? '' : 's'} did not have lot
            info in the item ledger. The lot column will be blank on those on
            the printed BOL.
          </div>
        )}
        {lines.length === 0 ? (
          <p style={{ color: '#9ca3af' }}>
            No lines found for this shipment.
          </p>
        ) : (
          lines.map((l, i) => (
            <div key={i} style={styles.lineCard}>
              <div style={styles.itemNo}>{l.item_no}</div>
              <div style={styles.itemDesc}>{l.description}</div>
              <div style={styles.lineRow}>
                <span>Qty: <strong>{l.quantity}</strong> {l.uom || ''}</span>
                {l.allocations && l.allocations.length > 0 ? (
                  <span style={styles.lotTags}>
                    {l.allocations.map((a, j) => (
                      <span key={j} style={styles.lotTag}>
                        Lot {a.lot_no}: {a.quantity}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span style={styles.noLot}>No lot info</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>QA verification (optional)</div>
        <label style={styles.fieldLabel}>Truck Temp</label>
        <input
          style={styles.input}
          value={qa.truckTemp}
          onChange={(e) => setQa({ ...qa, truckTemp: e.target.value })}
        />
        <label style={styles.fieldLabel}>Temp Logger</label>
        <input
          style={styles.input}
          value={qa.tempLogger}
          onChange={(e) => setQa({ ...qa, tempLogger: e.target.value })}
        />
        <label style={styles.fieldLabel}>Condition of Trailer</label>
        <input
          style={styles.input}
          value={qa.conditionOfTrailer}
          onChange={(e) => setQa({ ...qa, conditionOfTrailer: e.target.value })}
        />
        <label style={styles.fieldLabel}>Comments</label>
        <input
          style={styles.input}
          value={qa.comments}
          onChange={(e) => setQa({ ...qa, comments: e.target.value })}
        />
      </div>

      <div style={styles.section}>
        <label style={styles.fieldLabel}>Notes</label>
        <textarea
          style={styles.textarea}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any notes for the reconstructed BOL"
        />
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
        <button style={styles.saveBtn} onClick={onSave}>
          <Save size={18} />
          Save reconstruction
        </button>
        <button style={styles.printBtn} onClick={onPrint}>
          <Printer size={18} />
          Print
        </button>
      </div>
      <div style={styles.actionRow}>
        <button style={styles.altBtn} onClick={onDownloadPdf}>
          <Download size={18} />
          Download PDF
        </button>
        <button style={styles.emailBtn} onClick={onEmail}>
          <Mail size={18} />
          Email BOL
        </button>
      </div>
      <div style={{ height: '40px' }} />
    </>
  );
}

function KV({ label, value }) {
  return (
    <div style={styles.kvRow}>
      <span style={styles.kvLabel}>{label}</span>
      <span style={styles.kvValue}>{value || '\u2014'}</span>
    </div>
  );
}

// ---------- Printable El Pinto BOL (with Reconstructed footer) ----------
function BolDocument({ shipment, lines, totalCases, qa, notes, editShipTo }) {
  const printShipToName =
    (editShipTo && editShipTo.name) || shipment.ship_to_name || '';
  const printShipToAddr =
    (editShipTo && editShipTo.address) || shipment.ship_to_address || '';
  // Description of Goods: group by item
  const byItem = new Map();
  for (const l of lines) {
    const key = l.item_no || '';
    if (!byItem.has(key)) {
      byItem.set(key, {
        item_no: l.item_no,
        description: l.description,
        cases: 0,
      });
    }
    byItem.get(key).cases += Number(l.quantity) || 0;
  }
  const goods = Array.from(byItem.values());

  // BOL Detail: item / lot / qty rows
  const detailRows = [];
  for (const l of lines) {
    const allocs =
      l.allocations && l.allocations.length > 0
        ? l.allocations
        : [{ lot_no: '', quantity: l.quantity }];
    for (const a of allocs) {
      detailRows.push({
        item_no: l.item_no,
        lot_no: a.lot_no,
        quantity: a.quantity,
      });
    }
  }

  return (
    <div className="bol-page" style={styles.bolPage}>
      <div style={styles.bolTitle}>
        BOL: RECON-{shipment.shipment_no}
        <span style={styles.bolTitleDate}>
          Date: {formatDate(shipment.posting_date)}
        </span>
      </div>
      {shipment.order_no ? (
        <div style={styles.bolSalesOrder}>
          Sales Order #: {shipment.order_no}
        </div>
      ) : null}

      <table style={styles.infoTable}>
        <tbody>
          <tr>
            <td style={styles.infoCellTall}>
              <span style={styles.infoLabel}>Ship To:</span>
              <div style={styles.infoStrong}>{printShipToName}</div>
              <div style={styles.infoAddr}>{printShipToAddr}</div>
            </td>
            <td style={styles.infoCellTall}>
              <span style={styles.infoLabel}>Ship From:</span>
              <div style={styles.infoStrong}>El Pinto Foods LLC</div>
              <div style={styles.infoAddr}>
                10500 4th St NW{'\n'}Albuquerque, NM 87114
              </div>
            </td>
          </tr>
          <InfoPair
            shaded
            l={[
              shipment.customer_po ? 'Customer PO:' : 'Sales Order #:',
              shipment.customer_po || shipment.order_no,
            ]}
            r={['Tracking #:', shipment.tracking_no]}
          />
          <InfoPair
            l={['Carrier:', shipment.carrier]}
            r={['Truck Temp:', qa.truckTemp]}
          />
          <InfoPair
            shaded
            l={['Temp Logger:', qa.tempLogger]}
            r={['Total Cases:', totalCases]}
          />
        </tbody>
      </table>

      <div style={styles.bolHeading}>Description of Goods</div>
      <table style={styles.goodsTable}>
        <thead>
          <tr>
            <th style={styles.gTh}>Item Number</th>
            <th style={styles.gTh}>Description</th>
            <th style={styles.gThR}>Cases</th>
          </tr>
        </thead>
        <tbody>
          {goods.map((g, i) => (
            <tr key={i}>
              <td style={styles.gTd}>{g.item_no}</td>
              <td style={styles.gTd}>{g.description}</td>
              <td style={styles.gTdR}>{g.cases || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={styles.warning}>{TEMP_WARNING_DEFAULT}</div>

      <div style={styles.legalNote}>{LEGAL_NOTE}</div>
      <table style={styles.legalTable}>
        <tbody>
          <tr>
            <td style={styles.legalCell}>{CERT_LEFT}</td>
            <td style={styles.legalCell}>{CERT_RIGHT}</td>
          </tr>
        </tbody>
      </table>

      <div style={styles.bolHeading}>BOL Detail (Item Ledger)</div>
      <table style={styles.goodsTable}>
        <thead>
          <tr>
            <th style={styles.gTh}>Item Number</th>
            <th style={styles.gTh}>Lot Number</th>
            <th style={styles.gThR}>Quantity</th>
          </tr>
        </thead>
        <tbody>
          {detailRows.map((r, i) => (
            <tr key={i}>
              <td style={styles.gTd}>{r.item_no}</td>
              <td style={styles.gTd}>{r.lot_no}</td>
              <td style={styles.gTdR}>{r.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {notes ? (
        <div style={styles.legalNote}>
          <strong>Notes:</strong> {notes}
        </div>
      ) : null}

      {/* THE AUDIT-CRITICAL FOOTER */}
      <div style={styles.reconstructedFooter}>
        {reconstructedFooter(shipment.posting_date)}
      </div>
    </div>
  );
}

function InfoPair({ l, r, shaded }) {
  const cell = shaded
    ? { ...styles.infoCell, background: '#e8e8e8' }
    : styles.infoCell;
  return (
    <tr>
      <td style={cell}>
        <span style={styles.infoLabel}>{l[0]}</span>{' '}
        <span>{l[1] == null ? '' : String(l[1])}</span>
      </td>
      <td style={cell}>
        <span style={styles.infoLabel}>{r[0]}</span>{' '}
        <span>{r[1] == null ? '' : String(r[1])}</span>
      </td>
    </tr>
  );
}

// ---------- print CSS ----------
const printCss = `
@media screen {
  #historical-bol-print { position: absolute; left: -10000px; top: 0; }
}
@media print {
  @page { size: letter portrait; margin: 0.5in; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .screen-only { display: none !important; }
  #historical-bol-print { position: static !important; left: auto !important; }
}
`;

// ---------- styles ----------
const styles = {
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f8f8' },
  header: { backgroundColor: '#c8102e', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  headerInner: { maxWidth: '820px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' },
  backText: { fontSize: '13px', color: '#fff', fontWeight: '500' },
  titleArea: { display: 'flex', alignItems: 'center', gap: '8px' },
  headerTitle: { fontSize: '18px', fontWeight: '700', color: '#fff' },
  content: { flex: 1, maxWidth: '820px', width: '100%', margin: '0 auto', padding: '16px' },

  hint: { fontSize: '13px', color: '#6b7280', marginBottom: '12px', lineHeight: 1.4 },
  bcBar: { display: 'flex', gap: '8px', marginBottom: '12px' },
  bcSecondaryBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: '#fff', color: '#c8102e', border: '1px solid #fecdd3', borderRadius: '10px', padding: '12px 14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  searchWrap: { display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '16px', background: 'transparent' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px', textAlign: 'left', cursor: 'pointer', width: '100%' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  shipNo: { fontSize: '15px', fontWeight: '700', color: '#c8102e' },
  shipDate: { fontSize: '13px', color: '#6b7280' },
  shipCustomer: { fontSize: '15px', fontWeight: '600', marginTop: '4px' },
  shipMeta: { fontSize: '13px', color: '#6b7280', marginTop: '2px' },

  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginBottom: '12px' },
  sectionTitle: { fontSize: '13px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' },
  fieldLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px', marginTop: '10px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '15px', boxSizing: 'border-box', marginBottom: '4px' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '14px', boxSizing: 'border-box', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' },
  strong: { fontWeight: 700, fontSize: '15px' },
  addr: { fontSize: '13px', color: '#374151', whiteSpace: 'pre-wrap', marginTop: '4px' },
  linkAction: { background: 'transparent', border: 'none', color: '#c8102e', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' },
  helpHint: { fontSize: '12px', color: '#6b7280', marginTop: '6px', lineHeight: 1.4 },

  kvRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f3f4f6', fontSize: '13px' },
  kvLabel: { color: '#6b7280', fontWeight: 500 },
  kvValue: { fontWeight: 700, textAlign: 'right' },

  lineHeadRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' },
  pill: { fontSize: '12px', fontWeight: 700, background: '#f3f4f6', color: '#374151', borderRadius: '999px', padding: '2px 10px' },
  warnLine: { fontSize: '13px', color: '#a16207', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px' },
  lineCard: { border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px', marginBottom: '10px', background: '#fafafa' },
  itemNo: { fontSize: '14px', fontWeight: '700' },
  itemDesc: { fontSize: '13px', color: '#6b7280', marginTop: '2px', marginBottom: '6px' },
  lineRow: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', fontSize: '13px' },
  lotTags: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  lotTag: { fontSize: '11px', fontWeight: 700, background: '#ecfdf5', color: '#065f46', border: '1px solid #99f6e4', borderRadius: '6px', padding: '2px 8px' },
  noLot: { fontSize: '12px', color: '#a16207' },

  message: { fontSize: '14px', fontWeight: '600', marginBottom: '10px' },
  actionRow: { display: 'flex', gap: '10px', marginTop: '10px' },
  saveBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  printBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '12px', padding: '13px 20px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  altBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  emailBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { background: '#d1d5db', cursor: 'not-allowed' },
  reconBanner: { background: '#fef3c7', color: '#78350f', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 12px', fontSize: '13px', marginBottom: '14px' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200 },
  modal: { background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '600px', maxHeight: '80vh', padding: '16px', display: 'flex', flexDirection: 'column' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  modalTitle: { fontSize: '17px', fontWeight: '700' },
  iconBtn: { background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px' },
  helpText: { fontSize: '13px', color: '#6b7280', marginBottom: '10px' },
  fileLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', margin: '10px 0 6px' },
  fileInput: { width: '100%', fontSize: '14px' },

  // ----- printable BOL -----
  bolPage: { width: '7.5in', color: '#000', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '11px' },
  bolTitle: { fontSize: '20px', fontWeight: '700' },
  bolTitleDate: { marginLeft: '24px' },
  bolSalesOrder: { fontSize: '14px', fontWeight: '600', marginBottom: '10px', color: '#444' },

  infoTable: { width: '100%', borderCollapse: 'collapse', border: '1px solid #999', marginBottom: '12px', tableLayout: 'fixed' },
  infoCellTall: { border: '1px solid #ccc', padding: '6px 8px', verticalAlign: 'top', width: '50%' },
  infoCell: { border: '1px solid #ccc', padding: '4px 8px', verticalAlign: 'top', width: '50%', fontSize: '11px' },
  infoLabel: { fontWeight: '700' },
  infoStrong: { fontWeight: '700', fontSize: '12px', marginTop: '2px' },
  infoAddr: { fontSize: '11px', whiteSpace: 'pre-wrap' },

  bolHeading: { fontSize: '17px', fontWeight: '700', margin: '14px 0 6px' },
  goodsTable: { width: '100%', borderCollapse: 'collapse', marginBottom: '10px' },
  gTh: { border: '1px solid #999', padding: '5px 6px', textAlign: 'left', background: '#f0f0f0', fontSize: '10px', fontFamily: 'Arial, sans-serif' },
  gThR: { border: '1px solid #999', padding: '5px 6px', textAlign: 'right', background: '#f0f0f0', fontSize: '10px', fontFamily: 'Arial, sans-serif' },
  gTd: { border: '1px solid #ccc', padding: '4px 6px', fontSize: '11px', fontFamily: 'Arial, sans-serif' },
  gTdR: { border: '1px solid #ccc', padding: '4px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'Arial, sans-serif' },

  warning: { fontWeight: '700', fontSize: '15px', margin: '14px 0', lineHeight: 1.3 },
  legalNote: { border: '1px solid #999', padding: '6px', fontSize: '10px', fontFamily: 'Arial, sans-serif', marginBottom: '10px' },
  legalTable: { width: '100%', borderCollapse: 'collapse', marginBottom: '12px', tableLayout: 'fixed' },
  legalCell: { border: '1px solid #999', padding: '6px', fontSize: '9px', verticalAlign: 'top', width: '50%', fontFamily: 'Arial, sans-serif' },

  reconstructedFooter: { marginTop: '18px', paddingTop: '10px', borderTop: '1px solid #000', fontSize: '10px', fontStyle: 'italic', color: '#000', fontFamily: 'Arial, sans-serif' },
};