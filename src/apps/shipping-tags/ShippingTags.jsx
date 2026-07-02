import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';
import JsBarcode from 'jsbarcode';
import { ChevronLeft, Search, Printer, X } from 'lucide-react';

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

// Render a Code128 barcode to an SVG markup string (reused in preview + every printed copy).
function makeBarcodeSvg(value) {
  if (!value) return '';
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, String(value), {
      format: 'CODE128',
      displayValue: true,
      fontSize: 16,
      textMargin: 2,
      height: 60,
      width: 2,
      margin: 0,
    });
    return svg.outerHTML;
  } catch (e) {
    return '';
  }
}

// ---------- the 4x6 label face (used on screen + when printing) ----------
function TagFace({ data, barcodeSvg }) {
  return (
    <div className="ship-tag-face" style={styles.tagFace}>
      <div style={styles.tagHeader}>
        <span style={styles.tagBrand}>EL PINTO FOODS</span>
        <span style={styles.tagType}>SHIPPING TAG</span>
      </div>

      <div style={styles.tagBody}>
        <div>
          <div style={styles.tagLabel}>Ship To</div>
          <div style={styles.tagShipTo}>{data.shipTo || '\u2014'}</div>
        </div>

        <div style={styles.tagRow}>
          <div style={{ flex: 1 }}>
            <div style={styles.tagLabel}>PO / Order #</div>
            <div style={styles.tagValue}>{data.poNumber || '\u2014'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={styles.tagLabel}>Ship Date</div>
            <div style={styles.tagValue}>{formatDate(data.shipDate)}</div>
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
          <div style={{ flex: 1 }}>
            <div style={styles.tagLabel}>Lot #</div>
            <div style={styles.tagValue}>{data.lotNo || '\u2014'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={styles.tagLabel}>Best By</div>
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
  #ship-tag-print { position: absolute; left: -10000px; top: 0; }
}
@media print {
  @page { size: 4in 6in; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .screen-only { display: none !important; }
  #ship-tag-print { position: static !important; left: auto !important; }
  .ship-tag-face { page-break-after: always; break-after: page; }
  .ship-tag-face:last-child { page-break-after: auto; break-after: auto; }
}
`;

// ---------- main page ----------
export default function ShippingTags() {
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [selectedItemNo, setSelectedItemNo] = useState(null);
  const [selectedLot, setSelectedLot] = useState(null);

  const [shipTo, setShipTo] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [qty, setQty] = useState('');
  const [uom, setUom] = useState('');
  const [shipDate, setShipDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [barcodeSource, setBarcodeSource] = useState('item'); // 'item' | 'lot'
  const [copies, setCopies] = useState(1);

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    setLoading(true);
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('item_no')
      .limit(5000);
    if (!error) setItems(data || []);
    setLoading(false);
  }

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

  const lotsForItem = useMemo(
    () =>
      selectedItemNo ? items.filter((it) => it.item_no === selectedItemNo) : [],
    [items, selectedItemNo]
  );

  function selectItem(itemNo) {
    setSelectedItemNo(itemNo);
    setSelectedLot(null);
    const lots = items.filter((it) => it.item_no === itemNo);
    if (lots.length === 1) chooseLot(lots[0]);
  }

  function chooseLot(lot) {
    setSelectedLot(lot);
    setUom(lot.uom || '');
  }

  function clearSelection() {
    setSelectedItemNo(null);
    setSelectedLot(null);
    setUom('');
  }

  const barcodeValue =
    barcodeSource === 'lot'
      ? selectedLot?.lot_no || ''
      : selectedLot?.item_no || selectedItemNo || '';

  const barcodeSvg = useMemo(
    () => makeBarcodeSvg(barcodeValue),
    [barcodeValue]
  );

  const tagData = {
    shipTo,
    poNumber,
    shipDate,
    itemNo: selectedLot?.item_no || selectedItemNo || '',
    description: selectedLot?.description || '',
    lotNo: selectedLot?.lot_no || '',
    expirationDate: selectedLot?.expiration_date || null,
    qty,
    uom,
  };

  const copyCount = Math.max(1, Math.min(50, Number(copies) || 1));
  const canPrint =
    selectedLot && String(qty).trim() !== '' && shipTo.trim() !== '';

  function handlePrint() {
    if (!canPrint) return;
    window.print();
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
              <span style={styles.headerIcon}>🏷️</span>
              <span style={styles.headerTitle}>Shipping Tags</span>
            </div>
            <div style={{ width: '70px' }} />
          </div>
        </div>

        <div style={styles.content}>
          {/* Step 1: choose an item */}
          {!selectedItemNo ? (
            <>
              <h2 style={styles.pageTitle}>Create a Shipping Tag</h2>
              <p style={styles.sub}>Pick the item you're shipping.</p>

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
                      onClick={() => selectItem(it.item_no)}
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
                  <div style={styles.itemDesc}>
                    {lotsForItem[0]?.description || ''}
                  </div>
                </div>
                <button style={styles.changeBtn} onClick={clearSelection}>
                  <X size={16} />
                  Change
                </button>
              </div>

              {/* Step 2: pick a lot if more than one */}
              {lotsForItem.length > 1 && (
                <div style={styles.section}>
                  <div style={styles.fieldLabel}>Lot / Bin</div>
                  <div style={styles.lotList}>
                    {lotsForItem.map((lot) => {
                      const active = selectedLot && selectedLot.id === lot.id;
                      return (
                        <button
                          key={lot.id}
                          style={{
                            ...styles.lotBtn,
                            ...(active ? styles.lotBtnActive : {}),
                          }}
                          onClick={() => chooseLot(lot)}
                        >
                          <span style={{ fontWeight: 600 }}>
                            Lot {lot.lot_no || '\u2014'}
                          </span>
                          <span style={styles.lotMeta}>
                            Bin {lot.bin_code || '\u2014'} · Best by{' '}
                            {formatDate(lot.expiration_date)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 3: shipment details */}
              {selectedLot && (
                <>
                  <div style={styles.section}>
                    <label style={styles.fieldLabel}>Ship To / Customer</label>
                    <input
                      style={styles.input}
                      placeholder="e.g. Sysco Albuquerque"
                      value={shipTo}
                      onChange={(e) => setShipTo(e.target.value)}
                    />

                    <label style={styles.fieldLabel}>PO / Order #</label>
                    <input
                      style={styles.input}
                      placeholder="e.g. SO-10482"
                      value={poNumber}
                      onChange={(e) => setPoNumber(e.target.value)}
                    />

                    <div style={styles.twoCol}>
                      <div style={{ flex: 1 }}>
                        <label style={styles.fieldLabel}>Quantity</label>
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
                          placeholder="CS"
                          value={uom}
                          onChange={(e) => setUom(e.target.value)}
                        />
                      </div>
                    </div>

                    <label style={styles.fieldLabel}>Ship Date</label>
                    <input
                      style={styles.input}
                      type="date"
                      value={shipDate}
                      onChange={(e) => setShipDate(e.target.value)}
                    />
                  </div>

                  {/* Barcode + copies controls */}
                  <div style={styles.section}>
                    <div style={styles.fieldLabel}>Barcode encodes</div>
                    <div style={styles.toggleRow}>
                      <button
                        style={{
                          ...styles.toggleBtn,
                          ...(barcodeSource === 'item'
                            ? styles.toggleActive
                            : {}),
                        }}
                        onClick={() => setBarcodeSource('item')}
                      >
                        Item #
                      </button>
                      <button
                        style={{
                          ...styles.toggleBtn,
                          ...(barcodeSource === 'lot'
                            ? styles.toggleActive
                            : {}),
                        }}
                        onClick={() => setBarcodeSource('lot')}
                        disabled={!selectedLot?.lot_no}
                      >
                        Lot #
                      </button>
                    </div>

                    <div style={styles.twoCol}>
                      <div style={{ width: '140px' }}>
                        <label style={styles.fieldLabel}>Copies</label>
                        <input
                          style={styles.input}
                          type="number"
                          min="1"
                          max="50"
                          value={copies}
                          onChange={(e) => setCopies(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Live preview */}
                  <div style={styles.fieldLabel}>
                    Preview (4&quot; × 6&quot;)
                  </div>
                  <div style={styles.previewWrap}>
                    <TagFace data={tagData} barcodeSvg={barcodeSvg} />
                  </div>

                  <button
                    style={{
                      ...styles.printBtn,
                      ...(canPrint ? {} : styles.printBtnDisabled),
                    }}
                    onClick={handlePrint}
                    disabled={!canPrint}
                  >
                    <Printer size={20} />
                    {canPrint
                      ? `Print Tag${copyCount > 1 ? ` (${copyCount})` : ''}`
                      : 'Fill in ship-to and quantity to print'}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ===== Print-only copies ===== */}
      <div id="ship-tag-print">
        {Array.from({ length: copyCount }).map((_, i) => (
          <TagFace key={i} data={tagData} barcodeSvg={barcodeSvg} />
        ))}
      </div>
    </>
  );
}

// ---------- styles ----------
const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#f8f8f8',
  },
  header: {
    backgroundColor: '#c8102e',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  headerInner: {
    maxWidth: '700px',
    margin: '0 auto',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    borderRadius: '8px',
    padding: '6px 10px',
    cursor: 'pointer',
    minHeight: '36px',
  },
  backText: { fontSize: '13px', color: '#fff', fontWeight: '500' },
  titleArea: { display: 'flex', alignItems: 'center', gap: '8px' },
  headerIcon: { fontSize: '20px' },
  headerTitle: { fontSize: '18px', fontWeight: '700', color: '#fff' },
  content: {
    flex: 1,
    maxWidth: '700px',
    width: '100%',
    margin: '0 auto',
    padding: '20px 16px',
  },
  pageTitle: { fontSize: '22px', fontWeight: '700', marginBottom: '4px' },
  sub: { fontSize: '14px', color: '#6b7280', marginBottom: '16px' },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '10px 12px',
    marginBottom: '12px',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    fontSize: '16px',
    background: 'transparent',
  },
  list: { display: 'flex', flexDirection: 'column', gap: '6px' },
  itemRow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '12px 14px',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
  },
  itemNo: { fontSize: '15px', fontWeight: '600', color: '#1a1a1a' },
  itemDesc: { fontSize: '13px', color: '#6b7280' },
  selectedChip: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '14px 16px',
    marginBottom: '16px',
  },
  changeBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    background: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '13px',
    fontWeight: '500',
    color: '#374151',
    cursor: 'pointer',
  },
  section: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '16px',
  },
  fieldLabel: {
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
    boxSizing: 'border-box',
  },
  twoCol: { display: 'flex', gap: '12px', alignItems: 'flex-end' },
  lotList: { display: 'flex', flexDirection: 'column', gap: '6px' },
  lotBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '10px 12px',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
  },
  lotBtnActive: { borderColor: '#c8102e', background: '#fff1f2' },
  lotMeta: { fontSize: '12px', color: '#6b7280' },
  toggleRow: { display: 'flex', gap: '8px', marginBottom: '4px' },
  toggleBtn: {
    flex: 1,
    background: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '10px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    cursor: 'pointer',
  },
  toggleActive: {
    background: '#c8102e',
    borderColor: '#c8102e',
    color: '#fff',
  },
  previewWrap: {
    display: 'flex',
    justifyContent: 'center',
    padding: '16px',
    background: '#eef0f2',
    borderRadius: '12px',
    overflowX: 'auto',
    marginBottom: '16px',
  },
  printBtn: {
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
    marginBottom: '32px',
  },
  printBtnDisabled: { background: '#d1d5db', cursor: 'not-allowed' },

  // ----- 4x6 tag face -----
  tagFace: {
    width: '4in',
    height: '6in',
    boxSizing: 'border-box',
    background: '#fff',
    color: '#000',
    border: '1px solid #000',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'Arial, Helvetica, sans-serif',
  },
  tagHeader: {
    background: '#c8102e',
    color: '#fff',
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
  },
  tagBrand: { fontSize: '20px', fontWeight: '800', letterSpacing: '0.5px' },
  tagType: { fontSize: '12px', fontWeight: '600', letterSpacing: '2px' },
  tagBody: {
    flex: 1,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  tagLabel: {
    fontSize: '10px',
    fontWeight: '700',
    color: '#444',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  tagShipTo: { fontSize: '20px', fontWeight: '700', lineHeight: 1.1 },
  tagValue: { fontSize: '15px', fontWeight: '600' },
  tagRow: { display: 'flex', gap: '10px' },
  tagDivider: { borderTop: '2px solid #000', margin: '2px 0' },
  tagItemNo: { fontSize: '26px', fontWeight: '800', lineHeight: 1 },
  tagDesc: { fontSize: '13px', fontWeight: '500' },
  tagQtyRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    border: '2px solid #000',
    borderRadius: '6px',
    padding: '6px 10px',
  },
  tagQtyLabel: { fontSize: '12px', fontWeight: '700' },
  tagQtyValue: { fontSize: '30px', fontWeight: '800' },
  tagUom: { fontSize: '16px', fontWeight: '700' },
  tagBarcode: {
    marginTop: 'auto',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
};
