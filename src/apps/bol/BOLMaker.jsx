import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';
import Papa from 'papaparse';
import {
  ChevronLeft,
  Search,
  Plus,
  Trash2,
  Printer,
  X,
  FileText,
  Save,
  Upload,
  PackageOpen,
  AlertTriangle,
  CheckCircle2,
  Mail,
  Download,
  PenLine,
} from 'lucide-react';

// ---------- constants ----------
const TEMP_WARNING_DEFAULT =
  '*PLEASE MAINTAIN PRODUCT BELOW 90 DEGREES WHEN SHIPPING/STORING. DO NOT ALLOW PRODUCT TO SIT IN HOT TRAILER.*';

const LEGAL_NOTE =
  'Note: Liability Limitation for loss or damage in this shipment may be applicable. See 49 USC 14706(c)(1)(A) and (B)';

const CERT_LEFT =
  'Received, subject to individually determined rates or contracts that have been agreed upon in writing between the carrier and shipper, if applicable, otherwise to the rates, classifications, and rules that have been established by the carrier and are available to the shipper, on request, and to all applicable state and federal regulations.';

const CERT_RIGHT =
  'This is to certify that the above-named materials are properly classified, described, packaged, marked and labeled and are in proper condition for transportation according to the applicable regulations of the Department of Transportation';

const FREIGHT_TERMS = [
  { value: 'prepaid', label: 'Prepaid' },
  { value: 'collect', label: 'Collect' },
  { value: 'third_party', label: '3rd Party' },
];

const SHIP_LOCATION = 'ABQEP';

// ---------- weight auto-calc config ----------
const CASE_WEIGHT_BY_OZ = {
  4: 4.0,
  11: 7.2,
  16: 9.5,
  32: 17.0,
};
const PALLET_WEIGHT_LB = 50;

// ---------- BOL distribution config ----------
// Default recipients when you tap "Email BOL".  Easy to edit.
const DEFAULT_EMAIL_RECIPIENTS = [
  'caleb@elpinto.com',
  'warehouse@elpinto.com',
];
// Whether a PDF auto-downloads every time a BOL is saved.
const AUTO_DOWNLOAD_PDF_ON_SAVE = true;

// Build a safe filename for the BOL PDF.
function bolPdfFilename(header) {
  const parts = ['BOL'];
  if (header.bolNumber) parts.push(String(header.bolNumber).replace(/[^\w.-]+/g, '_'));
  if (header.shipToName) {
    parts.push(
      String(header.shipToName)
        .split(/\s+/)
        .slice(0, 2)
        .join('_')
        .replace(/[^\w.-]+/g, '_')
    );
  }
  return parts.filter(Boolean).join('-') + '.pdf';
}

// Generate a PDF from the on-screen printable BOL (#bol-print) and either
// download it, or return the Blob.  Uses jsPDF + html2canvas, loaded on demand.
async function generateBolPdf({ filename, downloadIt }) {
  const node = document.getElementById('bol-print');
  if (!node) throw new Error('BOL preview not found');

  // Dynamic imports (loaded only when the user actually generates a PDF)
  const [{ default: html2canvas }, jspdfMod] = await Promise.all([
    import('https://esm.sh/html2canvas@1.4.1'),
    import('https://esm.sh/jspdf@2.5.1'),
  ]);
  const { jsPDF } = jspdfMod;

  // Temporarily make the print node visible to the renderer.
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

  // Letter-size PDF; scale the canvas image to fit the page width, paginate.
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36; // 0.5"
  const imgW = pageW - margin * 2;
  const ratio = imgW / canvas.width;
  const imgH = canvas.height * ratio;

  const imgData = canvas.toDataURL('image/png');

  if (imgH <= pageH - margin * 2) {
    pdf.addImage(imgData, 'PNG', margin, margin, imgW, imgH);
  } else {
    // Paginate by stamping the same image at a Y offset, each page clipping.
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
    pdf.save(filename || 'BOL.pdf');
    return null;
  }
  return pdf.output('blob');
}

// Open the user's mail client with To/Subject/Body pre-filled.
function openEmailDraft({ to, subject, body }) {
  const url =
    'mailto:' +
    encodeURIComponent((to || []).join(','))
    + '?subject=' + encodeURIComponent(subject || '')
    + '&body=' + encodeURIComponent(body || '');
  window.location.href = url;
}

function detectOz(description) {
  if (!description) return null;
  const m = String(description).match(/(\d+(?:\.\d+)?)\s*OZ\b/i);
  return m ? Number(m[1]) : null;
}

function estimateCaseWeight(oz) {
  if (CASE_WEIGHT_BY_OZ[oz] != null) return CASE_WEIGHT_BY_OZ[oz];
  if (oz == null) return null;
  return Math.round((0.458 * oz + 2.167) * 10) / 10;
}

// Total cases assigned across a line's allocations
function allocTotal(line) {
  return (line.allocations || []).reduce(
    (s, a) => s + (Number(a.quantity) || 0),
    0
  );
}

// All pallet numbers used on a line's allocations (unique, non-empty)
function linePalletNumbers(line) {
  const set = new Set();
  for (const a of line.allocations || []) {
    const p = (a.pallet_number || '').trim();
    if (p) set.add(p);
  }
  return Array.from(set);
}

// Per-line case weight = cases × per-case lb, from item's oz size
function calcLineCaseWeight(line) {
  const cases = allocTotal(line);
  if (!cases) return null;
  const oz = detectOz(line.description);
  const perCase = estimateCaseWeight(oz);
  if (perCase == null) return null;
  return Math.round(cases * perCase * 10) / 10;
}

// Recalc weights on every line: case weight + pallet tare on each unique
// pallet's first appearance across the whole BOL. Manual overrides respected.
function recalcLineWeights(lines) {
  const palletSeen = new Set();
  return lines.map((l) => {
    const palletsHere = linePalletNumbers(l);
    let palletW = 0;
    for (const p of palletsHere) {
      if (!palletSeen.has(p)) {
        palletSeen.add(p);
        palletW += PALLET_WEIGHT_LB;
      }
    }
    if (l.weight_manual) return l;
    const caseW = calcLineCaseWeight(l);
    if (caseW == null && palletW === 0) return { ...l, weight: '' };
    return { ...l, weight: Math.round(((caseW || 0) + palletW) * 10) / 10 };
  });
}

// ---------- helpers ----------
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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function suggestBolNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `EPBOL-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours()
  )}${p(d.getMinutes())}`;
}

const defaultQA = () => ({
  conditionOfTrailer: 'Good',
  odor: 'No',
  possibleContaminationReason: '',
  itemsRejectedReason: 'NA',
  itemsOnHoldReason: 'No',
  damagedWhileLoading: 'No',
  tempLogger: '',
  rodentExcreta: 'No',
  possibleContamination: 'No',
  anyItemsRejected: 'No',
  anyItemsOnHold: 'No',
  damagedOnTrailer: 'No',
  comments: '',
});

const blankHeader = () => ({
  bolNumber: suggestBolNumber(),
  whsNumber: '',
  salesOrderNo: '',
  bolDate: todayStr(),
  dueDate: todayStr(),
  status: 'open',
  shipFromName: 'El Pinto Foods LLC',
  shipFromAddress: '10500 4th St NW\nAlbuquerque, NM 87114',
  shipToName: '',
  shipToAddress: '',
  billToName: '',
  billToAddress: '',
  customerPo: '',
  freightTerms: 'prepaid',
  carrierName: '',
  carrierScac: '',
  proNumber: '',
  trailerNumber: '',
  sealNumber: '',
  chepPalletCount: '',
  tempLoggerNumber: '',
  truckTemp: '',
  overallWeight: '',
  trailerLoadedByShipper: 'Yes',
  trailerLoadedByDriver: 'Yes',
  tempWarning: TEMP_WARNING_DEFAULT,
  specialInstructions: '',
  qa: defaultQA(),
  shipperSignature: '',
  shipperSignedAt: '',
  driverSignature: '',
  driverSignedAt: '',
});

// ---------- CSV import helpers ----------
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

function isDtcOrder(o) {
  const r = lower(o.raw || {});
  if (pick(r, ['ShpfyOrderNo', 'Shpfy_Order_No', 'ShopifyOrderNo']))
    return true;
  const name = (o.customer_name || '').toLowerCase();
  const custNo = pick(r, ['Sell_to_Customer_No']).toLowerCase();
  if (name.includes('amazon') || custNo.includes('amaz')) return true;
  return false;
}

let lineSeq = 1;
let allocSeq = 1;
const nextLineId = () => lineSeq++;
const nextAllocId = () => allocSeq++;

