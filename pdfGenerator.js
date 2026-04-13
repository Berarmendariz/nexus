/**
 * PDF Report Generator using PDFKit
 * Creates professional PDF reports for real estate simulations.
 */
import PDFDocument from 'pdfkit'

const COLORS = {
  bg: '#080c14',
  surface: '#0f1623',
  accent: '#3b82f6',
  accent2: '#60a5fa',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  text: '#e2e8f0',
  text2: '#94a3b8',
  text3: '#64748b',
  white: '#ffffff',
  darkBlue: '#0a1628',
}

function getKpiColor(type) {
  switch (type) {
    case 'positive': return COLORS.success
    case 'negative': return COLORS.danger
    case 'warning': return COLORS.warning
    default: return COLORS.accent2
  }
}

export function generatePDF(simulation) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: `Nexus Report — ${simulation.project?.name || 'Simulación'}`,
          Author: 'Nexus Investment Simulator',
          Subject: 'Real Estate Investment Analysis',
        }
      })

      const buffers = []
      doc.on('data', chunk => buffers.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(buffers)))
      doc.on('error', reject)

      const report = simulation.report || {}
      const projectName = simulation.project?.name || 'Proyecto'
      const date = new Date(simulation.timestamp).toLocaleDateString('es-MX', {
        year: 'numeric', month: 'long', day: 'numeric'
      })

      const pageWidth = doc.page.width - 100 // 50 margin each side

      // ── HEADER ──
      doc.rect(0, 0, doc.page.width, 120).fill('#0a1628')

      doc.fill('#3b82f6')
        .fontSize(28)
        .font('Helvetica-Bold')
        .text('NEXUS', 50, 35, { continued: false })

      doc.fill('#94a3b8')
        .fontSize(10)
        .font('Helvetica')
        .text('Simulador de Decisiones Inmobiliarias', 50, 68)

      doc.fill('#e2e8f0')
        .fontSize(16)
        .font('Helvetica-Bold')
        .text(projectName, 50, 88)

      // Right side: date and badge
      doc.fill('#64748b')
        .fontSize(9)
        .font('Helvetica')
        .text(date, 350, 40, { width: 200, align: 'right' })

      if (report.badge) {
        doc.fill('#3b82f6')
          .fontSize(9)
          .font('Helvetica-Bold')
          .text(report.badge, 350, 55, { width: 200, align: 'right' })
      }

      if (report.engine) {
        doc.fill('#64748b')
          .fontSize(8)
          .font('Helvetica')
          .text(`Motor: ${report.engine}`, 350, 70, { width: 200, align: 'right' })
      }

      let y = 140

      // ── QUESTION / CONTEXT ──
      if (simulation.question) {
        doc.fill('#64748b')
          .fontSize(9)
          .font('Helvetica-Bold')
          .text('CONSULTA:', 50, y)
        y += 14
        doc.fill('#94a3b8')
          .fontSize(10)
          .font('Helvetica')
          .text(simulation.question, 50, y, { width: pageWidth })
        y = doc.y + 20
      }

      // ── KPI GRID ──
      if (report.kpis && report.kpis.length > 0) {
        doc.fill('#3b82f6')
          .fontSize(12)
          .font('Helvetica-Bold')
          .text('INDICADORES CLAVE', 50, y)
        y += 20

        const cols = 3
        const kpiWidth = (pageWidth - (cols - 1) * 12) / cols
        const kpiHeight = 55

        report.kpis.forEach((kpi, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          const x = 50 + col * (kpiWidth + 12)
          const ky = y + row * (kpiHeight + 8)

          // KPI box background
          doc.roundedRect(x, ky, kpiWidth, kpiHeight, 6)
            .fill('#161e2e')

          // Label
          doc.fill('#64748b')
            .fontSize(8)
            .font('Helvetica')
            .text(kpi.label.toUpperCase(), x + 10, ky + 10, { width: kpiWidth - 20 })

          // Value
          doc.fill(getKpiColor(kpi.type))
            .fontSize(14)
            .font('Helvetica-Bold')
            .text(kpi.value, x + 10, ky + 26, { width: kpiWidth - 20 })
        })

        const totalRows = Math.ceil(report.kpis.length / cols)
        y += totalRows * (kpiHeight + 8) + 16
      }

      // ── REPORT SECTIONS ──
      if (report.sections) {
        report.sections.forEach(section => {
          // Check if we need a new page
          if (y > doc.page.height - 150) {
            doc.addPage()
            y = 50
          }

          // Section title
          doc.fill('#60a5fa')
            .fontSize(11)
            .font('Helvetica-Bold')
            .text(section.title, 50, y, { width: pageWidth })
          y = doc.y + 4

          // Divider line
          doc.moveTo(50, y).lineTo(50 + pageWidth, y).stroke('#1e2d42')
          y += 10

          // Items (bullet list)
          if (section.items && section.items.length > 0) {
            section.items.forEach(item => {
              if (y > doc.page.height - 80) {
                doc.addPage()
                y = 50
              }

              // Bullet dot
              doc.circle(58, y + 5, 2.5).fill('#3b82f6')

              // Item text
              doc.fill('#94a3b8')
                .fontSize(10)
                .font('Helvetica')
                .text(item, 68, y, { width: pageWidth - 24 })
              y = doc.y + 6
            })
          }

          // Conclusion text
          if (section.text) {
            if (y > doc.page.height - 100) {
              doc.addPage()
              y = 50
            }

            doc.roundedRect(50, y, pageWidth, 0.1, 4).fill('#0f1623')
            // Measure text height first
            const textHeight = doc.heightOfString(section.text, { width: pageWidth - 30 })
            doc.roundedRect(50, y, pageWidth, textHeight + 20, 6)
              .fill('#0f1623')

            doc.fill('#60a5fa')
              .fontSize(9)
              .font('Helvetica-Bold')
              .text('💡 CONCLUSIÓN', 65, y + 8, { width: pageWidth - 30 })

            doc.fill('#94a3b8')
              .fontSize(10)
              .font('Helvetica')
              .text(section.text, 65, doc.y + 4, { width: pageWidth - 30 })
            y = doc.y + 16
          }

          y += 12
        })
      }

      // ── FOOTER ──
      const footerY = doc.page.height - 40
      doc.fill('#1e2d42')
        .moveTo(50, footerY)
        .lineTo(50 + pageWidth, footerY)
        .stroke('#1e2d42')

      doc.fill('#64748b')
        .fontSize(8)
        .font('Helvetica')
        .text(
          `© ${new Date().getFullYear()} Nexus — Simulador de Decisiones Inmobiliarias | Generado: ${new Date().toISOString()}`,
          50, footerY + 8,
          { width: pageWidth, align: 'center' }
        )

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}
