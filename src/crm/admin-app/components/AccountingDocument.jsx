import React, { useEffect, useMemo, useState } from 'react';
import { Download, Mail, Printer, X } from 'lucide-react';
import { getClientMailboxesAdmin, sendHostingerMailToClientAdmin } from '../adminApi.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]));

const formatMoney = (amount, currency = 'USD') => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount) || 0);
  } catch {
    return `${currency} ${(Number(amount) || 0).toFixed(2)}`;
  }
};

const documentReference = (document, kind) => kind === 'receipt'
  ? document.receipt_number || document.receiptNumber || 'Receipt'
  : document.invoice_number || document.invoiceNumber || 'Invoice';

export default function AccountingDocument({ kind, document, invoice, clientId, clientName, clientEmail, onClose }) {
  const [mailboxes, setMailboxes] = useState([]);
  const [senderMailboxId, setSenderMailboxId] = useState('');
  const [mailState, setMailState] = useState({ busy: false, error: '', sent: '' });
  const reference = documentReference(document || {}, kind);
  const isReceipt = kind === 'receipt';
  const title = isReceipt ? 'Payment receipt' : 'Invoice';
  const issuedDate = isReceipt
    ? document?.payment_date || document?.paymentDate
    : document?.issue_date || document?.issueDate;
  const currency = document?.currency || invoice?.currency || 'USD';
  const items = Array.isArray(invoice?.line_items)
    ? invoice.line_items
    : Array.isArray(invoice?.lineItems) ? invoice.lineItems : [];
  const amount = isReceipt
    ? Number(document?.amount || 0)
    : Number(document?.total || 0);
  const balanceDue = Number(document?.balance_due ?? document?.balanceDue ?? amount);
  const invoiceNumber = invoice?.invoice_number || invoice?.invoiceNumber || '';
  const cannotEmail = ['draft', 'voided'].includes(String(document?.status || '').toLowerCase());

  useEffect(() => {
    let active = true;
    getClientMailboxesAdmin(clientId)
      .then((assignments) => {
        if (!active) return;
        const enabled = assignments.filter((mailbox) => mailbox.enabled !== false);
        setMailboxes(enabled);
        setSenderMailboxId(enabled[0]?.providerMailboxId || '');
      })
      .catch((error) => {
        if (active) setMailState((current) => ({ ...current, error: error.message || 'Could not load assigned email senders.' }));
      });
    return () => { active = false; };
  }, [clientId]);

  const emailContent = useMemo(() => {
    const safeName = escapeHtml(clientName || 'Client');
    const safeRef = escapeHtml(reference);
    const safeDate = escapeHtml(issuedDate || '—');
    const safeCurrency = escapeHtml(currency);
    const safeAmount = escapeHtml(formatMoney(amount, currency));
    const safeEmail = escapeHtml(clientEmail || '');
    const safeStatus = escapeHtml(document?.status || 'Issued');
    const serviceRows = isReceipt
      ? `<tr><td>Payment${invoiceNumber ? ` applied to invoice ${escapeHtml(invoiceNumber)}` : ''}</td><td style="text-align:right">${safeAmount}</td></tr>`
      : items.map((item) => {
        const description = escapeHtml(item.description || item.service || 'Professional services');
        const quantity = Number(item.quantity || 1);
        const unitPrice = Number(item.unitPrice ?? item.unit_price ?? 0);
        return `<tr><td>${description}<br><small>${quantity} × ${escapeHtml(formatMoney(unitPrice, currency))}</small></td><td style="text-align:right">${escapeHtml(formatMoney(quantity * unitPrice, currency))}</td></tr>`;
      }).join('');
    const summaryRows = isReceipt
      ? `<tr><td>Method</td><td>${escapeHtml(document?.payment_method || document?.paymentMethod || '—')}</td></tr><tr><td>Reference</td><td>${escapeHtml(document?.transaction_reference || document?.transactionReference || '—')}</td></tr>`
      : `<tr><td>Subtotal</td><td>${escapeHtml(formatMoney(document?.subtotal, currency))}</td></tr><tr><td>Tax</td><td>${escapeHtml(formatMoney(document?.tax, currency))}</td></tr><tr><td>Balance due</td><td>${escapeHtml(formatMoney(balanceDue, currency))}</td></tr>`;
    const dueDateRow = !isReceipt ? `<tr><td style="padding:8px 0;color:#707988">Due date</td><td style="padding:8px 0;text-align:right">${escapeHtml(document?.due_date || document?.dueDate || '—')}</td></tr>` : '';
    const html = `<!doctype html><html><body style="margin:0;background:#f2f4f7;padding:28px 12px;font-family:Arial,sans-serif;color:#20252d"><div style="max-width:680px;margin:0 auto;background:#fff;border:1px solid #e1e5eb;border-radius:12px;overflow:hidden"><div style="padding:28px 32px;background:#152234;color:#fff"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#a8c6df">Codex Dynamics</div><h1 style="margin:20px 0 4px;font-size:28px">${title}</h1><div style="color:#d9e2ec">${safeRef}</div></div><div style="padding:28px 32px"><p style="margin:0 0 22px">Hello ${safeName},</p><p style="margin:0 0 24px;color:#586273">${isReceipt ? 'Thank you. This receipt confirms that we recorded your payment.' : 'Please find your invoice details below. Kindly arrange payment by the due date shown on your invoice.'}</p><table style="width:100%;border-collapse:collapse;margin-bottom:20px"><tr><td style="padding:8px 0;color:#707988">Bill to</td><td style="padding:8px 0;text-align:right">${safeName}${safeEmail ? `<br>${safeEmail}` : ''}</td></tr><tr><td style="padding:8px 0;color:#707988">${isReceipt ? 'Payment date' : 'Issue date'}</td><td style="padding:8px 0;text-align:right">${safeDate}</td></tr>${dueDateRow}<tr><td style="padding:8px 0;color:#707988">Status</td><td style="padding:8px 0;text-align:right">${safeStatus}</td></tr></table><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f5f7fa"><th style="padding:12px;text-align:left">Description</th><th style="padding:12px;text-align:right">Amount (${safeCurrency})</th></tr></thead><tbody>${serviceRows}</tbody></table><table style="width:100%;margin-top:18px;border-top:1px solid #e1e5eb;border-collapse:collapse">${summaryRows}<tr><td style="padding:14px 0;font-size:18px;font-weight:bold">${isReceipt ? 'Total received' : 'Invoice total'}</td><td style="padding:14px 0;text-align:right;font-size:18px;font-weight:bold">${safeAmount}</td></tr></table><p style="margin:28px 0 0;color:#707988;font-size:12px">This electronic ${isReceipt ? 'receipt' : 'invoice'} was issued by Codex Dynamics. Please contact us if you have questions about this document.</p></div></div></body></html>`;
    const text = [
      `CODEX DYNAMICS · ${title.toUpperCase()}`,
      `${title} number: ${reference}`,
      `Client: ${clientName || 'Client'}${clientEmail ? ` (${clientEmail})` : ''}`,
      `${isReceipt ? 'Payment' : 'Issue'} date: ${issuedDate || '—'}`,
      `Status: ${document?.status || 'Issued'}`,
      '',
      ...(isReceipt
        ? [`Payment${invoiceNumber ? ` applied to invoice ${invoiceNumber}` : ''}: ${formatMoney(amount, currency)}`, `Method: ${document?.payment_method || document?.paymentMethod || '—'}`, `Reference: ${document?.transaction_reference || document?.transactionReference || '—'}`]
        : [
          ...items.map((item) => `${item.description || item.service || 'Professional services'} · ${Number(item.quantity || 1)} × ${formatMoney(Number(item.unitPrice ?? item.unit_price ?? 0), currency)}`),
          `Subtotal: ${formatMoney(document?.subtotal, currency)}`,
          `Tax: ${formatMoney(document?.tax, currency)}`,
          `Due date: ${document?.due_date || document?.dueDate || '—'}`,
        ]),
      '',
      `${isReceipt ? 'Total received' : 'Invoice total'}: ${formatMoney(amount, currency)}`,
      ...(!isReceipt ? [`Balance due: ${formatMoney(balanceDue, currency)}`] : []),
      '',
      'Codex Dynamics',
    ].join('\n');
    return { html, text, subject: `${title} ${reference} · Codex Dynamics` };
  }, [amount, balanceDue, clientEmail, clientName, currency, document, invoiceNumber, isReceipt, items, issuedDate, reference, title]);

  const sendEmail = async () => {
    if (!senderMailboxId) return;
    setMailState({ busy: true, error: '', sent: '' });
    try {
      const result = await sendHostingerMailToClientAdmin(senderMailboxId, {
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      });
      setMailState({ busy: false, error: '', sent: `Sent to ${result.to} from ${result.from}.` });
    } catch (error) {
      setMailState({ busy: false, error: error.message || 'Could not send the document email.', sent: '' });
    }
  };

  if (!document) return null;
  return (
    <div className="aw-document-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="aw-document-dialog" role="dialog" aria-modal="true" aria-labelledby="aw-document-title">
        <header className="aw-document-toolbar">
          <div><span>DOCUMENT PREVIEW</span><h2 id="aw-document-title">{title} · {reference}</h2></div>
          <div className="aw-document-toolbar-actions">
            <button type="button" className="aw-button aw-button-quiet" onClick={() => window.print()}><Printer size={14} />Print / Save PDF</button>
            <a className="aw-button aw-button-quiet" href={`data:text/html;charset=utf-8,${encodeURIComponent(emailContent.html)}`} download={`${reference}.html`}><Download size={14} />Download HTML</a>
            <button type="button" className="aw-icon-button" aria-label="Close document preview" onClick={onClose}><X size={16} /></button>
          </div>
        </header>
        <article className="aw-document-sheet">
          <div className="aw-document-brand"><strong>CODEX DYNAMICS</strong><span>Digital services · codexdynamics.com</span></div>
          <div className="aw-document-title-row"><div><span className="aw-document-kicker">{isReceipt ? 'PAYMENT CONFIRMATION' : 'BILLING DOCUMENT'}</span><h1>{title}</h1></div><span className={`aw-document-status ${String(document.status || '').toLowerCase()}`}>{document.status || 'Issued'}</span></div>
          <div className="aw-document-meta"><div><span>{isReceipt ? 'Receipt number' : 'Invoice number'}</span><strong>{reference}</strong></div><div><span>{isReceipt ? 'Payment date' : 'Issue date'}</span><strong>{issuedDate || '—'}</strong></div>{!isReceipt && <div><span>Due date</span><strong>{document.due_date || document.dueDate || '—'}</strong></div>}</div>
          <div className="aw-document-parties"><section><span>{isReceipt ? 'RECEIVED FROM' : 'BILL TO'}</span><strong>{clientName || 'Client'}</strong>{clientEmail && <small>{clientEmail}</small>}</section><section><span>ISSUED BY</span><strong>Codex Dynamics</strong><small>codexdynamics.com</small></section></div>
          <table className="aw-document-lines"><thead><tr><th>Description</th>{!isReceipt && <><th>Qty</th><th>Unit price</th></>}<th className="aw-align-right">Amount</th></tr></thead><tbody>
            {isReceipt ? <tr><td colSpan="3">Payment received{invoiceNumber ? ` · Invoice ${invoiceNumber}` : ''}<small>{document.payment_method || document.paymentMethod || 'Payment'}{(document.transaction_reference || document.transactionReference) ? ` · Ref ${document.transaction_reference || document.transactionReference}` : ''}</small></td><td className="aw-align-right">{formatMoney(amount, currency)}</td></tr>
              : items.map((item, index) => {
                const quantity = Number(item.quantity || 1);
                const unitPrice = Number(item.unitPrice ?? item.unit_price ?? 0);
                return <tr key={`${item.description || item.service}-${index}`}><td>{item.description || item.service || 'Professional services'}<small>{item.service || 'Professional services'}</small></td><td>{quantity}</td><td>{formatMoney(unitPrice, currency)}</td><td className="aw-align-right">{formatMoney(quantity * unitPrice, currency)}</td></tr>;
              })}
          </tbody></table>
          <div className="aw-document-bottom">
            <div className="aw-document-note"><span>{isReceipt ? 'PAYMENT METHOD' : 'PAYMENT TERMS'}</span><p>{isReceipt ? `${document.payment_method || document.paymentMethod || 'Payment'}${(document.transaction_reference || document.transactionReference) ? ` · Reference ${document.transaction_reference || document.transactionReference}` : ''}` : document.payment_terms || 'Please include the invoice number with your payment.'}</p></div>
            <div className="aw-document-totals">{!isReceipt && <><div><span>Subtotal</span><strong>{formatMoney(document.subtotal, currency)}</strong></div><div><span>Tax ({Number(document.tax_rate ?? document.taxRate ?? 0)}%)</span><strong>{formatMoney(document.tax, currency)}</strong></div></>}<div className="aw-document-grand-total"><span>{isReceipt ? 'Amount received' : 'Total due'}</span><strong>{formatMoney(amount, currency)}</strong></div>{!isReceipt && <div><span>Balance due</span><strong>{formatMoney(document.balance_due ?? document.balanceDue ?? amount, currency)}</strong></div>}</div>
          </div>
          <footer className="aw-document-footer">Thank you for choosing Codex Dynamics.<span>{reference} · {currency}</span></footer>
        </article>
        <div className="aw-document-email">
          <div><strong>Email this {isReceipt ? 'receipt' : 'invoice'}</strong><span>{clientEmail || 'This client has no email address on file.'}</span></div>
          <label>Send from<select value={senderMailboxId} onChange={(event) => setSenderMailboxId(event.target.value)} disabled={!mailboxes.length}>{mailboxes.length ? mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.providerMailboxId}>{mailbox.displayName || mailbox.emailAddress} · {mailbox.emailAddress}</option>) : <option value="">No assigned mailbox</option>}</select></label>
          {mailState.error && <p className="aw-document-email-error" role="alert">{mailState.error}</p>}
          {mailState.sent && <p className="aw-document-email-success" role="status">{mailState.sent}</p>}
          {!mailboxes.length && !mailState.error && <p className="aw-document-email-hint">Assign an active Hostinger mailbox to this client to send documents directly.</p>}
          {cannotEmail && <p className="aw-document-email-hint">Draft invoices and voided receipts cannot be emailed.</p>}
          <button type="button" className="aw-button aw-button-primary" disabled={!senderMailboxId || !clientEmail || mailState.busy || cannotEmail} onClick={sendEmail}><Mail size={14} />{mailState.busy ? 'Sending…' : `Email ${isReceipt ? 'receipt' : 'invoice'}`}</button>
        </div>
      </section>
    </div>
  );
}