// ============================================================
export default function BOLMaker() {
  const navigate = useNavigate();

  const [view, setView] = useState('list');

  const [bols, setBols] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState('');

  const [items, setItems] = useState([]);

  const [editingId, setEditingId] = useState(null);
  const [header, setHeader] = useState(blankHeader());
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [showPicker, setShowPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerItemNo, setPickerItemNo] = useState(null);

  const [bcOrders, setBcOrders] = useState([]);
  const [showImport, setShowImport] = useState(false);
  const [showOrderPicker, setShowOrderPicker] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [hideDtc, setHideDtc] = useState(true);
  const [lotPickerLine, setLotPickerLine] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [signaturePad, setSignaturePad] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false); // 'shipper' | 'driver' | null

  useEffect(() => {
    loadBols();
    loadItems();
    loadBcOrders();
  }, []);

  async function loadBols() {
    setLoadingList(true);
    const { data, error } = await supabase
      .schema('shipping')
      .from('bols')
      .select('*, bol_lines(*)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (!error) setBols(data || []);
    setLoadingList(false);
  }

  async function loadItems() {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('item_no')
      .limit(5000);
    if (!error) setItems(data || []);
  }

  async function loadBcOrders() {
    const { data, error } = await supabase
      .schema('shipping')
      .from('bc_open_orders')
      .select('*')
      .order('order_no', { ascending: true })
      .limit(2000);
    if (!error) setBcOrders(data || []);
  }

  async function importOrders(ordersFile, linesFile) {
    setImporting(true);
    setImportMsg('');
    try {
      const [orderRows, lineRows] = await Promise.all([
        parseCsv(ordersFile),
        parseCsv(linesFile),
      ]);

      const orders = [];
      for (const r of orderRows) {
        const lr = lower(r);
        const orderNo = pick(lr, ['No', 'Order_No', 'Document_No']);
        if (!orderNo) continue;
        const shipToName =
          pick(lr, ['Ship_to_Name']) || pick(lr, ['Sell_to_Customer_Name']);
        const city = pick(lr, ['Ship_to_City']) || pick(lr, ['Sell_to_City']);
        const state =
          pick(lr, ['Ship_to_County']) || pick(lr, ['Sell_to_County']);
        orders.push({
          order_no: orderNo,
          customer_name: pick(lr, ['Sell_to_Customer_Name']),
          ship_to_name: shipToName,
          ship_to_loc: [city, state].filter(Boolean).join(', '),
          customer_po: pick(lr, ['External_Document_No', 'Your_Reference']),
          raw: r,
        });
      }

      const linesOut = [];
      for (const r of lineRows) {
        const lr = lower(r);
        const type = pick(lr, ['Type']);
        if (type && type.toLowerCase() !== 'item') continue;
        const loc = pick(lr, ['Location_Code']);
        if (loc.toUpperCase() !== SHIP_LOCATION) continue;
        const orderNo = pick(lr, ['Document_No', 'Order_No']);
        const itemNo = pick(lr, ['No', 'Item_No', 'Item_Reference_No']);
        if (!orderNo || !itemNo) continue;
        const qty =
          toNum(pick(lr, ['Outstanding_Quantity'])) ??
          toNum(pick(lr, ['Quantity']));
        linesOut.push({
          order_no: orderNo,
          line_no: pick(lr, ['Line_No']),
          item_no: itemNo,
          description: pick(lr, ['Description']),
          quantity: qty,
          uom: pick(lr, ['Unit_of_Measure_Code', 'UOM']),
          raw: r,
        });
      }

      if (orders.length === 0) {
        throw new Error(
          'No orders found — check that orders.csv has a "No" column.'
        );
      }

      const ordersWithLines = new Set(linesOut.map((l) => l.order_no));
      const keptOrders = orders.filter((o) => ordersWithLines.has(o.order_no));

      await supabase
        .schema('shipping')
        .from('bc_open_order_lines')
        .delete()
        .gte('imported_at', '1970-01-01');
      await supabase
        .schema('shipping')
        .from('bc_open_orders')
        .delete()
        .gte('imported_at', '1970-01-01');

      for (const part of chunk(keptOrders, 500)) {
        const { error } = await supabase
          .schema('shipping')
          .from('bc_open_orders')
          .insert(part);
        if (error) throw error;
      }
      for (const part of chunk(linesOut, 500)) {
        const { error } = await supabase
          .schema('shipping')
          .from('bc_open_order_lines')
          .insert(part);
        if (error) throw error;
      }

      await loadBcOrders();
      setImportMsg(
        `Imported ${keptOrders.length} orders (${SHIP_LOCATION}) and ${linesOut.length} item lines \u2713`
      );
    } catch (e) {
      setImportMsg('Import error: ' + (e.message || 'unknown error'));
    } finally {
      setImporting(false);
    }
  }

  async function startFromOrder(order) {
    lineSeq = 1;
    allocSeq = 1;
    setEditingId(null);

    const r = lower(order.raw || {});
    const shipAddr = [
      pick(r, ['Ship_to_Address']) || pick(r, ['Sell_to_Address']),
      pick(r, ['Ship_to_Address_2']) || pick(r, ['Sell_to_Address_2']),
      [
        pick(r, ['Ship_to_City']) || pick(r, ['Sell_to_City']),
        pick(r, ['Ship_to_County']) || pick(r, ['Sell_to_County']),
        pick(r, ['Ship_to_Post_Code']) || pick(r, ['Sell_to_Post_Code']),
      ]
        .filter(Boolean)
        .join(' '),
    ]
      .filter(Boolean)
      .join('\n');

    const h = blankHeader();
    h.salesOrderNo = order.order_no || '';
    h.shipToName = order.ship_to_name || order.customer_name || '';
    h.shipToAddress = shipAddr;
    h.customerPo = order.customer_po || '';
    h.carrierName = pick(r, ['Shipping_Agent_Code']) || '';
    h.trailerNumber = pick(r, ['Trailer_1', 'Trailer_2']) || '';
    setHeader(h);

    const { data: orderLines } = await supabase
      .schema('shipping')
      .from('bc_open_order_lines')
      .select('*')
      .eq('order_no', order.order_no)
      .order('line_no', { ascending: true });

    const itemsByNo = new Map(items.map((it) => [it.item_no, it]));

    setLines(
      recalcLineWeights(
        (orderLines || []).map((l) => {
          const match = itemsByNo.get(l.item_no);
          return {
            tempId: nextLineId(),
            item_no: l.item_no || '',
            description: l.description || match?.description || '',
            quantity: l.quantity ?? '',
            uom: l.uom || match?.uom || '',
            allocations: [],
            weight: '',
            freight_class: '',
            nmfc: '',
          };
        })
      )
    );

    setMessage(
      `Pre-filled from order ${order.order_no}. Assign lots & pallets on each line.`
    );
    setShowOrderPicker(false);
    setView('edit');
  }

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return bcOrders.filter((o) => {
      if (hideDtc && isDtcOrder(o)) return false;
      if (!q) return true;
      return (
        (o.order_no || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.ship_to_name || '').toLowerCase().includes(q)
      );
    });
  }, [bcOrders, orderSearch, hideDtc]);

  const dtcHiddenCount = useMemo(
    () => (hideDtc ? bcOrders.filter(isDtcOrder).length : 0),
    [bcOrders, hideDtc]
  );

  const filteredBols = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bols;
    return bols.filter((b) => {
      const inHeader =
        (b.bol_number || '').toLowerCase().includes(q) ||
        (b.whs_number || '').toLowerCase().includes(q) ||
        (b.sales_order_no || '').toLowerCase().includes(q) ||
        (b.ship_to_name || '').toLowerCase().includes(q) ||
        (b.carrier_name || '').toLowerCase().includes(q);
      const inLines = (b.bol_lines || []).some(
        (l) =>
          (l.lot_no || '').toLowerCase().includes(q) ||
          (l.item_no || '').toLowerCase().includes(q)
      );
      return inHeader || inLines;
    });
  }, [bols, search]);

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

  const pickerFiltered = useMemo(() => {
    let list = uniqueItems;
    const q = pickerSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (it) =>
          it.item_no.toLowerCase().includes(q) ||
          (it.description || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 50);
  }, [uniqueItems, pickerSearch]);

  function startNew() {
    lineSeq = 1;
    allocSeq = 1;
    setEditingId(null);
    setHeader(blankHeader());
    setLines([]);
    setMessage('');
    setView('edit');
  }

  function openBol(b) {
    setEditingId(b.id);
    setHeader({
      bolNumber: b.bol_number || '',
      whsNumber: b.whs_number || '',
      salesOrderNo: b.sales_order_no || '',
      bolDate: b.bol_date || todayStr(),
      dueDate: b.due_date || todayStr(),
      status: b.status || 'open',
      shipFromName: b.ship_from_name || '',
      shipFromAddress: b.ship_from_address || '',
      shipToName: b.ship_to_name || '',
      shipToAddress: b.ship_to_address || '',
      billToName: b.bill_to_name || '',
      billToAddress: b.bill_to_address || '',
      customerPo: b.customer_po || '',
      freightTerms: b.freight_terms || 'prepaid',
      carrierName: b.carrier_name || '',
      carrierScac: b.carrier_scac || '',
      proNumber: b.pro_number || '',
      trailerNumber: b.trailer_number || '',
      sealNumber: b.seal_number || '',
      chepPalletCount: b.chep_pallet_count ?? '',
      tempLoggerNumber: b.temp_logger_number || '',
      truckTemp: b.truck_temp || '',
      overallWeight: b.overall_weight ?? '',
      trailerLoadedByShipper: b.trailer_loaded_by_shipper || 'Yes',
      trailerLoadedByDriver: b.trailer_loaded_by_driver || 'Yes',
      tempWarning: b.temp_warning || TEMP_WARNING_DEFAULT,
      specialInstructions: b.special_instructions || '',
      qa: { ...defaultQA(), ...(b.qa || {}) },
      shipperSignature: b.shipper_signature || '',
      shipperSignedAt: b.shipper_signed_at || '',
      driverSignature: b.driver_signature || '',
      driverSignedAt: b.driver_signed_at || '',
    });

    // Group saved bol_lines rows back into lines by line_group.
    const groups = new Map();
    for (const row of b.bol_lines || []) {
      const key = row.line_group ?? row.id; // legacy rows: each row is its own line
      if (!groups.has(key)) {
        groups.set(key, {
          tempId: nextLineId(),
          item_no: row.item_no || '',
          description: row.description || '',
          quantity: '',
          uom: row.uom || '',
          allocations: [],
          weight: row.weight ?? '',
          weight_manual: !!row.weight,
          freight_class: row.freight_class || '',
          nmfc: row.nmfc || '',
          _qtySum: 0,
        });
      }
      const g = groups.get(key);
      g.allocations.push({
        allocId: nextAllocId(),
        lot_no: row.lot_no || '',
        quantity: row.quantity ?? '',
        pallet_number: row.pallet_number || '',
      });
      g._qtySum += Number(row.quantity) || 0;
    }
    const restored = Array.from(groups.values()).map((g) => {
      g.quantity = g._qtySum || '';
      delete g._qtySum;
      return g;
    });
    setLines(restored);
    setMessage('');
    setView('edit');
  }

  function setH(field, value) {
    setHeader((h) => ({ ...h, [field]: value }));
  }
  function setQA(field, value) {
    setHeader((h) => ({ ...h, qa: { ...h.qa, [field]: value } }));
  }

  // ---- adding a fresh line manually (no lot yet) ----
  function addBlankLineForItem(itemNo, description, uom) {
    setLines((prev) => [
      ...prev,
      {
        tempId: nextLineId(),
        item_no: itemNo || '',
        description: description || '',
        quantity: '',
        uom: uom || '',
        allocations: [],
        weight: '',
        freight_class: '',
        nmfc: '',
      },
    ]);
    setShowPicker(false);
    setPickerItemNo(null);
    setPickerSearch('');
  }

  function updateLine(tempId, field, value) {
    setLines((prev) => {
      const next = prev.map((l) => {
        if (l.tempId !== tempId) return l;
        const updated = { ...l, [field]: value };
        if (field === 'weight') {
          updated.weight_manual = value !== '';
        }
        return updated;
      });
      if (field === 'quantity' || field === 'description') {
        return recalcLineWeights(next);
      }
      return next;
    });
  }

  function removeLine(tempId) {
    setLines((prev) =>
      recalcLineWeights(prev.filter((l) => l.tempId !== tempId))
    );
  }

  // ---- multi-lot allocation editing ----
  function setLineAllocations(tempId, allocations) {
    setLines((prev) =>
      recalcLineWeights(
        prev.map((l) => (l.tempId === tempId ? { ...l, allocations } : l))
      )
    );
  }

  const activeLotLine = lines.find((l) => l.tempId === lotPickerLine) || null;
  const lotsForLine = useMemo(() => {
    if (!activeLotLine) return [];
    return items.filter(
      (it) =>
        it.item_no === activeLotLine.item_no &&
        (it.location_code || '').toUpperCase() === SHIP_LOCATION
    );
  }, [items, activeLotLine]);

  const totals = useMemo(() => {
    let weight = 0;
    let cases = 0;
    const pallets = new Set();
    for (const l of lines) {
      weight += Number(l.weight) || 0;
      cases += Number(l.quantity) || 0;
      for (const p of linePalletNumbers(l)) pallets.add(p);
    }
    return { weight, cases, pallets: pallets.size };
  }, [lines]);

  // ---- validation: which lines are over/under allocated ----
  const lineStatuses = useMemo(() => {
    const out = new Map();
    for (const l of lines) {
      const need = Number(l.quantity) || 0;
      const got = allocTotal(l);
      const allocated = (l.allocations || []).length > 0;
      let status = 'empty';
      if (allocated) {
        if (need === 0) status = 'no-qty';
        else if (got === need) status = 'ok';
        else if (got < need) status = 'under';
        else status = 'over';
      }
      out.set(l.tempId, { need, got, status });
    }
    return out;
  }, [lines]);

  const allocationWarnings = useMemo(
    () =>
      lines.filter((l) => {
        const s = lineStatuses.get(l.tempId);
        return s && (s.status === 'under' || s.status === 'over');
      }).length,
    [lines, lineStatuses]
  );

  const canSave =
    header.shipToName.trim() !== '' && lines.length > 0 && !saving;

  async function deleteBol() {
    if (!editingId) return;
    setSaving(true);
    setMessage('');
    try {
      // bol_lines cascade-delete via the FK, so we only need to remove the BOL row.
      const { error } = await supabase
        .schema('shipping')
        .from('bols')
        .delete()
        .eq('id', editingId);
      if (error) throw error;
      await loadBols();
      setEditingId(null);
      setView('list');
    } catch (e) {
      setMessage('Error deleting: ' + (e.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }

  async function saveBol() {
    if (!canSave) return;
    setSaving(true);
    setMessage('');

    const headerRow = {
      bol_number: header.bolNumber || null,
      whs_number: header.whsNumber || null,
      sales_order_no: header.salesOrderNo || null,
      bol_date: header.bolDate || null,
      due_date: header.dueDate || null,
      status: header.status || 'open',
      ship_from_name: header.shipFromName || null,
      ship_from_address: header.shipFromAddress || null,
      ship_to_name: header.shipToName || null,
      ship_to_address: header.shipToAddress || null,
      bill_to_name: header.billToName || null,
      bill_to_address: header.billToAddress || null,
      customer_po: header.customerPo || null,
      freight_terms: header.freightTerms || 'prepaid',
      carrier_name: header.carrierName || null,
      carrier_scac: header.carrierScac || null,
      pro_number: header.proNumber || null,
      trailer_number: header.trailerNumber || null,
      seal_number: header.sealNumber || null,
      chep_pallet_count:
        header.chepPalletCount === '' ? null : Number(header.chepPalletCount),
      temp_logger_number: header.tempLoggerNumber || null,
      truck_temp: header.truckTemp || null,
      overall_weight:
        header.overallWeight === ''
          ? totals.weight || 0
          : Number(header.overallWeight),
      trailer_loaded_by_shipper: header.trailerLoadedByShipper || null,
      trailer_loaded_by_driver: header.trailerLoadedByDriver || null,
      temp_warning: header.tempWarning || null,
      special_instructions: header.specialInstructions || null,
      qa: header.qa || {},
      shipper_signature: header.shipperSignature || null,
      shipper_signed_at: header.shipperSignedAt || null,
      driver_signature: header.driverSignature || null,
      driver_signed_at: header.driverSignedAt || null,
      total_weight: totals.weight || 0,
      total_pallets: totals.pallets || 0,
      total_pieces: totals.cases || 0,
    };

    try {
      let bolId = editingId;

      if (editingId) {
        const { error: upErr } = await supabase
          .schema('shipping')
          .from('bols')
          .update(headerRow)
          .eq('id', editingId);
        if (upErr) throw upErr;
        const { error: delErr } = await supabase
          .schema('shipping')
          .from('bol_lines')
          .delete()
          .eq('bol_id', editingId);
        if (delErr) throw delErr;
      } else {
        const { data: inserted, error: insErr } = await supabase
          .schema('shipping')
          .from('bols')
          .insert(headerRow)
          .select()
          .single();
        if (insErr) throw insErr;
        bolId = inserted.id;
        setEditingId(bolId);
      }

      // Each allocation = one bol_lines row; group rows by line_group.
      const lineRows = [];
      let groupCounter = 1;
      for (const l of lines) {
        const groupId = groupCounter++;
        const allocs =
          l.allocations && l.allocations.length > 0
            ? l.allocations
            : [{ lot_no: '', quantity: l.quantity, pallet_number: '' }];
        // Spread the line's weight across allocations: put it on the first row
        // so it doesn't get double-counted when reopening.
        for (let i = 0; i < allocs.length; i++) {
          const a = allocs[i];
          lineRows.push({
            bol_id: bolId,
            line_group: groupId,
            item_no: l.item_no || null,
            description: l.description || null,
            lot_no: a.lot_no || '',
            quantity: a.quantity === '' ? null : Number(a.quantity),
            uom: l.uom || null,
            weight:
              i === 0
                ? l.weight === ''
                  ? null
                  : Number(l.weight)
                : null,
            pallet_number: a.pallet_number || null,
            freight_class: l.freight_class || null,
            nmfc: l.nmfc || null,
          });
        }
      }

      const { error: lineErr } = await supabase
        .schema('shipping')
        .from('bol_lines')
        .insert(lineRows);
      if (lineErr) throw lineErr;

      setMessage('Saved \u2713');
      loadBols();

      if (AUTO_DOWNLOAD_PDF_ON_SAVE) {
        // Run after the React state has actually updated the document.
        setTimeout(() => {
          generateBolPdf({
            filename: bolPdfFilename(header),
            downloadIt: true,
          }).catch(() => {
            /* downloads can be blocked silently — that's ok, user can hit Download manually */
          });
        }, 200);
      }
    } catch (e) {
      setMessage('Error saving: ' + (e.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  async function handleDownloadPdf() {
    try {
      await generateBolPdf({
        filename: bolPdfFilename(header),
        downloadIt: true,
      });
    } catch (e) {
      setMessage('Error making PDF: ' + (e.message || 'unknown error'));
    }
  }

  async function handleEmailBol() {
    // 1) Save the PDF locally so the user can attach it in one click
    const filename = bolPdfFilename(header);
    try {
      await generateBolPdf({ filename, downloadIt: true });
    } catch (e) {
      setMessage('Error making PDF: ' + (e.message || 'unknown error'));
      return;
    }
    // 2) Open the user's mail client with everything pre-filled
    const subject = `BOL ${header.bolNumber || ''}${
      header.shipToName ? ' \u2014 ' + header.shipToName : ''
    }`;
    const bodyLines = [
      `BOL #:        ${header.bolNumber || ''}`,
      header.whsNumber ? `WHS #:        ${header.whsNumber}` : '',
      header.salesOrderNo ? `Sales Order:  ${header.salesOrderNo}` : '',
      `Ship To:      ${header.shipToName || ''}`,
      header.customerPo ? `Customer PO:  ${header.customerPo}` : '',
      header.carrierName ? `Carrier:      ${header.carrierName}` : '',
      `Cases:        ${totals.cases}`,
      `Pallets:      ${totals.pallets}`,
      `Weight (lb):  ${totals.weight}`,
      '',
      `Please find the BOL PDF attached: ${filename}`,
      `(It was just saved to your Downloads folder — drag it onto this email.)`,
    ];
    openEmailDraft({
      to: DEFAULT_EMAIL_RECIPIENTS,
      subject,
      body: bodyLines.filter(Boolean).join('\n'),
    });
  }

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
                {view === 'edit' ? 'BOLs' : 'Home'}
              </span>
            </button>
            <div style={styles.titleArea}>
              <FileText size={18} color="#fff" />
              <span style={styles.headerTitle}>
                {view === 'edit' ? 'Bill of Lading' : 'BOL History'}
              </span>
            </div>
            <div style={{ width: '70px' }} />
          </div>
        </div>

        <div style={styles.content}>
          {view === 'list' ? (
            <ListView
              loading={loadingList}
              bols={filteredBols}
              search={search}
              setSearch={setSearch}
              onNew={startNew}
              onOpen={openBol}
              onImport={() => {
                setImportMsg('');
                setShowImport(true);
              }}
              onPickOrder={() => {
                setOrderSearch('');
                setShowOrderPicker(true);
              }}
              bcOrderCount={bcOrders.length}
            />
          ) : (
            <EditView
              header={header}
              setH={setH}
              setQA={setQA}
              lines={lines}
              lineStatuses={lineStatuses}
              updateLine={updateLine}
              removeLine={removeLine}
              totals={totals}
              allocationWarnings={allocationWarnings}
              onAddItem={() => setShowPicker(true)}
              onChooseLots={(tempId) => setLotPickerLine(tempId)}
              onSave={saveBol}
              onPrint={handlePrint}
              onDownloadPdf={handleDownloadPdf}
              onEmail={handleEmailBol}
              onSign={(which) => setSignaturePad(which)}
              onClearSignature={(which) => {
                if (which === 'shipper') {
                  setH('shipperSignature', '');
                  setH('shipperSignedAt', '');
                } else {
                  setH('driverSignature', '');
                  setH('driverSignedAt', '');
                }
              }}
              canSave={canSave}
              saving={saving}
              message={message}
              editingId={editingId}
              confirmDelete={confirmDelete}
              onRequestDelete={() => setConfirmDelete(true)}
              onCancelDelete={() => setConfirmDelete(false)}
              onConfirmDelete={async () => {
                setConfirmDelete(false);
                await deleteBol();
              }}
            />
          )}
        </div>

        {/* Add-item picker: just creates a fresh blank line for the item */}
        {showPicker && (
          <div style={styles.overlay}>
            <div style={styles.modal}>
              <div style={styles.modalHead}>
                <span style={styles.modalTitle}>Add an item</span>
                <button
                  style={styles.iconBtn}
                  onClick={() => {
                    setShowPicker(false);
                    setPickerItemNo(null);
                    setPickerSearch('');
                  }}
                >
                  <X size={18} />
                </button>
              </div>
              <div style={styles.searchWrap}>
                <Search size={18} color="#9ca3af" />
                <input
                  autoFocus
                  style={styles.searchInput}
                  placeholder="Search item # or description..."
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                />
              </div>
              <div style={styles.modalList}>
                {pickerFiltered.map((it) => (
                  <button
                    key={it.item_no}
                    style={styles.itemRow}
                    onClick={() => addBlankLineForItem(it.item_no, it.description, '')}
                  >
                    <span style={styles.itemNo}>{it.item_no}</span>
                    <span style={styles.itemDesc}>{it.description}</span>
                  </button>
                ))}
                {pickerFiltered.length === 0 && (
                  <p style={{ color: '#9ca3af', padding: '8px' }}>
                    No items match.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {showImport && (
          <ImportModal
            importing={importing}
            importMsg={importMsg}
            onImport={importOrders}
            onClose={() => setShowImport(false)}
          />
        )}

        {showOrderPicker && (
          <div style={styles.overlay}>
            <div style={styles.modal}>
              <div style={styles.modalHead}>
                <span style={styles.modalTitle}>Pick an order</span>
                <button
                  style={styles.iconBtn}
                  onClick={() => setShowOrderPicker(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <div style={styles.searchWrap}>
                <Search size={18} color="#9ca3af" />
                <input
                  autoFocus
                  style={styles.searchInput}
                  placeholder="Search order #, customer..."
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                />
              </div>
              <button
                style={styles.filterToggle}
                onClick={() => setHideDtc((v) => !v)}
              >
                <span
                  style={{
                    ...styles.checkbox,
                    ...(hideDtc ? styles.checkboxOn : {}),
                  }}
                >
                  {hideDtc ? '✓' : ''}
                </span>
                Hide Shopify &amp; Amazon
                {hideDtc && dtcHiddenCount > 0 ? (
                  <span style={styles.filterCount}>
                    {dtcHiddenCount} hidden
                  </span>
                ) : null}
              </button>
              <div style={styles.modalList}>
                {filteredOrders.length === 0 ? (
                  <p style={{ color: '#9ca3af', padding: '8px' }}>
                    No imported orders. Tap "Import orders" first.
                  </p>
                ) : (
                  filteredOrders.map((o) => (
                    <button
                      key={o.order_no}
                      style={styles.itemRow}
                      onClick={() => startFromOrder(o)}
                    >
                      <span style={styles.itemNo}>{o.order_no}</span>
                      <span style={styles.itemDesc}>
                        {o.customer_name || o.ship_to_name}
                        {o.ship_to_loc ? ' · ' + o.ship_to_loc : ''}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Multi-lot allocation modal */}
        {lotPickerLine != null && activeLotLine && (
          <LotAllocationModal
            line={activeLotLine}
            lots={lotsForLine}
            onClose={() => setLotPickerLine(null)}
            onSave={(allocs) => {
              setLineAllocations(activeLotLine.tempId, allocs);
              setLotPickerLine(null);
            }}
          />
        )}

        {/* Digital signature pad */}
        {signaturePad && (
          <SignaturePad
            title={
              signaturePad === 'shipper'
                ? 'Shipper Signature'
                : 'Driver Signature'
            }
            onClose={() => setSignaturePad(null)}
            onSave={(png) => {
              const now = new Date().toISOString();
              if (signaturePad === 'shipper') {
                setH('shipperSignature', png);
                setH('shipperSignedAt', now);
              } else {
                setH('driverSignature', png);
                setH('driverSignedAt', now);
              }
              setSignaturePad(null);
            }}
          />
        )}
      </div>

      <div id="bol-print">
        <BolDocument header={header} lines={lines} totals={totals} />
      </div>
    </>
  );
}

// ---------- List view ----------
function ListView({
  loading,
  bols,
  search,
  setSearch,
  onNew,
  onOpen,
  onImport,
  onPickOrder,
  bcOrderCount,
}) {
  return (
    <>
      <div style={styles.listTopRow}>
        <h2 style={styles.pageTitle}>Bills of Lading</h2>
        <button style={styles.primaryBtn} onClick={onNew}>
          <Plus size={18} />
          New BOL
        </button>
      </div>

      <div style={styles.bcBar}>
        <button style={styles.bcPrimaryBtn} onClick={onPickOrder}>
          <PackageOpen size={18} />
          New BOL from order
          {bcOrderCount ? (
            <span style={styles.bcCount}>{bcOrderCount}</span>
          ) : null}
        </button>
        <button style={styles.bcSecondaryBtn} onClick={onImport}>
          <Upload size={16} />
          Import orders
        </button>
      </div>

      <div style={styles.searchWrap}>
        <Search size={18} color="#9ca3af" />
        <input
          style={styles.searchInput}
          placeholder="Search BOL #, customer, order #, or lot #..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <p style={styles.hint}>
        Tip: search a lot number to find every shipment that lot went out on.
      </p>

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading...</p>
      ) : bols.length === 0 ? (
        <div style={styles.empty}>
          <FileText size={32} color="#d1d5db" />
          <p style={{ color: '#9ca3af', marginTop: '8px' }}>
            No BOLs yet. Create your first one.
          </p>
        </div>
      ) : (
        <div style={styles.list}>
          {bols.map((b) => {
            const lots = Array.from(
              new Set(
                (b.bol_lines || []).map((l) => l.lot_no).filter(Boolean)
              )
            );
            return (
              <button
                key={b.id}
                style={styles.bolCard}
                onClick={() => onOpen(b)}
              >
                <div style={styles.bolCardTop}>
                  <span style={styles.bolNumber}>
                    {b.bol_number || '(no number)'}
                    {b.whs_number ? '  *  ' + b.whs_number : ''}
                  </span>
                  <span style={styles.bolDate}>{formatDate(b.bol_date)}</span>
                </div>
                <div style={styles.bolCustomer}>
                  {b.ship_to_name || '(no customer)'}
                </div>
                {b.sales_order_no ? (
                  <div style={styles.bolMeta}>Order: {b.sales_order_no}</div>
                ) : null}
                <div style={styles.bolMeta}>
                  {b.carrier_name ? b.carrier_name + ' · ' : ''}
                  {(b.bol_lines || []).length} line
                  {(b.bol_lines || []).length === 1 ? '' : 's'}
                  {b.total_pieces ? ' · ' + b.total_pieces + ' cases' : ''}
                </div>
                {lots.length > 0 && (
                  <div style={styles.lotTags}>
                    {lots.slice(0, 6).map((lot, i) => (
                      <span key={i} style={styles.lotTag}>
                        {lot}
                      </span>
                    ))}
                    {lots.length > 6 && (
                      <span style={styles.lotTag}>+{lots.length - 6}</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------- Import modal ----------
function ImportModal({ importing, importMsg, onImport, onClose }) {
  const [ordersFile, setOrdersFile] = useState(null);
  const [linesFile, setLinesFile] = useState(null);
  const ready = ordersFile && linesFile && !importing;
  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHead}>
          <span style={styles.modalTitle}>Import open orders</span>
          <button style={styles.iconBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p style={styles.importHelp}>
          Export your two queries from Power Query as CSV, then choose them
          here. Item lines are kept; freight (G/L) lines are skipped
          automatically.
        </p>

        <label style={styles.fileLabel}>
          1. Orders CSV (the SalesOrder query)
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          style={styles.fileInput}
          onChange={(e) => setOrdersFile(e.target.files?.[0] || null)}
        />

        <label style={styles.fileLabel}>
          2. Lines CSV (the SalesLine query)
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          style={styles.fileInput}
          onChange={(e) => setLinesFile(e.target.files?.[0] || null)}
        />

        {importMsg && (
          <div
            style={{
              ...styles.message,
              marginTop: '12px',
              color: importMsg.startsWith('Import error')
                ? '#c8102e'
                : '#15803d',
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
          onClick={() => onImport(ordersFile, linesFile)}
        >
          <Upload size={18} />
          {importing ? 'Importing...' : 'Import'}
        </button>
      </div>
    </div>
  );
}

// ---------- Multi-lot allocation modal ----------
function LotAllocationModal({ line, lots, onClose, onSave }) {
  // Working copy of allocations as { allocId, lot_no, quantity, pallet_number }
  const [allocs, setAllocs] = useState(() =>
    (line.allocations || []).map((a) => ({
      allocId: nextAllocId(),
      lot_no: a.lot_no || '',
      quantity: a.quantity ?? '',
      pallet_number: a.pallet_number || '',
    }))
  );

  const need = Number(line.quantity) || 0;
  const got = allocs.reduce((s, a) => s + (Number(a.quantity) || 0), 0);
  const remaining = need - got;

  // Determine which lots are already in this line vs. still pickable.
  const lotsByNo = useMemo(() => {
    const m = new Map();
    for (const l of lots) m.set(l.lot_no, l);
    return m;
  }, [lots]);

  // On-hand per lot (in inventory) MINUS what we've already assigned to it
  // on this line, so the "available" count shrinks as you allocate.
  function availableFor(lotNo) {
    const inv = lotsByNo.get(lotNo);
    if (!inv) return null;
    const onHand = Number(inv.bc_quantity) || 0;
    const assigned = allocs
      .filter((a) => a.lot_no === lotNo)
      .reduce((s, a) => s + (Number(a.quantity) || 0), 0);
    return onHand - assigned;
  }

  function addAlloc(lot) {
    const onHand = Number(lot.bc_quantity) || 0;
    if (onHand <= 0) return; // out of stock — blocked
    const assignedSoFar = allocs
      .filter((a) => a.lot_no === lot.lot_no)
      .reduce((s, a) => s + (Number(a.quantity) || 0), 0);
    const available = onHand - assignedSoFar;
    if (available <= 0) return;
    // Never suggest more than the line still needs OR more than this lot has.
    const lineRemaining = Math.max(remaining, 0);
    const take = lineRemaining > 0
      ? Math.min(available, lineRemaining)
      : available;
    setAllocs((prev) => [
      ...prev,
      {
        allocId: nextAllocId(),
        lot_no: lot.lot_no || '',
        quantity: take,
        pallet_number: '',
      },
    ]);
  }

  function updateAlloc(id, field, value) {
    setAllocs((prev) => {
      // For the pallet field, just write through.
      if (field !== 'quantity') {
        return prev.map((a) => (a.allocId === id ? { ...a, [field]: value } : a));
      }
      // Quantity edits get clamped: not more than this lot's on-hand,
      // and not more than what the line still needs (counting OTHER allocs).
      const target = prev.find((a) => a.allocId === id);
      const inv = target ? lotsByNo.get(target.lot_no) : null;
      const onHand = inv ? Number(inv.bc_quantity) || 0 : Infinity;
      const otherForLot = prev
        .filter((a) => a.allocId !== id && a.lot_no === target?.lot_no)
        .reduce((s, a) => s + (Number(a.quantity) || 0), 0);
      const maxByLot = Math.max(onHand - otherForLot, 0);
      const otherTotal = prev
        .filter((a) => a.allocId !== id)
        .reduce((s, a) => s + (Number(a.quantity) || 0), 0);
      const maxByLine = need > 0 ? Math.max(need - otherTotal, 0) : Infinity;
      // Allow empty string while editing
      let clamped = value;
      if (value !== '' && !isNaN(Number(value))) {
        const n = Number(value);
        const max = Math.min(maxByLot, maxByLine);
        if (n > max) clamped = max;
        if (n < 0) clamped = 0;
      }
      return prev.map((a) =>
        a.allocId === id ? { ...a, quantity: clamped } : a
      );
    });
  }
  function removeAlloc(id) {
    setAllocs((prev) => prev.filter((a) => a.allocId !== id));
  }

  // Sort lots: best-by date ascending (FIFO), out-of-stock at the bottom.
  const sortedLots = useMemo(() => {
    const copy = [...lots];
    copy.sort((a, b) => {
      const aOh = Number(a.bc_quantity) || 0;
      const bOh = Number(b.bc_quantity) || 0;
      if (aOh > 0 && bOh <= 0) return -1;
      if (aOh <= 0 && bOh > 0) return 1;
      const aD = a.expiration_date
        ? new Date(a.expiration_date).getTime()
        : Infinity;
      const bD = b.expiration_date
        ? new Date(b.expiration_date).getTime()
        : Infinity;
      return aD - bD;
    });
    return copy;
  }, [lots]);

  const statusColor =
    remaining === 0
      ? '#15803d'
      : remaining > 0
        ? '#a16207'
        : '#c8102e';
  const statusLabel =
    remaining === 0
      ? 'Fully assigned'
      : remaining > 0
        ? `${remaining} cases unassigned`
        : `${-remaining} cases over`;

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, maxHeight: '90vh' }}>
        <div style={styles.modalHead}>
          <div>
            <div style={styles.modalTitle}>Lots for {line.item_no}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              Need {need} cases · {got} assigned ·{' '}
              <span style={{ color: statusColor, fontWeight: 700 }}>
                {statusLabel}
              </span>
            </div>
          </div>
          <button style={styles.iconBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Current allocations */}
        {allocs.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '13px', margin: '4px 0' }}>
            No lots assigned yet. Tap a lot below to add it.
          </p>
        ) : (
          <div style={{ marginBottom: '10px' }}>
            {allocs.map((a) => {
              const avail = availableFor(a.lot_no);
              return (
                <div key={a.allocId} style={styles.allocRow}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>Lot {a.lot_no}</div>
                    {avail != null && (
                      <div style={{ fontSize: '11px', color: '#6b7280' }}>
                        {avail >= 0 ? `${avail} still available` : `${-avail} over inv`}
                      </div>
                    )}
                  </div>
                  <div style={styles.allocField}>
                    <label style={styles.allocLabel}>Cases</label>
                    <input
                      style={styles.allocInput}
                      type="number"
                      inputMode="decimal"
                      value={a.quantity}
                      onChange={(e) =>
                        updateAlloc(a.allocId, 'quantity', e.target.value)
                      }
                    />
                  </div>
                  <div style={styles.allocField}>
                    <label style={styles.allocLabel}>Pallet #</label>
                    <input
                      style={styles.allocInput}
                      value={a.pallet_number}
                      onChange={(e) =>
                        updateAlloc(a.allocId, 'pallet_number', e.target.value)
                      }
                    />
                  </div>
                  <button
                    style={styles.iconBtn}
                    onClick={() => removeAlloc(a.allocId)}
                    title="Remove"
                  >
                    <Trash2 size={16} color="#c8102e" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Pickable lots */}
        <div style={{ ...styles.fieldLabel, marginTop: '8px' }}>
          Available lots (sorted by best-by date)
        </div>
        <div style={styles.modalList}>
          {sortedLots.length === 0 ? (
            <p style={{ color: '#9ca3af', padding: '4px 0' }}>
              No lots in inventory for this item at {SHIP_LOCATION}.
            </p>
          ) : (
            sortedLots.map((lot) => {
              const onHand = Number(lot.bc_quantity) || 0;
              const avail = availableFor(lot.lot_no) ?? onHand;
              const lineFull = need > 0 && remaining <= 0;
              const blocked = onHand <= 0 || avail <= 0 || lineFull;
              return (
                <button
                  key={lot.id}
                  style={{
                    ...styles.itemRow,
                    ...(blocked ? styles.itemRowBlocked : {}),
                  }}
                  onClick={() => !blocked && addAlloc(lot)}
                  disabled={blocked}
                >
                  <span style={styles.itemNo}>
                    Lot {lot.lot_no || '\u2014'}
                    {blocked ? (
                      <span style={styles.outOfStock}>Out of stock</span>
                    ) : null}
                  </span>
                  <span style={styles.itemDesc}>
                    Bin {lot.bin_code || '\u2014'} · Best by{' '}
                    {formatDate(lot.expiration_date)} · {avail} available
                  </span>
                </button>
              );
            })
          )}
        </div>

        <button
          style={{ ...styles.saveBtn, marginTop: '14px' }}
          onClick={() => onSave(allocs.filter((a) => a.lot_no))}
        >
          <Save size={18} />
          Save assignments
        </button>
      </div>
    </div>
  );
}

// ---------- Edit view ----------
function EditView({
  header,
  setH,
  setQA,
  lines,
  lineStatuses,
  updateLine,
  removeLine,
  totals,
  allocationWarnings,
  onAddItem,
  onChooseLots,
  onSave,
  onPrint,
  onDownloadPdf,
  onEmail,
  onSign,
  onClearSignature,
  canSave,
  saving,
  message,
  editingId,
  confirmDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}) {
  const qa = header.qa;
  return (
    <>
      {/* IDs */}
      <div style={styles.section}>
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>BOL # (EPBOL)</label>
            <input
              style={styles.input}
              value={header.bolNumber}
              onChange={(e) => setH('bolNumber', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>WHS #</label>
            <input
              style={styles.input}
              placeholder="WHS-011080"
              value={header.whsNumber}
              onChange={(e) => setH('whsNumber', e.target.value)}
            />
          </div>
        </div>
        <div>
          <label style={styles.fieldLabel}>Sales Order #</label>
          <input
            style={styles.input}
            placeholder="S-ORD111347"
            value={header.salesOrderNo}
            onChange={(e) => setH('salesOrderNo', e.target.value)}
          />
        </div>
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Date</label>
            <input
              style={styles.input}
              type="date"
              value={header.bolDate}
              onChange={(e) => setH('bolDate', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Due Date</label>
            <input
              style={styles.input}
              type="date"
              value={header.dueDate}
              onChange={(e) => setH('dueDate', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Ship From / To */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Ship From</div>
        <input
          style={styles.input}
          placeholder="Shipper name"
          value={header.shipFromName}
          onChange={(e) => setH('shipFromName', e.target.value)}
        />
        <textarea
          style={styles.textarea}
          placeholder="Shipper address"
          value={header.shipFromAddress}
          onChange={(e) => setH('shipFromAddress', e.target.value)}
        />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Ship To (Consignee)</div>
        <input
          style={styles.input}
          placeholder="Customer name"
          value={header.shipToName}
          onChange={(e) => setH('shipToName', e.target.value)}
        />
        <textarea
          style={styles.textarea}
          placeholder="Customer address"
          value={header.shipToAddress}
          onChange={(e) => setH('shipToAddress', e.target.value)}
        />
        <label style={styles.fieldLabel}>Customer PO Numbers</label>
        <input
          style={styles.input}
          value={header.customerPo}
          onChange={(e) => setH('customerPo', e.target.value)}
        />
      </div>

      {/* Carrier */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Carrier &amp; Shipment</div>
        <label style={styles.fieldLabel}>Carrier name</label>
        <input
          style={styles.input}
          value={header.carrierName}
          onChange={(e) => setH('carrierName', e.target.value)}
        />
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>SCAC</label>
            <input
              style={styles.input}
              value={header.carrierScac}
              onChange={(e) => setH('carrierScac', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>PRO #</label>
            <input
              style={styles.input}
              value={header.proNumber}
              onChange={(e) => setH('proNumber', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Trailer #</label>
            <input
              style={styles.input}
              value={header.trailerNumber}
              onChange={(e) => setH('trailerNumber', e.target.value)}
            />
          </div>
        </div>
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Seal #</label>
            <input
              style={styles.input}
              value={header.sealNumber}
              onChange={(e) => setH('sealNumber', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>CHEP Pallet Count</label>
            <input
              style={styles.input}
              type="number"
              value={header.chepPalletCount}
              onChange={(e) => setH('chepPalletCount', e.target.value)}
            />
          </div>
        </div>
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Temp Logger #</label>
            <input
              style={styles.input}
              value={header.tempLoggerNumber}
              onChange={(e) => setH('tempLoggerNumber', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Truck Temp</label>
            <input
              style={styles.input}
              placeholder="35° F"
              value={header.truckTemp}
              onChange={(e) => setH('truckTemp', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Overall Weight (lb)</label>
            <input
              style={styles.input}
              type="number"
              placeholder={String(totals.weight || 0)}
              value={header.overallWeight}
              onChange={(e) => setH('overallWeight', e.target.value)}
            />
          </div>
        </div>
        <label style={styles.fieldLabel}>Freight terms</label>
        <div style={styles.toggleRow}>
          {FREIGHT_TERMS.map((t) => (
            <button
              key={t.value}
              style={{
                ...styles.toggleBtn,
                ...(header.freightTerms === t.value ? styles.toggleActive : {}),
              }}
              onClick={() => setH('freightTerms', t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Line items */}
      <div style={styles.section}>
        <div style={styles.lineHeadRow}>
          <div style={styles.sectionTitle}>Items, Lots &amp; Pallets</div>
          <button style={styles.smallBtn} onClick={onAddItem}>
            <Plus size={16} />
            Add item
          </button>
        </div>

        {lines.length === 0 ? (
          <p style={{ color: '#9ca3af', fontSize: '14px' }}>
            No items yet. Tap &quot;Add item&quot; to pull from your inventory.
          </p>
        ) : (
          lines.map((l) => {
            const s = lineStatuses.get(l.tempId) || { status: 'empty' };
            const lotsLabel = (l.allocations || [])
              .map((a) =>
                a.quantity ? `${a.lot_no}: ${a.quantity}` : a.lot_no
              )
              .filter(Boolean)
              .join('  ·  ');
            return (
              <div key={l.tempId} style={styles.lineCard}>
                <div style={styles.lineCardTop}>
                  <span style={styles.itemNo}>{l.item_no}</span>
                  <button
                    style={styles.iconBtn}
                    onClick={() => removeLine(l.tempId)}
                  >
                    <Trash2 size={16} color="#c8102e" />
                  </button>
                </div>
                <div style={styles.itemDesc}>{l.description}</div>

                <button
                  style={{
                    ...styles.chooseLotBtn,
                    ...(s.status === 'ok' ? styles.chooseLotBtnSet : {}),
                    ...(s.status === 'under' || s.status === 'over'
                      ? styles.chooseLotBtnWarn
                      : {}),
                  }}
                  onClick={() => onChooseLots(l.tempId)}
                >
                  {s.status === 'ok' && (
                    <CheckCircle2 size={14} style={{ marginRight: 4 }} />
                  )}
                  {(s.status === 'under' || s.status === 'over') && (
                    <AlertTriangle size={14} style={{ marginRight: 4 }} />
                  )}
                  {(l.allocations || []).length === 0
                    ? '+ Choose lots'
                    : `Lots: ${lotsLabel || '(set quantities)'}`}
                </button>

                {s.status === 'under' && (
                  <div style={styles.warnText}>
                    {s.need - s.got} cases unassigned
                  </div>
                )}
                {s.status === 'over' && (
                  <div style={styles.warnText}>
                    {s.got - s.need} cases over the line quantity
                  </div>
                )}

                <div style={styles.lineGrid}>
                  <LineField
                    label="Cases / Qty"
                    value={l.quantity}
                    type="number"
                    onChange={(v) => updateLine(l.tempId, 'quantity', v)}
                  />
                  <LineField
                    label="Weight (lb)"
                    value={l.weight}
                    type="number"
                    onChange={(v) => updateLine(l.tempId, 'weight', v)}
                  />
                  <LineField
                    label="UOM"
                    value={l.uom}
                    onChange={(v) => updateLine(l.tempId, 'uom', v)}
                  />
                  <LineField
                    label="Class"
                    value={l.freight_class}
                    onChange={(v) => updateLine(l.tempId, 'freight_class', v)}
                  />
                  <LineField
                    label="NMFC"
                    value={l.nmfc}
                    onChange={(v) => updateLine(l.tempId, 'nmfc', v)}
                  />
                </div>
              </div>
            );
          })
        )}

        {lines.length > 0 && (
          <div style={styles.totalsRow}>
            <span>
              <strong>{totals.cases}</strong> cases
            </span>
            <span>
              <strong>{totals.pallets}</strong> pallets
            </span>
            <span>
              <strong>{totals.weight}</strong> lb
            </span>
          </div>
        )}
      </div>

      {/* Temperature warning */}
      <div style={styles.section}>
        <label style={styles.fieldLabel}>
          Temperature warning (prints in bold)
        </label>
        <textarea
          style={styles.textarea}
          value={header.tempWarning}
          onChange={(e) => setH('tempWarning', e.target.value)}
        />
      </div>

      <div style={styles.section}>
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Trailer Loaded By Shipper</label>
            <YesNo
              value={header.trailerLoadedByShipper}
              onChange={(v) => setH('trailerLoadedByShipper', v)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Trailer Loaded By Driver</label>
            <YesNo
              value={header.trailerLoadedByDriver}
              onChange={(v) => setH('trailerLoadedByDriver', v)}
            />
          </div>
        </div>
      </div>

      {/* QA Verification */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>QA Verification</div>
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <QAField label="Condition of Trailer" value={qa.conditionOfTrailer} onChange={(v) => setQA('conditionOfTrailer', v)} />
            <QAField label="Odor?" value={qa.odor} onChange={(v) => setQA('odor', v)} />
            <QAField label="Possible Contamination Reason" value={qa.possibleContaminationReason} onChange={(v) => setQA('possibleContaminationReason', v)} />
            <QAField label="Items Rejected Reason" value={qa.itemsRejectedReason} onChange={(v) => setQA('itemsRejectedReason', v)} />
            <QAField label="Items Placed on Hold Reason" value={qa.itemsOnHoldReason} onChange={(v) => setQA('itemsOnHoldReason', v)} />
            <QAField label="Damaged Items While Loading" value={qa.damagedWhileLoading} onChange={(v) => setQA('damagedWhileLoading', v)} />
          </div>
          <div style={{ flex: 1 }}>
            <QAField label="Temp Logger" value={qa.tempLogger} onChange={(v) => setQA('tempLogger', v)} />
            <QAField label="Rodent Excreta Found" value={qa.rodentExcreta} onChange={(v) => setQA('rodentExcreta', v)} />
            <QAField label="Possible Contamination" value={qa.possibleContamination} onChange={(v) => setQA('possibleContamination', v)} />
            <QAField label="Any Items Rejected?" value={qa.anyItemsRejected} onChange={(v) => setQA('anyItemsRejected', v)} />
            <QAField label="Any Items Placed On Hold?" value={qa.anyItemsOnHold} onChange={(v) => setQA('anyItemsOnHold', v)} />
            <QAField label="Damaged Items Found On Trailer?" value={qa.damagedOnTrailer} onChange={(v) => setQA('damagedOnTrailer', v)} />
          </div>
        </div>
        <QAField label="Comments" value={qa.comments} onChange={(v) => setQA('comments', v)} />
      </div>

      {/* Signatures */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Signatures</div>
        <div style={styles.twoCol}>
          <SignatureBox
            label="Shipper Signature"
            signature={header.shipperSignature}
            signedAt={header.shipperSignedAt}
            onSign={() => onSign('shipper')}
            onClear={() => onClearSignature('shipper')}
          />
          <SignatureBox
            label="Driver Signature"
            signature={header.driverSignature}
            signedAt={header.driverSignedAt}
            onSign={() => onSign('driver')}
            onClear={() => onClearSignature('driver')}
          />
        </div>
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

      {allocationWarnings > 0 && (
        <div style={styles.bannerWarn}>
          <AlertTriangle size={16} />
          {allocationWarnings} line{allocationWarnings === 1 ? '' : 's'} have
          lot quantities that don't match. You can still save.
        </div>
      )}

      <div style={styles.actionRow}>
        <button
          style={{ ...styles.saveBtn, ...(canSave ? {} : styles.btnDisabled) }}
          onClick={onSave}
          disabled={!canSave}
        >
          <Save size={18} />
          {saving ? 'Saving...' : editingId ? 'Update BOL' : 'Save BOL'}
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

      {editingId ? (
        confirmDelete ? (
          <div style={styles.deleteConfirmBox}>
            <div style={styles.deleteConfirmText}>
              Delete this BOL permanently? This can't be undone.
            </div>
            <div style={styles.actionRow}>
              <button style={styles.altBtn} onClick={onCancelDelete}>
                Cancel
              </button>
              <button style={styles.deleteBtn} onClick={onConfirmDelete}>
                <Trash2 size={18} />
                Yes, delete BOL
              </button>
            </div>
          </div>
        ) : (
          <button style={styles.deleteLinkBtn} onClick={onRequestDelete}>
            Delete this BOL
          </button>
        )
      ) : null}
      <div style={{ height: '40px' }} />
    </>
  );
}

function LineField({ label, value, onChange, type }) {
  return (
    <div style={styles.lineField}>
      <label style={styles.lineFieldLabel}>{label}</label>
      <input
        style={styles.lineInput}
        type={type || 'text'}
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ---------- Digital signature pad ----------
// Drawing canvas overlay. Returns a PNG data URL via onSave.
function SignaturePad({ title, onClose, onSave }) {
  const canvasRef = React.useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    // Match the canvas resolution to its display size for crisp ink
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
    // White background so the resulting PNG looks like signed paper
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

        <p style={styles.importHelp}>
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
              ...(hasInk ? {} : styles.btnDisabled),
            }}
            onClick={save}
            disabled={!hasInk}
          >
            <Save size={18} />
            Save Signature
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Inline signature box (shown in the edit view) ----------
function SignatureBox({ label, signature, signedAt, onSign, onClear }) {
  return (
    <div style={styles.sigBox}>
      <div style={styles.sigBoxLabel}>{label}</div>
      {signature ? (
        <>
          <img src={signature} alt={label} style={styles.sigImage} />
          <div style={styles.sigSignedAt}>
            Signed {signedAt ? new Date(signedAt).toLocaleString() : ''}
          </div>
          <button style={styles.sigClearBtn} onClick={onClear}>
            Clear &amp; re-sign
          </button>
        </>
      ) : (
        <button style={styles.sigSignBtn} onClick={onSign}>
          <PenLine size={16} />
          Tap to sign
        </button>
      )}
    </div>
  );
}

function QAField({ label, value, onChange }) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <label style={styles.lineFieldLabel}>{label}</label>
      <input
        style={styles.lineInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function YesNo({ value, onChange }) {
  return (
    <div style={styles.toggleRow}>
      {['Yes', 'No'].map((v) => (
        <button
          key={v}
          style={{
            ...styles.toggleBtn,
            ...(value === v ? styles.toggleActive : {}),
          }}
          onClick={() => onChange(v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

// ---------- Printable BOL ----------
function BolDocument({ header, lines, totals }) {
  // Description of Goods: group by item, sum cases (across all allocations)
  const byItem = new Map();
  for (const l of lines) {
    const key = l.item_no || '';
    if (!byItem.has(key)) {
      byItem.set(key, {
        item_no: l.item_no,
        description: l.description,
        cases: 0,
        lbs: 0,
      });
    }
    const g = byItem.get(key);
    g.cases += Number(l.quantity) || 0;
    g.lbs += Number(l.weight) || 0;
  }
  const goods = Array.from(byItem.values());

  // BOL Detail: each allocation as its own row
  const detailRows = [];
  for (const l of lines) {
    const allocs =
      l.allocations && l.allocations.length > 0
        ? l.allocations
        : [{ lot_no: '', quantity: l.quantity, pallet_number: '' }];
    for (const a of allocs) {
      detailRows.push({
        item_no: l.item_no,
        lot_no: a.lot_no,
        pallet_number: a.pallet_number,
        quantity: a.quantity,
      });
    }
  }

  const overallWeight =
    header.overallWeight !== '' && header.overallWeight != null
      ? header.overallWeight
      : totals.weight || 0;
  const qa = header.qa || {};

  return (
    <div className="bol-page" style={styles.bolPage}>
      <div style={styles.bolTitle}>
        BOL: {header.bolNumber || ''}
        {header.whsNumber ? '   *   ' + header.whsNumber : ''}
        <span style={styles.bolTitleDate}>
          Date: {formatDate(header.bolDate)}
        </span>
      </div>
      <div style={styles.bolDueDate}>
        Due Date: {formatDate(header.dueDate)}
      </div>
      {header.salesOrderNo ? (
        <div style={styles.bolSalesOrder}>
          Sales Order #: {header.salesOrderNo}
        </div>
      ) : null}

      <table style={styles.infoTable}>
        <tbody>
          <tr>
            <td style={styles.infoCellTall}>
              <span style={styles.infoLabel}>Ship To:</span>
              <div style={styles.infoStrong}>{header.shipToName}</div>
              <div style={styles.infoAddr}>{header.shipToAddress}</div>
            </td>
            <td style={styles.infoCellTall}>
              <span style={styles.infoLabel}>Ship From:</span>
              <div style={styles.infoStrong}>{header.shipFromName}</div>
              <div style={styles.infoAddr}>{header.shipFromAddress}</div>
            </td>
          </tr>
          <InfoPair shaded l={['Overall Weight in LB:', overallWeight]} r={['Customer PO Numbers:', header.customerPo]} />
          <InfoPair l={['Carrier Name:', header.carrierName]} r={['Trailer #:', header.trailerNumber]} />
          <InfoPair shaded l={['Seal #:', header.sealNumber]} r={['Temp Logger #:', header.tempLoggerNumber]} />
          <InfoPair l={['CHEP Pallet Count:', header.chepPalletCount]} r={['Truck Temp:', header.truckTemp]} />
          <InfoPair shaded l={['Total Cases:', totals.cases]} r={['Total Pallets:', totals.pallets]} />
        </tbody>
      </table>

      <div style={styles.bolHeading}>Description of Goods</div>
      <table style={styles.goodsTable}>
        <thead>
          <tr>
            <th style={styles.gTh}>Item Number</th>
            <th style={styles.gTh}>Description</th>
            <th style={styles.gThR}>Cases</th>
            <th style={styles.gThR}>Lbs.</th>
          </tr>
        </thead>
        <tbody>
          {goods.map((g, i) => (
            <tr key={i}>
              <td style={styles.gTd}>{g.item_no}</td>
              <td style={styles.gTd}>{g.description}</td>
              <td style={styles.gTdR}>{g.cases || ''}</td>
              <td style={styles.gTdR}>{g.lbs || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {header.tempWarning ? (
        <div style={styles.warning}>{header.tempWarning}</div>
      ) : null}

      <div style={styles.legalNote}>{LEGAL_NOTE}</div>
      <table style={styles.legalTable}>
        <tbody>
          <tr>
            <td style={styles.legalCell}>{CERT_LEFT}</td>
            <td style={styles.legalCell}>{CERT_RIGHT}</td>
          </tr>
          <tr>
            <td style={styles.legalCell}>
              <strong>Trailer Loaded By Shipper:</strong>{' '}
              {header.trailerLoadedByShipper}
            </td>
            <td style={styles.legalCell}>
              <strong>Trailer Loaded By Driver:</strong>{' '}
              {header.trailerLoadedByDriver}
            </td>
          </tr>
          <tr>
            <td style={styles.signCell}>
              {header.shipperSignature ? (
                <img
                  src={header.shipperSignature}
                  alt="Shipper signature"
                  style={styles.printSigImg}
                />
              ) : (
                <div style={styles.signSpace} />
              )}
              <div style={styles.signLabel}>
                Shipper Signature
                {header.shipperSignedAt
                  ? ' \u2014 ' + new Date(header.shipperSignedAt).toLocaleString()
                  : ''}
              </div>
            </td>
            <td style={styles.signCell}>
              {header.driverSignature ? (
                <img
                  src={header.driverSignature}
                  alt="Driver signature"
                  style={styles.printSigImg}
                />
              ) : (
                <div style={styles.signSpace} />
              )}
              <div style={styles.signLabel}>
                Driver Signature
                {header.driverSignedAt
                  ? ' \u2014 ' + new Date(header.driverSignedAt).toLocaleString()
                  : ''}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div style={styles.bolHeading}>QA Verification</div>
      <table style={styles.infoTable}>
        <tbody>
          <InfoPair shaded l={['Truck Temperature:', header.truckTemp]} r={['Temp Logger:', qa.tempLogger]} />
          <InfoPair l={['Condition of Trailer:', qa.conditionOfTrailer]} r={['Rodent Excreta Found:', qa.rodentExcreta]} />
          <InfoPair shaded l={['Odor?:', qa.odor]} r={['Possible Contamination:', qa.possibleContamination]} />
          <InfoPair l={['Possible Contamination Reason:', qa.possibleContaminationReason]} r={['Any Items Rejected?:', qa.anyItemsRejected]} />
          <InfoPair shaded l={['Items Rejected Reason:', qa.itemsRejectedReason]} r={['Any Items Placed On Hold?:', qa.anyItemsOnHold]} />
          <InfoPair l={['Items Placed on Hold Reason:', qa.itemsOnHoldReason]} r={['Damaged Items Found On Trailer?:', qa.damagedOnTrailer]} />
          <InfoPair shaded l={['Damaged Items While Loading:', qa.damagedWhileLoading]} r={['Comments:', qa.comments]} />
        </tbody>
      </table>

      <div style={styles.bolHeading}>BOL Detail</div>
      <table style={styles.goodsTable}>
        <thead>
          <tr>
            <th style={styles.gTh}>Item Number</th>
            <th style={styles.gTh}>Lot Number</th>
            <th style={styles.gTh}>Pallet Number</th>
            <th style={styles.gThR}>Quantity</th>
          </tr>
        </thead>
        <tbody>
          {detailRows.map((r, i) => (
            <tr key={i}>
              <td style={styles.gTd}>{r.item_no}</td>
              <td style={styles.gTd}>{r.lot_no}</td>
              <td style={styles.gTd}>{r.pallet_number}</td>
              <td style={styles.gTdR}>{r.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <span style={styles.infoVal}>{l[1] == null ? '' : String(l[1])}</span>
      </td>
      <td style={cell}>
        <span style={styles.infoLabel}>{r[0]}</span>{' '}
        <span style={styles.infoVal}>{r[1] == null ? '' : String(r[1])}</span>
      </td>
    </tr>
  );
}

// ---------- print CSS ----------
const printCss = `
@media screen {
  #bol-print { position: absolute; left: -10000px; top: 0; }
}
@media print {
  @page { size: letter portrait; margin: 0.5in; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .screen-only { display: none !important; }
  #bol-print { position: static !important; left: auto !important; }
}
`;

// ---------- styles ----------
const styles = {
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f8f8' },
  header: { backgroundColor: '#c8102e', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  headerInner: { maxWidth: '820px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', minHeight: '36px' },
  backText: { fontSize: '13px', color: '#fff', fontWeight: '500' },
  titleArea: { display: 'flex', alignItems: 'center', gap: '8px' },
  headerTitle: { fontSize: '18px', fontWeight: '700', color: '#fff' },
  content: { flex: 1, maxWidth: '820px', width: '100%', margin: '0 auto', padding: '20px 16px' },

  listTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  pageTitle: { fontSize: '22px', fontWeight: '700' },
  primaryBtn: { display: 'flex', alignItems: 'center', gap: '6px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  bcBar: { display: 'flex', gap: '8px', marginBottom: '12px' },
  bcPrimaryBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  bcSecondaryBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: '#fff', color: '#0f766e', border: '1px solid #99f6e4', borderRadius: '10px', padding: '12px 14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  bcCount: { background: 'rgba(255,255,255,0.25)', borderRadius: '999px', padding: '1px 8px', fontSize: '12px', fontWeight: '700' },
  importHelp: { fontSize: '13px', color: '#6b7280', marginBottom: '14px', lineHeight: 1.4 },
  fileLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', margin: '10px 0 6px' },
  fileInput: { width: '100%', fontSize: '14px' },
  filterToggle: { display: 'flex', alignItems: 'center', gap: '8px', background: 'transparent', border: 'none', cursor: 'pointer', padding: '10px 2px', fontSize: '14px', fontWeight: '600', color: '#374151', width: '100%' },
  checkbox: { width: '20px', height: '20px', borderRadius: '6px', border: '1px solid #d1d5db', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: '#fff', background: '#fff' },
  checkboxOn: { background: '#0f766e', borderColor: '#0f766e' },
  filterCount: { fontSize: '12px', fontWeight: '600', color: '#9ca3af', marginLeft: 'auto' },
  hint: { fontSize: '12px', color: '#9ca3af', margin: '6px 2px 16px' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  bolCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px', textAlign: 'left', cursor: 'pointer', width: '100%' },
  bolCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  bolNumber: { fontSize: '15px', fontWeight: '700', color: '#c8102e' },
  bolDate: { fontSize: '13px', color: '#6b7280' },
  bolCustomer: { fontSize: '15px', fontWeight: '600', marginTop: '4px' },
  bolMeta: { fontSize: '13px', color: '#6b7280', marginTop: '2px' },
  lotTags: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' },
  lotTag: { fontSize: '11px', fontWeight: '600', color: '#374151', background: '#f3f4f6', borderRadius: '6px', padding: '2px 8px' },

  searchWrap: { display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '16px', background: 'transparent' },
  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginBottom: '14px' },
  sectionTitle: { fontSize: '13px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' },
  fieldLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px', marginTop: '12px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '11px 13px', fontSize: '16px', boxSizing: 'border-box', marginBottom: '4px' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '11px 13px', fontSize: '15px', boxSizing: 'border-box', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' },
  twoCol: { display: 'flex', gap: '12px', alignItems: 'flex-end' },
  toggleRow: { display: 'flex', gap: '8px' },
  toggleBtn: { flex: 1, background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px', fontSize: '14px', fontWeight: '500', color: '#374151', cursor: 'pointer' },
  toggleActive: { background: '#c8102e', borderColor: '#c8102e', color: '#fff' },

  lineHeadRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' },
  smallBtn: { display: 'flex', alignItems: 'center', gap: '4px', background: '#fff1f2', color: '#c8102e', border: '1px solid #fecdd3', borderRadius: '8px', padding: '7px 12px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  lineCard: { border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px', marginBottom: '10px', background: '#fafafa' },
  lineCardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  chooseLotBtn: { width: '100%', marginTop: '8px', background: '#fff1f2', color: '#c8102e', border: '1px dashed #fca5a5', borderRadius: '8px', padding: '9px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  chooseLotBtnSet: { background: '#ecfdf5', color: '#0f766e', border: '1px solid #99f6e4' },
  chooseLotBtnWarn: { background: '#fffbeb', color: '#a16207', border: '1px solid #fde68a' },
  warnText: { marginTop: '6px', fontSize: '12px', fontWeight: '600', color: '#a16207' },
  itemNo: { fontSize: '15px', fontWeight: '700', color: '#1a1a1a' },
  itemDesc: { fontSize: '13px', color: '#6b7280', marginTop: '2px' },
  lineGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '8px', marginTop: '10px' },
  lineField: { display: 'flex', flexDirection: 'column' },
  lineFieldLabel: { fontSize: '11px', fontWeight: '600', color: '#6b7280', marginBottom: '3px' },
  lineInput: { border: '1px solid #d1d5db', borderRadius: '8px', padding: '8px 10px', fontSize: '15px', boxSizing: 'border-box', width: '100%' },
  totalsRow: { display: 'flex', gap: '20px', justifyContent: 'flex-end', fontSize: '14px', color: '#374151', marginTop: '8px', paddingTop: '10px', borderTop: '1px solid #e5e7eb' },

  message: { fontSize: '14px', fontWeight: '600', marginBottom: '10px' },
  bannerWarn: { display: 'flex', alignItems: 'center', gap: '8px', background: '#fffbeb', color: '#a16207', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 12px', fontSize: '13px', fontWeight: '600', marginBottom: '10px' },
  actionRow: { display: 'flex', gap: '10px' },
  saveBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '15px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' },
  printBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '12px', padding: '15px 20px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { background: '#d1d5db', cursor: 'not-allowed' },
  altBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' },
  emailBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' },
  deleteLinkBtn: { display: 'block', width: '100%', background: 'transparent', color: '#c8102e', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '20px 8px 8px', textAlign: 'center', textDecoration: 'underline' },
  deleteConfirmBox: { background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '12px', padding: '14px', marginTop: '16px' },
  deleteConfirmText: { fontSize: '14px', fontWeight: '600', color: '#9f1239', marginBottom: '12px', textAlign: 'center' },
  deleteBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200 },
  modal: { background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '640px', maxHeight: '80vh', padding: '16px', display: 'flex', flexDirection: 'column' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  modalTitle: { fontSize: '17px', fontWeight: '700' },
  iconBtn: { background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px' },
  modalList: { display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', maxHeight: '40vh' },
  itemRow: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer', textAlign: 'left', width: '100%' },
  itemRowBlocked: { opacity: 0.5, cursor: 'not-allowed' },
  outOfStock: { marginLeft: '8px', fontSize: '10px', fontWeight: 700, color: '#c8102e', background: '#fee2e2', borderRadius: '4px', padding: '2px 6px' },
  allocRow: { display: 'flex', gap: '8px', alignItems: 'center', padding: '8px', background: '#fafafa', borderRadius: '8px', marginBottom: '6px' },
  allocField: { display: 'flex', flexDirection: 'column' },
  allocLabel: { fontSize: '10px', fontWeight: 700, color: '#6b7280' },
  allocInput: { width: '80px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '6px 8px', fontSize: '14px' },
  linkBtn: { background: 'transparent', border: 'none', color: '#c8102e', fontSize: '14px', fontWeight: '600', cursor: 'pointer', padding: '10px', textAlign: 'left' },

  // ----- printable El Pinto BOL -----
  bolPage: { width: '7.5in', color: '#000', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '11px' },
  bolTitle: { fontSize: '20px', fontWeight: '700' },
  bolTitleDate: { marginLeft: '24px' },
  bolDueDate: { fontSize: '18px', fontWeight: '700', marginBottom: '4px' },
  bolSalesOrder: { fontSize: '14px', fontWeight: '600', marginBottom: '10px', color: '#444' },

  infoTable: { width: '100%', borderCollapse: 'collapse', border: '1px solid #999', marginBottom: '12px', tableLayout: 'fixed' },
  infoCellTall: { border: '1px solid #ccc', padding: '6px 8px', verticalAlign: 'top', width: '50%' },
  infoCell: { border: '1px solid #ccc', padding: '4px 8px', verticalAlign: 'top', width: '50%', fontSize: '11px' },
  infoLabel: { fontWeight: '700' },
  infoVal: {},
  infoStrong: { fontWeight: '700', fontSize: '12px', marginTop: '2px' },
  infoAddr: { fontSize: '11px', whiteSpace: 'pre-wrap' },

  bolHeading: { fontSize: '17px', fontWeight: '700', margin: '14px 0 6px' },
  goodsTable: { width: '100%', borderCollapse: 'collapse', marginBottom: '10px' },
  gTh: { border: '1px solid #999', padding: '5px 6px', textAlign: 'left', background: '#f0f0f0', fontSize: '10px', fontFamily: 'Arial, sans-serif' },
  gThR: { border: '1px solid #999', padding: '5px 6px', textAlign: 'right', background: '#f0f0f0', fontSize: '10px', fontFamily: 'Arial, sans-serif' },
  gTd: { border: '1px solid #ccc', padding: '4px 6px', fontSize: '11px', fontFamily: 'Arial, sans-serif' },
  gTdR: { border: '1px solid #ccc', padding: '4px 6px', fontSize: '11px', textAlign: 'right', fontFamily: 'Arial, sans-serif' },

  warning: { fontWeight: '700', fontSize: '15px', margin: '14px 0', lineHeight: 1.3 },

  legalNote: { border: '1px solid #999', borderBottom: 'none', padding: '4px 6px', fontSize: '10px', fontFamily: 'Arial, sans-serif' },
  legalTable: { width: '100%', borderCollapse: 'collapse', marginBottom: '12px', tableLayout: 'fixed' },
  legalCell: { border: '1px solid #999', padding: '6px', fontSize: '9px', verticalAlign: 'top', width: '50%', fontFamily: 'Arial, sans-serif' },
  signCell: { border: '1px solid #999', padding: '6px', verticalAlign: 'top', width: '50%' },
  signSpace: { height: '54px' },
  signLabel: { fontSize: '9px', fontFamily: 'Arial, sans-serif' },
  printSigImg: { display: 'block', maxHeight: '54px', maxWidth: '100%', objectFit: 'contain' },

  // ----- digital signature -----
  sigPadFrame: { background: '#fff', border: '2px dashed #c8102e', borderRadius: '10px', padding: '0', overflow: 'hidden' },
  sigPadCanvas: { display: 'block', width: '100%', height: '200px', touchAction: 'none', background: '#fff', cursor: 'crosshair' },
  sigBox: { flex: 1, background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px', minWidth: 0 },
  sigBoxLabel: { fontSize: '12px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' },
  sigImage: { display: 'block', width: '100%', maxHeight: '80px', objectFit: 'contain', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px' },
  sigSignedAt: { fontSize: '11px', color: '#6b7280', marginTop: '6px' },
  sigSignBtn: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: '#fff', color: '#c8102e', border: '1px dashed #fca5a5', borderRadius: '8px', padding: '24px 12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  sigClearBtn: { marginTop: '6px', width: '100%', background: 'transparent', color: '#6b7280', border: 'none', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' },
};