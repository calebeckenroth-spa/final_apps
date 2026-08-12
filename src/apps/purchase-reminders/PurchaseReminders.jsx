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
  Bell,
  Calendar,
  CheckCircle2,
  Repeat,
  ShoppingCart,
  AlertTriangle,
} from 'lucide-react';

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'One-time' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
];

function blankReminder() {
  const today = new Date();
  const orderBy = new Date(today);
  orderBy.setDate(today.getDate() + 7);
  return {
    title: '',
    vendor_id: '',
    vendor_name: '',
    item_no: '',
    item_description: '',
    suggested_quantity: '',
    suggested_uom: '',
    order_by_date: orderBy.toISOString().slice(0, 10),
    suggested_delivery_date: '',
    notes: '',
    recurrence: 'none',
    status: 'pending',
  };
}

function addToDate(dateStr, unit) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  if (unit === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (unit === 'quarterly') d.setMonth(d.getMonth() + 3);
  else if (unit === 'annually') d.setFullYear(d.getFullYear() + 1);
  else return null;
  return d.toISOString().slice(0, 10);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
  return diff;
}

// ============================================================
export default function PurchaseReminders() {
  const navigate = useNavigate();
  const [view, setView] = useState('list'); // 'list' | 'edit'
  const [loading, setLoading] = useState(true);
  const [reminders, setReminders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [vendorItems, setVendorItems] = useState([]);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankReminder());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [remRes, vendRes, viRes, itemsRes] = await Promise.all([
      supabase
        .schema('procurement')
        .from('purchase_reminders')
        .select('*')
        .order('order_by_date', { ascending: true })
        .limit(500),
      supabase
        .schema('procurement')
        .from('vendors')
        .select('id, name')
        .eq('active', true)
        .order('name'),
      supabase
        .schema('procurement')
        .from('vendor_items')
        .select('vendor_id, item_no, description, suggested_uom:uom, last_unit_price'),
      supabase.from('items').select('item_no, description').limit(20000),
    ]);
    setReminders(remRes.data || []);
    setVendors(vendRes.data || []);
    setVendorItems(viRes.data || []);
    setItems(itemsRes.data || []);
    setLoading(false);
  }

  const itemCatalogMap = useMemo(() => {
    const m = new Map();
    for (const it of items) if (it.item_no) m.set(it.item_no, it.description || '');
    return m;
  }, [items]);

  // Items filtered to the selected vendor (for the SKU dropdown when editing)
  const vendorLinkedItems = useMemo(() => {
    if (!form.vendor_id) return [];
    return vendorItems.filter((vi) => vi.vendor_id === form.vendor_id);
  }, [vendorItems, form.vendor_id]);

  const filteredReminders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = showCompleted
      ? reminders
      : reminders.filter(
          (r) => r.status !== 'done' && r.status !== 'skipped'
        );
    if (!q) return base;
    return base.filter(
      (r) =>
        (r.title || '').toLowerCase().includes(q) ||
        (r.vendor_name || '').toLowerCase().includes(q) ||
        (r.item_no || '').toLowerCase().includes(q) ||
        (r.item_description || '').toLowerCase().includes(q)
    );
  }, [reminders, search, showCompleted]);

  const completedCount = useMemo(
    () =>
      reminders.filter((r) => r.status === 'done' || r.status === 'skipped')
        .length,
    [reminders]
  );

  function setF(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startNew() {
    setEditingId(null);
    setForm(blankReminder());
    setMessage('');
    setConfirmDelete(false);
    setView('edit');
  }

  function openReminder(r) {
    setEditingId(r.id);
    setForm({
      title: r.title || '',
      vendor_id: r.vendor_id || '',
      vendor_name: r.vendor_name || '',
      item_no: r.item_no || '',
      item_description: r.item_description || '',
      suggested_quantity: r.suggested_quantity ?? '',
      suggested_uom: r.suggested_uom || '',
      order_by_date: r.order_by_date || '',
      suggested_delivery_date: r.suggested_delivery_date || '',
      notes: r.notes || '',
      recurrence: r.recurrence || 'none',
      status: r.status || 'pending',
    });
    setMessage('');
    setConfirmDelete(false);
    setView('edit');
  }

  function selectVendor(vendorId) {
    setF('vendor_id', vendorId);
    const v = vendors.find((x) => x.id === vendorId);
    if (v) setF('vendor_name', v.name);
    // Clear item pick since vendor changed
    setF('item_no', '');
    setF('item_description', '');
  }

  function selectItem(itemNo) {
    setF('item_no', itemNo);
    const vi = vendorLinkedItems.find((x) => x.item_no === itemNo);
    if (vi) {
      setF('item_description', vi.description || itemCatalogMap.get(itemNo) || '');
      if (vi.suggested_uom) setF('suggested_uom', vi.suggested_uom);
    } else {
      setF('item_description', itemCatalogMap.get(itemNo) || '');
    }
  }

  async function saveReminder() {
    if (!form.title || !form.order_by_date) {
      setMessage('Title and Order-by date are required');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const row = {
        title: form.title,
        vendor_id: form.vendor_id || null,
        vendor_name: form.vendor_name || null,
        item_no: form.item_no || null,
        item_description: form.item_description || null,
        suggested_quantity:
          form.suggested_quantity === '' ? null : Number(form.suggested_quantity),
        suggested_uom: form.suggested_uom || null,
        order_by_date: form.order_by_date,
        suggested_delivery_date: form.suggested_delivery_date || null,
        notes: form.notes || null,
        recurrence: form.recurrence || 'none',
        status: form.status || 'pending',
        updated_at: new Date().toISOString(),
      };
      if (editingId) {
        const { error } = await supabase
          .schema('procurement')
          .from('purchase_reminders')
          .update(row)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .schema('procurement')
          .from('purchase_reminders')
          .insert(row);
        if (error) throw error;
      }
      await load();
      setView('list');
      setEditingId(null);
    } catch (e) {
      setMessage('Error: ' + (e.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  }

  async function markOrdered(r) {
    // Set current reminder to 'ordered'; if recurring, spawn next occurrence
    try {
      await supabase
        .schema('procurement')
        .from('purchase_reminders')
        .update({
          status: 'ordered',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', r.id);

      if (r.recurrence && r.recurrence !== 'none') {
        const nextOrderBy = addToDate(r.order_by_date, r.recurrence);
        const nextDelivery = r.suggested_delivery_date
          ? addToDate(r.suggested_delivery_date, r.recurrence)
          : null;
        if (nextOrderBy) {
          const nextRow = {
            title: r.title,
            vendor_id: r.vendor_id,
            vendor_name: r.vendor_name,
            item_no: r.item_no,
            item_description: r.item_description,
            suggested_quantity: r.suggested_quantity,
            suggested_uom: r.suggested_uom,
            order_by_date: nextOrderBy,
            suggested_delivery_date: nextDelivery,
            notes: r.notes,
            recurrence: r.recurrence,
            status: 'pending',
            parent_reminder_id: r.parent_reminder_id || r.id,
          };
          await supabase
            .schema('procurement')
            .from('purchase_reminders')
            .insert(nextRow);
        }
      }
      await load();
    } catch (e) {
      setMessage('Error marking ordered: ' + (e.message || 'unknown'));
    }
  }

  async function markSkipped(r) {
    // Skipped = "I'm not going to order this time." Same recurring behavior.
    try {
      await supabase
        .schema('procurement')
        .from('purchase_reminders')
        .update({
          status: 'skipped',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', r.id);

      if (r.recurrence && r.recurrence !== 'none') {
        const nextOrderBy = addToDate(r.order_by_date, r.recurrence);
        if (nextOrderBy) {
          const nextRow = {
            title: r.title,
            vendor_id: r.vendor_id,
            vendor_name: r.vendor_name,
            item_no: r.item_no,
            item_description: r.item_description,
            suggested_quantity: r.suggested_quantity,
            suggested_uom: r.suggested_uom,
            order_by_date: nextOrderBy,
            suggested_delivery_date: r.suggested_delivery_date
              ? addToDate(r.suggested_delivery_date, r.recurrence)
              : null,
            notes: r.notes,
            recurrence: r.recurrence,
            status: 'pending',
            parent_reminder_id: r.parent_reminder_id || r.id,
          };
          await supabase
            .schema('procurement')
            .from('purchase_reminders')
            .insert(nextRow);
        }
      }
      await load();
    } catch (e) {
      setMessage('Error skipping: ' + (e.message || 'unknown'));
    }
  }

  function createPoFromReminder(r) {
    // Navigate to PO Tracker with the reminder id, which pre-fills vendor + item
    navigate(`/po-tracker?fromReminder=${r.id}`);
  }

  async function deleteReminder() {
    if (!editingId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .schema('procurement')
        .from('purchase_reminders')
        .delete()
        .eq('id', editingId);
      if (error) throw error;
      await load();
      setView('list');
      setEditingId(null);
    } catch (e) {
      setMessage('Error deleting: ' + (e.message || 'unknown'));
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
              view === 'edit'
                ? (setView('list'), setEditingId(null))
                : navigate('/')
            }
          >
            <ChevronLeft size={20} color="#fff" />
            <span style={styles.backText}>
              {view === 'edit' ? 'Reminders' : 'Home'}
            </span>
          </button>
          <div style={styles.titleArea}>
            <Bell size={18} color="#fff" />
            <span style={styles.headerTitle}>
              {view === 'edit'
                ? editingId
                  ? 'Edit Reminder'
                  : 'New Reminder'
                : 'Purchase Reminders'}
            </span>
          </div>
          <div style={{ width: '64px' }} />
        </div>
      </div>

      <div style={styles.content}>
        {view === 'edit' ? (
          <EditView
            form={form}
            setF={setF}
            selectVendor={selectVendor}
            selectItem={selectItem}
            vendors={vendors}
            vendorLinkedItems={vendorLinkedItems}
            editingId={editingId}
            saving={saving}
            message={message}
            confirmDelete={confirmDelete}
            onSave={saveReminder}
            onDelete={deleteReminder}
            onRequestDelete={() => setConfirmDelete(true)}
            onCancelDelete={() => setConfirmDelete(false)}
          />
        ) : (
          <ListView
            loading={loading}
            reminders={filteredReminders}
            search={search}
            setSearch={setSearch}
            showCompleted={showCompleted}
            setShowCompleted={setShowCompleted}
            completedCount={completedCount}
            onNew={startNew}
            onOpen={openReminder}
            onMarkOrdered={markOrdered}
            onMarkSkipped={markSkipped}
            onCreatePo={createPoFromReminder}
          />
        )}
      </div>
    </div>
  );
}

// ---------- List view ----------
function ListView({
  loading,
  reminders,
  search,
  setSearch,
  showCompleted,
  setShowCompleted,
  completedCount,
  onNew,
  onOpen,
  onMarkOrdered,
  onMarkSkipped,
  onCreatePo,
}) {
  // Split into buckets
  const buckets = useMemo(() => {
    const overdue = [];
    const dueSoon = [];  // next 30 days
    const upcoming = []; // beyond 30 days
    const completed = [];
    for (const r of reminders) {
      if (r.status === 'done' || r.status === 'skipped' || r.status === 'ordered') {
        completed.push(r);
        continue;
      }
      const days = daysUntil(r.order_by_date);
      if (days == null) continue;
      if (days < 0) overdue.push(r);
      else if (days <= 30) dueSoon.push(r);
      else upcoming.push(r);
    }
    return { overdue, dueSoon, upcoming, completed };
  }, [reminders]);

  return (
    <>
      <div style={styles.listTopRow}>
        <h2 style={styles.pageTitle}>Reminders</h2>
        <button style={styles.primaryBtn} onClick={onNew}>
          <Plus size={18} />
          New reminder
        </button>
      </div>

      <div style={styles.searchWrap}>
        <Search size={18} color="#9ca3af" />
        <input
          style={styles.searchInput}
          placeholder="Search title, vendor, item..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {completedCount > 0 || showCompleted ? (
        <div style={styles.filterChipRow}>
          <button
            style={{
              ...styles.filterChip,
              ...(showCompleted ? styles.filterChipActive : {}),
            }}
            onClick={() => setShowCompleted(!showCompleted)}
          >
            {showCompleted
              ? `Hide history (${completedCount})`
              : `Show history (${completedCount})`}
          </button>
        </div>
      ) : null}

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading...</p>
      ) : reminders.length === 0 ? (
        <div style={styles.empty}>
          <Bell size={32} color="#d1d5db" />
          <p style={{ color: '#9ca3af', marginTop: '8px' }}>
            No reminders yet. Tap New reminder to add one.
          </p>
        </div>
      ) : (
        <>
          {buckets.overdue.length > 0 ? (
            <Bucket
              label={`Overdue (${buckets.overdue.length})`}
              icon={<AlertTriangle size={16} color="#c8102e" />}
            >
              {buckets.overdue.map((r) => (
                <ReminderCard
                  key={r.id}
                  r={r}
                  onOpen={() => onOpen(r)}
                  onMarkOrdered={() => onMarkOrdered(r)}
                  onMarkSkipped={() => onMarkSkipped(r)}
                  onCreatePo={() => onCreatePo(r)}
                />
              ))}
            </Bucket>
          ) : null}
          {buckets.dueSoon.length > 0 ? (
            <Bucket
              label={`Due soon (${buckets.dueSoon.length})`}
              icon={<Calendar size={16} color="#a16207" />}
            >
              {buckets.dueSoon.map((r) => (
                <ReminderCard
                  key={r.id}
                  r={r}
                  onOpen={() => onOpen(r)}
                  onMarkOrdered={() => onMarkOrdered(r)}
                  onMarkSkipped={() => onMarkSkipped(r)}
                  onCreatePo={() => onCreatePo(r)}
                />
              ))}
            </Bucket>
          ) : null}
          {buckets.upcoming.length > 0 ? (
            <Bucket
              label={`Upcoming (${buckets.upcoming.length})`}
              icon={<Calendar size={16} color="#6b7280" />}
            >
              {buckets.upcoming.map((r) => (
                <ReminderCard
                  key={r.id}
                  r={r}
                  onOpen={() => onOpen(r)}
                  onMarkOrdered={() => onMarkOrdered(r)}
                  onMarkSkipped={() => onMarkSkipped(r)}
                  onCreatePo={() => onCreatePo(r)}
                />
              ))}
            </Bucket>
          ) : null}
          {showCompleted && buckets.completed.length > 0 ? (
            <Bucket
              label={`History (${buckets.completed.length})`}
              icon={<CheckCircle2 size={16} color="#065f46" />}
            >
              {buckets.completed.map((r) => (
                <ReminderCard
                  key={r.id}
                  r={r}
                  onOpen={() => onOpen(r)}
                  isHistory
                />
              ))}
            </Bucket>
          ) : null}
        </>
      )}
    </>
  );
}

function Bucket({ label, icon, children }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={styles.bucketHead}>
        {icon}
        <span style={styles.bucketTitle}>{label}</span>
      </div>
      <div style={styles.list}>{children}</div>
    </div>
  );
}

function ReminderCard({
  r,
  onOpen,
  onMarkOrdered,
  onMarkSkipped,
  onCreatePo,
  isHistory,
}) {
  const days = daysUntil(r.order_by_date);
  const dayLabel =
    days == null
      ? ''
      : days < 0
        ? Math.abs(days) + (Math.abs(days) === 1 ? ' day overdue' : ' days overdue')
        : days === 0
          ? 'Today'
          : days === 1
            ? 'Tomorrow'
            : 'In ' + days + ' days';
  const dayColor =
    days == null
      ? '#6b7280'
      : days < 0
        ? '#c8102e'
        : days <= 7
          ? '#a16207'
          : '#374151';
  return (
    <div style={styles.card}>
      <button style={styles.cardButton} onClick={onOpen}>
        <div style={styles.cardTop}>
          <span style={styles.title}>{r.title}</span>
          {r.recurrence && r.recurrence !== 'none' ? (
            <span style={styles.recurringChip}>
              <Repeat size={11} /> {r.recurrence}
            </span>
          ) : null}
        </div>
        <div style={styles.cardMetaRow}>
          <span style={{ ...styles.dayLabel, color: dayColor }}>
            {dayLabel}
          </span>
          <span style={styles.dot}>·</span>
          <span style={styles.metaText}>{r.order_by_date}</span>
        </div>
        {r.vendor_name ? (
          <div style={styles.metaText}>Vendor: {r.vendor_name}</div>
        ) : null}
        {r.item_no ? (
          <div style={styles.metaText}>
            Item: <strong>{r.item_no}</strong>
            {r.item_description ? ' — ' + r.item_description.slice(0, 50) : ''}
          </div>
        ) : null}
        {r.suggested_quantity ? (
          <div style={styles.metaText}>
            Suggested qty: {r.suggested_quantity} {r.suggested_uom || ''}
          </div>
        ) : null}
        {r.notes ? <div style={styles.notes}>{r.notes}</div> : null}
      </button>
      {!isHistory ? (
        <div style={styles.actionRowInline}>
          <button style={styles.orderBtn} onClick={onCreatePo}>
            <ShoppingCart size={12} /> Create PO
          </button>
          <button style={styles.checkBtn} onClick={onMarkOrdered}>
            <CheckCircle2 size={12} /> Ordered
          </button>
          <button style={styles.skipBtn} onClick={onMarkSkipped}>
            Skip
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------- Edit view ----------
function EditView({
  form,
  setF,
  selectVendor,
  selectItem,
  vendors,
  vendorLinkedItems,
  editingId,
  saving,
  message,
  confirmDelete,
  onSave,
  onDelete,
  onRequestDelete,
  onCancelDelete,
}) {
  return (
    <>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>What to remember</div>
        <label style={styles.fieldLabel}>Title *</label>
        <input
          style={styles.input}
          value={form.title}
          onChange={(e) => setF('title', e.target.value)}
          placeholder="e.g. Order YG chile"
        />

        <label style={styles.fieldLabel}>Vendor</label>
        <select
          style={styles.input}
          value={form.vendor_id}
          onChange={(e) => selectVendor(e.target.value)}
        >
          <option value="">(none)</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>

        <label style={styles.fieldLabel}>Item</label>
        {form.vendor_id && vendorLinkedItems.length > 0 ? (
          <select
            style={styles.input}
            value={form.item_no}
            onChange={(e) => selectItem(e.target.value)}
          >
            <option value="">(none)</option>
            {vendorLinkedItems.map((vi) => (
              <option key={vi.item_no} value={vi.item_no}>
                {vi.item_no}
                {vi.description ? ' — ' + vi.description.slice(0, 40) : ''}
              </option>
            ))}
          </select>
        ) : (
          <input
            style={styles.input}
            value={form.item_no}
            onChange={(e) => setF('item_no', e.target.value)}
            placeholder={
              !form.vendor_id
                ? 'Pick vendor first, or type an item # freeform'
                : 'No items linked to this vendor — type freeform'
            }
          />
        )}

        <label style={styles.fieldLabel}>Item description</label>
        <input
          style={styles.input}
          value={form.item_description}
          onChange={(e) => setF('item_description', e.target.value)}
          placeholder="Auto-fills from item pick"
        />

        <div style={styles.twoCol}>
          <div style={{ flex: 2 }}>
            <label style={styles.fieldLabel}>Suggested quantity</label>
            <input
              style={styles.input}
              type="number"
              min="0"
              value={form.suggested_quantity}
              onChange={(e) => setF('suggested_quantity', e.target.value)}
              placeholder="Optional pre-fill for PO"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>UoM</label>
            <input
              style={styles.input}
              value={form.suggested_uom}
              onChange={(e) => setF('suggested_uom', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>When</div>
        <label style={styles.fieldLabel}>Place order by *</label>
        <input
          style={styles.input}
          type="date"
          value={form.order_by_date}
          onChange={(e) => setF('order_by_date', e.target.value)}
        />

        <label style={styles.fieldLabel}>Need it by (optional)</label>
        <input
          style={styles.input}
          type="date"
          value={form.suggested_delivery_date}
          onChange={(e) => setF('suggested_delivery_date', e.target.value)}
        />

        <label style={styles.fieldLabel}>Recurrence</label>
        <select
          style={styles.input}
          value={form.recurrence}
          onChange={(e) => setF('recurrence', e.target.value)}
        >
          {RECURRENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {form.recurrence !== 'none' ? (
          <p style={styles.hintNote}>
            When you mark this as Ordered (or Skip), a new reminder for the next{' '}
            {form.recurrence === 'annually' ? 'year' : form.recurrence.replace('ly', '')}{' '}
            will be created automatically.
          </p>
        ) : null}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Notes</div>
        <textarea
          style={styles.textarea}
          value={form.notes}
          onChange={(e) => setF('notes', e.target.value)}
          placeholder="Who to call, past order details, negotiation notes..."
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
        <button style={styles.saveBtn} onClick={onSave} disabled={saving}>
          <Save size={18} />
          {saving ? 'Saving...' : editingId ? 'Update reminder' : 'Save reminder'}
        </button>
      </div>

      {editingId ? (
        confirmDelete ? (
          <div style={styles.deleteConfirmBox}>
            <div style={styles.deleteConfirmText}>
              Delete this reminder permanently?
            </div>
            <div style={styles.deleteConfirmRow}>
              <button style={styles.altBtn} onClick={onCancelDelete}>
                Cancel
              </button>
              <button style={styles.deleteBtn} onClick={onDelete}>
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </div>
        ) : (
          <button style={styles.deleteBtnGhost} onClick={onRequestDelete}>
            <Trash2 size={14} /> Delete this reminder
          </button>
        )
      ) : null}
    </>
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
  content: { flex: 1, maxWidth: '820px', width: '100%', margin: '0 auto', padding: '16px' },

  listTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' },
  pageTitle: { fontSize: '20px', fontWeight: '700', margin: 0 },
  primaryBtn: { display: 'flex', alignItems: 'center', gap: '6px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },

  searchWrap: { display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '16px', background: 'transparent' },

  filterChipRow: { display: 'flex', gap: '6px', margin: '4px 0 10px', flexWrap: 'wrap' },
  filterChip: { fontSize: '13px', fontWeight: 600, background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '5px 12px', cursor: 'pointer' },
  filterChipActive: { background: '#c8102e', color: '#fff', borderColor: '#c8102e' },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' },

  bucketHead: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 4px 8px', borderBottom: '1px solid #e5e7eb', marginBottom: '6px' },
  bucketTitle: { fontSize: '13px', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },

  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' },
  cardButton: { background: 'transparent', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer' },
  cardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' },
  title: { fontSize: '15px', fontWeight: 700 },
  recurringChip: { display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: 700, background: '#eef2ff', color: '#4338ca', borderRadius: '999px', padding: '2px 8px', textTransform: 'capitalize' },
  cardMetaRow: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' },
  dayLabel: { fontSize: '13px', fontWeight: 700 },
  dot: { color: '#d1d5db' },
  metaText: { fontSize: '12px', color: '#374151', marginTop: '2px' },
  notes: { fontSize: '12px', color: '#6b7280', marginTop: '4px', fontStyle: 'italic' },

  actionRowInline: { display: 'flex', gap: '6px', borderTop: '1px solid #f3f4f6', paddingTop: '8px' },
  orderBtn: { display: 'flex', alignItems: 'center', gap: '3px', flex: 1, fontSize: '11px', fontWeight: 700, background: '#c8102e', color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 8px', cursor: 'pointer', justifyContent: 'center' },
  checkBtn: { display: 'flex', alignItems: 'center', gap: '3px', flex: 1, fontSize: '11px', fontWeight: 700, background: '#065f46', color: '#fff', border: 'none', borderRadius: '8px', padding: '6px 8px', cursor: 'pointer', justifyContent: 'center' },
  skipBtn: { fontSize: '11px', fontWeight: 700, background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' },

  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginBottom: '12px' },
  sectionTitle: { fontSize: '13px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' },
  fieldLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginTop: '8px', marginBottom: '4px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '15px', boxSizing: 'border-box', background: '#fff' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '14px', boxSizing: 'border-box', background: '#fff', minHeight: '70px', fontFamily: 'inherit' },
  twoCol: { display: 'flex', gap: '10px' },
  hintNote: { fontSize: '12px', color: '#6b7280', margin: '6px 0 0', lineHeight: 1.4 },

  message: { fontSize: '14px', fontWeight: '600', marginBottom: '10px' },
  actionRow: { display: 'flex', gap: '10px', marginBottom: '10px' },
  saveBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  altBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },

  deleteBtnGhost: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%', background: 'transparent', color: '#c8102e', border: 'none', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', marginTop: '4px' },
  deleteConfirmBox: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '12px', marginTop: '8px' },
  deleteConfirmText: { fontSize: '14px', fontWeight: '600', color: '#7f1d1d', marginBottom: '10px' },
  deleteConfirmRow: { display: 'flex', gap: '10px' },
  deleteBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
};