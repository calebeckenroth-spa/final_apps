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
  Users,
  Phone,
  Mail,
  Edit3,
  Package,
} from 'lucide-react';

const CATEGORIES = [
  { value: 'ingredient', label: 'Ingredient' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'mro', label: 'MRO / Supplies' },
  { value: 'other', label: 'Other' },
];

const blankVendor = () => ({
  name: '',
  vendor_code: '',
  primary_contact: '',
  email: '',
  phone: '',
  address: '',
  category: 'ingredient',
  payment_terms: '',
  lead_time_days: '',
  moq_notes: '',
  primary_items: '',
  notes: '',
  active: true,
});

export default function Vendors() {
  const navigate = useNavigate();
  const [view, setView] = useState('list'); // 'list' | 'edit'

  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showInactive, setShowInactive] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankVendor());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Items catalog (from public.items) and items currently linked to this vendor
  const [itemCatalog, setItemCatalog] = useState([]);
  const [linkedItems, setLinkedItems] = useState([]);

  useEffect(() => {
    load();
    loadItemCatalog();
  }, []);

  async function loadItemCatalog() {
    // Roll up items table by item_no to get one row per item with description
    const { data } = await supabase.from('items').select('item_no, description').limit(20000);
    const map = new Map();
    for (const r of data || []) {
      if (!r.item_no) continue;
      if (!map.has(r.item_no)) {
        map.set(r.item_no, { item_no: r.item_no, description: r.description || '' });
      }
    }
    setItemCatalog(Array.from(map.values()).sort((a, b) => a.item_no.localeCompare(b.item_no)));
  }

  async function loadLinkedItems(vendorId) {
    if (!vendorId) {
      setLinkedItems([]);
      return;
    }
    const { data } = await supabase
      .schema('procurement')
      .from('vendor_items')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('item_no');
    setLinkedItems(data || []);
  }

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .schema('procurement')
      .from('vendors')
      .select('*')
      .order('name');
    if (!error) setVendors(data || []);
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => {
      if (!showInactive && v.active === false) return false;
      if (categoryFilter !== 'all' && v.category !== categoryFilter)
        return false;
      if (!q) return true;
      return (
        (v.name || '').toLowerCase().includes(q) ||
        (v.vendor_code || '').toLowerCase().includes(q) ||
        (v.primary_contact || '').toLowerCase().includes(q) ||
        (v.email || '').toLowerCase().includes(q) ||
        (v.primary_items || '').toLowerCase().includes(q) ||
        (v.notes || '').toLowerCase().includes(q)
      );
    });
  }, [vendors, search, categoryFilter, showInactive]);

  function setF(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function startNew() {
    setEditingId(null);
    setForm(blankVendor());
    setLinkedItems([]);
    setMessage('');
    setConfirmDelete(false);
    setView('edit');
  }

  function openVendor(v) {
    setEditingId(v.id);
    setForm({
      name: v.name || '',
      vendor_code: v.vendor_code || '',
      primary_contact: v.primary_contact || '',
      email: v.email || '',
      phone: v.phone || '',
      address: v.address || '',
      category: v.category || 'ingredient',
      payment_terms: v.payment_terms || '',
      lead_time_days: v.lead_time_days ?? '',
      moq_notes: v.moq_notes || '',
      primary_items: v.primary_items || '',
      notes: v.notes || '',
      active: v.active !== false,
    });
    loadLinkedItems(v.id);
    setMessage('');
    setConfirmDelete(false);
    setView('edit');
  }

  async function linkItem(item) {
    // If no vendor yet, save the vendor first so we have an id
    let vendorId = editingId;
    if (!vendorId) {
      setMessage('Save the vendor first before linking items');
      return;
    }
    // Skip if already linked
    if (linkedItems.some((li) => li.item_no === item.item_no)) return;
    try {
      const row = {
        vendor_id: vendorId,
        item_no: item.item_no,
        description: item.description || null,
        uom: null,
        last_unit_price: null,
        last_purchase_date: null,
      };
      const { data, error } = await supabase
        .schema('procurement')
        .from('vendor_items')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      setLinkedItems((prev) => [...prev, data]);
    } catch (e) {
      setMessage('Error linking item: ' + (e.message || 'unknown error'));
    }
  }

  async function unlinkItem(vendorItemId) {
    try {
      const { error } = await supabase
        .schema('procurement')
        .from('vendor_items')
        .delete()
        .eq('id', vendorItemId);
      if (error) throw error;
      setLinkedItems((prev) => prev.filter((li) => li.id !== vendorItemId));
    } catch (e) {
      setMessage('Error unlinking item: ' + (e.message || 'unknown error'));
    }
  }

  async function updateLinkedItem(vendorItemId, patch) {
    // Optimistic
    setLinkedItems((prev) =>
      prev.map((li) => (li.id === vendorItemId ? { ...li, ...patch } : li))
    );
    try {
      const { error } = await supabase
        .schema('procurement')
        .from('vendor_items')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', vendorItemId);
      if (error) throw error;
    } catch (e) {
      setMessage('Error updating item: ' + (e.message || 'unknown error'));
    }
  }

  async function saveVendor() {
    if (!form.name.trim()) {
      setMessage('Name is required');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const row = {
        name: form.name.trim(),
        vendor_code: form.vendor_code || null,
        primary_contact: form.primary_contact || null,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        category: form.category || null,
        payment_terms: form.payment_terms || null,
        lead_time_days:
          form.lead_time_days === '' ? null : Number(form.lead_time_days),
        moq_notes: form.moq_notes || null,
        primary_items: form.primary_items || null,
        notes: form.notes || null,
        active: !!form.active,
        updated_at: new Date().toISOString(),
      };
      if (editingId) {
        const { error } = await supabase
          .schema('procurement')
          .from('vendors')
          .update(row)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .schema('procurement')
          .from('vendors')
          .insert(row)
          .select()
          .single();
        if (error) throw error;
        setEditingId(data.id);
      }
      setMessage('Saved \u2713');
      load();
    } catch (e) {
      setMessage('Error saving: ' + (e.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteVendor() {
    if (!editingId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .schema('procurement')
        .from('vendors')
        .delete()
        .eq('id', editingId);
      if (error) throw error;
      await load();
      setEditingId(null);
      setView('list');
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
            onClick={() =>
              view === 'edit' ? setView('list') : navigate('/')
            }
          >
            <ChevronLeft size={20} color="#fff" />
            <span style={styles.backText}>
              {view === 'edit' ? 'Vendors' : 'Home'}
            </span>
          </button>
          <div style={styles.titleArea}>
            <Users size={18} color="#fff" />
            <span style={styles.headerTitle}>
              {view === 'edit'
                ? editingId
                  ? 'Edit vendor'
                  : 'New vendor'
                : 'Vendors'}
            </span>
          </div>
          <div style={{ width: '70px' }} />
        </div>
      </div>

      <div style={styles.content}>
        {view === 'list' ? (
          <ListView
            vendors={filtered}
            loading={loading}
            total={vendors.length}
            search={search}
            setSearch={setSearch}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            showInactive={showInactive}
            setShowInactive={setShowInactive}
            onNew={startNew}
            onOpen={openVendor}
          />
        ) : (
          <EditView
            form={form}
            setF={setF}
            editingId={editingId}
            saving={saving}
            message={message}
            confirmDelete={confirmDelete}
            onSave={saveVendor}
            onDelete={deleteVendor}
            onCancelDelete={() => setConfirmDelete(false)}
            onRequestDelete={() => setConfirmDelete(true)}
            linkedItems={linkedItems}
            itemCatalog={itemCatalog}
            onLinkItem={linkItem}
            onUnlinkItem={unlinkItem}
            onUpdateLinkedItem={updateLinkedItem}
          />
        )}
      </div>
    </div>
  );
}

// ---------- List view ----------
function ListView({
  vendors,
  loading,
  total,
  search,
  setSearch,
  categoryFilter,
  setCategoryFilter,
  showInactive,
  setShowInactive,
  onNew,
  onOpen,
}) {
  return (
    <>
      <div style={styles.topRow}>
        <h2 style={styles.pageTitle}>Vendors ({total})</h2>
        <button style={styles.primaryBtn} onClick={onNew}>
          <Plus size={18} />
          New vendor
        </button>
      </div>

      <div style={styles.searchWrap}>
        <Search size={18} color="#9ca3af" />
        <input
          style={styles.searchInput}
          placeholder="Search name, contact, items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={styles.chipRow}>
        {[
          { value: 'all', label: 'All' },
          ...CATEGORIES,
        ].map((c) => (
          <button
            key={c.value}
            style={{
              ...styles.chip,
              ...(categoryFilter === c.value ? styles.chipActive : {}),
            }}
            onClick={() => setCategoryFilter(c.value)}
          >
            {c.label}
          </button>
        ))}
        <button
          style={{
            ...styles.chip,
            ...(showInactive ? styles.chipActive : {}),
          }}
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? 'Hide inactive' : 'Show inactive'}
        </button>
      </div>

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading...</p>
      ) : vendors.length === 0 ? (
        <div style={styles.empty}>
          <Users size={32} color="#d1d5db" />
          <p style={{ color: '#9ca3af', marginTop: '8px' }}>
            No vendors yet. Tap "New vendor" to add your first.
          </p>
        </div>
      ) : (
        <div style={styles.list}>
          {vendors.map((v) => (
            <button
              key={v.id}
              style={{
                ...styles.card,
                ...(v.active === false ? { opacity: 0.55 } : {}),
              }}
              onClick={() => onOpen(v)}
            >
              <div style={styles.cardTop}>
                <span style={styles.vendorName}>{v.name}</span>
                {v.category ? (
                  <span style={styles.categoryChip}>
                    {CATEGORIES.find((c) => c.value === v.category)?.label ||
                      v.category}
                  </span>
                ) : null}
              </div>
              {v.primary_contact ? (
                <div style={styles.contactLine}>{v.primary_contact}</div>
              ) : null}
              <div style={styles.metaRow}>
                {v.phone ? (
                  <span style={styles.metaItem}>
                    <Phone size={12} /> {v.phone}
                  </span>
                ) : null}
                {v.email ? (
                  <span style={styles.metaItem}>
                    <Mail size={12} /> {v.email}
                  </span>
                ) : null}
              </div>
              {v.primary_items ? (
                <div style={styles.primaryItems}>{v.primary_items}</div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ---------- Edit view ----------
function EditView({
  form,
  setF,
  editingId,
  saving,
  message,
  confirmDelete,
  onSave,
  onDelete,
  onCancelDelete,
  onRequestDelete,
  linkedItems,
  itemCatalog,
  onLinkItem,
  onUnlinkItem,
  onUpdateLinkedItem,
}) {
  return (
    <>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Basics</div>
        <label style={styles.fieldLabel}>Vendor name *</label>
        <input
          style={styles.input}
          value={form.name}
          onChange={(e) => setF('name', e.target.value)}
          placeholder="e.g. Rio Grande Chile Co."
        />
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>BC vendor code</label>
            <input
              style={styles.input}
              value={form.vendor_code}
              onChange={(e) => setF('vendor_code', e.target.value)}
              placeholder="e.g. V0142"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Category</label>
            <select
              style={styles.input}
              value={form.category}
              onChange={(e) => setF('category', e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Contact</div>
        <label style={styles.fieldLabel}>Primary contact</label>
        <input
          style={styles.input}
          value={form.primary_contact}
          onChange={(e) => setF('primary_contact', e.target.value)}
        />
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Phone</label>
            <input
              style={styles.input}
              value={form.phone}
              onChange={(e) => setF('phone', e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Email</label>
            <input
              style={styles.input}
              value={form.email}
              onChange={(e) => setF('email', e.target.value)}
              type="email"
            />
          </div>
        </div>
        <label style={styles.fieldLabel}>Address</label>
        <textarea
          style={styles.textarea}
          value={form.address}
          onChange={(e) => setF('address', e.target.value)}
        />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Terms &amp; logistics</div>
        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Payment terms</label>
            <input
              style={styles.input}
              value={form.payment_terms}
              onChange={(e) => setF('payment_terms', e.target.value)}
              placeholder="Net 30, COD, etc."
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Typical lead time (days)</label>
            <input
              style={styles.input}
              type="number"
              value={form.lead_time_days}
              onChange={(e) => setF('lead_time_days', e.target.value)}
            />
          </div>
        </div>
        <label style={styles.fieldLabel}>Minimum order notes</label>
        <input
          style={styles.input}
          value={form.moq_notes}
          onChange={(e) => setF('moq_notes', e.target.value)}
          placeholder="e.g. 1 pallet min, or 24 case min"
        />
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>What they supply</div>
        <label style={styles.fieldLabel}>Primary items</label>
        <input
          style={styles.input}
          value={form.primary_items}
          onChange={(e) => setF('primary_items', e.target.value)}
          placeholder="16 oz jars, lids, red chile powder..."
        />
        <label style={styles.fieldLabel}>Notes</label>
        <textarea
          style={styles.textarea}
          value={form.notes}
          onChange={(e) => setF('notes', e.target.value)}
          placeholder="Reliability, quality issues, price notes, etc."
        />
      </div>

      <VendorItemsSection
        editingId={editingId}
        linkedItems={linkedItems || []}
        itemCatalog={itemCatalog || []}
        onLinkItem={onLinkItem}
        onUnlinkItem={onUnlinkItem}
        onUpdateLinkedItem={onUpdateLinkedItem}
      />

      <div style={styles.section}>
        <label style={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setF('active', e.target.checked)}
          />
          <span>Active</span>
        </label>
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
          {saving ? 'Saving...' : editingId ? 'Update vendor' : 'Save vendor'}
        </button>
      </div>

      {editingId ? (
        confirmDelete ? (
          <div style={styles.deleteConfirmBox}>
            <div style={styles.deleteConfirmText}>
              Delete this vendor permanently?
            </div>
            <div style={styles.actionRow}>
              <button style={styles.altBtn} onClick={onCancelDelete}>
                Cancel
              </button>
              <button style={styles.deleteBtn} onClick={onDelete}>
                <Trash2 size={18} />
                Yes, delete vendor
              </button>
            </div>
          </div>
        ) : (
          <button style={styles.deleteLinkBtn} onClick={onRequestDelete}>
            Delete this vendor
          </button>
        )
      ) : null}
      <div style={{ height: '40px' }} />
    </>
  );
}

// ---------- Vendor <-> items linking ----------
function VendorItemsSection({
  editingId,
  linkedItems,
  itemCatalog,
  onLinkItem,
  onUnlinkItem,
  onUpdateLinkedItem,
}) {
  const [search, setSearch] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);

  const linkedByItemNo = useMemo(() => {
    const s = new Set();
    for (const li of linkedItems) s.add(li.item_no);
    return s;
  }, [linkedItems]);

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const it of itemCatalog) {
      if (linkedByItemNo.has(it.item_no)) continue; // don't suggest already-linked
      if (
        (it.item_no || '').toLowerCase().includes(q) ||
        (it.description || '').toLowerCase().includes(q)
      ) {
        out.push(it);
      }
      if (out.length >= 8) break;
    }
    return out;
  }, [search, itemCatalog, linkedByItemNo]);

  return (
    <div style={styles.section}>
      <div style={styles.lineHeadRow}>
        <div style={styles.sectionTitle}>Items supplied by this vendor</div>
        <span style={styles.pill}>{linkedItems.length}</span>
      </div>

      {!editingId ? (
        <p style={styles.hintNote}>
          Save this vendor first — then you can add the items they supply.
        </p>
      ) : (
        <>
          <label style={styles.fieldLabel}>Search item catalog to add</label>
          <div style={styles.searchWrap}>
            <Search size={16} color="#9ca3af" />
            <input
              style={styles.searchInput}
              placeholder="Item # or description..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowSuggest(true);
              }}
              onFocus={() => setShowSuggest(true)}
            />
          </div>
          {showSuggest && suggestions.length > 0 && (
            <div style={styles.suggestBox}>
              {suggestions.map((s) => (
                <button
                  key={s.item_no}
                  style={styles.suggestRow}
                  onClick={() => {
                    onLinkItem(s);
                    setSearch('');
                    setShowSuggest(false);
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{s.item_no}</span>
                  <span style={{ color: '#6b7280', fontSize: 12 }}>
                    {s.description}
                  </span>
                </button>
              ))}
            </div>
          )}

          {linkedItems.length === 0 ? (
            <p style={styles.hintNote}>
              No items linked yet. Search above and tap to add.
            </p>
          ) : (
            <div style={{ marginTop: '8px' }}>
              {linkedItems.map((li) => (
                <LinkedItemRow
                  key={li.id}
                  li={li}
                  onUnlink={() => onUnlinkItem(li.id)}
                  onUpdate={(patch) => onUpdateLinkedItem(li.id, patch)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LinkedItemRow({ li, onUnlink, onUpdate }) {
  const [uom, setUom] = useState(li.uom || '');
  const [price, setPrice] = useState(li.last_unit_price ?? '');
  const [notes, setNotes] = useState(li.notes || '');
  const [dirty, setDirty] = useState(false);

  return (
    <div style={styles.linkedItemRow}>
      <div style={styles.linkedItemTop}>
        <div>
          <div style={styles.linkedItemNo}>{li.item_no}</div>
          <div style={styles.linkedItemDesc}>{li.description}</div>
        </div>
        <button style={styles.removeLinkBtn} onClick={onUnlink}>
          <X size={12} /> Remove
        </button>
      </div>
      <div style={styles.twoCol}>
        <div style={{ flex: 1 }}>
          <label style={styles.miniLabel}>UoM</label>
          <input
            style={styles.miniInput}
            value={uom}
            placeholder="CASE"
            onChange={(e) => {
              setUom(e.target.value);
              setDirty(true);
            }}
            onBlur={() => {
              if (dirty) {
                onUpdate({ uom: uom || null });
                setDirty(false);
              }
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={styles.miniLabel}>Last unit price</label>
          <input
            style={styles.miniInput}
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setDirty(true);
            }}
            onBlur={() => {
              if (dirty) {
                onUpdate({
                  last_unit_price: price === '' ? null : Number(price),
                });
                setDirty(false);
              }
            }}
          />
        </div>
      </div>
      {li.last_purchase_date ? (
        <div style={styles.lastPurchase}>
          Last purchased: {li.last_purchase_date}
        </div>
      ) : null}
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

  chipRow: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' },
  chip: { fontSize: '13px', fontWeight: 600, background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '5px 12px', cursor: 'pointer' },
  chipActive: { background: '#c8102e', color: '#fff', borderColor: '#c8102e' },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px', textAlign: 'left', cursor: 'pointer', width: '100%' },
  cardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '4px' },
  vendorName: { fontSize: '16px', fontWeight: '700', color: '#c8102e' },
  categoryChip: { fontSize: '11px', fontWeight: '700', color: '#374151', background: '#f3f4f6', borderRadius: '999px', padding: '2px 8px' },
  contactLine: { fontSize: '13px', color: '#374151', marginBottom: '4px' },
  metaRow: { display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12px', color: '#6b7280', marginBottom: '4px' },
  metaItem: { display: 'flex', alignItems: 'center', gap: '4px' },
  primaryItems: { fontSize: '12px', color: '#6b7280', marginTop: '2px' },

  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginBottom: '12px' },
  sectionTitle: { fontSize: '13px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' },
  fieldLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px', marginTop: '10px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '15px', boxSizing: 'border-box', marginBottom: '4px' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '14px', boxSizing: 'border-box', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' },
  twoCol: { display: 'flex', gap: '10px' },

  checkboxRow: { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 },

  message: { fontSize: '14px', fontWeight: '600', marginBottom: '10px' },
  actionRow: { display: 'flex', gap: '10px', marginTop: '10px' },
  saveBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  altBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  deleteLinkBtn: { display: 'block', width: '100%', background: 'transparent', color: '#c8102e', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '20px 8px 8px', textAlign: 'center', textDecoration: 'underline' },
  deleteConfirmBox: { background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '12px', padding: '14px', marginTop: '16px' },
  deleteConfirmText: { fontSize: '14px', fontWeight: '600', color: '#9f1239', marginBottom: '12px', textAlign: 'center' },
  deleteBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },

  lineHeadRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' },
  pill: { fontSize: '12px', fontWeight: 700, background: '#f3f4f6', color: '#374151', borderRadius: '999px', padding: '2px 10px' },
  hintNote: { fontSize: '13px', color: '#6b7280', margin: '10px 0 0', lineHeight: 1.4 },
  suggestBox: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' },
  suggestRow: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' },
  linkedItemRow: { border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px', marginBottom: '8px', background: '#fafafa' },
  linkedItemTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' },
  linkedItemNo: { fontSize: '14px', fontWeight: 700 },
  linkedItemDesc: { fontSize: '12px', color: '#6b7280' },
  removeLinkBtn: { display: 'flex', alignItems: 'center', gap: '3px', background: 'transparent', color: '#c8102e', border: 'none', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: '4px' },
  miniLabel: { display: 'block', fontSize: '11px', fontWeight: 600, color: '#6b7280', marginBottom: '2px', marginTop: '4px' },
  miniInput: { width: '100%', border: '1px solid #d1d5db', borderRadius: '8px', padding: '6px 8px', fontSize: '13px', boxSizing: 'border-box', background: '#fff' },
  lastPurchase: { fontSize: '11px', color: '#6b7280', marginTop: '6px' },
};