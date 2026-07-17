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
  ShoppingCart,
  Calendar,
  Package,
} from 'lucide-react';

const STATUSES = [
  { value: 'open', label: 'Open', color: '#a16207', bg: '#fef3c7' },
  { value: 'partially_received', label: 'Partial', color: '#1d4ed8', bg: '#dbeafe' },
  { value: 'received', label: 'Received', color: '#065f46', bg: '#d1fae5' },
  { value: 'closed', label: 'Closed', color: '#374151', bg: '#f3f4f6' },
  { value: 'void', label: 'Void', color: '#c8102e', bg: '#fee2e2' },
];

const blankLine = () => ({
  _key: Math.random().toString(36).slice(2),
  item_no: '',
  description: '',
  quantity: '',
  uom: 'CASE',
  unit_price: '',
  notes: '',
});

const blankPo = () => ({
  po_number: '',
  vendor_id: '',
  vendor_name: '',
  status: 'open',
  order_date: new Date().toISOString().slice(0, 10),
  expected_date: '',
  ship_to_location: 'ABQEP',
  freight_terms: '',
  notes: '',
});

export default function POTracker() {
  const navigate = useNavigate();
  const [view, setView] = useState('list');
  const [pos, setPos] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');

  const [editingId, setEditingId] = useState(null);
  const [header, setHeader] = useState(blankPo());
  const [lines, setLines] = useState([blankLine()]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Items linked to the currently-selected vendor (for line item picker)
  const [vendorItems, setVendorItems] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [posRes, vendRes] = await Promise.all([
      supabase
        .schema('procurement')
        .from('pos')
        .select('*')
        .order('order_date', { ascending: false })
        .limit(500),
      supabase
        .schema('procurement')
        .from('vendors')
        .select('id, name')
        .eq('active', true)
        .order('name'),
    ]);
    setPos(posRes.data || []);
    setVendors(vendRes.data || []);
    setLoading(false);
  }

  const vendorNameById = useMemo(() => {
    const m = new Map();
    for (const v of vendors) m.set(v.id, v.name);
    return m;
  }, [vendors]);

  async function loadVendorItems(vendorId) {
    if (!vendorId) {
      setVendorItems([]);
      return;
    }
    const { data } = await supabase
      .schema('procurement')
      .from('vendor_items')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('item_no');
    setVendorItems(data || []);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pos.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (p.po_number || '').toLowerCase().includes(q) ||
        (p.vendor_name || '').toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q)
      );
    });
  }, [pos, search, statusFilter]);

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

  function startNew() {
    setEditingId(null);
    // Auto-generate a PO number: EPPO-YYYY-#### (based on count of existing POs)
    const year = new Date().getFullYear();
    const seq = String(pos.length + 1).padStart(4, '0');
    setHeader({ ...blankPo(), po_number: `EPPO-${year}-${seq}` });
    setLines([blankLine()]);
    setVendorItems([]);
    setMessage('');
    setConfirmDelete(false);
    setView('edit');
  }

  async function openPo(p) {
    setEditingId(p.id);
    setHeader({
      po_number: p.po_number || '',
      vendor_id: p.vendor_id || '',
      vendor_name: p.vendor_name || '',
      status: p.status || 'open',
      order_date: p.order_date || '',
      expected_date: p.expected_date || '',
      ship_to_location: p.ship_to_location || 'ABQEP',
      freight_terms: p.freight_terms || '',
      notes: p.notes || '',
    });
    if (p.vendor_id) loadVendorItems(p.vendor_id);
    else setVendorItems([]);
    // load lines
    const { data: lineRows } = await supabase
      .schema('procurement')
      .from('po_lines')
      .select('*')
      .eq('po_id', p.id)
      .order('line_no');
    setLines(
      (lineRows || []).map((r) => ({
        _key: r.id,
        id: r.id,
        line_no: r.line_no,
        item_no: r.item_no || '',
        description: r.description || '',
        quantity: r.quantity ?? '',
        uom: r.uom || 'CASE',
        unit_price: r.unit_price ?? '',
        received_qty: r.received_qty ?? 0,
        notes: r.notes || '',
      }))
    );
    setMessage('');
    setConfirmDelete(false);
    setView('edit');
  }

  const totalAmount = useMemo(() => {
    return lines.reduce((s, l) => {
      const q = Number(l.quantity) || 0;
      const p = Number(l.unit_price) || 0;
      return s + q * p;
    }, 0);
  }, [lines]);

  async function savePo() {
    if (!header.po_number.trim()) {
      setMessage('PO number is required');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const row = {
        po_number: header.po_number.trim(),
        vendor_id: header.vendor_id || null,
        vendor_name:
          header.vendor_name || vendorNameById.get(header.vendor_id) || null,
        status: header.status,
        order_date: header.order_date || null,
        expected_date: header.expected_date || null,
        ship_to_location: header.ship_to_location || null,
        freight_terms: header.freight_terms || null,
        notes: header.notes || null,
        total_amount: totalAmount,
        updated_at: new Date().toISOString(),
      };

      let poId;
      if (editingId) {
        const { error } = await supabase
          .schema('procurement')
          .from('pos')
          .update(row)
          .eq('id', editingId);
        if (error) throw error;
        poId = editingId;
      } else {
        const { data, error } = await supabase
          .schema('procurement')
          .from('pos')
          .insert(row)
          .select()
          .single();
        if (error) throw error;
        poId = data.id;
        setEditingId(poId);
      }

      // Replace lines: cleanest approach for a small line count
      const { error: delErr } = await supabase
        .schema('procurement')
        .from('po_lines')
        .delete()
        .eq('po_id', poId);
      if (delErr) throw delErr;

      const lineRows = lines
        .filter((l) => (l.item_no || '').trim() || (l.description || '').trim())
        .map((l, idx) => ({
          po_id: poId,
          line_no: idx + 1,
          item_no: l.item_no || null,
          description: l.description || null,
          quantity: l.quantity === '' ? null : Number(l.quantity),
          uom: l.uom || null,
          unit_price: l.unit_price === '' ? null : Number(l.unit_price),
          line_total:
            l.quantity === '' || l.unit_price === ''
              ? null
              : Number(l.quantity) * Number(l.unit_price),
          received_qty: Number(l.received_qty) || 0,
          notes: l.notes || null,
        }));
      if (lineRows.length > 0) {
        const { error: lineErr } = await supabase
          .schema('procurement')
          .from('po_lines')
          .insert(lineRows);
        if (lineErr) throw lineErr;
      }

      // Update vendor_items with new "last price / last date" for each linked item
      if (header.vendor_id) {
        const purchaseDate = header.order_date || new Date().toISOString().slice(0, 10);
        for (const l of lineRows) {
          if (!l.item_no || l.unit_price == null) continue;
          // Best-effort upsert (won't fail the save if it errors)
          await supabase
            .schema('procurement')
            .from('vendor_items')
            .update({
              last_unit_price: l.unit_price,
              last_purchase_date: purchaseDate,
              updated_at: new Date().toISOString(),
            })
            .eq('vendor_id', header.vendor_id)
            .eq('item_no', l.item_no);
        }
      }

      setMessage('Saved \u2713');
      load();
    } catch (e) {
      setMessage('Error saving: ' + (e.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }

  async function deletePo() {
    if (!editingId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .schema('procurement')
        .from('pos')
        .delete()
        .eq('id', editingId);
      if (error) throw error;
      setEditingId(null);
      setView('list');
      load();
    } catch (e) {
      setMessage('Error deleting: ' + (e.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }

  function selectVendor(vendorId) {
    setH('vendor_id', vendorId);
    const v = vendors.find((x) => x.id === vendorId);
    if (v) setH('vendor_name', v.name);
    loadVendorItems(vendorId);
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
            <span style={styles.backText}>{view === 'edit' ? 'POs' : 'Home'}</span>
          </button>
          <div style={styles.titleArea}>
            <ShoppingCart size={18} color="#fff" />
            <span style={styles.headerTitle}>
              {view === 'edit'
                ? editingId
                  ? 'Edit PO'
                  : 'New PO'
                : 'Purchase Orders'}
            </span>
          </div>
          <div style={{ width: '70px' }} />
        </div>
      </div>

      <div style={styles.content}>
        {view === 'list' ? (
          <ListView
            pos={filtered}
            total={pos.length}
            loading={loading}
            search={search}
            setSearch={setSearch}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onNew={startNew}
            onOpen={openPo}
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
            totalAmount={totalAmount}
            vendors={vendors}
            vendorItems={vendorItems}
            selectVendor={selectVendor}
            saving={saving}
            message={message}
            editingId={editingId}
            confirmDelete={confirmDelete}
            onSave={savePo}
            onRequestDelete={() => setConfirmDelete(true)}
            onCancelDelete={() => setConfirmDelete(false)}
            onConfirmDelete={deletePo}
          />
        )}
      </div>
    </div>
  );
}

function ListView({
  pos,
  total,
  loading,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  onNew,
  onOpen,
  vendorNameById,
}) {
  return (
    <>
      <div style={styles.topRow}>
        <h2 style={styles.pageTitle}>POs ({total})</h2>
        <button style={styles.primaryBtn} onClick={onNew}>
          <Plus size={18} />
          New PO
        </button>
      </div>

      <div style={styles.searchWrap}>
        <Search size={18} color="#9ca3af" />
        <input
          style={styles.searchInput}
          placeholder="Search PO#, vendor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={styles.chipRow}>
        <button
          style={{
            ...styles.chip,
            ...(statusFilter === 'all' ? styles.chipActive : {}),
          }}
          onClick={() => setStatusFilter('all')}
        >
          All
        </button>
        {STATUSES.map((s) => (
          <button
            key={s.value}
            style={{
              ...styles.chip,
              ...(statusFilter === s.value ? styles.chipActive : {}),
            }}
            onClick={() => setStatusFilter(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading...</p>
      ) : pos.length === 0 ? (
        <div style={styles.empty}>
          <ShoppingCart size={32} color="#d1d5db" />
          <p style={{ color: '#9ca3af', marginTop: '8px' }}>
            No POs match. Tap "New PO" to create one.
          </p>
        </div>
      ) : (
        <div style={styles.list}>
          {pos.map((p) => {
            const s = STATUSES.find((x) => x.value === p.status) || STATUSES[0];
            return (
              <button key={p.id} style={styles.card} onClick={() => onOpen(p)}>
                <div style={styles.cardTop}>
                  <span style={styles.poNumber}>{p.po_number}</span>
                  <span
                    style={{
                      ...styles.statusChip,
                      color: s.color,
                      background: s.bg,
                    }}
                  >
                    {s.label}
                  </span>
                </div>
                <div style={styles.poVendor}>
                  {p.vendor_name || vendorNameById.get(p.vendor_id) || '(no vendor)'}
                </div>
                <div style={styles.poMeta}>
                  {p.order_date ? (
                    <span>
                      <Calendar size={11} /> Ordered {p.order_date}
                    </span>
                  ) : null}
                  {p.expected_date ? (
                    <span>
                      <Package size={11} /> Expected {p.expected_date}
                    </span>
                  ) : null}
                  {p.total_amount ? (
                    <span>${Number(p.total_amount).toFixed(2)}</span>
                  ) : null}
                </div>
              </button>
            );
          })}
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
  totalAmount,
  vendors,
  vendorItems,
  selectVendor,
  saving,
  message,
  editingId,
  confirmDelete,
  onSave,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}) {
  return (
    <>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>PO details</div>
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>PO number *</label>
            <input
              style={styles.input}
              value={header.po_number}
              onChange={(e) => setH('po_number', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Status</label>
            <select
              style={styles.input}
              value={header.status}
              onChange={(e) => setH('status', e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label style={styles.fieldLabel}>Vendor</label>
        <select
          style={styles.input}
          value={header.vendor_id || ''}
          onChange={(e) => selectVendor(e.target.value)}
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
            <label style={styles.fieldLabel}>Order date</label>
            <input
              style={styles.input}
              type="date"
              value={header.order_date || ''}
              onChange={(e) => setH('order_date', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Expected date</label>
            <input
              style={styles.input}
              type="date"
              value={header.expected_date || ''}
              onChange={(e) => setH('expected_date', e.target.value)}
            />
          </div>
        </div>
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Freight terms</label>
            <input
              style={styles.input}
              value={header.freight_terms}
              onChange={(e) => setH('freight_terms', e.target.value)}
              placeholder="FOB origin, prepaid, etc."
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Ship to</label>
            <input
              style={styles.input}
              value={header.ship_to_location}
              onChange={(e) => setH('ship_to_location', e.target.value)}
            />
          </div>
        </div>
        <label style={styles.fieldLabel}>Notes</label>
        <textarea
          style={styles.textarea}
          value={header.notes}
          onChange={(e) => setH('notes', e.target.value)}
        />
      </div>

      <div style={styles.section}>
        <div style={styles.lineHeadRow}>
          <div style={styles.sectionTitle}>Line items</div>
          <span style={styles.pill}>
            {lines.length} line{lines.length === 1 ? '' : 's'} · $
            {totalAmount.toFixed(2)}
          </span>
        </div>
        {lines.map((l) => (
          <div key={l._key} style={styles.lineCard}>
            <div style={styles.twoCol}>
              <div style={{ flex: 1 }}>
                <label style={styles.miniLabel}>Item #</label>
                {vendorItems && vendorItems.length > 0 ? (
                  <select
                    style={styles.miniInput}
                    value={l.item_no || ''}
                    onChange={(e) => {
                      const picked = e.target.value;
                      const vi = vendorItems.find((x) => x.item_no === picked);
                      // Autofill description, UoM, unit price from vendor_items
                      setLine(l._key, 'item_no', picked);
                      if (vi) {
                        setLine(l._key, 'description', vi.description || '');
                        if (vi.uom) setLine(l._key, 'uom', vi.uom);
                        if (vi.last_unit_price != null)
                          setLine(l._key, 'unit_price', String(vi.last_unit_price));
                      }
                    }}
                  >
                    <option value="">(pick item)</option>
                    {vendorItems.map((vi) => (
                      <option key={vi.item_no} value={vi.item_no}>
                        {vi.item_no}
                        {vi.description ? ' — ' + vi.description.slice(0, 30) : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    style={styles.miniInput}
                    value={l.item_no}
                    onChange={(e) => setLine(l._key, 'item_no', e.target.value)}
                    placeholder={
                      !header.vendor_id
                        ? 'Pick vendor first'
                        : 'No items linked'
                    }
                  />
                )}
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
                <label style={styles.miniLabel}>Qty</label>
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
                <label style={styles.miniLabel}>Unit price</label>
                <input
                  style={styles.miniInput}
                  type="number"
                  step="0.01"
                  value={l.unit_price}
                  onChange={(e) =>
                    setLine(l._key, 'unit_price', e.target.value)
                  }
                />
              </div>
            </div>
            {l.received_qty ? (
              <div style={styles.receivedNote}>
                Received: <strong>{l.received_qty}</strong> of {l.quantity || 0}
              </div>
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
          {saving ? 'Saving...' : editingId ? 'Update PO' : 'Save PO'}
        </button>
      </div>

      {editingId ? (
        confirmDelete ? (
          <div style={styles.deleteConfirmBox}>
            <div style={styles.deleteConfirmText}>Delete this PO permanently?</div>
            <div style={styles.actionRow}>
              <button style={styles.altBtn} onClick={onCancelDelete}>
                Cancel
              </button>
              <button style={styles.deleteBtn} onClick={onConfirmDelete}>
                <Trash2 size={18} />
                Yes, delete PO
              </button>
            </div>
          </div>
        ) : (
          <button style={styles.deleteLinkBtn} onClick={onRequestDelete}>
            Delete this PO
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
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' },
  chip: { fontSize: '13px', fontWeight: 600, background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '5px 12px', cursor: 'pointer' },
  chipActive: { background: '#c8102e', color: '#fff', borderColor: '#c8102e' },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px', textAlign: 'left', cursor: 'pointer', width: '100%' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
  poNumber: { fontSize: '15px', fontWeight: 700, color: '#c8102e' },
  statusChip: { fontSize: '11px', fontWeight: 700, borderRadius: '999px', padding: '2px 10px' },
  poVendor: { fontSize: '15px', fontWeight: '600', marginBottom: '4px' },
  poMeta: { display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12px', color: '#6b7280' },

  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginBottom: '12px' },
  sectionTitle: { fontSize: '13px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' },
  fieldLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px', marginTop: '10px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '15px', boxSizing: 'border-box', marginBottom: '4px' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '14px', boxSizing: 'border-box', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' },
  twoCol: { display: 'flex', gap: '10px' },

  lineHeadRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' },
  pill: { fontSize: '12px', fontWeight: 700, background: '#f3f4f6', color: '#374151', borderRadius: '999px', padding: '2px 10px' },
  lineCard: { border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px', marginBottom: '8px', background: '#fafafa' },
  miniLabel: { display: 'block', fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '2px', marginTop: '6px' },
  miniInput: { width: '100%', border: '1px solid #d1d5db', borderRadius: '8px', padding: '6px 8px', fontSize: '13px', boxSizing: 'border-box', background: '#fff' },
  receivedNote: { fontSize: '12px', color: '#065f46', background: '#d1fae5', border: '1px solid #99f6e4', borderRadius: '6px', padding: '4px 8px', marginTop: '6px' },
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