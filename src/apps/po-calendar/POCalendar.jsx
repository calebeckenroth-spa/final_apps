import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  ChevronDown,
  X,
  Clock,
  Save,
  RefreshCw,
  Truck,
} from 'lucide-react';

// ---------- date helpers ----------
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Format YYYY-MM-DD in *local* time (avoid UTC drift on toISOString)
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfWeek(d) {
  const x = new Date(d);
  x.setDate(d.getDate() - d.getDay());
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(d.getDate() + n);
  return x;
}
function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function isToday(d) {
  return sameDay(d, new Date());
}
function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':');
  const H = parseInt(h, 10);
  const ampm = H >= 12 ? 'PM' : 'AM';
  const H12 = H % 12 || 12;
  return `${H12}:${m} ${ampm}`;
}

// ---------- main ----------
export default function POCalendar() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'week'
  const [anchor, setAnchor] = useState(new Date());
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [dragOverDate, setDragOverDate] = useState(null);
  const [selectedPo, setSelectedPo] = useState(null); // for edit-time modal

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setRefreshing(true);
    try {
      const { data } = await supabase
        .schema('procurement')
        .from('pos')
        .select(
          'id, po_number, vendor_name, status, expected_date, expected_time, calendar_notes, order_date, total_amount'
        )
        .in('status', ['open', 'partially_received'])
        .order('expected_date', { ascending: true });
      setPos(data || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Group POs by expected_date (or 'unscheduled')
  const posByDate = useMemo(() => {
    const m = new Map();
    for (const p of pos) {
      const key = p.expected_date || 'unscheduled';
      const arr = m.get(key) || [];
      arr.push(p);
      m.set(key, arr);
    }
    return m;
  }, [pos]);

  const unscheduled = posByDate.get('unscheduled') || [];
  const scheduled = pos.filter((p) => !!p.expected_date);

  async function assignPoToDate(poId, dateStr) {
    setMessage('');
    // Optimistic update
    setPos((prev) =>
      prev.map((p) => (p.id === poId ? { ...p, expected_date: dateStr } : p))
    );
    try {
      const { error } = await supabase
        .schema('procurement')
        .from('pos')
        .update({
          expected_date: dateStr,
          updated_at: new Date().toISOString(),
        })
        .eq('id', poId);
      if (error) throw error;
      setMessage('Rescheduled \u2713');
    } catch (e) {
      setMessage('Error: ' + (e.message || 'failed'));
      load(); // reload on failure to reset optimistic update
    }
  }

  async function updatePoDetails(poId, { expected_time, calendar_notes }) {
    setMessage('');
    setPos((prev) =>
      prev.map((p) =>
        p.id === poId
          ? { ...p, expected_time, calendar_notes }
          : p
      )
    );
    try {
      const { error } = await supabase
        .schema('procurement')
        .from('pos')
        .update({
          expected_time: expected_time || null,
          calendar_notes: calendar_notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', poId);
      if (error) throw error;
      setMessage('Saved \u2713');
    } catch (e) {
      setMessage('Error: ' + (e.message || 'failed'));
      load();
    }
  }

  async function unscheduleP(poId) {
    setMessage('');
    setPos((prev) =>
      prev.map((p) =>
        p.id === poId
          ? { ...p, expected_date: null, expected_time: null }
          : p
      )
    );
    try {
      const { error } = await supabase
        .schema('procurement')
        .from('pos')
        .update({
          expected_date: null,
          expected_time: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', poId);
      if (error) throw error;
      setMessage('Unscheduled');
    } catch (e) {
      setMessage('Error: ' + (e.message || 'failed'));
      load();
    }
  }

  // ---------- date range for current view ----------
  const range = useMemo(() => {
    if (viewMode === 'month') {
      const first = startOfMonth(anchor);
      const gridStart = startOfWeek(first);
      const cells = [];
      for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
      return cells;
    }
    const gridStart = startOfWeek(anchor);
    const cells = [];
    for (let i = 0; i < 7; i++) cells.push(addDays(gridStart, i));
    return cells;
  }, [viewMode, anchor]);

  function goPrev() {
    if (viewMode === 'month') {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));
    } else {
      setAnchor(addDays(anchor, -7));
    }
  }
  function goNext() {
    if (viewMode === 'month') {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
    } else {
      setAnchor(addDays(anchor, 7));
    }
  }
  function goToday() {
    setAnchor(new Date());
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
            <Calendar size={18} color="#fff" />
            <span style={styles.headerTitle}>PO Calendar</span>
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
        {/* Toolbar */}
        <div style={styles.toolbar}>
          <div style={styles.navGroup}>
            <button style={styles.navBtn} onClick={goPrev}>
              <ChevronLeft size={16} />
            </button>
            <button style={styles.todayBtn} onClick={goToday}>
              Today
            </button>
            <button style={styles.navBtn} onClick={goNext}>
              <ChevronRight size={16} />
            </button>
            <span style={styles.rangeLabel}>
              {viewMode === 'month'
                ? `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
                : `Week of ${range[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
            </span>
          </div>
          <div style={styles.viewToggle}>
            <button
              style={{
                ...styles.toggleBtn,
                ...(viewMode === 'month' ? styles.toggleBtnActive : {}),
              }}
              onClick={() => setViewMode('month')}
            >
              Month
            </button>
            <button
              style={{
                ...styles.toggleBtn,
                ...(viewMode === 'week' ? styles.toggleBtnActive : {}),
              }}
              onClick={() => setViewMode('week')}
            >
              Week
            </button>
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

        {/* Main layout: sidebar + calendar */}
        <div style={styles.mainRow}>
          {/* Sidebar */}
          <div style={styles.sidebar}>
            <div style={styles.sidebarSection}>
              <div style={styles.sidebarTitle}>
                Unscheduled ({unscheduled.length})
              </div>
              {unscheduled.length === 0 ? (
                <p style={styles.sidebarEmpty}>All POs are scheduled.</p>
              ) : (
                unscheduled.map((p) => (
                  <PoChip key={p.id} po={p} />
                ))
              )}
            </div>

            <div style={styles.sidebarSection}>
              <div style={styles.sidebarTitle}>
                Scheduled ({scheduled.length})
              </div>
              <p style={styles.sidebarHint}>
                Drag any PO onto a new day to reschedule.
              </p>
              {scheduled.slice(0, 20).map((p) => (
                <PoChip key={p.id} po={p} scheduled />
              ))}
              {scheduled.length > 20 && (
                <p style={styles.sidebarHint}>
                  +{scheduled.length - 20} more (visible on calendar)
                </p>
              )}
            </div>
          </div>

          {/* Calendar */}
          <div style={styles.calendarWrap}>
            <div style={styles.dowRow}>
              {DOW.map((d) => (
                <div key={d} style={styles.dowCell}>
                  {d}
                </div>
              ))}
            </div>
            <div
              style={{
                ...styles.grid,
                gridTemplateRows: viewMode === 'month' ? 'repeat(6, minmax(90px, 1fr))' : 'minmax(220px, 1fr)',
              }}
            >
              {range.map((d) => {
                const key = ymd(d);
                const dayPos = posByDate.get(key) || [];
                const otherMonth =
                  viewMode === 'month' && d.getMonth() !== anchor.getMonth();
                return (
                  <div
                    key={key}
                    style={{
                      ...styles.dayCell,
                      ...(otherMonth ? styles.dayCellOther : {}),
                      ...(isToday(d) ? styles.dayCellToday : {}),
                      ...(dragOverDate === key ? styles.dayCellDragOver : {}),
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverDate(key);
                    }}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverDate(null);
                      const poId = e.dataTransfer.getData('text/po-id');
                      if (poId) assignPoToDate(poId, key);
                    }}
                  >
                    <div style={styles.dayNumRow}>
                      <span
                        style={{
                          ...styles.dayNum,
                          ...(isToday(d) ? styles.dayNumToday : {}),
                        }}
                      >
                        {d.getDate()}
                      </span>
                      {dayPos.length > 0 && (
                        <span style={styles.dayCount}>{dayPos.length}</span>
                      )}
                    </div>
                    <div style={styles.dayEvents}>
                      {dayPos.map((p) => (
                        <DayEvent
                          key={p.id}
                          po={p}
                          onClick={() => setSelectedPo(p)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selectedPo && (
        <EditModal
          po={selectedPo}
          onClose={() => setSelectedPo(null)}
          onSave={async (fields) => {
            await updatePoDetails(selectedPo.id, fields);
            setSelectedPo(null);
          }}
          onUnschedule={async () => {
            await unscheduleP(selectedPo.id);
            setSelectedPo(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- draggable PO chip in sidebar ----------
function PoChip({ po, scheduled }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/po-id', po.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      style={{
        ...styles.poChip,
        ...(scheduled ? styles.poChipScheduled : {}),
      }}
    >
      <div style={styles.poChipTop}>
        <span style={styles.poChipNumber}>{po.po_number}</span>
        {scheduled && po.expected_date ? (
          <span style={styles.poChipDate}>
            {new Date(po.expected_date + 'T00:00:00').toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        ) : null}
      </div>
      <div style={styles.poChipVendor}>{po.vendor_name || '(no vendor)'}</div>
    </div>
  );
}

// ---------- event pill inside a calendar day ----------
function DayEvent({ po, onClick }) {
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/po-id', po.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      style={styles.eventPill}
      onClick={onClick}
    >
      <Truck size={10} />
      <span style={styles.eventText}>
        {po.expected_time ? formatTime(po.expected_time) + ' — ' : ''}
        {po.vendor_name || po.po_number}
      </span>
    </button>
  );
}

// ---------- modal for setting time / notes ----------
function EditModal({ po, onClose, onSave, onUnschedule }) {
  const [time, setTime] = useState(po.expected_time || '');
  const [notes, setNotes] = useState(po.calendar_notes || '');
  const [saving, setSaving] = useState(false);

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHead}>
          <div>
            <div style={styles.modalPoNo}>{po.po_number}</div>
            <div style={styles.modalVendor}>{po.vendor_name || ''}</div>
          </div>
          <button style={styles.iconBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={styles.modalDateRow}>
          <Calendar size={14} />
          <span>
            {po.expected_date
              ? new Date(po.expected_date + 'T00:00:00').toLocaleDateString(
                  'en-US',
                  { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
                )
              : '(no date)'}
          </span>
        </div>

        <label style={styles.fieldLabel}>Expected arrival time</label>
        <div style={styles.timeRow}>
          <Clock size={16} color="#6b7280" />
          <input
            type="time"
            style={styles.timeInput}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>

        <label style={styles.fieldLabel}>Notes (dock, window, carrier)</label>
        <textarea
          style={styles.textarea}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Dock 2, 8am-noon window, ask for Mike..."
        />

        <div style={styles.actionRow}>
          <button
            style={styles.saveBtn}
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({ expected_time: time, calendar_notes: notes });
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save size={18} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <button style={styles.unscheduleBtn} onClick={onUnschedule}>
          Unschedule (move back to sidebar)
        </button>
      </div>
    </div>
  );
}

// ---------- styles ----------
const styles = {
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f8f8' },
  header: { backgroundColor: '#c8102e', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  headerInner: { maxWidth: '1200px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' },
  backText: { fontSize: '13px', color: '#fff', fontWeight: '500' },
  titleArea: { display: 'flex', alignItems: 'center', gap: '8px' },
  headerTitle: { fontSize: '18px', fontWeight: '700', color: '#fff' },
  refreshBtn: { background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' },
  content: { flex: 1, maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '16px' },

  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' },
  navGroup: { display: 'flex', alignItems: 'center', gap: '6px' },
  navBtn: { background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px', padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' },
  todayBtn: { background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' },
  rangeLabel: { fontSize: '17px', fontWeight: '700', marginLeft: '8px' },
  viewToggle: { display: 'flex', gap: '4px', background: '#f3f4f6', borderRadius: '10px', padding: '3px' },
  toggleBtn: { border: 'none', background: 'transparent', padding: '6px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', color: '#374151' },
  toggleBtnActive: { background: '#fff', color: '#c8102e', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' },

  message: { fontSize: '13px', fontWeight: '600', marginBottom: '10px' },

  mainRow: { display: 'grid', gridTemplateColumns: '260px 1fr', gap: '12px', alignItems: 'start' },

  sidebar: { display: 'flex', flexDirection: 'column', gap: '10px' },
  sidebarSection: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '12px' },
  sidebarTitle: { fontSize: '13px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' },
  sidebarHint: { fontSize: '11px', color: '#9ca3af', margin: '4px 0 8px' },
  sidebarEmpty: { fontSize: '13px', color: '#9ca3af', textAlign: 'center', padding: '10px 0' },

  poChip: { background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '8px', padding: '8px 10px', marginBottom: '6px', cursor: 'grab' },
  poChipScheduled: { background: '#f0fdf4', border: '1px solid #bbf7d0' },
  poChipTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  poChipNumber: { fontSize: '12px', fontWeight: '700', color: '#c8102e' },
  poChipDate: { fontSize: '11px', color: '#065f46', fontWeight: 600 },
  poChipVendor: { fontSize: '12px', color: '#374151', marginTop: '2px' },

  calendarWrap: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden' },
  dowRow: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' },
  dowCell: { padding: '8px', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' },
  dayCell: { borderRight: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6', padding: '6px', display: 'flex', flexDirection: 'column', minHeight: '90px', background: '#fff' },
  dayCellOther: { background: '#fafafa', color: '#9ca3af' },
  dayCellToday: { background: '#fff1f2' },
  dayCellDragOver: { background: '#dcfce7', outline: '2px dashed #16a34a' },
  dayNumRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' },
  dayNum: { fontSize: '12px', fontWeight: '600', color: '#374151' },
  dayNumToday: { background: '#c8102e', color: '#fff', borderRadius: '50%', width: '22px', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' },
  dayCount: { fontSize: '10px', fontWeight: '700', color: '#c8102e', background: '#fef3c7', borderRadius: '999px', padding: '1px 6px' },
  dayEvents: { display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' },

  eventPill: { display: 'flex', alignItems: 'center', gap: '3px', background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', borderRadius: '4px', padding: '2px 4px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', textAlign: 'left', width: '100%', overflow: 'hidden' },
  eventText: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },

  // Modal
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal: { background: '#fff', borderRadius: '16px', width: '90%', maxWidth: '480px', padding: '18px' },
  modalHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px' },
  modalPoNo: { fontSize: '16px', fontWeight: '700', color: '#c8102e' },
  modalVendor: { fontSize: '14px', color: '#374151' },
  modalDateRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151', padding: '8px 10px', background: '#f9fafb', borderRadius: '8px', marginBottom: '10px' },
  iconBtn: { background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px' },
  fieldLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px', marginTop: '10px' },
  timeRow: { display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '8px 12px' },
  timeInput: { flex: 1, border: 'none', outline: 'none', fontSize: '15px' },
  textarea: { width: '100%', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', fontSize: '14px', boxSizing: 'border-box', minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' },
  actionRow: { display: 'flex', gap: '10px', marginTop: '14px' },
  saveBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  unscheduleBtn: { display: 'block', width: '100%', background: 'transparent', color: '#6b7280', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer', padding: '14px 8px 4px', textDecoration: 'underline', textAlign: 'center' },
};