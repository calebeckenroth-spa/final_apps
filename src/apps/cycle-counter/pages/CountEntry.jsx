import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient.js';
import {
  Search,
  X,
  AlertTriangle,
  ChevronLeft,
  ClipboardCheck,
} from 'lucide-react';

const CATEGORIES = [
  { prefix: 'ALL', label: 'All' },
  { prefix: 'SA', label: 'Salsa' },
  { prefix: 'SU', label: 'Sauce' },
  { prefix: 'CH', label: 'Chile' },
  { prefix: 'FZ', label: 'Frozen' },
  { prefix: 'CG', label: 'Corrugated' },
  { prefix: 'DI', label: 'Dry Ing.' },
  { prefix: 'CT', label: 'Container' },
  { prefix: 'FH', label: 'Fresh' },
  { prefix: 'LB', label: 'Label' },
  { prefix: 'OL', label: 'Oil' },
  { prefix: 'SP', label: 'Sec. Pkg' },
  { prefix: 'SS', label: 'Scorpion' },
];

function expStatus(dateStr) {
  if (!dateStr) return { label: 'No Date', color: '#9ca3af', bg: '#f3f4f6' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(dateStr);
  const days = Math.floor((exp - today) / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: 'EXPIRED', color: '#dc2626', bg: '#fef2f2' };
  if (days <= 30)
    return { label: `Exp ${days}d`, color: '#b45309', bg: '#fffbeb' };
  return { label: 'Good', color: '#15803d', bg: '#f0fdf4' };
}

export default function CountEntry() {
  const navigate = useNavigate();
  const { id: sessionId } = useParams();

  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [allBins, setAllBins] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const [category, setCategory] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedItemNo, setSelectedItemNo] = useState(null);
  const [selectedLot, setSelectedLot] = useState(null);

  const [physBin, setPhysBin] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [dupEntry, setDupEntry] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    loadAll();
  }, [sessionId]);

  async function loadAll() {
    setLoading(true);
    const sessionReq = supabase
      .schema('cycle_count')
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    const itemsReq = supabase
      .from('items')
      .select('*')
      .order('item_no')
      .limit(5000);
    const binsReq = supabase
      .from('items')
      .select('bin_code')
      .not('bin_code', 'is', null)
      .order('bin_code');
    const entriesReq = supabase
      .schema('cycle_count')
      .from('count_entries')
      .select('*')
      .eq('session_id', sessionId)
      .order('counted_at', { ascending: false });

    const results = await Promise.all([
      sessionReq,
      itemsReq,
      binsReq,
      entriesReq,
    ]);
    setSession(results.at(0).data);
    setItems(results.at(1).data || []);

    const rawBins = results.at(2).data || [];
    const uniqueBins = Array.from(
      new Set(rawBins.map((b) => b.bin_code).filter(Boolean))
    ).sort();
    setAllBins(uniqueBins);

    setEntries(results.at(3).data || []);
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

  const filteredItems = useMemo(() => {
    let list = uniqueItems;
    if (category !== 'ALL') {
      list = list.filter((it) => it.item_no.toUpperCase().startsWith(category));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (it) =>
          it.item_no.toLowerCase().includes(q) ||
          (it.description || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 100);
  }, [uniqueItems, category, search]);

  const lotsForItem = useMemo(() => {
    if (!selectedItemNo) return [];
    return items.filter((it) => it.item_no === selectedItemNo);
  }, [items, selectedItemNo]);

  function selectItem(itemNo) {
    setSelectedItemNo(itemNo);
    setSelectedLot(null);
    resetForm();
    const lots = items.filter((it) => it.item_no === itemNo);
    if (lots.length === 1) selectLot(lots.at(0));
  }

  function selectLot(lotRecord) {
    setSelectedLot(lotRecord);
    setPhysBin(lotRecord.bin_code || '');
  }

  function resetForm() {
    setPhysBin('');
    setCountedQty('');
    setNotes('');
  }

  function clearSelection() {
    setSelectedItemNo(null);
    setSelectedLot(null);
    resetForm();
  }

  async function submitEntry() {
    if (!selectedLot) return;
    const qty = parseFloat(countedQty);
    if (isNaN(qty) || countedQty === '') {
      setToast('Please enter a counted quantity.');
      return;
    }
    if (!physBin) {
      setToast('Please select the physical bin.');
      return;
    }

    const existing = entries.find(
      (e) =>
        e.item_no === selectedLot.item_no &&
        e.lot_no === (selectedLot.lot_no || '') &&
        (e.physical_bin || '') === physBin
    );

    if (existing) {
      setDupEntry({ existing, newQty: qty });
      return;
    }

    await saveNewEntry(qty);
  }

  async function saveNewEntry(qty) {
    setSaving(true);
    const { error } = await supabase
      .schema('cycle_count')
      .from('count_entries')
      .insert({
        session_id: sessionId,
        item_no: selectedLot.item_no,
        description: selectedLot.description,
        lot_no: selectedLot.lot_no || '',
        uom: selectedLot.uom,
        expiration_date: selectedLot.expiration_date,
        bc_location: selectedLot.location_code,
        bc_bin: selectedLot.bin_code,
        bc_quantity: selectedLot.bc_quantity,
        physical_location: null,
        physical_bin: physBin || null,
        counted_quantity: qty,
        notes: notes.trim() || null,
      });
    setSaving(false);
    if (error) {
      setToast('Save failed: ' + error.message);
      return;
    }
    setToast('Count saved!');
    clearSelection();
    refreshEntries();
  }

  async function combineDuplicate() {
    const { existing, newQty } = dupEntry;
    setSaving(true);
    const { error } = await supabase
      .schema('cycle_count')
      .from('count_entries')
      .update({
        counted_quantity: Number(existing.counted_quantity) + newQty,
        counted_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    setSaving(false);
    setDupEntry(null);
    if (error) {
      setToast('Update failed: ' + error.message);
      return;
    }
    setToast('Counts combined!');
    clearSelection();
    refreshEntries();
  }

  async function refreshEntries() {
    const { data } = await supabase
      .schema('cycle_count')
      .from('count_entries')
      .select('*')
      .eq('session_id', sessionId)
      .order('counted_at', { ascending: false });
    setEntries(data || []);
  }

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 2500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  if (loading) return <p style={{ color: '#6b7280' }}>Loading...</p>;

  return (
    <div>
      {/* Session header */}
      <div style={styles.sessionBar}>
        <div>
          <div style={styles.sessionName}>{session?.session_name}</div>
          <div style={styles.sessionMeta}>
            {session?.counted_by} • {entries.length} entries
          </div>
        </div>
        <button
          style={styles.reviewBtn}
          onClick={() =>
            navigate(`/cycle-counter/sessions/${sessionId}/review`)
          }
        >
          <ClipboardCheck size={16} />
          Review
        </button>
      </div>

      {/* ════ STEP 1: Pick Item ════ */}
      {!selectedLot && (
        <>
          {/* Category tabs */}
          <div style={styles.catRow} className="scroll-x">
            {CATEGORIES.map((c) => (
              <button
                key={c.prefix}
                style={{
                  ...styles.catTab,
                  ...(category === c.prefix ? styles.catTabActive : {}),
                }}
                onClick={() => setCategory(c.prefix)}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={styles.searchWrap}>
            <Search size={18} color="#9ca3af" style={styles.searchIcon} />
            <input
              style={styles.searchInput}
              placeholder="Search item no or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button style={styles.searchClear} onClick={() => setSearch('')}>
                <X size={16} />
              </button>
            )}
          </div>

          {/* Item list OR lot picker */}
          {!selectedItemNo ? (
            <div style={styles.itemList}>
              {filteredItems.length === 0 && (
                <p style={styles.noResults}>No items found</p>
              )}
              {filteredItems.map((it) => (
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
          ) : (
            <div>
              <button style={styles.backLink} onClick={clearSelection}>
                <ChevronLeft size={16} /> Back to items
              </button>
              <div style={styles.lotHeader}>
                Select lot for <strong>{selectedItemNo}</strong>
              </div>
              <div style={styles.itemList}>
                {lotsForItem.map((lot) => {
                  const exp = expStatus(lot.expiration_date);
                  return (
                    <button
                      key={lot.id}
                      style={styles.lotRow}
                      onClick={() => selectLot(lot)}
                    >
                      <div style={styles.lotTopRow}>
                        <span style={styles.lotNo}>
                          {lot.lot_no || '(no lot)'}
                        </span>
                        <span
                          style={{
                            ...styles.expBadge,
                            color: exp.color,
                            background: exp.bg,
                          }}
                        >
                          {exp.label}
                        </span>
                      </div>
                      <div style={styles.lotMeta}>
                        {lot.location_code} • Bin: {lot.bin_code || '—'} • BC
                        Qty: {lot.bc_quantity} {lot.uom}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ════ STEP 2: Count Form ════ */}
      {selectedLot && (
        <div>
          <button style={styles.backLink} onClick={clearSelection}>
            <ChevronLeft size={16} /> Change item
          </button>

          {/* Item info card */}
          <div style={styles.infoCard}>
            <div style={styles.infoTitle}>
              {selectedLot.item_no} — {selectedLot.description}
            </div>
            <div style={styles.infoGrid}>
              <div style={styles.infoCell}>
                <span style={styles.infoLabel}>Lot</span>
                <span style={styles.infoValue}>
                  {selectedLot.lot_no || '—'}
                </span>
              </div>
              <div style={styles.infoCell}>
                <span style={styles.infoLabel}>BC Qty</span>
                <span style={styles.infoValue}>
                  {selectedLot.bc_quantity} {selectedLot.uom}
                </span>
              </div>
              <div style={styles.infoCell}>
                <span style={styles.infoLabel}>BC Location</span>
                <span style={styles.infoValue}>
                  {selectedLot.location_code || '—'}
                </span>
              </div>
              <div style={styles.infoCell}>
                <span style={styles.infoLabel}>BC Bin</span>
                <span style={styles.infoValue}>
                  {selectedLot.bin_code || '—'}
                </span>
              </div>
              <div style={styles.infoCell}>
                <span style={styles.infoLabel}>Expiration</span>
                <span
                  style={{
                    ...styles.infoValue,
                    color: expStatus(selectedLot.expiration_date).color,
                  }}
                >
                  {selectedLot.expiration_date || 'No date'}
                </span>
              </div>
            </div>
          </div>

          {/* Physical Bin Found */}
          <label style={styles.label}>Physical Bin Found *</label>
          <select
            style={styles.select}
            value={physBin}
            onChange={(e) => setPhysBin(e.target.value)}
          >
            <option value="">Select bin...</option>
            {allBins.map((bin) => (
              <option key={bin} value={bin}>
                {bin}
              </option>
            ))}
          </select>

          {/* Counted Quantity */}
          <label style={styles.label}>Counted Quantity *</label>
          <input
            style={{ ...styles.input, fontSize: '22px', fontWeight: '700' }}
            type="number"
            inputMode="decimal"
            placeholder="0"
            value={countedQty}
            onChange={(e) => setCountedQty(e.target.value)}
          />

          {/* Notes */}
          <label style={styles.label}>Notes (optional)</label>
          <input
            style={styles.input}
            placeholder="Anything unusual..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <button
            style={styles.submitBtn}
            onClick={submitEntry}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Count'}
          </button>
        </div>
      )}

      {/* ════ Recent Entries ════ */}
      {!selectedLot && entries.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <div style={styles.recentTitle}>Recent Entries</div>
          {entries.slice(0, 8).map((e) => (
            <div key={e.id} style={styles.entryRow}>
              <div>
                <div style={styles.entryItem}>
                  {e.item_no} • Lot {e.lot_no || '—'}
                </div>
                <div style={styles.entryMeta}>
                  BC Bin: {e.bc_bin || '—'} → Found: {e.physical_bin || '—'}
                </div>
              </div>
              <div style={styles.entryQty}>
                {e.counted_quantity}{' '}
                <span style={styles.entryUom}>{e.uom}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════ Duplicate Modal ════ */}
      {dupEntry && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <AlertTriangle
              size={40}
              color="#b45309"
              style={{ margin: '0 auto' }}
            />
            <h3 style={styles.modalTitle}>Duplicate Entry Detected</h3>
            <p style={styles.modalText}>
              <strong>{dupEntry.existing.item_no}</strong> — Lot{' '}
              {dupEntry.existing.lot_no || '—'}
              <br />
              Physical Bin: {dupEntry.existing.physical_bin || '—'}
            </p>
            <div style={styles.dupMath}>
              <div style={styles.dupRow}>
                <span>Already counted:</span>
                <strong>{dupEntry.existing.counted_quantity}</strong>
              </div>
              <div style={styles.dupRow}>
                <span>You are entering:</span>
                <strong>{dupEntry.newQty}</strong>
              </div>
              <div style={{ ...styles.dupRow, ...styles.dupTotal }}>
                <span>New combined total:</span>
                <strong>
                  {Number(dupEntry.existing.counted_quantity) + dupEntry.newQty}
                </strong>
              </div>
            </div>
            <div style={styles.modalButtons}>
              <button
                style={styles.modalCancel}
                onClick={() => setDupEntry(null)}
                disabled={saving}
              >
                Discard
              </button>
              <button
                style={styles.modalConfirm}
                onClick={combineDuplicate}
                disabled={saving}
              >
                Add to Count
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

const styles = {
  sessionBar: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
  },
  sessionName: { fontSize: '15px', fontWeight: '700' },
  sessionMeta: { fontSize: '12px', color: '#6b7280' },
  reviewBtn: {
    background: '#1a1a1a',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '10px 14px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  catRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
    paddingBottom: '4px',
  },
  catTab: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '999px',
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: '500',
    color: '#6b7280',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    minHeight: 'auto',
    flexShrink: 0,
  },
  catTabActive: {
    background: '#c8102e',
    borderColor: '#c8102e',
    color: '#fff',
  },
  searchWrap: {
    position: 'relative',
    marginBottom: '12px',
  },
  searchIcon: {
    position: 'absolute',
    left: '14px',
    top: '50%',
    transform: 'translateY(-50%)',
  },
  searchInput: {
    width: '100%',
    border: '1px solid #d1d5db',
    borderRadius: '12px',
    padding: '14px 40px 14px 42px',
    fontSize: '16px',
    background: '#fff',
  },
  searchClear: {
    position: 'absolute',
    right: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    padding: '6px',
    cursor: 'pointer',
    minHeight: 'auto',
    display: 'flex',
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  noResults: {
    color: '#9ca3af',
    fontSize: '14px',
    textAlign: 'center',
    padding: '24px',
  },
  itemRow: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
  },
  itemNo: { fontSize: '14px', fontWeight: '700', color: '#c8102e' },
  itemDesc: { fontSize: '13px', color: '#4b5563' },
  backLink: {
    background: 'none',
    border: 'none',
    color: '#c8102e',
    fontWeight: '600',
    fontSize: '14px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '4px 0',
    marginBottom: '8px',
    minHeight: 'auto',
  },
  lotHeader: {
    fontSize: '14px',
    color: '#4b5563',
    marginBottom: '10px',
  },
  lotRow: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '14px',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left',
    marginBottom: '6px',
  },
  lotTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '4px',
  },
  lotNo: { fontSize: '14px', fontWeight: '700' },
  expBadge: {
    fontSize: '11px',
    fontWeight: '600',
    padding: '2px 8px',
    borderRadius: '999px',
  },
  lotMeta: { fontSize: '12px', color: '#6b7280' },
  infoCard: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '16px',
  },
  infoTitle: {
    fontSize: '15px',
    fontWeight: '700',
    marginBottom: '12px',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px',
  },
  infoCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  infoLabel: {
    fontSize: '11px',
    color: '#9ca3af',
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  infoValue: { fontSize: '14px', fontWeight: '600' },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '6px',
    marginTop: '14px',
  },
  select: {
    width: '100%',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '12px 14px',
    fontSize: '16px',
    background: '#fff',
  },
  input: {
    width: '100%',
    border: '1px solid #d1d5db',
    borderRadius: '10px',
    padding: '12px 14px',
    fontSize: '16px',
    background: '#fff',
  },
  submitBtn: {
    width: '100%',
    background: '#c8102e',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    padding: '16px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '20px',
  },
  recentTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: '8px',
  },
  entryRow: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '12px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '6px',
  },
  entryItem: { fontSize: '13px', fontWeight: '600' },
  entryMeta: { fontSize: '12px', color: '#6b7280' },
  entryQty: { fontSize: '16px', fontWeight: '700' },
  entryUom: { fontSize: '11px', color: '#9ca3af', fontWeight: '400' },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 1000,
  },
  modal: {
    background: '#fff',
    borderRadius: '16px',
    padding: '24px',
    maxWidth: '380px',
    width: '100%',
    textAlign: 'center',
  },
  modalTitle: { fontSize: '18px', fontWeight: '700', margin: '12px 0 8px' },
  modalText: {
    fontSize: '14px',
    color: '#4b5563',
    lineHeight: '1.5',
    marginBottom: '16px',
  },
  dupMath: {
    background: '#f9fafb',
    borderRadius: '10px',
    padding: '14px',
    marginBottom: '20px',
    textAlign: 'left',
  },
  dupRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '14px',
    padding: '4px 0',
    color: '#4b5563',
  },
  dupTotal: {
    borderTop: '1px solid #e5e7eb',
    marginTop: '6px',
    paddingTop: '10px',
    color: '#1a1a1a',
    fontSize: '15px',
  },
  modalButtons: { display: 'flex', gap: '12px' },
  modalCancel: {
    flex: 1,
    background: '#f3f4f6',
    color: '#1a1a1a',
    border: 'none',
    borderRadius: '10px',
    padding: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  modalConfirm: {
    flex: 1,
    background: '#c8102e',
    color: '#fff',
    border: 'none',
    borderRadius: '10px',
    padding: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  toast: {
    position: 'fixed',
    bottom: '90px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1a1a1a',
    color: '#fff',
    padding: '12px 24px',
    borderRadius: '999px',
    fontSize: '14px',
    fontWeight: '500',
    zIndex: 1100,
    whiteSpace: 'nowrap',
  },
};
