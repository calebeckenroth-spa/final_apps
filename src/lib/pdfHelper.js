// Shared PDF generation helper.
// Captures a DOM node (rendered off-screen) and turns it into a multi-page
// letter-size PDF. Used by BOL Maker, Historical BOLs, PO Tracker, and Receiving.

export async function generatePdfFromNode({ nodeId, filename }) {
    const node = document.getElementById(nodeId);
    if (!node) throw new Error(`PDF source node not found: ${nodeId}`);
  
    const [{ default: html2canvas }, jspdfMod] = await Promise.all([
      import('https://esm.sh/html2canvas@1.4.1'),
      import('https://esm.sh/jspdf@2.5.1'),
    ]);
    const { jsPDF } = jspdfMod;
  
    // Temporarily bring the node onscreen for capture
    const saved = {
      position: node.style.position,
      left: node.style.left,
      top: node.style.top,
      background: node.style.background,
    };
    node.style.position = 'fixed';
    node.style.left = '0';
    node.style.top = '0';
    node.style.background = '#fff';
  
    let canvas;
    try {
      canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      });
    } finally {
      node.style.position = saved.position;
      node.style.left = saved.left;
      node.style.top = saved.top;
      node.style.background = saved.background;
    }
  
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 36;
    const imgW = pageW - margin * 2;
    const ratio = imgW / canvas.width;
    const imgH = canvas.height * ratio;
    const imgData = canvas.toDataURL('image/png');
  
    if (imgH <= pageH - margin * 2) {
      pdf.addImage(imgData, 'PNG', margin, margin, imgW, imgH);
    } else {
      let y = margin;
      let remaining = imgH;
      let offset = 0;
      while (remaining > 0) {
        pdf.addImage(imgData, 'PNG', margin, y - offset, imgW, imgH);
        remaining -= pageH - margin * 2;
        offset += pageH - margin * 2;
        if (remaining > 0) {
          pdf.addPage();
          y = margin;
        }
      }
    }
  
    pdf.save(filename || 'document.pdf');
  }