import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import {
  ChevronLeft,
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

// ============================================================
// CARLA'S WEEKLY TIMESHEET CLEANUP
// --------------------------------
// In : a raw CSV export from the scheduling system (32+ columns,
//      multi-line quoted comments, mixed data types).
// Out: a clean .xlsx with one row per shift, sorted by Emp GL,
//      with a blank + TOTAL row after each employee's shifts,
//      light grey highlight on the TOTAL rows.
//
// Columns written to the Excel:
//   Emp GL | Employee | Last Name | First Name | Role | Wage |
//   Date | Clock-In Start (HH:MM 24h) | Clock-In End (HH:MM 24h) |
//   Act Hrs (recalculated from start/end) | Comments
//
// Everything runs in the browser. No upload to any server, so Carla
// can use it from anywhere without worrying about where the file goes.
// ============================================================

// ---------- date / time helpers ----------
// Scheduling-system format: "Oct 28, 2026 10:15:14pm"
// The missing space before am/pm makes Date() reject the string in Node
// and some browsers. Insert a space so JS can parse it reliably.
function parseSystemDate(str) {
  if (!str) return null;
  let s = String(str).trim();
  if (!s) return null;
  s = s.replace(/(\d)(am|pm|AM|PM)\b/, '$1 $2');
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function fmtDateMDY(d) {
  if (!d) return '';
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
}

function fmtTimeHHMM24(d) {
  if (!d) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Hours between two Date objects, decimal, 2 places. Negative or null -> 0.
function hoursBetween(start, end) {
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return 0;
  return Math.round((ms / 3600000) * 100) / 100;
}

// Split "Santistevan, Giselle" into {last: 'Santistevan', first: 'Giselle'}
function splitName(name) {
  if (!name) return { last: '', first: '' };
  const parts = String(name).split(',');
  if (parts.length < 2) return { last: String(name).trim(), first: '' };
  return {
    last: parts[0].trim(),
    first: parts.slice(1).join(',').trim(),
  };
}

// Strip tabs and whitespace from Emp GL ("\t21372" -> "21372")
function cleanGl(v) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, '').trim();
}

// ---------- the transformation itself ----------
// Returns { rows, summary } where rows is the Excel row list (with blank+TOTAL
// separators) and summary is the one-sentence status line for the UI.
function transform(rawRows) {
  // Step 1: map each input row into a shift object with the fields we want
  const shifts = [];
  for (const r of rawRows) {
    const gl = cleanGl(r['Emp GL']);
    const pin = cleanGl(r['Employee Pin']);
    // Grouping key: Emp GL when present, else Employee Pin. Some rows in
    // the source have a blank Emp GL but a real Pin — without this fallback
    // every such person's shifts would collapse together under one empty group.
    const groupKey = gl || pin || '';
    const employee = (r['Employee'] || '').trim();
    if (!groupKey && !employee) continue; // skip genuinely empty rows
    const { last, first } = splitName(employee);

    const startRaw = r['Clock-In Start'] || '';
    const endRaw = r['Clock-In End'] || '';
    const startDate = parseSystemDate(startRaw);
    const endDate = parseSystemDate(endRaw);

    // Date column: prefer the clock-in start date; fall back to schedule
    // start if the shift was a no-show.
    const dateSource =
      startDate ||
      parseSystemDate(r['Schedule Start']) ||
      parseSystemDate(r['Schedule End']);

    const isNoShow = String(r['No Show'] || '').trim() === '1';
    const noShowReason = (r['No Show Reason'] || '').trim();

    const comments = isNoShow
      ? `No Show${noShowReason ? ': ' + noShowReason : ''}`
      : '';

    // Hours: recalculated from clock-in start/end per Caleb's spec.
    // No-shows and missing punches come out as 0.
    const actHrs = hoursBetween(startDate, endDate);

    // Wage: input is a plain number; format as $X.XX for output
    const wageNum = Number(r['Wage']);
    const wageFmt = Number.isFinite(wageNum)
      ? ` $${wageNum.toFixed(2)} `
      : r['Wage'] || '';

    shifts.push({
      _gl: groupKey,
      _dateSort: dateSource ? dateSource.getTime() : 0,
      emp_gl: gl ? `\t${gl}` : '',
      employee,
      last_name: last,
      first_name: first,
      role: r['Role'] || '',
      wage: wageFmt,
      date: fmtDateMDY(dateSource),
      clock_in_start: fmtTimeHHMM24(startDate),
      clock_in_end: fmtTimeHHMM24(endDate),
      act_hrs: actHrs,
      comments,
    });
  }

  // Step 2: sort by Emp GL, then by date within the same employee
  shifts.sort((a, b) => {
    if (a._gl !== b._gl) return a._gl.localeCompare(b._gl);
    return a._dateSort - b._dateSort;
  });

  // Step 3: group and emit rows with blank + TOTAL separators
  const rows = [];
  let currentGl = null;
  let currentEmployee = '';
  let groupTotal = 0;

  function emitTotal() {
    if (currentGl === null) return;
    // TOTAL first — sits directly under this person's last shift.
    // Blank separator row comes after so there's visible space before
    // the next employee's first shift.
    rows.push({
      _kind: 'total',
      emp_gl: '',
      employee: `TOTAL — ${currentEmployee}`,
      last_name: '',
      first_name: '',
      role: '',
      wage: '',
      date: '',
      clock_in_start: '',
      clock_in_end: '',
      act_hrs: Math.round(groupTotal * 100) / 100,
      comments: '',
    });
    rows.push({ _kind: 'blank' });
  }

  for (const s of shifts) {
    if (currentGl !== null && s._gl !== currentGl) {
      emitTotal();
      groupTotal = 0;
    }
    currentGl = s._gl;
    currentEmployee = s.employee;
    rows.push({ _kind: 'shift', ...s });
    groupTotal += s.act_hrs;
  }
  // Last group's total
  if (currentGl !== null) emitTotal();

  const summary = `${shifts.length} shifts across ${
    new Set(shifts.map((s) => s._gl)).size
  } employees.`;
  return { rows, summary };
}

// ---------- XLSX builder ----------
// We load SheetJS dynamically from the CDN at use time, matching how the
// rest of the platform handles html2canvas / jspdf. No package.json churn.
async function buildXlsxBlob(rows, weekLabel) {
  // xlsx-js-style is a maintained fork of SheetJS with full cell-style
  // support (fills, fonts, borders) baked in. The community SheetJS
  // silently drops styles, so colors never reached Excel.
  // The CDN build sometimes exposes utils on the module namespace and
  // sometimes on .default, depending on how esm.sh wraps it, so we
  // grab whichever one actually has utils.
  const mod = await import('https://esm.sh/xlsx-js-style@1.2.0');
  const XLSX = mod.utils ? mod : mod.default || mod;
  if (!XLSX || !XLSX.utils) {
    throw new Error('xlsx-js-style loaded but utils missing (CDN shape changed)');
  }

  const header = [
    'Emp GL',
    'Employee',
    'Last Name',
    'First Name',
    'Role',
    'Wage',
    'Date',
    'Clock-In Start',
    'Clock-In End',
    'Act Hrs',
    'Comments',
  ];

  const aoa = [header];
  for (const r of rows) {
    if (r._kind === 'blank') {
      aoa.push(['', '', '', '', '', '', '', '', '', '', '']);
    } else {
      aoa.push([
        r.emp_gl,
        r.employee,
        r.last_name,
        r.first_name,
        r.role,
        r.wage,
        r.date,
        r.clock_in_start,
        r.clock_in_end,
        r.act_hrs,
        r.comments,
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths — tuned so nothing is squished in Excel
  ws['!cols'] = [
    { wch: 10 }, // Emp GL
    { wch: 24 }, // Employee
    { wch: 16 }, // Last Name
    { wch: 14 }, // First Name
    { wch: 18 }, // Role
    { wch: 10 }, // Wage
    { wch: 12 }, // Date
    { wch: 14 }, // Clock-In Start
    { wch: 14 }, // Clock-In End
    { wch: 10 }, // Act Hrs
    { wch: 32 }, // Comments
  ];

  // Highlight: TOTAL rows get a light cream fill (matches Carla's sample).
  // Blank rows get a slightly different grey so the separator is visible.
  // Note: SheetJS community edition has limited style support, but cell
  // .s objects on individual cells do get written to the file in a way
  // that Excel reads.
  // Blue-ish fill for separator (blank) rows and the TOTAL rows, so it's
  // easy to scan down the sheet and see where each employee's shifts end.
  // Softer blue on the blank row, stronger blue + bold text on the TOTAL
  // so the sum stands out.
  const BLANK_FILL = 'DBEAFE';   // light blue — separator
  const TOTAL_FILL = 'BFDBFE';   // slightly darker blue — totals
  const TOTAL_TEXT = '1E3A8A';   // navy — strong contrast on the blue fill
  for (let i = 0; i < rows.length; i++) {
    const excelRow = i + 2; // +1 for header, +1 because Excel is 1-indexed
    if (rows[i]._kind === 'total') {
      for (let c = 0; c < header.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: excelRow - 1, c });
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        ws[addr].s = {
          fill: { fgColor: { rgb: TOTAL_FILL } },
          font: { bold: true, color: { rgb: TOTAL_TEXT }, sz: 11 },
        };
      }
    } else if (rows[i]._kind === 'blank') {
      for (let c = 0; c < header.length; c++) {
        const addr = XLSX.utils.encode_cell({ r: excelRow - 1, c });
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        ws[addr].s = { fill: { fgColor: { rgb: BLANK_FILL } } };
      }
    }
  }
  // Bold header row
  for (let c = 0; c < header.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) {
      ws[addr].s = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'D9D9D9' } },
      };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hours');
  const wbout = XLSX.write(wb, {
    type: 'array',
    bookType: 'xlsx',
    cellStyles: true,
  });
  return new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ---------- the React page ----------
export default function EmployeeHoursReport() {
  const [status, setStatus] = useState('idle'); // 'idle' | 'parsing' | 'ready' | 'building' | 'error'
  const [message, setMessage] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [summary, setSummary] = useState('');
  const [sourceFilename, setSourceFilename] = useState('');

  function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setSourceFilename(file.name);
    setStatus('parsing');
    setMessage('Reading your CSV...');
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (results) => {
        try {
          if (results.errors && results.errors.length) {
            // Non-fatal parse errors are common with this system's exports
            // (multi-line comments trip Papa). We log but keep going.
            // eslint-disable-next-line no-console
            console.log('CSV parse warnings:', results.errors.slice(0, 5));
          }
          const { rows, summary } = transform(results.data || []);
          if (rows.length === 0) {
            setStatus('error');
            setMessage(
              "No employee rows found. Is this the right file? It should be the weekly timesheet CSV."
            );
            return;
          }
          setParsedRows(rows);
          setSummary(summary);
          setStatus('ready');
          setMessage('');
        } catch (err) {
          setStatus('error');
          setMessage(
            'Something went wrong reading the file: ' +
              (err.message || 'unknown')
          );
        }
      },
      error: (err) => {
        setStatus('error');
        setMessage(
          'Could not read that file: ' + (err.message || 'unknown')
        );
      },
    });
  }

  async function handleDownload() {
    if (status !== 'ready' || parsedRows.length === 0) return;
    setStatus('building');
    setMessage('Building your Excel file...');
    try {
      const blob = await buildXlsxBlob(parsedRows);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const today = new Date();
      const stamp = `${today.getFullYear()}${pad2(today.getMonth() + 1)}${pad2(
        today.getDate()
      )}`;
      a.href = url;
      a.download = `Employee_Hours_${stamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus('ready');
      setMessage('Downloaded. You can run another file, or close this tab.');
    } catch (err) {
      setStatus('error');
      setMessage(
        'Could not build the Excel file: ' + (err.message || 'unknown')
      );
    }
  }

  function reset() {
    setStatus('idle');
    setMessage('');
    setParsedRows([]);
    setSummary('');
    setSourceFilename('');
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerInner}>
          <Link to="/for/carla" style={styles.backLink}>
            <ChevronLeft size={20} color="#fff" />
            <span style={styles.backText}>Home</span>
          </Link>
          <div style={styles.titleArea}>
            <FileSpreadsheet size={18} color="#fff" />
            <span style={styles.headerTitle}>Employee Hours Report</span>
          </div>
          <div style={{ width: '70px' }} />
        </div>
      </div>

      <div style={styles.content}>
        <h1 style={styles.pageTitle}>Clean up the weekly timesheet</h1>
        <p style={styles.sub}>
          Upload the CSV you exported from the scheduling system. I'll sort
          it by employee, separate the name and dates, convert the times,
          add totals, and give you back a clean Excel file.
        </p>

        {/* STEP 1: upload */}
        <div style={styles.step}>
          <div style={styles.stepHead}>
            <span style={styles.stepNo}>1</span>
            <span style={styles.stepTitle}>Pick your CSV file</span>
          </div>
          <label style={styles.uploadBox}>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              style={{ display: 'none' }}
            />
            <Upload size={28} color="#c8102e" />
            <div style={styles.uploadText}>
              {sourceFilename
                ? `Selected: ${sourceFilename}`
                : 'Tap or click to choose a CSV'}
            </div>
            <div style={styles.uploadHint}>
              From the scheduling system export
            </div>
          </label>
        </div>

        {/* STEP 2: confirmation / download */}
        {status === 'parsing' || status === 'building' ? (
          <div style={styles.statusMsg}>
            <div style={styles.spinner} />
            {message}
          </div>
        ) : null}

        {status === 'error' ? (
          <div style={styles.errorBox}>
            <AlertCircle size={20} color="#c8102e" />
            <div>
              <div style={styles.errorTitle}>Something went wrong</div>
              <div style={styles.errorText}>{message}</div>
              <button style={styles.linkBtn} onClick={reset}>
                Try a different file
              </button>
            </div>
          </div>
        ) : null}

        {status === 'ready' ? (
          <>
            <div style={styles.step}>
              <div style={styles.stepHead}>
                <span style={styles.stepNo}>2</span>
                <span style={styles.stepTitle}>Download the clean file</span>
              </div>
              <div style={styles.readyRow}>
                <CheckCircle2 size={22} color="#065f46" />
                <div style={{ flex: 1 }}>
                  <div style={styles.readyTitle}>Looks good.</div>
                  <div style={styles.readySub}>{summary}</div>
                  {message ? (
                    <div style={styles.readyMessage}>{message}</div>
                  ) : null}
                </div>
              </div>
              <button style={styles.downloadBtn} onClick={handleDownload}>
                <Download size={20} />
                Download Excel
              </button>
              <button style={styles.linkBtn} onClick={reset}>
                Start over with a different file
              </button>
            </div>
          </>
        ) : null}

        <div style={styles.helpBox}>
          <strong>Not sure what to upload?</strong>
          <p style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
            Export the weekly timesheet from the scheduling system as a CSV
            file. Save it to your computer, then upload it here. This tool
            runs in your browser — nothing gets sent anywhere.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- styles ----------
const styles = {
  container: { minHeight: '100vh', background: '#f8f8f8', display: 'flex', flexDirection: 'column' },
  header: { background: '#c8102e', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', position: 'sticky', top: 0, zIndex: 100 },
  headerInner: { maxWidth: '720px', margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  backLink: { display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.15)', borderRadius: '8px', padding: '6px 10px', textDecoration: 'none' },
  backText: { fontSize: '13px', color: '#fff', fontWeight: 500 },
  titleArea: { display: 'flex', alignItems: 'center', gap: '8px' },
  headerTitle: { fontSize: '17px', fontWeight: 700, color: '#fff' },

  content: { flex: 1, maxWidth: '720px', width: '100%', margin: '0 auto', padding: '28px 20px' },
  pageTitle: { fontSize: '24px', fontWeight: 800, marginBottom: '6px' },
  sub: { fontSize: '15px', color: '#374151', marginBottom: '24px', lineHeight: 1.5 },

  step: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '20px', marginBottom: '16px' },
  stepHead: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' },
  stepNo: { width: '26px', height: '26px', borderRadius: '50%', background: '#c8102e', color: '#fff', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontSize: '16px', fontWeight: 700 },

  uploadBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '28px 20px', border: '2px dashed #c8102e', borderRadius: '12px', background: '#fef2f2', cursor: 'pointer' },
  uploadText: { fontSize: '15px', fontWeight: 600, color: '#1a1a1a', textAlign: 'center' },
  uploadHint: { fontSize: '13px', color: '#6b7280' },

  statusMsg: { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '12px', fontSize: '14px', fontWeight: 600, color: '#4338ca', marginBottom: '16px' },
  spinner: { width: '14px', height: '14px', borderRadius: '50%', border: '2px solid #4338ca', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' },

  errorBox: { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', marginBottom: '16px' },
  errorTitle: { fontSize: '15px', fontWeight: 700, color: '#7f1d1d' },
  errorText: { fontSize: '14px', color: '#991b1b', marginTop: '4px' },

  readyRow: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '16px' },
  readyTitle: { fontSize: '16px', fontWeight: 700 },
  readySub: { fontSize: '14px', color: '#374151', marginTop: '2px' },
  readyMessage: { fontSize: '13px', color: '#065f46', marginTop: '6px', fontWeight: 600 },

  downloadBtn: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: '#065f46', color: '#fff', border: 'none', borderRadius: '12px', padding: '15px', fontSize: '16px', fontWeight: 700, cursor: 'pointer' },
  linkBtn: { background: 'transparent', color: '#4338ca', border: 'none', fontSize: '13px', fontWeight: 600, marginTop: '10px', cursor: 'pointer', textDecoration: 'underline' },

  helpBox: { marginTop: '24px', padding: '14px 16px', background: '#f3f4f6', borderRadius: '12px', fontSize: '13px', color: '#374151' },
};