import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient.js';
import {
  ChevronLeft,
  AlertCircle,
  Clock,
  Truck,
  Package,
  FileText,
  ClipboardList,
  RefreshCw,
} from 'lucide-react';

const SHIP_LOCATION = 'ABQEP';
const LOW_STOCK_THRESHOLD = 50; // cases — tweak to taste

function todayBoundary() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekAgo() {
  const d = todayBoundary();
  d.setDate(d.getDate() - 7);
  return d;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const diffMs = d.getTime() - todayBoundary().getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState({
    items: [],
    expItems: [],
    bols: [],
    openOrders: [],
    lastSession: null,
  });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setRefreshing(true);
    try {
      const [itemsRes, expRes, bolsRes, ordersRes, sessionRes] =
        await Promise.all([
          supabase.from('items').select('*').limit(10000),
          supabase.from('items_with_exp_status').select('*').limit(10000),
          supabase
            .schema('shipping')
            .from('bols')
            .select('*, bol_lines(quantity)')
            .order('created_at', { ascending: false })
            .limit(500),
          supabase
            .schema('shipping')
            .from('bc_open_orders')
            .select('*')
            .limit(2000),
          supabase
            .schema('cycle_count')
            .from('sessions')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1),
        ]);

      setData({
        items: itemsRes.data || [],
        expItems: expRes.data || [],
        bols: bolsRes.data || [],
        openOrders: ordersRes.data || [],
        lastSession: (sessionRes.data || [])[0] || null,
      });
    } catch (e) {
      // surface gently — dashboard shouldn't crash on a missing table
      console.warn('Dashboard load issue:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // ---------- derived numbers ----------
  const metrics = useMemo(() => {
    const today = todayBoundary().getTime();
    const week = weekAgo().getTime();

    // Inventory at ship location
    const atLoc = data.items.filter(
      (it) => (it.location_code || '').toUpperCase() === SHIP_LOCATION
    );
    const totalSkus = new Set(atLoc.map((it) => it.item_no)).size;
    const totalCases = atLoc.reduce(
      (s, it) => s + (Number(it.bc_quantity) || 0),
      0
    );

    // Per-item totals (for low stock)
    const byItem = new Map();
    for (const it of atLoc) {
      const key = it.item_no;
      const cur = byItem.get(key) || {
        item_no: key,
        description: it.description,
        total: 0,
      };
      cur.total += Number(it.bc_quantity) || 0;
      byItem.set(key, cur);
    }
    const lowStock = Array.from(byItem.values())
      .filter((x) => x.total > 0 && x.total < LOW_STOCK_THRESHOLD)
      .sort((a, b) => a.total - b.total)
      .slice(0, 8);

    // Expiration (using items_with_exp_status view)
    const expAtLoc = data.expItems.filter(
      (it) => (it.location_code || '').toUpperCase() === SHIP_LOCATION
    );
    const expired = [];
    const expiringSoon = []; // ≤ 30 days
    for (const it of expAtLoc) {
      const days = daysUntil(it.expiration_date);
      if (days == null) continue;
      if (days < 0) expired.push({ ...it, days });
      else if (days <= 30) expiringSoon.push({ ...it, days });
    }
    expired.sort((a, b) => a.days - b.days);
    expiringSoon.sort((a, b) => a.days - b.days);

    // BOL activity
    const bolsToday = data.bols.filter(
      (b) => new Date(b.created_at).getTime() >= today
    );
    const bolsWeek = data.bols.filter(
      (b) => new Date(b.created_at).getTime() >= week
    );
    const casesToday = bolsToday.reduce(
      (s, b) => s + (Number(b.total_pieces) || 0),
      0
    );
    const casesWeek = bolsWeek.reduce(
      (s, b) => s + (Number(b.total_pieces) || 0),
      0
    );
    const openBols = data.bols.filter((b) => b.status === 'open');
    const lastBol = data.bols[0] || null;

    // Open orders work queue (only counts orders not yet on a BOL)
    const orderNosOnBols = new Set();
    for (const b of data.bols) {
      if (b.sales_order_no) orderNosOnBols.add(b.sales_order_no);
    }
    const openWithoutBol = data.openOrders.filter(
      (o) => !orderNosOnBols.has(o.order_no)
    );
    // Oldest by imported_at
    openWithoutBol.sort(
      (a, b) =>
        new Date(a.imported_at).getTime() - new Date(b.imported_at).getTime()
    );

    return {
      totalSkus,
      totalCases,
      lowStock,
      expired,
      expiringSoon,
      bolsToday: bolsToday.length,
      bolsWeek: bolsWeek.length,
      casesToday,
      casesWeek,
      openBols,
      lastBol,
      openWithoutBolCount: openWithoutBol.length,
      oldestOpenOrder: openWithoutBol[0] || null,
    };
  }, [data]);

  if (loading) {
    return (
      <div style={styles.container}>
        <Header navigate={navigate} onRefresh={load} refreshing={refreshing} />
        <div style={styles.content}>
          <p style={{ color: '#6b7280' }}>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <Header navigate={navigate} onRefresh={load} refreshing={refreshing} />

      <div style={styles.content}>
        {/* === Big numbers row === */}
        <div style={styles.statGrid}>
          <Stat
            label="Open work"
            value={metrics.openWithoutBolCount}
            sub="orders ready to ship"
            accent="#0f766e"
            onClick={() => navigate('/bol')}
          />
          <Stat
            label="BOLs today"
            value={metrics.bolsToday}
            sub={`${metrics.casesToday} cases`}
            accent="#c8102e"
            onClick={() => navigate('/bol')}
          />
          <Stat
            label="Expiring soon"
            value={metrics.expiringSoon.length}
            sub="next 30 days"
            accent={metrics.expiringSoon.length > 0 ? '#a16207' : '#9ca3af'}
          />
          <Stat
            label="Expired"
            value={metrics.expired.length}
            sub="lots past best-by"
            accent={metrics.expired.length > 0 ? '#c8102e' : '#9ca3af'}
          />
        </div>

        {/* === Expiration === */}
        <Card
          title="Expiration watch"
          icon={<AlertCircle size={18} color="#a16207" />}
          subtitle={`${SHIP_LOCATION} location`}
        >
          {metrics.expired.length === 0 && metrics.expiringSoon.length === 0 ? (
            <EmptyMsg text="Nothing expiring in the next 30 days." />
          ) : (
            <>
              {metrics.expired.slice(0, 5).map((it, i) => (
                <ExpRow key={'e' + i} item={it} expired />
              ))}
              {metrics.expiringSoon.slice(0, 8).map((it, i) => (
                <ExpRow key={'s' + i} item={it} />
              ))}
              {metrics.expired.length + metrics.expiringSoon.length > 13 && (
                <p style={styles.moreMsg}>
                  + {metrics.expired.length + metrics.expiringSoon.length - 13}{' '}
                  more
                </p>
              )}
            </>
          )}
        </Card>

        {/* === Outbound activity === */}
        <Card
          title="Outbound activity"
          icon={<Truck size={18} color="#c8102e" />}
        >
          <KV label="BOLs this week" value={metrics.bolsWeek} />
          <KV label="Cases shipped this week" value={metrics.casesWeek} />
          <KV label="Open (unshipped) BOLs" value={metrics.openBols.length} />
          {metrics.lastBol ? (
            <KV
              label="Last BOL"
              value={`${metrics.lastBol.bol_number || '\u2014'} \u00b7 ${
                metrics.lastBol.ship_to_name || ''
              }`}
              sub={formatDateTime(metrics.lastBol.created_at)}
            />
          ) : (
            <EmptyMsg text="No BOLs yet." />
          )}
        </Card>

        {/* === Order queue === */}
        <Card
          title="Order queue"
          icon={<FileText size={18} color="#0f766e" />}
          subtitle="Open BC orders not yet on a BOL"
        >
          <KV
            label="Open orders waiting"
            value={metrics.openWithoutBolCount}
            big
          />
          {metrics.oldestOpenOrder ? (
            <KV
              label="Oldest waiting"
              value={`${metrics.oldestOpenOrder.order_no} \u00b7 ${
                metrics.oldestOpenOrder.customer_name || ''
              }`}
              sub={
                metrics.oldestOpenOrder.imported_at
                  ? 'Imported ' +
                    formatDate(metrics.oldestOpenOrder.imported_at)
                  : ''
              }
            />
          ) : null}
          <button style={styles.actionLink} onClick={() => navigate('/bol')}>
            Open BOL Maker →
          </button>
        </Card>

        {/* === Inventory === */}
        <Card
          title="Inventory snapshot"
          icon={<Package size={18} color="#374151" />}
          subtitle={`${SHIP_LOCATION} location`}
        >
          <KV label="SKUs on hand" value={metrics.totalSkus} />
          <KV label="Total cases" value={metrics.totalCases.toLocaleString()} />

          {metrics.lowStock.length > 0 && (
            <>
              <div style={styles.subhead}>
                Low stock (under {LOW_STOCK_THRESHOLD} cases)
              </div>
              {metrics.lowStock.map((x, i) => (
                <div key={i} style={styles.row}>
                  <div style={styles.rowMain}>
                    <div style={styles.itemNo}>{x.item_no}</div>
                    <div style={styles.itemDesc}>{x.description}</div>
                  </div>
                  <div style={styles.rowQty}>{x.total}</div>
                </div>
              ))}
            </>
          )}
        </Card>

        {/* === Cycle count === */}
        <Card
          title="Cycle counting"
          icon={<ClipboardList size={18} color="#374151" />}
        >
          {data.lastSession ? (
            <>
              <KV
                label="Last session"
                value={data.lastSession.session_name || '(unnamed)'}
                sub={`${
                  data.lastSession.counted_by || ''
                } \u00b7 ${formatDateTime(data.lastSession.created_at)}`}
              />
              <KV label="Status" value={data.lastSession.status || ''} />
            </>
          ) : (
            <EmptyMsg text="No cycle count sessions yet." />
          )}
          <button
            style={styles.actionLink}
            onClick={() => navigate('/cycle-counter/dashboard')}
          >
            Open Cycle Counter →
          </button>
        </Card>

        <div style={{ height: '32px' }} />
      </div>
    </div>
  );
}

// ---------- helper components ----------
function Header({ navigate, onRefresh, refreshing }) {
  return (
    <div style={styles.header}>
      <div style={styles.headerInner}>
        <button style={styles.backButton} onClick={() => navigate('/')}>
          <ChevronLeft size={20} color="#fff" />
          <span style={styles.backText}>Home</span>
        </button>
        <div style={styles.titleArea}>
          <span style={styles.headerTitle}>Dashboard</span>
        </div>
        <button
          style={styles.refreshBtn}
          onClick={onRefresh}
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
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function Stat({ label, value, sub, accent, onClick }) {
  return (
    <button
      style={{
        ...styles.statCard,
        borderColor: accent || '#e5e7eb',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
    >
      <div style={{ ...styles.statValue, color: accent || '#111' }}>
        {value}
      </div>
      <div style={styles.statLabel}>{label}</div>
      {sub ? <div style={styles.statSub}>{sub}</div> : null}
    </button>
  );
}

function Card({ title, subtitle, icon, children }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {icon}
          <span style={styles.cardTitle}>{title}</span>
        </div>
        {subtitle ? <span style={styles.cardSub}>{subtitle}</span> : null}
      </div>
      <div style={styles.cardBody}>{children}</div>
    </div>
  );
}

function KV({ label, value, sub, big }) {
  return (
    <div style={styles.kvRow}>
      <span style={styles.kvLabel}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <div style={big ? styles.kvValueBig : styles.kvValue}>{value}</div>
        {sub ? <div style={styles.kvSub}>{sub}</div> : null}
      </div>
    </div>
  );
}

function ExpRow({ item, expired }) {
  const days = item.days;
  const tone = expired ? '#c8102e' : days <= 7 ? '#a16207' : '#374151';
  return (
    <div style={styles.row}>
      <div style={styles.rowMain}>
        <div style={styles.itemNo}>
          {item.item_no}{' '}
          <span style={styles.lotChip}>Lot {item.lot_no || '\u2014'}</span>
        </div>
        <div style={styles.itemDesc}>
          {item.description} · Bin {item.bin_code || '\u2014'}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ ...styles.rowQty, color: tone }}>
          {expired
            ? `${Math.abs(days)}d ago`
            : days === 0
            ? 'Today'
            : `${days}d`}
        </div>
        <div style={styles.rowSub}>{formatDate(item.expiration_date)}</div>
      </div>
    </div>
  );
}

function EmptyMsg({ text }) {
  return <p style={styles.emptyText}>{text}</p>;
}

// ---------- styles ----------
const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f8f8f8',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    backgroundColor: '#c8102e',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  headerInner: {
    maxWidth: '820px',
    margin: '0 auto',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    borderRadius: '8px',
    padding: '6px 10px',
    cursor: 'pointer',
  },
  backText: { fontSize: '13px', color: '#fff', fontWeight: '500' },
  titleArea: { display: 'flex', alignItems: 'center', gap: '8px' },
  headerTitle: { fontSize: '18px', fontWeight: '700', color: '#fff' },
  refreshBtn: {
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 10px',
    cursor: 'pointer',
  },
  content: {
    flex: 1,
    maxWidth: '820px',
    width: '100%',
    margin: '0 auto',
    padding: '16px',
  },

  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '10px',
    marginBottom: '16px',
  },
  statCard: {
    background: '#fff',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '14px',
    textAlign: 'left',
    width: '100%',
  },
  statValue: { fontSize: '28px', fontWeight: '800', lineHeight: 1 },
  statLabel: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginTop: '6px',
  },
  statSub: { fontSize: '12px', color: '#6b7280', marginTop: '2px' },

  card: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '14px',
    marginBottom: '14px',
  },
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px',
  },
  cardTitle: { fontSize: '15px', fontWeight: '700' },
  cardSub: { fontSize: '11px', color: '#9ca3af' },
  cardBody: { display: 'flex', flexDirection: 'column', gap: '4px' },

  kvRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '6px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  kvLabel: { fontSize: '13px', color: '#6b7280', fontWeight: '500' },
  kvValue: { fontSize: '15px', fontWeight: '700' },
  kvValueBig: { fontSize: '24px', fontWeight: '800', color: '#c8102e' },
  kvSub: { fontSize: '11px', color: '#9ca3af', marginTop: '2px' },

  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  rowMain: { flex: 1, minWidth: 0, paddingRight: '8px' },
  itemNo: { fontSize: '13px', fontWeight: '700', color: '#1a1a1a' },
  itemDesc: {
    fontSize: '12px',
    color: '#6b7280',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  lotChip: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#374151',
    background: '#f3f4f6',
    borderRadius: '4px',
    padding: '1px 6px',
    marginLeft: '6px',
  },
  rowQty: { fontSize: '15px', fontWeight: '700' },
  rowSub: { fontSize: '11px', color: '#9ca3af' },

  subhead: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginTop: '12px',
    marginBottom: '4px',
  },

  emptyText: { fontSize: '13px', color: '#9ca3af', margin: '6px 0' },
  moreMsg: {
    fontSize: '12px',
    color: '#9ca3af',
    marginTop: '8px',
    textAlign: 'center',
  },

  actionLink: {
    background: 'transparent',
    border: 'none',
    color: '#c8102e',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    padding: '8px 0',
    textAlign: 'left',
  },
};
