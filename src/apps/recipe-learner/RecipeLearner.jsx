import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';
import Papa from 'papaparse';
import {
  ChevronLeft,
  Search,
  Upload,
  X,
  ChefHat,
  CheckCircle2,
  Edit3,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

// ------------------------------------------------------------
// CSV / OData helpers (same patterns used across the platform)
// ------------------------------------------------------------
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
    // Try each name in every common variant Power BI/BC emit:
    //   base ("Item_No"), trailing underscore ("Item_No_"),
    //   "Sum of ..." aggregation prefix, "Count of ..." aggregation prefix
    const variants = [
      key,
      key + '_',
      'sum of ' + key,
      'sum of ' + key + '_',
      'count of ' + key,
      'count of ' + key + '_',
    ];
    for (const k of variants) {
      const v = lrow[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

function toNum(v) {
  if (v == null || String(v).trim() === '') return null;
  // Strip commas (thousands separators like "25,608"), spaces, and any
  // stray quotes. Then parse.
  const cleaned = String(v).replace(/[,"' ]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

// Some Power BI exports split dates into Day/Month/Year columns instead of
// giving us Posting_Date. Reconstruct if we can find those pieces.
const MONTH_MAP = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
function reconstructDate(lrow) {
  const day = toNum(pick(lrow, ['Day']));
  const yearRaw = pick(lrow, ['Year']);
  const year = toNum(yearRaw);
  const monthRaw = pick(lrow, ['Month']);
  let month = null;
  if (monthRaw) {
    const m = MONTH_MAP[monthRaw.toLowerCase().trim()];
    if (m) month = m;
    else {
      const n = toNum(monthRaw);
      if (n && n >= 1 && n <= 12) month = n;
    }
  }
  if (!day || !month || !year) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function fmtNum(n, digits = 3) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs === 0) return '0';
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(digits);
}

// A finished-good is considered "single-unit" (not a case) if its description
// contains any of these markers. Used to filter out JUGs / EACHes / '1 ...'
// items so the recipe list only shows case-level SKUs.
const SINGLE_UNIT_MARKERS = [
  /\bJUG\b/i,
  /\bEACH\b/i,
  /(^|\s)1(\s|$)/,   // standalone " 1 " (e.g. "EL PINTO 1 32oz")
];

function isSingleUnit(description) {
  if (!description) return false;
  return SINGLE_UNIT_MARKERS.some((rx) => rx.test(description));
}

// ============================================================
export default function RecipeLearner() {
  const navigate = useNavigate();
  const [view, setView] = useState('list'); // 'list' | 'detail'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [runs, setRuns] = useState([]);
  const [runLines, setRunLines] = useState([]);
  const [bcBom, setBcBom] = useState([]);
  const [approvedRecipes, setApprovedRecipes] = useState([]);

  const [search, setSearch] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const [selectedSku, setSelectedSku] = useState(null); // {item_no, description}
  const [message, setMessage] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setRefreshing(true);
    try {
      const [runsData, linesData, bomData, recipesData] = await Promise.all([
        fetchAll('assembly_runs'),
        fetchAll('assembly_run_lines'),
        fetchAll('bc_assembly_bom'),
        fetchAll('recipes'),
      ]);
      setRuns(runsData);
      setRunLines(linesData);
      setBcBom(bomData);
      setApprovedRecipes(recipesData);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Supabase / PostgREST caps queries at 1000 rows by default. Fetch in
  // 1000-row pages using .range() until we have everything.
  async function fetchAll(tableName) {
    const pageSize = 1000;
    const all = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .schema('production')
        .from(tableName)
        .select('*')
        .range(from, from + pageSize - 1);
      if (error) {
        console.error(`fetchAll ${tableName} error:`, error);
        break;
      }
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
      // Safety cap: bail out at 500k rows so we can't infinite-loop
      if (all.length > 500000) break;
    }
    return all;
  }

  // ----- Import: 3 CSVs -----
  async function importFiles({ hdrFile, linesFile, bomFile }) {
    setImporting(true);
    setImportMsg('');
    try {
      const [hdrRows, lineRows, bomRows] = await Promise.all([
        parseCsv(hdrFile),
        parseCsv(linesFile),
        parseCsv(bomFile),
      ]);

      // Headers → assembly_runs
      const runsOut = [];
      const skippedItemNos = new Set();  // track which SKUs got filtered out
      let skippedRuns = 0;
      for (const r of hdrRows) {
        const lr = lower(r);
        const docNo = pick(lr, ['No', 'Document_No']);
        if (!docNo) continue;
        const description = pick(lr, ['Description']);
        // Filter out single-unit items (JUG, EACH, standalone " 1 ")
        if (isSingleUnit(description)) {
          skippedRuns++;
          skippedItemNos.add(pick(lr, ['Item_No']));
          continue;
        }
        runsOut.push({
          document_no: docNo,
          item_no: pick(lr, ['Item_No']),
          description,
          quantity: toNum(pick(lr, ['Quantity'])),
          uom: pick(lr, ['Unit_of_Measure_Code']),
          posting_date:
            pick(lr, ['Posting_Date']) || reconstructDate(lr) || null,
          location_code: pick(lr, ['Location_Code']),
          raw: r,
        });
      }
      // Kept set of doc_nos so we skip lines that belong to skipped runs
      const keptDocNos = new Set(runsOut.map((r) => r.document_no));

      // Lines → assembly_run_lines
      const linesOut = [];
      for (const r of lineRows) {
        const lr = lower(r);
        const docNo = pick(lr, ['Document_No']);
        const componentNo = pick(lr, ['No', 'Item_No']);
        if (!docNo || !componentNo) continue;
        // Skip lines belonging to filtered-out headers
        if (!keptDocNos.has(docNo)) continue;
        linesOut.push({
          document_no: docNo,
          component_no: componentNo,
          actual_quantity: toNum(pick(lr, ['Quantity'])),
          ideal_qty_per: toNum(pick(lr, ['Ideal_Qty_per', 'Ideal_Qty__per'])),
          ideal_quantity: toNum(pick(lr, ['Ideal_Quantity'])),
          uom: pick(lr, ['Unit_of_Measure_Code']),
          location_code: pick(lr, ['Location_Code']),
          raw: r,
        });
      }

      // BC BOM → bc_assembly_bom
      const bomOut = [];
      for (const r of bomRows) {
        const lr = lower(r);
        const parent = pick(lr, ['Parent_Item_No']);
        const comp = pick(lr, ['No', 'Item_No']);
        if (!parent || !comp) continue;
        bomOut.push({
          parent_item_no: parent,
          component_no: comp,
          quantity_per: toNum(pick(lr, ['Quantity_per'])),
          uom: pick(lr, ['Unit_of_Measure_Code']),
          line_no: toNum(pick(lr, ['Line_No'])) || null,
          raw: r,
        });
      }

      // Replace snapshot (fresh import each time)
      await supabase
        .schema('production')
        .from('assembly_run_lines')
        .delete()
        .gte('imported_at', '1970-01-01');
      await supabase
        .schema('production')
        .from('assembly_runs')
        .delete()
        .gte('imported_at', '1970-01-01');
      await supabase
        .schema('production')
        .from('bc_assembly_bom')
        .delete()
        .gte('imported_at', '1970-01-01');

      for (const part of chunk(runsOut, 500)) {
        const { error } = await supabase
          .schema('production')
          .from('assembly_runs')
          .insert(part);
        if (error) throw error;
      }
      for (const part of chunk(linesOut, 500)) {
        const { error } = await supabase
          .schema('production')
          .from('assembly_run_lines')
          .insert(part);
        if (error) throw error;
      }
      for (const part of chunk(bomOut, 500)) {
        const { error } = await supabase
          .schema('production')
          .from('bc_assembly_bom')
          .insert(part);
        if (error) throw error;
      }

      await load();
      setImportMsg(
        `Imported ${runsOut.length} runs, ${linesOut.length} lines, ${bomOut.length} BOM entries. ` +
          `Skipped ${skippedRuns} single-unit runs (${skippedItemNos.size} distinct SKUs — JUG/EACH/'1'). \u2713`
      );
    } catch (e) {
      setImportMsg('Import error: ' + (e.message || 'unknown error'));
    } finally {
      setImporting(false);
    }
  }

  // ----- Roll runs up per SKU + learned recipes per (SKU, component) -----
  const runsByItem = useMemo(() => {
    const m = new Map();
    for (const r of runs) {
      if (!r.item_no) continue;
      const arr = m.get(r.item_no) || [];
      arr.push(r);
      m.set(r.item_no, arr);
    }
    return m;
  }, [runs]);

  const linesByDoc = useMemo(() => {
    const m = new Map();
    for (const l of runLines) {
      const arr = m.get(l.document_no) || [];
      arr.push(l);
      m.set(l.document_no, arr);
    }
    return m;
  }, [runLines]);

  const bomByParent = useMemo(() => {
    const m = new Map();
    for (const b of bcBom) {
      const arr = m.get(b.parent_item_no) || [];
      arr.push(b);
      m.set(b.parent_item_no, arr);
    }
    return m;
  }, [bcBom]);

  const approvedByPair = useMemo(() => {
    const m = new Map();
    for (const r of approvedRecipes) {
      m.set(`${r.parent_item_no}::${r.component_no}`, r);
    }
    return m;
  }, [approvedRecipes]);

  // For each SKU: gather all lines from its runs, group by component,
  // compute average actual per finished-good (actual / run's output),
  // pull ideal from BC BOM.
  const skuAnalysis = useMemo(() => {
    const out = [];
    for (const [itemNo, runList] of runsByItem.entries()) {
      const skuRuns = runList
        .filter((r) => (r.quantity || 0) > 0)
        .sort((a, b) =>
          String(b.posting_date || '').localeCompare(String(a.posting_date || ''))
        );
      if (skuRuns.length === 0) continue;

      // per-component: accumulate ratios and totals
      const perComp = new Map();
      let totalOutput = 0;
      for (const run of skuRuns) {
        const output = Number(run.quantity) || 0;
        if (output <= 0) continue;
        totalOutput += output;
        const lines = linesByDoc.get(run.document_no) || [];
        for (const l of lines) {
          if (!l.component_no) continue;
          const actual = Number(l.actual_quantity) || 0;
          const ratio = actual / output;
          const cur = perComp.get(l.component_no) || {
            component_no: l.component_no,
            uom: l.uom || '',
            ratios: [],
            actual_sum: 0,
            ideal_qty_per_last: null,
          };
          cur.ratios.push(ratio);
          cur.actual_sum += actual;
          if (l.ideal_qty_per != null) cur.ideal_qty_per_last = l.ideal_qty_per;
          if (!cur.uom && l.uom) cur.uom = l.uom;
          perComp.set(l.component_no, cur);
        }
      }

      // Fold in BC BOM ideal (in case some components didn't appear in the runs)
      const bomList = bomByParent.get(itemNo) || [];
      for (const b of bomList) {
        if (!b.component_no) continue;
        const cur = perComp.get(b.component_no);
        if (cur) {
          if (cur.ideal_qty_per_last == null) cur.ideal_qty_per_last = b.quantity_per;
          if (!cur.uom && b.uom) cur.uom = b.uom;
        } else {
          perComp.set(b.component_no, {
            component_no: b.component_no,
            uom: b.uom || '',
            ratios: [],
            actual_sum: 0,
            ideal_qty_per_last: b.quantity_per,
          });
        }
      }

      // Finalize components
      const components = [];
      for (const [, c] of perComp) {
        const avgRatio =
          c.ratios.length > 0
            ? c.ratios.reduce((s, r) => s + r, 0) / c.ratios.length
            : null;
        const ideal = c.ideal_qty_per_last;
        let deltaPct = null;
        if (avgRatio != null && ideal != null && ideal !== 0) {
          deltaPct = ((avgRatio - ideal) / ideal) * 100;
        }
        const approved = approvedByPair.get(`${itemNo}::${c.component_no}`);
        components.push({
          component_no: c.component_no,
          uom: c.uom,
          avg_actual_per: avgRatio,
          ideal_per: ideal,
          delta_pct: deltaPct,
          runs_seen: c.ratios.length,
          approved,
        });
      }

      const description = skuRuns[0]?.description || '';
      const anyApproved = components.some((c) => c.approved);
      out.push({
        item_no: itemNo,
        description,
        run_count: skuRuns.length,
        total_output: totalOutput,
        last_run_date: skuRuns[0].posting_date,
        components: components.sort((a, b) =>
          (a.component_no || '').localeCompare(b.component_no || '')
        ),
        any_approved: anyApproved,
      });
    }
    return out.sort((a, b) => (a.item_no || '').localeCompare(b.item_no || ''));
  }, [runsByItem, linesByDoc, bomByParent, approvedByPair]);

  const filteredSkus = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Belt-and-suspenders: even if a single-unit item somehow made it into
    // the DB (older import, edge case), hide it here unless showHidden is on.
    const base = showHidden
      ? skuAnalysis
      : skuAnalysis.filter((s) => !isSingleUnit(s.description));
    if (!q) return base;
    return base.filter(
      (s) =>
        (s.item_no || '').toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q)
    );
  }, [skuAnalysis, search, showHidden]);

  // Count of SKUs currently hidden by the display filter, for the toggle label
  const hiddenSkuCount = useMemo(
    () => skuAnalysis.filter((s) => isSingleUnit(s.description)).length,
    [skuAnalysis]
  );

  const stats = useMemo(() => {
    const totalSkus = skuAnalysis.length;
    const approvedSkus = skuAnalysis.filter((s) => s.any_approved).length;
    const totalRuns = runs.length;
    return { totalSkus, approvedSkus, totalRuns };
  }, [skuAnalysis, runs]);

  // ----- Approve / edit recipe rows -----
  async function approveComponent(sku, component, override) {
    const qtyPer =
      override != null
        ? override
        : component.avg_actual_per != null
          ? component.avg_actual_per
          : component.ideal_per;
    if (qtyPer == null || isNaN(qtyPer)) {
      setMessage('No quantity to approve — this component has no actual or ideal data');
      return;
    }
    const source =
      override != null
        ? 'manual'
        : component.avg_actual_per != null
          ? 'learned'
          : 'bc_bom';
    try {
      const row = {
        parent_item_no: sku.item_no,
        parent_description: sku.description,
        component_no: component.component_no,
        component_description: null,
        quantity_per: Number(qtyPer),
        uom: component.uom || null,
        source,
        runs_averaged:
          source === 'learned' ? component.runs_seen : null,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const existing = approvedByPair.get(
        `${sku.item_no}::${component.component_no}`
      );
      if (existing) {
        const { error } = await supabase
          .schema('production')
          .from('recipes')
          .update(row)
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .schema('production')
          .from('recipes')
          .insert(row);
        if (error) throw error;
      }
      await load();
      setMessage('Approved \u2713');
    } catch (e) {
      setMessage('Error: ' + (e.message || 'unknown'));
    }
  }

  async function unapproveComponent(sku, component) {
    const existing = approvedByPair.get(
      `${sku.item_no}::${component.component_no}`
    );
    if (!existing) return;
    try {
      const { error } = await supabase
        .schema('production')
        .from('recipes')
        .delete()
        .eq('id', existing.id);
      if (error) throw error;
      await load();
      setMessage('Removed');
    } catch (e) {
      setMessage('Error: ' + (e.message || 'unknown'));
    }
  }

  const selectedSkuData = useMemo(
    () =>
      selectedSku ? skuAnalysis.find((s) => s.item_no === selectedSku) : null,
    [selectedSku, skuAnalysis]
  );

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerInner}>
          <button
            style={styles.backButton}
            onClick={() =>
              view === 'detail' ? (setView('list'), setSelectedSku(null)) : navigate('/')
            }
          >
            <ChevronLeft size={20} color="#fff" />
            <span style={styles.backText}>
              {view === 'detail' ? 'Recipes' : 'Home'}
            </span>
          </button>
          <div style={styles.titleArea}>
            <ChefHat size={18} color="#fff" />
            <span style={styles.headerTitle}>
              {view === 'detail'
                ? selectedSkuData?.item_no || 'Recipe'
                : 'Recipe Learner'}
            </span>
          </div>
          <button style={styles.refreshBtn} onClick={load} disabled={refreshing}>
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
        {view === 'list' ? (
          <>
            <p style={styles.hint}>
              Learn actual recipes from posted assembly runs. Import once, then
              approve the recipe for each finished-good SKU. Approved recipes
              become the source of truth for ingredient forecasting.
            </p>

            <div style={styles.bcBar}>
              <button
                style={styles.bcSecondaryBtn}
                onClick={() => {
                  setImportMsg('');
                  setShowImport(true);
                }}
              >
                <Upload size={16} />
                Import assembly data
              </button>
            </div>

            <div style={styles.statRow}>
              <Stat
                label="SKUs seen"
                value={stats.totalSkus}
                tone="#374151"
              />
              <Stat
                label="Approved"
                value={stats.approvedSkus}
                tone="#065f46"
              />
              <Stat
                label="Runs"
                value={stats.totalRuns}
                tone="#1d4ed8"
              />
            </div>

            <div style={styles.searchWrap}>
              <Search size={18} color="#9ca3af" />
              <input
                style={styles.searchInput}
                placeholder="Search finished-good SKU or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {hiddenSkuCount > 0 || showHidden ? (
              <div style={styles.filterChipRow}>
                <button
                  style={{
                    ...styles.filterChip,
                    ...(showHidden ? styles.filterChipActive : {}),
                  }}
                  onClick={() => setShowHidden(!showHidden)}
                >
                  {showHidden
                    ? `Hide single-unit (${hiddenSkuCount})`
                    : `Show single-unit (${hiddenSkuCount})`}
                </button>
              </div>
            ) : null}

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

            {loading ? (
              <p style={{ color: '#6b7280' }}>Loading...</p>
            ) : filteredSkus.length === 0 ? (
              <div style={styles.empty}>
                <ChefHat size={32} color="#d1d5db" />
                <p style={{ color: '#9ca3af', marginTop: '8px' }}>
                  No SKUs yet. Import assembly data to see learned recipes.
                </p>
              </div>
            ) : (
              <div style={styles.list}>
                {filteredSkus.map((s) => (
                  <button
                    key={s.item_no}
                    style={styles.card}
                    onClick={() => {
                      setSelectedSku(s.item_no);
                      setView('detail');
                    }}
                  >
                    <div style={styles.cardTop}>
                      <span style={styles.skuNo}>{s.item_no}</span>
                      {s.any_approved ? (
                        <span style={styles.approvedChip}>
                          <CheckCircle2 size={12} /> Approved
                        </span>
                      ) : null}
                    </div>
                    <div style={styles.skuDesc}>{s.description}</div>
                    <div style={styles.skuMeta}>
                      {s.run_count} run{s.run_count === 1 ? '' : 's'} ·{' '}
                      {s.components.length} component
                      {s.components.length === 1 ? '' : 's'} · last run{' '}
                      {s.last_run_date || '—'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          selectedSkuData && (
            <RecipeDetail
              sku={selectedSkuData}
              message={message}
              onApprove={approveComponent}
              onUnapprove={unapproveComponent}
            />
          )
        )}
      </div>

      {showImport && (
        <ImportModal
          importing={importing}
          importMsg={importMsg}
          onImport={importFiles}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}

// ---------- Recipe detail view ----------
function RecipeDetail({ sku, message, onApprove, onUnapprove }) {
  return (
    <>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>{sku.item_no}</div>
        <div style={styles.skuTitleDesc}>{sku.description}</div>
        <div style={styles.detailMetaRow}>
          <span>
            <strong>{sku.run_count}</strong> posted runs
          </span>
          <span>
            <strong>{fmtNum(sku.total_output, 0)}</strong> total output
          </span>
          <span>Last: <strong>{sku.last_run_date || '—'}</strong></span>
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

      <div style={styles.section}>
        <div style={styles.sectionTitle}>Components (per 1 finished good)</div>
        <div style={styles.tableHead}>
          <div style={{ flex: 2 }}>Component</div>
          <div style={{ flex: 1, textAlign: 'right' }}>Avg actual</div>
          <div style={{ flex: 1, textAlign: 'right' }}>BC ideal</div>
          <div style={{ flex: 1, textAlign: 'right' }}>Δ</div>
          <div style={{ width: '90px' }} />
        </div>
        {sku.components.map((c, i) => (
          <ComponentRow
            key={i}
            sku={sku}
            component={c}
            onApprove={onApprove}
            onUnapprove={onUnapprove}
          />
        ))}
      </div>
    </>
  );
}

function ComponentRow({ sku, component, onApprove, onUnapprove }) {
  const [editing, setEditing] = useState(false);
  const [override, setOverride] = useState(
    component.avg_actual_per != null
      ? String(component.avg_actual_per)
      : component.ideal_per != null
        ? String(component.ideal_per)
        : ''
  );
  const isDrift =
    component.delta_pct != null && Math.abs(component.delta_pct) > 5;
  const isBigDrift =
    component.delta_pct != null && Math.abs(component.delta_pct) > 15;

  return (
    <div style={styles.componentRow}>
      <div style={{ flex: 2, minWidth: 0 }}>
        <div style={styles.componentNo}>{component.component_no}</div>
        <div style={styles.componentMeta}>
          {component.uom || ''}{' '}
          {component.runs_seen > 0
            ? '· ' + component.runs_seen + ' runs'
            : '· from BOM only'}
        </div>
      </div>
      <div style={{ flex: 1, textAlign: 'right', fontWeight: 700 }}>
        {fmtNum(component.avg_actual_per)}
      </div>
      <div style={{ flex: 1, textAlign: 'right', color: '#6b7280' }}>
        {fmtNum(component.ideal_per)}
      </div>
      <div
        style={{
          flex: 1,
          textAlign: 'right',
          fontWeight: 700,
          color: isBigDrift ? '#c8102e' : isDrift ? '#a16207' : '#065f46',
        }}
      >
        {component.delta_pct == null
          ? '—'
          : (component.delta_pct >= 0 ? '+' : '') +
            component.delta_pct.toFixed(1) +
            '%'}
        {isBigDrift ? (
          <AlertTriangle
            size={12}
            color="#c8102e"
            style={{ marginLeft: 4, verticalAlign: 'middle' }}
          />
        ) : null}
      </div>
      <div style={{ width: '90px', display: 'flex', justifyContent: 'flex-end' }}>
        {component.approved ? (
          <button
            style={styles.approvedBtn}
            onClick={() => onUnapprove(sku, component)}
            title="Click to un-approve"
          >
            <CheckCircle2 size={14} /> Locked
          </button>
        ) : editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input
              style={styles.overrideInput}
              type="number"
              step="0.0001"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onApprove(sku, component, Number(override));
                  setEditing(false);
                }
              }}
              autoFocus
            />
            <button
              style={styles.approveBtn}
              onClick={() => {
                onApprove(sku, component, Number(override));
                setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              style={styles.approveBtn}
              onClick={() => onApprove(sku, component, null)}
              title="Approve at average actual"
            >
              Approve
            </button>
            <button
              style={styles.editBtn}
              onClick={() => setEditing(true)}
              title="Override the amount"
            >
              <Edit3 size={12} />
            </button>
          </div>
        )}
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

// ---------- Import modal ----------
function ImportModal({ importing, importMsg, onImport, onClose }) {
  const [hdrFile, setHdrFile] = useState(null);
  const [linesFile, setLinesFile] = useState(null);
  const [bomFile, setBomFile] = useState(null);
  const ready = hdrFile && linesFile && bomFile && !importing;
  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHead}>
          <span style={styles.modalTitle}>Import assembly data</span>
          <button style={styles.iconBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p style={styles.helpText}>
          Export three queries from Power BI as CSV and pick them here. Each
          replaces the previous import.
        </p>

        <label style={styles.fileLabel}>1. PostedAssemblyHeaders CSV</label>
        <input
          type="file"
          accept=".csv"
          style={styles.fileInput}
          onChange={(e) => setHdrFile(e.target.files?.[0] || null)}
        />

        <label style={styles.fileLabel}>2. PostedAssemblyLine CSV</label>
        <input
          type="file"
          accept=".csv"
          style={styles.fileInput}
          onChange={(e) => setLinesFile(e.target.files?.[0] || null)}
        />

        <label style={styles.fileLabel}>3. AssemblyBOM CSV</label>
        <input
          type="file"
          accept=".csv"
          style={styles.fileInput}
          onChange={(e) => setBomFile(e.target.files?.[0] || null)}
        />

        {importMsg && (
          <div
            style={{
              ...styles.message,
              marginTop: '12px',
              color: importMsg.startsWith('Import error') ? '#c8102e' : '#15803d',
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
          onClick={() => onImport({ hdrFile, linesFile, bomFile })}
        >
          <Upload size={18} />
          {importing ? 'Importing...' : 'Import'}
        </button>
      </div>
    </div>
  );
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
  refreshBtn: { background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' },
  content: { flex: 1, maxWidth: '900px', width: '100%', margin: '0 auto', padding: '16px' },

  hint: { fontSize: '13px', color: '#6b7280', marginBottom: '12px', lineHeight: 1.4 },
  bcBar: { display: 'flex', gap: '8px', marginBottom: '12px' },
  bcSecondaryBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: '#fff', color: '#c8102e', border: '1px solid #fecdd3', borderRadius: '10px', padding: '12px 14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' },
  stat: { background: '#fff', border: '2px solid #e5e7eb', borderRadius: '12px', padding: '12px', textAlign: 'left' },
  statValue: { fontSize: '22px', fontWeight: 800, lineHeight: 1 },
  statLabel: { fontSize: '11px', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 },
  searchWrap: { display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px' },
  searchInput: { flex: 1, border: 'none', outline: 'none', fontSize: '16px', background: 'transparent' },
  filterChipRow: { display: 'flex', gap: '6px', margin: '4px 0 8px', flexWrap: 'wrap' },
  filterChip: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 600, background: '#fff', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '5px 12px', cursor: 'pointer' },
  filterChipActive: { background: '#c8102e', color: '#fff', borderColor: '#c8102e' },

  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px' },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '14px', textAlign: 'left', cursor: 'pointer', width: '100%' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
  skuNo: { fontSize: '15px', fontWeight: 700, color: '#c8102e' },
  approvedChip: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: '#065f46', background: '#d1fae5', borderRadius: '999px', padding: '2px 8px' },
  skuDesc: { fontSize: '15px', fontWeight: '600' },
  skuMeta: { fontSize: '12px', color: '#6b7280', marginTop: '2px' },

  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginBottom: '12px' },
  sectionTitle: { fontSize: '13px', fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' },
  skuTitleDesc: { fontSize: '15px', color: '#374151', marginBottom: '8px' },
  detailMetaRow: { display: 'flex', gap: '14px', fontSize: '12px', color: '#6b7280', flexWrap: 'wrap' },

  tableHead: { display: 'flex', gap: '8px', padding: '8px 4px', fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb' },
  componentRow: { display: 'flex', gap: '8px', alignItems: 'center', padding: '10px 4px', borderBottom: '1px solid #f3f4f6', fontSize: '13px' },
  componentNo: { fontWeight: 700 },
  componentMeta: { fontSize: '11px', color: '#6b7280', marginTop: '2px' },
  approveBtn: { fontSize: '11px', fontWeight: 700, background: '#c8102e', color: '#fff', border: 'none', borderRadius: '8px', padding: '5px 8px', cursor: 'pointer' },
  approvedBtn: { display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', fontWeight: 700, background: '#d1fae5', color: '#065f46', border: '1px solid #99f6e4', borderRadius: '8px', padding: '5px 8px', cursor: 'pointer' },
  editBtn: { fontSize: '11px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', padding: '5px 6px', cursor: 'pointer' },
  overrideInput: { width: '70px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '4px 6px', fontSize: '12px', boxSizing: 'border-box' },

  message: { fontSize: '14px', fontWeight: '600', marginBottom: '10px' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 200 },
  modal: { background: '#fff', borderRadius: '16px 16px 0 0', width: '100%', maxWidth: '600px', maxHeight: '80vh', padding: '16px', display: 'flex', flexDirection: 'column' },
  modalHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  modalTitle: { fontSize: '17px', fontWeight: '700' },
  iconBtn: { background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px' },
  helpText: { fontSize: '13px', color: '#6b7280', marginBottom: '10px' },
  fileLabel: { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', margin: '10px 0 6px' },
  fileInput: { width: '100%', fontSize: '14px' },
  saveBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c8102e', color: '#fff', border: 'none', borderRadius: '12px', padding: '13px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { background: '#d1d5db', cursor: 'not-allowed' },
};