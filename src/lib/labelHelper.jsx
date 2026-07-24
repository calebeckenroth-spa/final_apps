// Shared 4x6 label rendering — used by Shipping Tags (outbound) and
// Receiving (inbound). Same visual so operators recognize the format
// regardless of where the pallet comes from.

import React from 'react';
import JsBarcode from 'jsbarcode';

// Render a Code128 barcode to an SVG markup string.
export function makeBarcodeSvg(value) {
  if (!value) return '';
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, String(value), {
      format: 'CODE128',
      displayValue: true,
      fontSize: 16,
      textMargin: 2,
      height: 60,
      width: 2,
      margin: 0,
    });
    return svg.outerHTML;
  } catch (e) {
    return '';
  }
}

// Assemble the pipe-delimited value we encode into the Code128 barcode.
// Field order (fixed): itemNo|description|lotNo|expirationDate|qty
// Pipes are used because they almost never appear in real product data.
// If any field contains a pipe we replace it with a space so scanning still
// splits into the expected number of fields.
export function buildBarcodeValue({ itemNo, description, lotNo, expirationDate, qty }) {
  const sanitize = (v) => String(v == null ? '' : v).replace(/\|/g, ' ').trim();
  return [
    sanitize(itemNo),
    sanitize(description),
    sanitize(lotNo),
    sanitize(expirationDate),
    sanitize(qty),
  ].join('|');
}

// Format a date-like value for display on labels
function formatLabelDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// The 4x6 label face. `data` fields (all optional):
//   shipTo, poNumber, shipDate, itemNo, description,
//   lotNo, expirationDate, qty, uom, caseCounter
// `caseCounter` (optional): { index: 1, total: 5 } renders "Case 1 of 5"
//   below the QTY row so operators know which case they are looking at.
// `title` overrides the "SHIPPING TAG" line — pass "RECEIVING TAG" for inbound.
export function TagFace({ data, barcodeSvg, title }) {
  const cc = data.caseCounter;
  return (
    <div className="ship-tag-face" style={labelStyles.tagFace}>
      <div style={labelStyles.tagHeader}>
        <span style={labelStyles.tagBrand}>EL PINTO FOODS</span>
        <span style={labelStyles.tagType}>{title || 'SHIPPING TAG'}</span>
      </div>

      <div style={labelStyles.tagBody}>
        <div>
          <div style={labelStyles.tagLabel}>Ship To</div>
          <div style={labelStyles.tagShipTo}>{data.shipTo || '\u2014'}</div>
        </div>

        <div style={labelStyles.tagRow}>
          <div style={{ flex: 1 }}>
            <div style={labelStyles.tagLabel}>PO / Order #</div>
            <div style={labelStyles.tagValue}>{data.poNumber || '\u2014'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={labelStyles.tagLabel}>Ship Date</div>
            <div style={labelStyles.tagValue}>{formatLabelDate(data.shipDate)}</div>
          </div>
        </div>

        <div style={labelStyles.tagDivider} />

        <div>
          <div style={labelStyles.tagLabel}>Item</div>
          <div style={labelStyles.tagItemNo}>{data.itemNo || '\u2014'}</div>
          {data.description ? (
            <div style={labelStyles.tagDesc}>{data.description}</div>
          ) : null}
        </div>

        <div style={labelStyles.tagRow}>
          <div style={{ flex: 1 }}>
            <div style={labelStyles.tagLabel}>Lot #</div>
            <div style={labelStyles.tagValue}>{data.lotNo || '\u2014'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={labelStyles.tagLabel}>Best By</div>
            <div style={labelStyles.tagValue}>{formatLabelDate(data.expirationDate)}</div>
          </div>
        </div>

        <div style={labelStyles.tagQtyRow}>
          <span style={labelStyles.tagQtyLabel}>QTY</span>
          <span style={labelStyles.tagQtyValue}>{data.qty || '\u2014'}</span>
          <span style={labelStyles.tagUom}>{data.uom || ''}</span>
        </div>

        {cc && cc.total > 1 ? (
          <div style={labelStyles.tagCaseCounter}>
            Case {cc.index} of {cc.total}
          </div>
        ) : null}

        <div
          style={labelStyles.tagBarcode}
          dangerouslySetInnerHTML={{ __html: barcodeSvg }}
        />
      </div>
    </div>
  );
}

// Print CSS — must be injected on the page that prints (Receiving OR ShippingTags).
// Note the container id is caller-specific so pages can render labels into
// their own container without clashing.
export const labelPrintCss = (containerId) => `
@media screen {
  #${containerId} { position: absolute; left: -10000px; top: 0; }
}
@media print {
  @page { size: 4in 6in; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .screen-only { display: none !important; }
  #${containerId} { position: static !important; left: auto !important; }
  .ship-tag-face { page-break-after: always; break-after: page; }
  .ship-tag-face:last-child { page-break-after: auto; break-after: auto; }
}
`;

const labelStyles = {
  tagFace: {
    width: '4in',
    height: '6in',
    background: '#fff',
    color: '#000',
    fontFamily: 'Arial, sans-serif',
    padding: '0.2in',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid #000',
  },
  tagHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottom: '2px solid #000',
    paddingBottom: '4px',
  },
  tagBrand: { fontSize: '18px', fontWeight: 800, letterSpacing: '0.5px' },
  tagType: { fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px' },
  tagBody: { flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '10px' },
  tagLabel: { fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#555' },
  tagShipTo: { fontSize: '20px', fontWeight: 700, lineHeight: 1.1 },
  tagValue: { fontSize: '15px', fontWeight: 600 },
  tagRow: { display: 'flex', gap: '8px' },
  tagDivider: { borderTop: '1px dashed #999', margin: '2px 0' },
  tagItemNo: { fontSize: '22px', fontWeight: 800, lineHeight: 1 },
  tagDesc: { fontSize: '12px', color: '#333', marginTop: '2px' },
  tagQtyRow: { display: 'flex', alignItems: 'baseline', gap: '10px', border: '2px solid #000', borderRadius: '6px', padding: '6px 10px' },
  tagQtyLabel: { fontSize: '12px', fontWeight: 700, letterSpacing: '1px' },
  tagQtyValue: { fontSize: '32px', fontWeight: 900, lineHeight: 1, flex: 1 },
  tagUom: { fontSize: '13px', fontWeight: 700 },
  tagCaseCounter: { fontSize: '13px', fontWeight: 700, color: '#000', textAlign: 'center', border: '1px dashed #666', borderRadius: '4px', padding: '4px 6px' },
  tagBarcode: { marginTop: 'auto', display: 'flex', justifyContent: 'center' },
};