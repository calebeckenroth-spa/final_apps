import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';
import {
  ChevronLeft,
  Search,
  Plus,
  X,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';

const SHIP_LOCATION = 'ABQEP';

const CATEGORIES = [
  { value: 'ingredient', label: 'Ingredient' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'mro', label: 'MRO' },
  { value: 'other', label: 'Other' },
];

export default function ReorderWatch() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [items, setItems] = useState([]); // from public.items (BC snapshot)
  const [reorderPoints, setReorderPoints] = useState([]);
  const [vendors, setVendors] = useState([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'low' | 'ok' | 'unset'

  const [editing, setEditing] = useState(null); // reorder_point row or {new: true, item_no, description}
  const [message, setMessage] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setRefreshing(true);
    try {
      const [itemsRes, rpRes, vendRes] = await Promise.all([
        supabase.from('items').select('*').limit(10000),
        supabase.schema('procurement').from('reorder_points').select('*'),
        supabase
          .schema('procurement')
          .from('vendors')
          .select('id, name')
          .eq('active', true)
          .order('name'),
      ]);
      setItems(itemsRes.data || []);
      setReorderPoints(rpRes.data || []);
      setVendors(vendRes.data || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Roll BC on-hand up to per-item totals at our ship location
  const itemsByNo = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if ((it.location_code || '').toUpperCase() !== SHIP_LOCATION) continue;
      const cur = map.get(it.item_no) || {
        item_no: it.item_no,
        description: it.description || '',
        total: 0,
      };
      cur.total += Number(it.bc_quantity) || 0;
      // Prefer non-empty description if we didn't have one yet
      if (!cur.description && it.description) cur.description = it.description;
      map.set(it.item_no, cur);
    }
    return map;
  }, [items]);

  const rpByItem = useMemo(() => {
    const m = new Map();
    for (const rp of reorderPoints) m.set(rp.item_no, rp);
    return m;
  }, [reorderPoints]);

  // Watchlist rows: one row per tracked item, plus (optionally) untracked items
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [];
    for (const rp of reorderPoints) {
      const inv = itemsByNo.get(rp.item_no);
      const onHand = inv ? inv.total : 0;
      const rpVal = Number(rp.reorder_point) || 0;
      let status = 'ok';
      if (onHand <= 0) status = 'out';
      else if (onHand <= rpVal) status = 'low';
      list.push({
        rp,
        item_no: rp.item_no,
        description: rp.description || inv?.description || '',
        on_hand: onHand,
        reorder_point: rpVal,
        target: Number(rp.target_stock) || null,
        status,
        preferred_vendor_id: rp.preferred_vendor_id,
        category: rp.category,
      });
    }
    list.sort((a, b) => {
      const rank = { out: 0, low: 1, ok: 2 };
      if (rank[a.status] !== rank[b.status])
        return rank[a.status] - rank[b.status];
      return (a.item_no || '').localeCompare(b.item_no || '');
    });
    return list.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (r.item_no || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      );
    });
  }, [reorderPoints, itemsByNo, search, statusFilter]);

  const stats = useMemo(() => {
    const s = { out: 0, low: 0, ok: 0, tracked: reorderPoints.length };
    for (const rp of reorderPoints) {
      const inv = itemsByNo.get(rp.item_no);
      const onHand = inv ? inv.total : 0;
      const rpVal = Number(rp.reorder_point) || 0;
      if (onHand <= 0) s.out++;
      else if (onHand <= rpVal) s.low++;
      else s.ok++;
    }
    return s;
  }, [reorderPoints, itemsByNo]);

  const vendorNameById = useMemo(() => {
    const m = new Map();
    for (const v of vendors) m.set(v.id, v.name);
    return m;
  }, [vendors]);

  async function saveReorderPoint(rp) {
    if (!rp.item_no || !rp.item_no.trim()) {
      setMessage('Item number is required');
      return;
    }
    if (rp.reorder_point === '' || rp.reorder_point == null) {
      setMessage('Reorder point is required');
      return;
    }
    try {
      const row = {
        item_no: rp.item_no.trim(),
        description: rp.description || null,
        reorder_point: Number(rp.reorder_point),
        target_stock:
          rp.target_stock === '' || rp.target_stock == null
            ? null
            : Number(rp.target_stock),
        preferred_vendor_id: rp.preferred_vendor_id || null,
        category: rp.category || null,
        notes: rp.notes || null,
        updated_at: new Date().toISOString(),
      };
      if (rp.id) {
        const { error } = await supabase
          .schema('procurement')
          .from('reorder_points')
          .update(row)
          .eq('id', rp.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .schema('procurement')
          .from('reorder_points')
          .insert(row);
        if (error) throw error;
      }
      setMessage('Saved \u2713');
      setEditing(null);
      load();
    } catch (e) {
      setMessage('Error saving: ' + (e.message || 'unknown error'));
    }
  }

  async function deleteReorderPoint(id) {
    if (!id) return;
    try {
      const { error } = await supabase
        .schema('procurement')
        .from('reorder_points')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setEditing(null);
      load();
    } catch (e) {
      setMessage('Error deleting: ' + (e.message || 'unknown error'));
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerInner}>
          <button style={styles.backButton} onClick={() => navigate('/')}>
            <ChevronLeft size={20} color="#fff" />
            <span style={styles.backText}>Home</span>
          </button>
          <div style={styles.titleArea}>
            <AlertCircle size={18} color="#fff" />
            <span style={styles.headerTitle}>Reorder Watch</span>
          </div>
          <button
            style={styles.refreshBtn}
            onClick={load}
            disabled={refreshing}
          >
            <RefreshCw
              size={18}
              color="#fff"
              style={{
                animation: refreshing ? 'spin 1s linear infinite' : 'none',
              }}
            />
          </button>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>

      <div style={styles.content}>
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading...</p>
        ) : (
          <>
            {/* Stat row */}
            <div style={styles.statRow}>
              <Stat label="Out" value={stats.out} tone="#c8102e" />
              <Stat label="Low" value={stats.low} tone="#a16207" />
              <Stat label="OK" value={stats.ok} tone="#0f766e" />
              <Stat label="Tracked" value={stats.tracked} tone="#374151" />
            </div>

            <div style={styles.searchWrap}>
              <Search size={18} color="#9ca3af" />
              <input
                style={styles.searchInput}
                placeholder="Search item # or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div style={styles.chipRow}>
              {[
                { value: 'all', label: 'All' },
                { value: 'out', label: 'Out' },
                { value: 'low', label: 'Low' },
                { value: 'ok', label: 'OK' },
              ].map((f) => (
                <button
                  key={f.value}
                  style={{
                    ...styles.chip,
                    ...(statusFilter === f.value ? styles.chipActive : {}),
                  }}
                  onClick={() => setStatusFilter(f.value)}
                >
                  {f.label}
                </button>
              ))}
              <button
                style={{ ...styles.chip, ...styles.chipAdd }}
                onClick={() =>
                  setEditing({
                    new: true,
                    item_no: '',
                    description: '',
                    reorder_point: '',
                    target_stock: '',
                    preferred_vendor_id: '',
                    category: 'ingredient',
                    notes: '',
                  })
                }
              >
                <Plus size={14} />
                Track new item
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

            {rows.length === 0 ? (
              <div style={styles.empty}>
                <AlertCircle size={32} color="#d1d5db" />
                <p style={{ color: '#9ca3af', marginTop: '8px' }}>
                  {reorderPoints.length === 0
                    ? 'No tracked items yet. Add an item to start watching.'
                    : 'Nothing matches your filter.'}
                </p>
              </div>
            ) : (
              <div style={styles.list}>
                {rows.map((r) => (
                  <div key={r.rp.id} style={styles.rowCard}>
                    <div style={styles.rowTop}>
                      <div>
                        <div style={styles.itemNo}>{r.item_no}</div>
                        <div style={styles.itemDesc}>{r.description}</div>
                      </div>
                      <StatusPill status={r.status} />
                    </div>
                    <div style={styles.numbersRow}>
                      <div style={styles.numBox}>
                        <div style={styles.numLabel}>On hand</div>
                        <div
                          style={{
                            ...styles.numValue,
                            color:
                              r.status === 'out'
                                ? '#c8102e'
                                : r.status === 'low'
                                  ? '#a16207'
                                  : '#111',
                          }}
                        >
                          {r.on_hand}
                        </div>
                      </div>
                      <div style={styles.numBox}>
                        <div style={styles.numLabel}>Reorder pt</div>
                        <div style={styles.numValue}>{r.reorder_point}</div>
                      </div>
                      {r.target ? (
                        <div style={styles.numBox}>
                          <div style={styles.numLabel}>Target</div>
                          <div style={styles.numValue}>{r.target}</div>
                        </div>
                      ) : null}
                    </div>
                    <div style={styles.rowFooter}>
                      {r.preferred_vendor_id ? (
                        <div style={styles.vendorLine}>
                          Vendor:{' '}
                          <strong>
                            {vendorNameById.get(r.preferred_vendor_id) ||
                              '(unknown)'}
                          </strong>
                        </div>
                      ) : (
                        <div style={styles.vendorLine}>No preferred vendor</div>
                      )}
                      <button
                        style={styles.editLink}
                        onClick={() =>
                          setEditing({ ...r.rp })
                        }
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {editing && (
        <EditModal
          value={editing}
          setValue={setEditing}
          vendors={vendors}
          onSave={() => saveReorderPoint(editing)}
          onDelete={() => deleteReorderPoint(editing.id)}
          onClose={() => setEditing(null)}
          allItems={itemsByNo}
        />
      )}
    </div>
  );
}

// ---------- helpers ----------
function Stat({ label, value, tone }) {
  return (
    <div style={{ ...styles.stat, borderColor: tone }}>
      <div style={{ ...styles.statValue, color: tone }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function StatusPill({ status }) {
  if (status === 'out')
    return (
      <span style={{ ...styles.pill, ...styles.pillOut }}>
        <AlertTriangle size={12} /> Out
      </span>
    );
  if (status === 'low')
    return (
      <span style={{ ...styles.pill, ...styles.pillLow }}>
        <AlertCircle size={12} /> Low
      </span>
    );
  return (
    <span style={{ ...styles.pill, ...styles.pillOk }}>
      <CheckCircle2 size={12} /> OK
    </span>
  );
}

function EditModal({ value, setValue, vendors, onSave, onDelete, onClose, allItems }) {
  // Simple autocomplete: if editing a new one, offer matching items
  const [suggest, setSuggest] = useState([]);
  useEffect(() => {
    if (!value.new) return;
    const q = (value.item_no || '').trim().toLowerCase();
    if (!q) {
      setSuggest([]);
      return;
    }
    const matches = [];
    for (const [k, v] of allItems.entries()) {
      if (
        k.toLowerCase().includes(q) ||
        (v.description || '').toLowerCase().includes(q)
      )
        matches.push(v);
      if (matches.length >= 6) break;
    }
    setSuggest(matches);
  }, [value.item_no, allItems, value.new]);

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHead}>
          <span style={styles.modalTitle}>
            {value.id ? 'Edit tracked item' : 'Track new item'}
          </span>
          <button style={styles.iconBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <label style={styles.fieldLabel}>Item number *</label>
        <input
          style={styles.input}
          value={value.item_no}
          onChange={(e) =>
            setValue({ ...value, item_no: e.target.value })
          }
          placeholder="e.g. SAMDSAEP16"
          disabled={!value.new && !!value.id}
        />
        {suggest.length > 0 && value.new && (
          <div style={styles.suggestBox}>
            {suggest.map((s) => (
              <button
                key={s.item_no}
                style={styles.suggestRow}
                onClick={() =>
                  setValue({
                    ...value,
                    item_no: s.item_no,
                    description: s.description,
                  })
                }
              >
                <span style={{ fontWeight: 700 }}>{s.item_no}</span>
                <span style={{ color: '#6b7280', fontSize: 12 }}>
                  {s.description}
                </span>
              </button>
            ))}
          </div>
        )}

        <label style={styles.fieldLabel}>Description</label>
        <input
          style={styles.input}
          value={value.description || ''}
          onChange={(e) => setValue({ ...value, description: e.target.value })}
        />

        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Reorder point *</label>
            <input
              style={styles.input}
              type="number"
              value={value.reorder_point}
              onChange={(e) =>
                setValue({ ...value, reorder_point: e.target.value })
              }
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Target stock</label>
            <input
              style={styles.input}
              type="number"
              value={value.target_stock || ''}
              onChange={(e) =>
                setValue({ ...value, target_stock: e.target.value })
              }
              placeholder="Bring back to..."
            />
          </div>
        </div>

        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Category</label>
            <select
              style={styles.input}
              value={value.category || 'ingredient'}
              onChange={(e) => setValue({ ...value, category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Preferred vendor</label>
            <select
              style={styles.input}
              value={value.preferred_vendor_id || ''}
              onChange={(e) =>
                setValue({ ...value, preferred_vendor_id: e.target.value })
              }
            >
              <option value="">(none)</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label style={styles.fieldLabel}>Notes</label>
        <textarea
          style={styles.textarea}
          value={value.notes || ''}
          onChange={(e) => setValue({ ...value, notes: e.target.value })}
        />

        <div style={styles.actionRow}>
          <button style={styles.saveBtn} onClick={onSave}>
            <Save size={18} />
            {value.id ? 'Update' : 'Track item'}
          </button>
        </div>
        {value.id ? (
          <button style={styles.deleteLinkBtn} onClick={onDelete}>
            <Trash2 size={12} /> Stop tracking this item
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------- styles ----------
const styles = {
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f8f8' },
  header: { backgroundColor: '#c8102e', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  headerInner: { maxWidth: '820px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' },
  backText: { fontSize: '13px', color: '#fff', fontWeight: '500' },
  titleArea: { display: 'flex', alignItems: 'center', gap: '8px' },
  headerTitle: { fontSize: '18px', fontWeight: '700', color: '#fff' },
  refreshBtn: { background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' },
  content: { flex: 1, maxWidth: '820px', width: '100%', margin: '0 auto', padding: '16px' },

  statRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '12px' },
  stat: { background: '#fff', border: '2px solid #e5e7eb', borderRadius: '12px', padding: '12px', textAlign: 'left' },
  statValue: { fontSize: '22px', fontWeight: 800, lineHeight: 1 },
  statLabel: { fontSize: '11px', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 },

  searchWrap: { display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '16px', background: 'transparent' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 600, background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '5px 12px', cursor: 'pointer' },
  chipActive: { background: '#c8102e', color: '#fff', borderColor: '#c8102e' },
  chipAdd: { background: '#fff1f2', color: '#c8102e', borderColor: '#fecdd3' },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  rowCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px' },
  rowTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '10px' },
  itemNo: { fontSize: '15px', fontWeight: 700 },
  itemDesc: { fontSize: '13px', color: '#6b7280' },
  pill: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, borderRadius: '999px', padding: '2px 10px' },
  pillOut: { color: '#c8102e', background: '#fee2e2' },
  pillLow: { color: '#a16207', background: '#fef3c7' },
  pillOk: { color: '#065f46', background: '#d1fae5' },

  numbersRow: { display: 'flex', gap: '10px', marginBottom: '10px' },
  numBox: { flex: 1, background: '#fafafa', borderRadius: '8px', padding: '8px' },
  numLabel: { fontSize: '10px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' },
  numValue: { fontSize: '18px', fontWeight: 800, marginTop: 2 },

  rowFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid #f3f4f6' },
  vendorLine: { fontSize: '12px', color: '#6b7280' },
  editLink: { background: 'transparent', border: 'none', color: '#c8102e', fontSize: '13px', fontWeight: 600, cursor: 'pointer' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200 },
  modal: { background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '600px', maxHeight: '90vh', padding: '16px', overflowY: 'auto' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  modalTitle: { fontSize: '17px', fontWeight: '700' },
  iconBtn: { background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px' },

  fieldLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px', marginTop: '10px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '15px', boxSizing: 'border-box', marginBottom: '4px' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '14px', boxSizing: 'border-box', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' },
  twoCol: { display: 'flex', gap: '10px' },
  suggestBox: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px', marginBottom: '4px' },
  suggestRow: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' },

  message: { fontSize: '14px', fontWeight: '600', marginBottom: '10px' },
  actionRow: { display: 'flex', gap: '10px', marginTop: '14px' },
  saveBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  deleteLinkBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', width: '100%', background: 'transparent', color: '#c8102e', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '14px 8px 4px', textDecoration: 'underline' },
};