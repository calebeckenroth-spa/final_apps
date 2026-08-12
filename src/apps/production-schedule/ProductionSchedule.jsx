import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Plus,
  Trash2,
  Save,
  X,
  CalendarDays,
  List,
  ClipboardCheck,
  Factory,
} from 'lucide-react';

// ------------------------------------------------------------
const STATUSES = [
  { value: 'planned', label: 'Planned', color: '#1d4ed8', bg: '#dbeafe' },
  { value: 'in_progress', label: 'In progress', color: '#a16207', bg: '#fef3c7' },
  { value: 'completed', label: 'Completed', color: '#065f46', bg: '#d1fae5' },
  { value: 'cancelled', label: 'Cancelled', color: '#6b7280', bg: '#f3f4f6' },
];

const SHIFT_PRESETS = ['Morning', 'Afternoon', 'Night'];

function blankRun(date) {
  return {
    item_no: '',
    description: '',
    planned_quantity: '',
    uom: 'CASE',
    planned_date: date || new Date().toISOString().slice(0, 10),
    shift: '',
    line: '',
    status: 'planned',
    notes: '',
  };
}

async function fetchAll(schema, tableName) {
  const pageSize = 1000;
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .schema(schema)
      .from(tableName)
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
    if (all.length > 100000) break;
  }
  return all;
}

