import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';
import JsBarcode from 'jsbarcode';
import {
  ChevronLeft,
  Search,
  Printer,
  Download,
  X,
  PackageCheck,
} from 'lucide-react';

// ---------- helpers ----------
function formatDate(d) {
  if (!d) return '\u2014';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Code128 barcode as SVG, reused in preview + every printed/exported copy.
// Encodes the plain item number only — scanners read it as the SKU, which
// is what the warehouse workflow (and downstream Power Apps / BC lookup)
// expects. Lot / qty / exp are still printed as text on the label.
function makeBarcodeSvg(value) {
  if (!value) return '';
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, String(value), {
      format: 'CODE128',
      displayValue: true, // show the item number under the bars for human eyes
      fontSize: 14,
      textMargin: 2,
      height: 55,
      width: 2,
      margin: 0,
    });
    return svg.outerHTML;
  } catch (e) {
    return '';
  }
}

// ---------- the 4x6 label face (used on screen + when printing/exporting) ----------
function TagFace({ data, barcodeSvg, index, total, numberEach }) {
  const showBagCount = numberEach && total && total > 1;
  return (
    <div className="recv-tag-face" style={styles.tagFace}>
      <div style={styles.tagHeader}>
        <span style={styles.tagBrand}>EL PINTO FOODS</span>
        <span style={styles.tagType}>RECEIVING TAG</span>
        {showBagCount ? (
          <span style={styles.tagBagBadge}>
            {index + 1} of {total}
          </span>
        ) : null}
      </div>

      <div style={styles.tagBody}>
        <div>
          <div style={styles.tagLabel}>Vendor</div>
          <div style={styles.tagShipTo}>{data.vendor || '\u2014'}</div>
        </div>

        <div style={styles.tagRow}>
          <div style={{ flex: 1 }}>
            <div style={styles.tagLabel}>Receipt #</div>
            <div style={styles.tagValue}>{data.receiptNo || '\u2014'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={styles.tagLabel}>Date Received</div>
            <div style={styles.tagValue}>{formatDate(data.receivedDate)}</div>
          </div>
        </div>

        <div style={styles.tagDivider} />

        <div>
          <div style={styles.tagLabel}>Item</div>
          <div style={styles.tagItemNo}>{data.itemNo || '\u2014'}</div>
          {data.description ? (
            <div style={styles.tagDesc}>{data.description}</div>
          ) : null}
        </div>

        <div style={styles.tagRow}>
          <div style={{ flex: 2 }}>
            <div style={styles.tagLabel}>Lot #</div>
            <div style={styles.tagLotNo}>{data.lotNo || '\u2014'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={styles.tagLabel}>Expiration</div>
            <div style={styles.tagValue}>{formatDate(data.expirationDate)}</div>
          </div>
        </div>

        <div style={styles.tagQtyRow}>
          <span style={styles.tagQtyLabel}>QTY</span>
          <span style={styles.tagQtyValue}>{data.qty || '\u2014'}</span>
          <span style={styles.tagUom}>{data.uom || ''}</span>
        </div>

        <div
          style={styles.tagBarcode}
          dangerouslySetInnerHTML={{ __html: barcodeSvg }}
        />
      </div>
    </div>
  );
}

// ---------- print CSS: one 4x6 page per copy, nothing else ----------
const printCss = `
@media screen {
  #recv-tag-print { position: absolute; left: -10000px; top: 0; }
}
@media print {
  @page { size: 4in 6in; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .screen-only { display: none !important; }
  #recv-tag-print { position: static !important; left: auto !important; }
  .recv-tag-face { page-break-after: always; break-after: page; }
  .recv-tag-face:last-child { page-break-after: auto; break-after: auto; }
}
`;

// ---------- main page ----------
export default function ReceivingTags() {
  const navigate = useNavigate();

  // Catalog for item picker
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Recent receipts for autofill
  const [recentReceipts, setRecentReceipts] = useState([]);

  const [selectedItemNo, setSelectedItemNo] = useState(null);

  // Form fields
  const [vendor, setVendor] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [lotNo, setLotNo] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [qty, setQty] = useState('');
  const [uom, setUom] = useState('CASE');
  const [description, setDescription] = useState('');
  const [receivedDate, setReceivedDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [copies, setCopies] = useState(1);
  const [numberEach, setNumberEach] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [searchParams] = useSearchParams();

  useEffect(() => {
    loadItems();
    loadRecentReceipts();
  }, []);

  // If arriving with ?fromReceiptLine=<uuid>, pull that specific line from
  // procurement.receipt_lines (joined to its header) and pre-fill the form.
  // Copies default to the line's quantity so "5 bags = 5 labels" out of the box.
  useEffect(() => {
    const lineId = searchParams.get('fromReceiptLine');
    if (!lineId) return;
    (async () => {
      try {
        const { data: line, error } = await supabase
          .schema('procurement')
          .from('receipt_lines')
          .select('*')
          .eq('id', lineId)
          .single();
        if (error || !line) return;

        const { data: header } = await supabase
          .schema('procurement')
          .from('receipts')
          .select('receipt_number, vendor_name, received_date')
          .eq('id', line.receipt_id)
          .single();

        setSelectedItemNo(line.item_no || '');
        setDescription(line.description || '');
        setLotNo(line.lot_no || '');
        setExpirationDate(line.expiration_date || '');
        setQty(String(line.quantity ?? ''));
        setUom(line.uom || 'CASE');
        if (header) {
          setReceiptNo(header.receipt_number || '');
          setVendor(header.vendor_name || '');
          if (header.received_date) setReceivedDate(header.received_date);
        }
        // Default copies to the received quantity (common case: 5 bags → 5 labels)
        const qtyNum = Number(line.quantity);
        if (Number.isFinite(qtyNum) && qtyNum > 0) {
          setCopies(Math.min(50, Math.round(qtyNum)));
        }
      } catch (e) {
        // silent — line may be gone
      }
    })();
  }, [searchParams]);

  async function loadItems() {
    setLoading(true);
    const { data, error } = await supabase
      .from('items')
      .select('item_no, description')
      .order('item_no')
      .limit(5000);
    if (!error) setItems(data || []);
    setLoading(false);
  }

  async function loadRecentReceipts() {
    const { data } = await supabase
      .schema('procurement')
      .from('receipts')
      .select('id, receipt_number, vendor_name, received_date')
      .order('received_date', { ascending: false })
      .limit(50);
    setRecentReceipts(data || []);
  }

  // Unique items for picker (your items table has one row per lot)
  const uniqueItems = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.item_no)) {
        map.set(it.item_no, {
          item_no: it.item_no,
          description: it.description,
        });
      }
    }
    return Array.from(map.values());
  }, [items]);

  const filtered = useMemo(() => {
    let list = uniqueItems;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (it) =>
          it.item_no.toLowerCase().includes(q) ||
          (it.description || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 50);
  }, [uniqueItems, search]);

  function selectItem(it) {
    setSelectedItemNo(it.item_no);
    setDescription(it.description || '');
  }

  function clearSelection() {
    setSelectedItemNo(null);
    setDescription('');
  }

  function pickRecentReceipt(r) {
    if (!r) return;
    setReceiptNo(r.receipt_number || '');
    setVendor(r.vendor_name || '');
    if (r.received_date) setReceivedDate(r.received_date);
  }

  const tagData = {
    vendor,
    receiptNo,
    receivedDate,
    itemNo: selectedItemNo || '',
    description,
    lotNo,
    expirationDate: expirationDate || null,
    qty,
    uom,
  };

  // Barcode encodes just the item number — scanners resolve it to the SKU
  const barcodeValue = tagData.itemNo || '';
  const barcodeSvg = useMemo(() => makeBarcodeSvg(barcodeValue), [barcodeValue]);

  const copyCount = Math.max(1, Math.min(50, Number(copies) || 1));
  const canOutput =
    selectedItemNo && String(qty).trim() !== '' && lotNo.trim() !== '';

  function handlePrint() {
    if (!canOutput) return;
    window.print();
  }

  // --- PDF download: render each label to canvas then jsPDF ---
  // html2canvas and jspdf are loaded dynamically from a CDN rather than
  // being bundled npm deps — same pattern as pdfHelper.js elsewhere in
  // this app, so we don't have to touch package.json.
  async function handleDownloadPdf() {
    if (!canOutput) return;
    setDownloading(true);
    try {
      const [{ default: html2canvas }, jspdfMod] = await Promise.all([
        import('https://esm.sh/html2canvas@1.4.1'),
        import('https://esm.sh/jspdf@2.5.1'),
      ]);
      const { jsPDF } = jspdfMod;

      // 4x6 inches
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'in',
        format: [4, 6],
      });
      // Grab the printable copies DOM (hidden offscreen but rendered)
      const container = document.getElementById('recv-tag-print');
      if (!container) throw new Error('Print container missing');
      const faces = container.querySelectorAll('.recv-tag-face');
      for (let i = 0; i < faces.length; i++) {
        const el = faces[i];
        const canvas = await html2canvas(el, {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
        });
        const imgData = canvas.toDataURL('image/png');
        if (i > 0) pdf.addPage([4, 6], 'portrait');
        pdf.addImage(imgData, 'PNG', 0, 0, 4, 6);
      }
      const safeItem = (selectedItemNo || 'label').replace(/[^A-Za-z0-9_-]/g, '_');
      const safeLot = (lotNo || 'lot').replace(/[^A-Za-z0-9_-]/g, '_');
      pdf.save(`RecvTag_${safeItem}_${safeLot}.pdf`);
    } catch (e) {
      alert('Could not generate PDF: ' + (e.message || 'unknown'));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <style>{printCss}</style>

      {/* ===== On-screen editor (hidden when printing) ===== */}
      <div className="screen-only" style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerInner}>
            <button style={styles.backButton} onClick={() => navigate('/')}>
              <ChevronLeft size={20} color="#fff" />
              <span style={styles.backText}>Home</span>
            </button>
            <div style={styles.titleArea}>
              <PackageCheck size={18} color="#fff" />
              <span style={styles.headerTitle}>Receiving Tags</span>
            </div>
            <div style={{ width: '70px' }} />
          </div>
        </div>

        <div style={styles.content}>
          {/* Step 1: choose an item */}
          {!selectedItemNo ? (
            <>
              <h2 style={styles.pageTitle}>Create a Receiving Tag</h2>
              <p style={styles.sub}>
                Pick the item you're receiving. You'll fill in lot, qty, and
                vendor next.
              </p>

              <div style={styles.searchWrap}>
                <Search size={18} color="#9ca3af" />
                <input
                  style={styles.searchInput}
                  placeholder="Search item # or description..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {loading ? (
                <p style={{ color: '#6b7280' }}>Loading items...</p>
              ) : filtered.length === 0 ? (
                <p style={{ color: '#9ca3af' }}>No items match that search.</p>
              ) : (
                <div style={styles.list}>
                  {filtered.map((it) => (
                    <button
                      key={it.item_no}
                      style={styles.itemRow}
                      onClick={() => selectItem(it)}
                    >
                      <span style={styles.itemNo}>{it.item_no}</span>
                      <span style={styles.itemDesc}>{it.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Selected item chip */}
              <div style={styles.selectedChip}>
                <div>
                  <div style={styles.itemNo}>{selectedItemNo}</div>
                  <div style={styles.itemDesc}>{description}</div>
                </div>
                <button style={styles.changeBtn} onClick={clearSelection}>
                  <X size={16} />
                  Change
                </button>
              </div>

              {/* Receipt autofill (optional) */}
              {recentReceipts.length > 0 ? (
                <div style={styles.section}>
                  <label style={styles.fieldLabel}>
                    Autofill from recent receipt (optional)
                  </label>
                  <select
                    style={styles.input}
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      const r = recentReceipts.find((x) => x.id === id);
                      pickRecentReceipt(r);
                    }}
                  >
                    <option value="">Pick a receipt to autofill...</option>
                    {recentReceipts.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.receipt_number} — {r.vendor_name || '(no vendor)'} —{' '}
                        {r.received_date}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div style={styles.section}>
                <label style={styles.fieldLabel}>Vendor</label>
                <input
                  style={styles.input}
                  placeholder="e.g. YG Chile"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />

                <label style={styles.fieldLabel}>Receipt #</label>
                <input
                  style={styles.input}
                  placeholder="e.g. EPREC-2026-0042"
                  value={receiptNo}
                  onChange={(e) => setReceiptNo(e.target.value)}
                />

                <label style={styles.fieldLabel}>Date Received</label>
                <input
                  style={styles.input}
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                />
              </div>

              <div style={styles.section}>
                <label style={styles.fieldLabel}>Description (override)</label>
                <input
                  style={styles.input}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />

                <label style={styles.fieldLabel}>Lot # *</label>
                <input
                  style={styles.input}
                  placeholder="e.g. 20260308-A"
                  value={lotNo}
                  onChange={(e) => setLotNo(e.target.value)}
                />

                <label style={styles.fieldLabel}>Expiration date</label>
                <input
                  style={styles.input}
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                />

                <div style={styles.twoCol}>
                  <div style={{ flex: 1 }}>
                    <label style={styles.fieldLabel}>Quantity *</label>
                    <input
                      style={styles.input}
                      type="number"
                      inputMode="decimal"
                      placeholder="0"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                    />
                  </div>
                  <div style={{ width: '110px' }}>
                    <label style={styles.fieldLabel}>UOM</label>
                    <input
                      style={styles.input}
                      placeholder="CASE"
                      value={uom}
                      onChange={(e) => setUom(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div style={styles.section}>
                <label style={styles.fieldLabel}>Copies</label>
                <input
                  style={{ ...styles.input, width: '140px' }}
                  type="number"
                  min="1"
                  max="50"
                  value={copies}
                  onChange={(e) => setCopies(e.target.value)}
                />
                <p style={styles.hint}>
                  Use one copy per physical bag, case, or pallet.
                </p>

                <label style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={numberEach}
                    onChange={(e) => setNumberEach(e.target.checked)}
                  />
                  <span>Number each label ("Bag 1 of 5", "Bag 2 of 5", ...)</span>
                </label>
                <p style={styles.hint}>
                  Off: every label is identical. On: each gets a sequence
                  badge for better pallet counting and per-bag traceability.
                </p>
              </div>

              {/* Live preview */}
              <div style={styles.fieldLabel}>Preview (4" × 6")</div>
              <div style={styles.previewWrap}>
                <TagFace
                  data={tagData}
                  barcodeSvg={barcodeSvg}
                  index={0}
                  total={copyCount}
                  numberEach={numberEach}
                />
              </div>

              <div style={styles.actionRow}>
                <button
                  style={{
                    ...styles.printBtn,
                    ...(canOutput ? {} : styles.printBtnDisabled),
                  }}
                  onClick={handlePrint}
                  disabled={!canOutput}
                >
                  <Printer size={18} />
                  {canOutput
                    ? `Print${copyCount > 1 ? ` (${copyCount})` : ''}`
                    : 'Fill required fields'}
                </button>
                <button
                  style={{
                    ...styles.downloadBtn,
                    ...(canOutput ? {} : styles.printBtnDisabled),
                  }}
                  onClick={handleDownloadPdf}
                  disabled={!canOutput || downloading}
                >
                  <Download size={18} />
                  {downloading
                    ? 'Generating...'
                    : `Download PDF${copyCount > 1 ? ` (${copyCount})` : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== Print-only copies ===== */}
      <div id="recv-tag-print">
        {Array.from({ length: copyCount }).map((_, i) => (
          <TagFace
            key={i}
            data={tagData}
            barcodeSvg={barcodeSvg}
            index={i}
            total={copyCount}
            numberEach={numberEach}
          />
        ))}
      </div>
    </>
  );
}

// ---------- styles ----------
const styles = {
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f8f8' },
  header: { backgroundColor: '#c8102e', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  headerInner: { maxWidth: '700px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', minHeight: '36px' },
  backText: { fontSize: '13px', color: '#fff', fontWeight: '500' },
  titleArea: { display: 'flex', alignItems: 'center', gap: '8px' },
  headerTitle: { fontSize: '18px', fontWeight: '700', color: '#fff' },
  content: { flex: 1, maxWidth: '700px', width: '100%', margin: '0 auto', padding: '20px 16px' },
  pageTitle: { fontSize: '22px', fontWeight: '700', marginBottom: '4px' },
  sub: { fontSize: '14px', color: '#6b7280', marginBottom: '16px' },
  searchWrap: { display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', marginBottom: '12px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '16px', background: 'transparent' },
  list: { display: 'flex', flexDirection: 'column', gap: '6px' },
  itemRow: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer', textAlign: 'left', width: '100%' },
  itemNo: { fontSize: '15px', fontWeight: '600', color: '#1a1a1a' },
  itemDesc: { fontSize: '13px', color: '#6b7280' },
  selectedChip: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px' },
  changeBtn: { display: 'flex', alignItems: 'center', gap: '4px', background: '#f3f4f6', border: 'none', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontWeight: '500', color: '#374151', cursor: 'pointer' },
  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginBottom: '16px' },
  fieldLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px', marginTop: '12px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '12px 14px', fontSize: '16px', boxSizing: 'border-box' },
  twoCol: { display: 'flex', gap: '12px', alignItems: 'flex-end' },
  hint: { fontSize: '12px', color: '#6b7280', marginTop: '6px' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', fontSize: '14px', fontWeight: '500', color: '#374151', cursor: 'pointer' },
  previewWrap: { display: 'flex', justifyContent: 'center', padding: '16px', background: '#eef0f2', borderRadius: '12px', overflowX: 'auto', marginBottom: '16px' },
  actionRow: { display: 'flex', gap: '10px', marginBottom: '32px' },
  printBtn: { flex: 1, background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' },
  downloadBtn: { flex: 1, background: '#065f46', color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' },
  printBtnDisabled: { background: '#d1d5db', color: '#6b7280', cursor: 'not-allowed' },

  // ----- 4x6 tag face -----
  tagFace: { width: '4in', height: '6in', boxSizing: 'border-box', background: '#fff', color: '#000', border: '1px solid #000', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif' },
  tagHeader: { background: '#c8102e', color: '#fff', padding: '10px 14px', display: 'flex', flexDirection: 'column' },
  tagBrand: { fontSize: '20px', fontWeight: '800', letterSpacing: '0.5px' },
  tagType: { fontSize: '12px', fontWeight: '600', letterSpacing: '2px' },
  tagBagBadge: { alignSelf: 'flex-end', background: '#fff', color: '#c8102e', fontSize: '14px', fontWeight: '800', padding: '3px 10px', borderRadius: '6px', marginTop: '4px' },
  tagBody: { flex: 1, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' },
  tagLabel: { fontSize: '10px', fontWeight: '700', color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px' },
  tagShipTo: { fontSize: '20px', fontWeight: '700', lineHeight: 1.1 },
  tagValue: { fontSize: '15px', fontWeight: '600' },
  tagRow: { display: 'flex', gap: '10px' },
  tagDivider: { borderTop: '2px solid #000', margin: '2px 0' },
  tagItemNo: { fontSize: '30px', fontWeight: '800', lineHeight: 1 },
  tagLotNo: { fontSize: '22px', fontWeight: '800', lineHeight: 1.05, letterSpacing: '0.5px' },
  tagDesc: { fontSize: '13px', fontWeight: '500' },
  tagQtyRow: { display: 'flex', alignItems: 'baseline', gap: '8px', border: '2px solid #000', borderRadius: '6px', padding: '6px 10px' },
  tagQtyLabel: { fontSize: '12px', fontWeight: '700' },
  tagQtyValue: { fontSize: '34px', fontWeight: '800' },
  tagUom: { fontSize: '16px', fontWeight: '700' },
  tagBarcode: { marginTop: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-end' },
};