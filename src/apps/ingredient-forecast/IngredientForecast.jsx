import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';
import Papa from 'papaparse';
import {
  ChevronLeft,
  Search,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
} from 'lucide-react';

const DEFAULT_HORIZON_DAYS = 30;

async function fetchAll(schema, tableName) {
  const pageSize = 1000;
  const all = [];
  let from = 0;
  while (true) {
    const q = schema
      ? supabase.schema(schema).from(tableName)
      : supabase.from(tableName);
    const { data, error } = await q.select('*').range(from, from + pageSize - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
    if (all.length > 200000) break;
  }
  return all;
}

// ============================================================
export default function IngredientForecast() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [plannedRuns, setPlannedRuns] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [items, setItems] = useState([]);
  const [vendorItems, setVendorItems] = useState([]);

  const [horizonDays, setHorizonDays] = useState(DEFAULT_HORIZON_DAYS);
  const [search, setSearch] = useState('');
  const [showSufficient, setShowSufficient] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setRefreshing(true);
    try {
      const [runsData, recipesData, itemsData, viData] = await Promise.all([
        fetchAll('production', 'planned_runs'),
        fetchAll('production', 'recipes'),
        fetchAll(null, 'items'),
        fetchAll('procurement', 'vendor_items'),
      ]);
      setPlannedRuns(runsData || []);
      setRecipes(recipesData || []);
      setItems(itemsData || []);
      setVendorItems(viData || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Recipes indexed by (parent, component) and by parent alone
  const recipesByParent = useMemo(() => {
    const m = new Map();
    for (const r of recipes) {
      const arr = m.get(r.parent_item_no) || [];
      arr.push(r);
      m.set(r.parent_item_no, arr);
    }
    return m;
  }, [recipes]);

  // Aggregate item info (on-hand qty summed across bins/lots) from public.items
  const itemInfo = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      if (!it.item_no) continue;
      const cur = m.get(it.item_no) || {
        item_no: it.item_no,
        description: it.description || '',
        on_hand: 0,
      };
      const q = Number(it.quantity) || 0;
      cur.on_hand += q;
      if (!cur.description && it.description) cur.description = it.description;
      m.set(it.item_no, cur);
    }
    return m;
  }, [items]);

  // Vendor items lookup (component -> preferred vendor name if any)
  const preferredVendor = useMemo(() => {
    const m = new Map();
    // just pick the most recent purchase per item; forecast doesn't need a
    // full vendor picker, just a hint
    const byItem = new Map();
    for (const vi of vendorItems) {
      const cur = byItem.get(vi.item_no);
      const curDate = cur?.last_purchase_date || '';
      const viDate = vi.last_purchase_date || '';
      if (!cur || viDate > curDate) byItem.set(vi.item_no, vi);
    }
    for (const [k, v] of byItem) m.set(k, v);
    return m;
  }, [vendorItems]);

  // The forecast window
  const windowRange = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(today.getDate() + horizonDays);
    return {
      start: today.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }, [horizonDays]);

  // Runs within the window that we can forecast (planned or in_progress)
  const inWindow = useMemo(() => {
    return plannedRuns.filter((r) => {
      if (r.status === 'completed' || r.status === 'cancelled') return false;
      if (!r.planned_date) return false;
      return (
        r.planned_date >= windowRange.start && r.planned_date <= windowRange.end
      );
    });
  }, [plannedRuns, windowRange]);

  // Split runs into: forecastable (has approved recipe) vs. gap (no recipe)
  const runsSplit = useMemo(() => {
    const forecastable = [];
    const gapRuns = [];
    for (const r of inWindow) {
      const rec = recipesByParent.get(r.item_no);
      if (rec && rec.length > 0) forecastable.push(r);
      else gapRuns.push(r);
    }
    return { forecastable, gapRuns };
  }, [inWindow, recipesByParent]);

  // The actual math: sum(component demand) across runs; subtract on-hand
  const componentDemand = useMemo(() => {
    const demand = new Map();
    // demand rows: { component_no, description, uom, gross_demand,
    //   on_hand, net_demand, contributing_runs, contributing_skus }
    for (const run of runsSplit.forecastable) {
      const runQty = Number(run.planned_quantity) || 0;
      if (runQty <= 0) continue;
      const rec = recipesByParent.get(run.item_no) || [];
      for (const line of rec) {
        const per = Number(line.quantity_per) || 0;
        if (per <= 0) continue;
        const demandQty = per * runQty;
        const cur = demand.get(line.component_no) || {
          component_no: line.component_no,
          description:
            line.component_description ||
            itemInfo.get(line.component_no)?.description ||
            '',
          uom: line.uom || '',
          gross_demand: 0,
          contributing_runs: 0,
          contributing_skus: new Set(),
        };
        cur.gross_demand += demandQty;
        cur.contributing_runs += 1;
        cur.contributing_skus.add(run.item_no);
        if (!cur.description) {
          cur.description = itemInfo.get(line.component_no)?.description || '';
        }
        if (!cur.uom && line.uom) cur.uom = line.uom;
        demand.set(line.component_no, cur);
      }
    }
    // Fold in on-hand and compute net
    const rows = [];
    for (const [componentNo, d] of demand) {
      const on = itemInfo.get(componentNo)?.on_hand ?? null;
      const net = on == null ? null : d.gross_demand - on;
      const vendor = preferredVendor.get(componentNo);
      rows.push({
        ...d,
        contributing_skus: Array.from(d.contributing_skus),
        on_hand: on,
        net_demand: net,
        has_inventory: on != null,
        preferred_vendor:
          vendor?.vendor_id || null, // just id; UI shows via lookup if needed
        preferred_vendor_last_price: vendor?.last_unit_price ?? null,
      });
    }
    return rows.sort((a, b) => (b.net_demand ?? 0) - (a.net_demand ?? 0));
  }, [runsSplit, recipesByParent, itemInfo, preferredVendor]);

  const filteredDemand = useMemo(() => {
    const q = search.trim().toLowerCase();
    return componentDemand.filter((c) => {
      if (!q) return true;
      return (
        (c.component_no || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q)
      );
    });
  }, [componentDemand, search]);

  const buckets = useMemo(() => {
    const need = [];
    const sufficient = [];
    const noInventoryData = [];
    for (const c of filteredDemand) {
      if (!c.has_inventory) noInventoryData.push(c);
      else if ((c.net_demand ?? 0) > 0) need.push(c);
      else sufficient.push(c);
    }
    return { need, sufficient, noInventoryData };
  }, [filteredDemand]);

  const stats = useMemo(() => {
    return {
      totalRuns: runsSplit.forecastable.length,
      gapRuns: runsSplit.gapRuns.length,
      components: componentDemand.length,
      needToBuy: buckets.need.length,
    };
  }, [runsSplit, componentDemand, buckets]);

  function exportCsv() {
    const rows = componentDemand.map((c) => ({
      component: c.component_no,
      description: c.description,
      uom: c.uom,
      gross_demand: c.gross_demand,
      on_hand: c.on_hand ?? '',
      net_demand: c.net_demand ?? '',
      status: !c.has_inventory
        ? 'no inventory data'
        : (c.net_demand ?? 0) > 0
          ? 'need to buy'
          : 'sufficient',
      contributing_runs: c.contributing_runs,
    }));
    const csv = Papa.unparse(rows);
    const today = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ingredient-forecast-${today}.csv`;
    a.click();
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
            <TrendingUp size={18} color="#fff" />
            <span style={styles.headerTitle}>Ingredient Forecast</span>
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
        <p style={styles.hint}>
          Adds up ingredient demand from your production schedule × approved
          recipes, subtracts current on-hand from BC. Shows what to buy.
        </p>

        <div style={styles.controlRow}>
          <div>
            <label style={styles.miniLabel}>Look ahead (days)</label>
            <div style={styles.horizonRow}>
              {[7, 14, 30, 60].map((d) => (
                <button
                  key={d}
                  style={{
                    ...styles.horizonBtn,
                    ...(horizonDays === d ? styles.horizonBtnActive : {}),
                  }}
                  onClick={() => setHorizonDays(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <button style={styles.altBtn} onClick={exportCsv}>
            <Download size={16} />
            Export CSV
          </button>
        </div>

        <div style={styles.statRow}>
          <Stat label="Runs in window" value={stats.totalRuns} tone="#374151" />
          <Stat label="Need to buy" value={stats.needToBuy} tone="#c8102e" />
          <Stat label="Components" value={stats.components} tone="#1d4ed8" />
        </div>

        {stats.gapRuns > 0 ? (
          <div style={styles.warnBox}>
            <AlertTriangle size={16} color="#a16207" />
            <span>
              <strong>{stats.gapRuns}</strong> planned run
              {stats.gapRuns === 1 ? '' : 's'} skipped — no approved recipe
              yet. Approve recipes in Recipe Learner to include them.
            </span>
          </div>
        ) : null}

        <div style={styles.searchWrap}>
          <Search size={18} color="#9ca3af" />
          <input
            style={styles.searchInput}
            placeholder="Search component..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading...</p>
        ) : componentDemand.length === 0 ? (
          <div style={styles.empty}>
            <TrendingUp size={32} color="#d1d5db" />
            <p style={{ color: '#9ca3af', marginTop: '8px' }}>
              No forecast yet. Add planned runs in Production Schedule and
              approve recipes in Recipe Learner.
            </p>
          </div>
        ) : (
          <>
            {/* Need to buy */}
            <div style={styles.bucketHead}>
              <AlertTriangle size={16} color="#c8102e" />
              <span style={styles.bucketTitle}>
                Need to buy ({buckets.need.length})
              </span>
            </div>
            {buckets.need.length === 0 ? (
              <div style={styles.bucketEmpty}>
                Nothing on the buy list right now.
              </div>
            ) : (
              buckets.need.map((c) => (
                <ComponentRow key={c.component_no} c={c} />
              ))
            )}

            {/* No inventory data */}
            {buckets.noInventoryData.length > 0 ? (
              <>
                <div style={styles.bucketHead}>
                  <Info size={16} color="#6b7280" />
                  <span style={styles.bucketTitle}>
                    Unknown stock ({buckets.noInventoryData.length})
                  </span>
                </div>
                <div style={styles.bucketNote}>
                  These components are used in the schedule but don't appear in
                  your inventory feed. Can't compute a net position.
                </div>
                {buckets.noInventoryData.map((c) => (
                  <ComponentRow key={c.component_no} c={c} />
                ))}
              </>
            ) : null}

            {/* Sufficient — hidden by default */}
            {buckets.sufficient.length > 0 ? (
              <>
                <div style={styles.bucketHead}>
                  <CheckCircle2 size={16} color="#065f46" />
                  <span style={styles.bucketTitle}>
                    Sufficient ({buckets.sufficient.length})
                  </span>
                  <button
                    style={styles.toggleLink}
                    onClick={() => setShowSufficient(!showSufficient)}
                  >
                    {showSufficient ? 'Hide' : 'Show'}
                  </button>
                </div>
                {showSufficient
                  ? buckets.sufficient.map((c) => (
                      <ComponentRow key={c.component_no} c={c} />
                    ))
                  : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ComponentRow({ c }) {
  const isNeed = c.has_inventory && (c.net_demand ?? 0) > 0;
  const isSufficient = c.has_inventory && (c.net_demand ?? 0) <= 0;
  const netTone = !c.has_inventory
    ? '#6b7280'
    : isNeed
      ? '#c8102e'
      : '#065f46';
  return (
    <div style={styles.compRow}>
      <div style={{ flex: 2, minWidth: 0 }}>
        <div style={styles.compNo}>{c.component_no}</div>
        <div style={styles.compDesc}>{c.description}</div>
        <div style={styles.compMeta}>
          Used in {c.contributing_runs} run{c.contributing_runs === 1 ? '' : 's'}
          {c.contributing_skus.length > 0
            ? ` · ${c.contributing_skus.length} SKU${c.contributing_skus.length === 1 ? '' : 's'}`
            : ''}
        </div>
      </div>
      <div style={styles.compNumbers}>
        <div style={styles.compNumRow}>
          <span style={styles.compNumLabel}>Need</span>
          <span style={styles.compNumValue}>
            {fmtNum(c.gross_demand)} {c.uom}
          </span>
        </div>
        <div style={styles.compNumRow}>
          <span style={styles.compNumLabel}>Have</span>
          <span
            style={{
              ...styles.compNumValue,
              color: c.has_inventory ? '#374151' : '#9ca3af',
            }}
          >
            {c.has_inventory ? fmtNum(c.on_hand) + ' ' + c.uom : '—'}
          </span>
        </div>
        <div style={styles.compNumRow}>
          <span style={styles.compNumLabel}>Buy</span>
          <span style={{ ...styles.compNumValueBig, color: netTone }}>
            {c.net_demand == null
              ? '—'
              : c.net_demand > 0
                ? '+' + fmtNum(c.net_demand)
                : fmtNum(c.net_demand)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div style={{ ...styles.stat, borderColor: tone }}>
      <div style={{ ...styles.statValue, color: tone }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 1000) return Math.round(n).toLocaleString();
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

const styles = {
  container: { minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f8f8' },
  header: { backgroundColor: '#c8102e', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  headerInner: { maxWidth: '900px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' },
  backText: { fontSize: '13px', color: '#fff', fontWeight: '500' },
  titleArea: { display: 'flex', alignItems: 'center', gap: '8px' },
  headerTitle: { fontSize: '18px', fontWeight: '700', color: '#fff' },
  refreshBtn: { background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' },
  content: { flex: 1, maxWidth: '900px', width: '100%', margin: '0 auto', padding: '16px' },

  hint: { fontSize: '13px', color: '#6b7280', marginBottom: '12px', lineHeight: 1.4 },

  controlRow: { display: 'flex', gap: '12px', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap' },
  miniLabel: { display: 'block', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  horizonRow: { display: 'flex', gap: '4px' },
  horizonBtn: { fontSize: '13px', fontWeight: 700, background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '8px 14px', cursor: 'pointer' },
  horizonBtnActive: { background: '#c8102e', color: '#fff', borderColor: '#c8102e' },
  altBtn: { display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },

  statRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' },
  stat: { background: '#fff', border: '2px solid #e5e7eb', borderRadius: '12px', padding: '12px', textAlign: 'left' },
  statValue: { fontSize: '22px', fontWeight: 800, lineHeight: 1 },
  statLabel: { fontSize: '11px', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 },

  warnBox: { display: 'flex', gap: '8px', alignItems: 'flex-start', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px', fontSize: '13px', color: '#92400e', marginBottom: '10px' },

  searchWrap: { display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '16px', background: 'transparent' },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' },

  bucketHead: { display: 'flex', alignItems: 'center', gap: '6px', margin: '16px 4px 6px', paddingBottom: '4px', borderBottom: '1px solid #e5e7eb' },
  bucketTitle: { fontSize: '13px', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', flex: 1 },
  bucketEmpty: { fontSize: '13px', color: '#9ca3af', padding: '10px 4px' },
  bucketNote: { fontSize: '12px', color: '#6b7280', padding: '4px 4px 8px', lineHeight: 1.4 },
  toggleLink: { background: 'transparent', color: '#c8102e', border: 'none', fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: 0 },

  compRow: { display: 'flex', gap: '10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', marginBottom: '6px' },
  compNo: { fontSize: '13px', fontWeight: 700, color: '#c8102e' },
  compDesc: { fontSize: '13px', fontWeight: 500, marginTop: '2px' },
  compMeta: { fontSize: '11px', color: '#6b7280', marginTop: '2px' },
  compNumbers: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '120px' },
  compNumRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' },
  compNumLabel: { fontSize: '10px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' },
  compNumValue: { fontSize: '12px', fontWeight: 600, color: '#374151' },
  compNumValueBig: { fontSize: '15px', fontWeight: 800 },
};