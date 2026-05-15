import 'server-only';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer';
import type { LineItem } from '@/lib/documents/vat';

// Phase 2 Session 14 — one parameterised React-PDF template covering all
// three document types (quote / invoice / receipt). The three share ~90% of
// structure; per-type variation is conditional inside the template.
//
// Why one template (per Plan Q3): the costs of three templates (duplicated
// boilerplate, drift between visual styles) outweigh the cost of a single
// type-aware template. The template is pure JSX over @react-pdf primitives;
// no DOM, no native deps, no Vercel-serverless-specific config required.

export interface DocumentPdfData {
  type: 'quote' | 'invoice' | 'receipt';
  documentNumber: string;
  invoiceSubtype: 'initial' | 'final' | null;
  status: 'draft' | 'sent' | 'superseded' | 'void';
  orgName: string;
  projectNumber: string;
  recipientName: string | null;
  lineItems: LineItem[];
  subtotal: number;
  discountPct: number;
  vatApplicable: boolean;
  vatAmount: number;
  total: number;
  currency: string;
  sentAt: Date | null;
  acceptedAt: Date | null;
  acceptedByName: string | null;
  revisionNumber: number;
  // Receipt-only — payment context.
  paymentRecordedAt: Date | null;
}

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#0f172a',
  },
  header: {
    marginBottom: 24,
  },
  orgName: {
    fontSize: 9,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 6,
  },
  meta: {
    flexDirection: 'row',
    gap: 8,
    fontSize: 9,
    color: '#475569',
  },
  metaItem: {
    paddingRight: 8,
  },
  paidStamp: {
    marginTop: 8,
    alignSelf: 'flex-start',
    fontSize: 12,
    fontWeight: 700,
    color: '#16a34a',
    borderColor: '#16a34a',
    borderWidth: 2,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    letterSpacing: 2,
  },
  recipientBox: {
    marginBottom: 20,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: 4,
  },
  recipientLabel: {
    fontSize: 8,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  recipientName: {
    fontSize: 11,
    fontWeight: 700,
  },
  table: {
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#cbd5e1',
    paddingBottom: 6,
    marginBottom: 4,
    fontSize: 8,
    fontWeight: 700,
    color: '#475569',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderColor: '#e2e8f0',
  },
  colDescription: { flex: 4, paddingRight: 8 },
  colQty: { flex: 1, textAlign: 'right', paddingHorizontal: 4 },
  colUnit: { flex: 1.2, textAlign: 'right', paddingHorizontal: 4 },
  colTotal: { flex: 1.4, textAlign: 'right' },
  totals: {
    marginTop: 8,
    alignSelf: 'flex-end',
    width: 220,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalsLabel: {
    color: '#475569',
  },
  totalsLabelMuted: {
    color: '#94a3b8',
  },
  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderColor: '#0f172a',
    fontSize: 12,
    fontWeight: 700,
  },
  acceptedBlock: {
    marginTop: 24,
    padding: 12,
    backgroundColor: '#ecfdf5',
    borderRadius: 4,
  },
  acceptedLabel: {
    fontSize: 8,
    color: '#15803d',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  acceptedText: {
    fontSize: 10,
    color: '#14532d',
  },
  revisionStrip: {
    marginTop: 12,
    fontSize: 8,
    color: '#64748b',
    fontStyle: 'italic',
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'center',
  },
});

function fmtGBP(amount: number, currency: string): string {
  // PDF formatter: avoid Intl (not bundled with @react-pdf in serverless);
  // hand-format a sane GBP/USD/EUR.
  const symbol = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
  const formatted = Math.abs(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol}${formatted}${symbol ? '' : ' ' + currency}`;
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function titleFor(data: DocumentPdfData): string {
  if (data.type === 'quote') return `Quote ${data.documentNumber}`;
  if (data.type === 'invoice') {
    const sub = data.invoiceSubtype === 'final' ? 'Final ' : data.invoiceSubtype === 'initial' ? 'Initial ' : '';
    return `${sub}Invoice ${data.documentNumber}`;
  }
  return `Receipt ${data.documentNumber}`;
}

export function DocumentPdfTemplate(data: DocumentPdfData) {
  const discountAmount =
    data.discountPct > 0 ? (data.subtotal * data.discountPct) / 100 : 0;
  const issuedDate =
    data.type === 'receipt' ? data.paymentRecordedAt : data.sentAt;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.orgName}>{data.orgName}</Text>
          <Text style={styles.title}>{titleFor(data)}</Text>
          <View style={styles.meta}>
            <Text style={styles.metaItem}>
              Project {data.projectNumber}
            </Text>
            {issuedDate && (
              <Text style={styles.metaItem}>
                {data.type === 'receipt' ? 'Received' : 'Issued'}{' '}
                {fmtDate(issuedDate)}
              </Text>
            )}
            {data.revisionNumber > 0 && data.type !== 'quote' && (
              <Text style={styles.metaItem}>
                Revision {data.revisionNumber}
              </Text>
            )}
          </View>
          {data.type === 'receipt' && (
            <Text style={styles.paidStamp}>PAID</Text>
          )}
        </View>

        {data.recipientName && (
          <View style={styles.recipientBox}>
            <Text style={styles.recipientLabel}>
              {data.type === 'receipt' ? 'Received from' : 'Issued to'}
            </Text>
            <Text style={styles.recipientName}>{data.recipientName}</Text>
          </View>
        )}

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colDescription}>Description</Text>
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colUnit}>Unit</Text>
            <Text style={styles.colTotal}>Total</Text>
          </View>
          {data.lineItems.map((li, idx) => (
            <View key={idx} style={styles.tableRow} wrap={false}>
              <Text style={styles.colDescription}>{li.description}</Text>
              <Text style={styles.colQty}>{li.quantity}</Text>
              <Text style={styles.colUnit}>
                {fmtGBP(li.unitPrice, data.currency)}
              </Text>
              <Text style={styles.colTotal}>
                {fmtGBP(li.unitPrice * li.quantity, data.currency)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text>{fmtGBP(data.subtotal, data.currency)}</Text>
          </View>
          {discountAmount > 0 && (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabelMuted}>
                Discount ({data.discountPct}%)
              </Text>
              <Text style={styles.totalsLabelMuted}>
                −{fmtGBP(discountAmount, data.currency)}
              </Text>
            </View>
          )}
          {data.vatApplicable && (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabelMuted}>VAT (20%)</Text>
              <Text style={styles.totalsLabelMuted}>
                {fmtGBP(data.vatAmount, data.currency)}
              </Text>
            </View>
          )}
          <View style={styles.grandTotal}>
            <Text>Total</Text>
            <Text>{fmtGBP(data.total, data.currency)}</Text>
          </View>
        </View>

        {data.type === 'quote' && data.acceptedAt && (
          <View style={styles.acceptedBlock}>
            <Text style={styles.acceptedLabel}>Accepted</Text>
            <Text style={styles.acceptedText}>
              {data.acceptedByName ?? 'Client'} accepted this quote on{' '}
              {fmtDate(data.acceptedAt)}.
            </Text>
          </View>
        )}

        {data.status === 'superseded' && data.type !== 'receipt' && (
          <View style={styles.revisionStrip}>
            <Text>
              This {data.type} has been superseded by a newer version.
            </Text>
          </View>
        )}

        <Text style={styles.footer}>
          {data.orgName} · {data.projectNumber} · {titleFor(data)}
        </Text>
      </Page>
    </Document>
  );
}