// ============================================================
export default function ProductionSchedule() {
  const navigate = useNavigate();
  const [view, setView] = useState('list'); // 'list' | 'calendar' | 'edit'
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [assemblyRuns, setAssemblyRuns] = useState([]);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);

  // Calendar month
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() }; // month is 0-based
  });

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankRun());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [runsData, recipeData, assemblyData, itemsData] = await Promise.all([
        fetchAll('production', 'planned_runs'),
        fetchAll('production', 'recipes'),
        fetchAll('production', 'assembly_runs'),
        supabase.from('items').select('item_no, description').limit(20000),
      ]);
      setRuns(runsData || []);
      setRecipes(recipeData || []);
      setAssemblyRuns(assemblyData || []);
      setItems(itemsData.data || []);
    } finally {
      setLoading(false);
    }
  }

  // Every SKU we've made in the past (from assembly_runs) OR have an
  // approved recipe for. Tagged with hasRecipe so the dropdown can show
  // status and the warning appears when scheduling something without one.
  const recipeSkus = useMemo(() => {
    const approvedSet = new Set();
    for (const r of recipes) if (r.parent_item_no) approvedSet.add(r.parent_item_no);

    const m = new Map();
    // Fold in all SKUs from past assembly runs
    for (const ar of assemblyRuns) {
      if (!ar.item_no) continue;
      if (!m.has(ar.item_no)) {
        m.set(ar.item_no, {
          item_no: ar.item_no,
          description: ar.description || '',
          hasRecipe: approvedSet.has(ar.item_no),
        });
      }
    }
    // Ensure approved-only SKUs (no historical runs) still appear
    for (const r of recipes) {
      if (!r.parent_item_no) continue;
      if (!m.has(r.parent_item_no)) {
        m.set(r.parent_item_no, {
          item_no: r.parent_item_no,
          description: r.parent_description || '',
          hasRecipe: true,
        });
      }
    }

    // Fold in items catalog as final fallback for descriptions
    const itemMap = new Map();
    for (const it of items) if (it.item_no) itemMap.set(it.item_no, it.description);

    // Sort: recipe-approved SKUs first, then alphabetical
    return Array.from(m.values())
      .map((s) => ({
        ...s,
        description: s.description || itemMap.get(s.item_no) || '',
      }))
      .sort((a, b) => {
        if (a.hasRecipe !== b.hasRecipe) return a.hasRecipe ? -1 : 1;
        return a.item_no.localeCompare(b.item_no);
      });
  }, [assemblyRuns, recipes, items]);

  const itemCatalogMap = useMemo(() => {
    const m = new Map();
    for (const it of items) if (it.item_no) m.set(it.item_no, it.description || '');
    return m;
  }, [items]);

  const filteredRuns = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = showCompleted
      ? runs
      : runs.filter((r) => r.status !== 'completed' && r.status !== 'cancelled');
    if (!q) return base;
    return base.filter(
      (r) =>
        (r.item_no || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q) ||
        (r.line || '').toLowerCase().includes(q)
    );
  }, [runs, search, showCompleted]);

  const completedCount = useMemo(
    () =>
      runs.filter((r) => r.status === 'completed' || r.status === 'cancelled')
        .length,
    [runs]
  );

  function setF(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startNew(dateOverride) {
    setEditingId(null);
    setForm(blankRun(dateOverride));
    setMessage('');
    setConfirmDelete(false);
    setView('edit');
  }

  function openRun(r) {
    setEditingId(r.id);
    setForm({
      item_no: r.item_no || '',
      description: r.description || '',
      planned_quantity: r.planned_quantity ?? '',
      uom: r.uom || 'CASE',
      planned_date: r.planned_date || '',
      shift: r.shift || '',
      line: r.line || '',
      status: r.status || 'planned',
      notes: r.notes || '',
    });
    setMessage('');
    setConfirmDelete(false);
    setView('edit');
  }

  function selectSku(itemNo) {
    setF('item_no', itemNo);
    const fromRecipe = recipeSkus.find((s) => s.item_no === itemNo);
    if (fromRecipe) setF('description', fromRecipe.description);
    else if (itemCatalogMap.has(itemNo)) setF('description', itemCatalogMap.get(itemNo));
  }

  async function saveRun() {
    if (!form.item_no || !form.planned_quantity || !form.planned_date) {
      setMessage('Item, quantity, and date are required');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const row = {
        item_no: form.item_no,
        description: form.description || null,
        planned_quantity: Number(form.planned_quantity),
        uom: form.uom || null,
        planned_date: form.planned_date,
        shift: form.shift || null,
        line: form.line || null,
        status: form.status || 'planned',
        notes: form.notes || null,
        updated_at: new Date().toISOString(),
      };
      if (editingId) {
        const { error } = await supabase
          .schema('production')
          .from('planned_runs')
          .update(row)
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .schema('production')
          .from('planned_runs')
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

  async function deleteRun() {
    if (!editingId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .schema('production')
        .from('planned_runs')
        .delete()
        .eq('id', editingId);
      if (error) throw error;
      await load();
      setView('list');
      setEditingId(null);
    } catch (e) {
      setMessage('Error: ' + (e.message || 'unknown'));
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
              {view === 'edit' ? 'Schedule' : 'Home'}
            </span>
          </button>
          <div style={styles.titleArea}>
            <Factory size={18} color="#fff" />
            <span style={styles.headerTitle}>
              {view === 'edit'
                ? editingId
                  ? 'Edit Run'
                  : 'New Run'
                : 'Production Schedule'}
            </span>
          </div>
          {view !== 'edit' ? (
            <div style={styles.viewToggle}>
              <button
                style={{
                  ...styles.viewToggleBtn,
                  ...(view === 'list' ? styles.viewToggleActive : {}),
                }}
                onClick={() => setView('list')}
                title="List view"
              >
                <List size={16} color="#fff" />
              </button>
              <button
                style={{
                  ...styles.viewToggleBtn,
                  ...(view === 'calendar' ? styles.viewToggleActive : {}),
                }}
                onClick={() => setView('calendar')}
                title="Calendar view"
              >
                <CalendarDays size={16} color="#fff" />
              </button>
            </div>
          ) : (
            <div style={{ width: '64px' }} />
          )}
        </div>
      </div>

      <div style={styles.content}>
        {view === 'edit' ? (
          <EditView
            form={form}
            setF={setF}
            selectSku={selectSku}
            recipeSkus={recipeSkus}
            editingId={editingId}
            saving={saving}
            message={message}
            confirmDelete={confirmDelete}
            onSave={saveRun}
            onDelete={deleteRun}
            onRequestDelete={() => setConfirmDelete(true)}
            onCancelDelete={() => setConfirmDelete(false)}
          />
        ) : view === 'calendar' ? (
          <CalendarView
            calMonth={calMonth}
            setCalMonth={setCalMonth}
            runs={filteredRuns}
            onNew={(d) => startNew(d)}
            onOpen={openRun}
          />
        ) : (
          <ListView
            loading={loading}
            runs={filteredRuns}
            search={search}
            setSearch={setSearch}
            showCompleted={showCompleted}
            setShowCompleted={setShowCompleted}
            completedCount={completedCount}
            onNew={() => startNew(null)}
            onOpen={openRun}
          />
        )}
      </div>
    </div>
  );
}

// ---------- List view ----------
function ListView({
  loading,
  runs,
  search,
  setSearch,
  showCompleted,
  setShowCompleted,
  completedCount,
  onNew,
  onOpen,
}) {
  // Group by date
  const byDate = useMemo(() => {
    const m = new Map();
    for (const r of runs) {
      const d = r.planned_date || 'undated';
      const arr = m.get(d) || [];
      arr.push(r);
      m.set(d, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [runs]);

  return (
    <>
      <div style={styles.listTopRow}>
        <h2 style={styles.pageTitle}>Planned runs</h2>
        <button style={styles.primaryBtn} onClick={onNew}>
          <Plus size={18} />
          New run
        </button>
      </div>

      <div style={styles.searchWrap}>
        <Search size={18} color="#9ca3af" />
        <input
          style={styles.searchInput}
          placeholder="Search SKU, description, line, or notes..."
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
              ? `Hide completed/cancelled (${completedCount})`
              : `Show completed/cancelled (${completedCount})`}
          </button>
        </div>
      ) : null}

      {loading ? (
        <p style={{ color: '#6b7280' }}>Loading...</p>
      ) : byDate.length === 0 ? (
        <div style={styles.empty}>
          <Factory size={32} color="#d1d5db" />
          <p style={{ color: '#9ca3af', marginTop: '8px' }}>
            No planned runs yet. Tap New run to schedule one.
          </p>
        </div>
      ) : (
        byDate.map(([date, dateRuns]) => (
          <div key={date} style={{ marginBottom: '16px' }}>
            <div style={styles.dateHeader}>{formatDate(date)}</div>
            <div style={styles.list}>
              {dateRuns.map((r) => (
                <RunCard key={r.id} run={r} onOpen={() => onOpen(r)} />
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}

function RunCard({ run, onOpen }) {
  const status = STATUSES.find((s) => s.value === run.status) || STATUSES[0];
  return (
    <button style={styles.card} onClick={onOpen}>
      <div style={styles.cardTop}>
        <span style={styles.skuNo}>{run.item_no}</span>
        <span
          style={{
            ...styles.statusChip,
            color: status.color,
            background: status.bg,
          }}
        >
          {status.label}
        </span>
      </div>
      <div style={styles.skuDesc}>{run.description}</div>
      <div style={styles.cardMeta}>
        <strong>{fmtQty(run.planned_quantity)}</strong> {run.uom || 'CASE'}
        {run.shift ? ' · ' + run.shift : ''}
        {run.line ? ' · Line ' + run.line : ''}
      </div>
      {run.notes ? <div style={styles.cardNotes}>{run.notes}</div> : null}
    </button>
  );
}

// ---------- Calendar view ----------
function CalendarView({ calMonth, setCalMonth, runs, onNew, onOpen }) {
  const monthLabel = useMemo(() => {
    const d = new Date(calMonth.year, calMonth.month, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [calMonth]);

  const grid = useMemo(() => {
    const first = new Date(calMonth.year, calMonth.month, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay()); // back to Sunday
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }, [calMonth]);

  const runsByDate = useMemo(() => {
    const m = new Map();
    for (const r of runs) {
      const d = r.planned_date;
      if (!d) continue;
      const arr = m.get(d) || [];
      arr.push(r);
      m.set(d, arr);
    }
    return m;
  }, [runs]);

  function prevMonth() {
    setCalMonth((c) =>
      c.month === 0
        ? { year: c.year - 1, month: 11 }
        : { year: c.year, month: c.month - 1 }
    );
  }
  function nextMonth() {
    setCalMonth((c) =>
      c.month === 11
        ? { year: c.year + 1, month: 0 }
        : { year: c.year, month: c.month + 1 }
    );
  }

  return (
    <>
      <div style={styles.calNav}>
        <button style={styles.calNavBtn} onClick={prevMonth}>
          <ChevronLeft size={18} />
        </button>
        <span style={styles.calMonthLabel}>{monthLabel}</span>
        <button style={styles.calNavBtn} onClick={nextMonth}>
          <ChevronRight size={18} />
        </button>
      </div>

      <div style={styles.calGridHead}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} style={styles.calGridHeadCell}>
            {d}
          </div>
        ))}
      </div>

      <div style={styles.calGrid}>
        {grid.map((d, i) => {
          const iso = d.toISOString().slice(0, 10);
          const dayRuns = runsByDate.get(iso) || [];
          const isThisMonth = d.getMonth() === calMonth.month;
          const isToday = iso === new Date().toISOString().slice(0, 10);
          return (
            <div
              key={i}
              style={{
                ...styles.calCell,
                ...(isThisMonth ? {} : styles.calCellDim),
                ...(isToday ? styles.calCellToday : {}),
              }}
            >
              <div style={styles.calCellHead}>
                <span style={styles.calCellDate}>{d.getDate()}</span>
                <button
                  style={styles.calCellAddBtn}
                  onClick={() => onNew(iso)}
                  title="Schedule a run this day"
                >
                  <Plus size={12} />
                </button>
              </div>
              {dayRuns.slice(0, 3).map((r) => (
                <button
                  key={r.id}
                  style={styles.calRunPill}
                  onClick={() => onOpen(r)}
                >
                  <span style={styles.calRunPillItem}>{r.item_no}</span>
                  <span style={styles.calRunPillQty}>
                    {fmtQty(r.planned_quantity)}
                  </span>
                </button>
              ))}
              {dayRuns.length > 3 ? (
                <div style={styles.calRunMore}>
                  +{dayRuns.length - 3} more
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- Edit view ----------
function EditView({
  form,
  setF,
  selectSku,
  recipeSkus,
  editingId,
  saving,
  message,
  confirmDelete,
  onSave,
  onDelete,
  onRequestDelete,
  onCancelDelete,
}) {
  const skuHasRecipe = useMemo(
    () => recipeSkus.some((s) => s.item_no === form.item_no),
    [recipeSkus, form.item_no]
  );

  return (
    <>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>What are we making?</div>

        <label style={styles.fieldLabel}>Finished-good SKU *</label>
        <select
          style={styles.input}
          value={form.item_no}
          onChange={(e) => selectSku(e.target.value)}
        >
          <option value="">(select SKU)</option>
          {recipeSkus.map((s) => (
            <option key={s.item_no} value={s.item_no}>
              {s.hasRecipe ? '✓ ' : '  '}
              {s.item_no}
              {s.description ? ' — ' + s.description.slice(0, 40) : ''}
            </option>
          ))}
        </select>
        {form.item_no && !skuHasRecipe ? (
          <p style={styles.warnHint}>
            ⚠ No approved recipe for this SKU yet. Ingredient forecast will
            skip it until you approve one in Recipe Learner.
          </p>
        ) : null}

        <label style={styles.fieldLabel}>Description</label>
        <input
          style={styles.input}
          value={form.description}
          onChange={(e) => setF('description', e.target.value)}
          placeholder="Auto-fills from SKU"
        />

        <div style={styles.twoCol}>
          <div style={{ flex: 2 }}>
            <label style={styles.fieldLabel}>Planned quantity *</label>
            <input
              style={styles.input}
              type="number"
              min="0"
              value={form.planned_quantity}
              onChange={(e) => setF('planned_quantity', e.target.value)}
              placeholder="e.g. 500"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>UoM</label>
            <input
              style={styles.input}
              value={form.uom}
              onChange={(e) => setF('uom', e.target.value)}
            />
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>When</div>
        <label style={styles.fieldLabel}>Planned date *</label>
        <input
          style={styles.input}
          type="date"
          value={form.planned_date}
          onChange={(e) => setF('planned_date', e.target.value)}
        />

        <div style={styles.twoCol}>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Shift</label>
            <select
              style={styles.input}
              value={form.shift}
              onChange={(e) => setF('shift', e.target.value)}
            >
              <option value="">(none)</option>
              {SHIFT_PRESETS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.fieldLabel}>Line</label>
            <input
              style={styles.input}
              value={form.line}
              onChange={(e) => setF('line', e.target.value)}
              placeholder="e.g. Line 1"
            />
          </div>
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Status & notes</div>
        <label style={styles.fieldLabel}>Status</label>
        <select
          style={styles.input}
          value={form.status}
          onChange={(e) => setF('status', e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <label style={styles.fieldLabel}>Notes</label>
        <textarea
          style={styles.textarea}
          value={form.notes}
          onChange={(e) => setF('notes', e.target.value)}
          placeholder="Customer PO, special instructions..."
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
          {saving ? 'Saving...' : editingId ? 'Update run' : 'Save run'}
        </button>
      </div>

      {editingId ? (
        confirmDelete ? (
          <div style={styles.deleteConfirmBox}>
            <div style={styles.deleteConfirmText}>
              Delete this planned run permanently?
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
            <Trash2 size={14} /> Delete this run
          </button>
        )
      ) : null}
    </>
  );
}

// ---------- helpers ----------
function fmtQty(n) {
  if (n == null) return '—';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return num.toLocaleString();
}

function formatDate(d) {
  if (!d || d === 'undated') return 'No date';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------- styles ----------
const styles = {
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f8f8' },
  header: { backgroundColor: '#c8102e', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  headerInner: { maxWidth: '900px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' },
  backText: { fontSize: '13px', color: '#fff', fontWeight: '500' },
  titleArea: { display: 'flex', alignItems: 'center', gap: '8px' },
  headerTitle: { fontSize: '18px', fontWeight: '700', color: '#fff' },
  viewToggle: { display: 'flex', gap: '4px', background: 'rgba(255,255,255,0.15)', borderRadius: '8px', padding: '3px' },
  viewToggleBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer' },
  viewToggleActive: { background: 'rgba(255,255,255,0.35)' },
  content: { flex: 1, maxWidth: '900px', width: '100%', margin: '0 auto', padding: '16px' },

  listTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' },
  pageTitle: { fontSize: '20px', fontWeight: '700', margin: 0 },
  primaryBtn: { display: 'flex', alignItems: 'center', gap: '6px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },

  searchWrap: { display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '16px', background: 'transparent' },

  filterChipRow: { display: 'flex', gap: '6px', margin: '4px 0 8px', flexWrap: 'wrap' },
  filterChip: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 600, background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '5px 12px', cursor: 'pointer' },
  filterChipActive: { background: '#c8102e', color: '#fff', borderColor: '#c8102e' },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' },
  dateHeader: { fontSize: '13px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 4px' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px', textAlign: 'left', cursor: 'pointer', width: '100%' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
  skuNo: { fontSize: '15px', fontWeight: 700, color: '#c8102e' },
  statusChip: { fontSize: '11px', fontWeight: 700, borderRadius: '999px', padding: '2px 8px' },
  skuDesc: { fontSize: '15px', fontWeight: '600' },
  cardMeta: { fontSize: '13px', color: '#374151', marginTop: '4px' },
  cardNotes: { fontSize: '12px', color: '#6b7280', marginTop: '2px', fontStyle: 'italic' },

  // Calendar
  calNav: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '10px' },
  calNavBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' },
  calMonthLabel: { fontSize: '17px', fontWeight: '700', minWidth: '180px', textAlign: 'center' },
  calGridHead: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '4px' },
  calGridHeadCell: { fontSize: '11px', fontWeight: 700, color: '#6b7280', textAlign: 'center', padding: '4px' },
  calGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' },
  calCell: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '4px', minHeight: '90px', display: 'flex', flexDirection: 'column', gap: '3px' },
  calCellDim: { background: '#fafafa', color: '#9ca3af' },
  calCellToday: { border: '2px solid #c8102e' },
  calCellHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  calCellDate: { fontSize: '12px', fontWeight: 700 },
  calCellAddBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: '4px', padding: '2px', cursor: 'pointer', color: '#9ca3af' },
  calRunPill: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', background: '#dbeafe', color: '#1e3a8a', border: 'none', borderRadius: '6px', padding: '3px 6px', cursor: 'pointer', textAlign: 'left', width: '100%', boxSizing: 'border-box' },
  calRunPillItem: { fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' },
  calRunPillQty: { fontSize: '10px', fontWeight: 500 },
  calRunMore: { fontSize: '10px', color: '#6b7280', paddingLeft: '2px' },

  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginBottom: '12px' },
  sectionTitle: { fontSize: '13px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' },
  fieldLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginTop: '8px', marginBottom: '4px' },
  input: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '15px', boxSizing: 'border-box', background: '#fff' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '14px', boxSizing: 'border-box', background: '#fff', minHeight: '70px', fontFamily: 'inherit' },
  twoCol: { display: 'flex', gap: '10px' },
  warnHint: { fontSize: '12px', color: '#a16207', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '8px', padding: '6px 10px', marginTop: '6px' },

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