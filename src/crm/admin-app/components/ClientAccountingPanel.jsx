import React, { useEffect, useMemo, useState } from 'react';
import {
  createClientAccountingAsset,
  createClientRecurringService,
  getClientAccountingAdmin,
  updateClientAccountingAsset,
  invoiceClientRecurringService,
  saveClientAccountingRecord,
  voidClientAccountingPayment,
  updateClientRecurringService,
} from '../adminApi.js';
import InvoiceFollowupForm from './InvoiceFollowupForm.jsx';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const newLine = () => ({ description: '', service: 'Project creation', quantity: 1, unitPrice: 0 });
const newRecurringService = () => ({
  serviceName: '',
  serviceType: 'Hosting',
  description: '',
  amount: '',
  currency: 'USD',
  billingFrequency: 'Monthly',
  startDate: today(),
  nextDueDate: today(),
  status: 'Active',
});
const newTrackedAsset = (type, currency = 'USD') => type === 'hosting'
  ? {
    websiteName: '',
    provider: '',
    plan: '',
    status: 'Active',
    startDate: today(),
    renewalDate: '',
    billingFrequency: 'Monthly',
    amount: '0',
    currency,
    autoRenew: true,
    serverRegion: '',
    ipAddress: '',
    uptime: '99.99%',
  }
  : {
    domainName: '',
    registrar: 'Codex Managed',
    registrationDate: today(),
    expirationDate: '',
    renewalAmount: '',
    currency,
    renewalStatus: 'Auto-Renew Active',
    sslStatus: '',
    dnssecStatus: '',
    autoRenew: true,
    nameservers: '',
  };
function normalizeInvoice(row) {
  let items = row.line_items || row.lineItems || [];
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = []; }
  }
  const dueDate = row.due_date || row.dueDate;
  const balanceDue = Number(row.balance_due ?? row.balanceDue ?? 0);
  const status = row.status || 'Pending';
  const isOverdue = balanceDue > 0 && status.toLowerCase() !== 'draft' && dueDate && dueDate.slice(0, 10) < today();
  return {
    ...row,
    lineItems: items,
    invoiceNumber: row.invoice_number || row.invoiceNumber,
    issueDate: row.issue_date || row.issueDate,
    dueDate,
    amountPaid: Number(row.amount_paid ?? row.amountPaid ?? 0),
    balanceDue,
    total: Number(row.total ?? 0),
    status: isOverdue ? 'Overdue' : status,
    currency: row.currency || 'USD',
  };
}
function normalizeRecurringService(row) {
  return {
    ...row,
    serviceName: row.service_name || row.serviceName || '',
    serviceType: row.service_type || row.serviceType || 'Other',
    description: row.description || '',
    amount: Number(row.amount || 0),
    currency: row.currency || 'USD',
    billingFrequency: row.billing_frequency || row.billingFrequency || 'Monthly',
    startDate: dateInput(row.start_date || row.startDate, today()),
    nextDueDate: dateInput(row.next_due_date || row.nextDueDate, today()),
    status: row.status || 'Active',
  };
}
function normalizePayment(row) {
  return {
    ...row,
    receiptNumber: row.receipt_number || row.receiptNumber,
    paymentDate: row.payment_date || row.paymentDate,
    paymentMethod: row.payment_method || row.paymentMethod,
    transactionReference: row.transaction_reference || row.transactionReference,
    amount: Number(row.amount || 0),
    invoiceId: row.invoice_id || row.invoiceId || '',
    currency: row.currency || 'USD',
  };
}
function money(amount, currency = 'USD') {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount) || 0); }
  catch { return `${currency} ${(Number(amount) || 0).toFixed(2)}`; }
}
function monthlyEquivalent(amount, frequency = 'Monthly') {
  const value = Number(amount) || 0;
  const label = String(frequency || '').toLowerCase();
  if (/one.?time|once/.test(label)) return 0;
  if (/bi.?weekly/.test(label)) return value * 26 / 12;
  if (/semi.?monthly/.test(label)) return value * 2;
  if (/year|annual/.test(label)) return value / 12;
  if (/quarter/.test(label)) return value / 3;
  if (/week/.test(label)) return value * 52 / 12;
  return value;
}
function dateInput(value, fallback) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 10);
}

export default function ClientAccountingPanel({ clientId, clientName = '', showNotification, canEdit = true, onSaved, initialMode = '' }) {
  const [records, setRecords] = useState({ invoices: [], payments: [], recurringServices: [], hosting: [], domains: [], followups: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(initialMode);
  const [currency, setCurrency] = useState('USD');
  const [items, setItems] = useState([newLine()]);
  const [taxRate, setTaxRate] = useState(0);
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(dateInput(null, new Date(Date.now() + 14 * 86400000).toISOString()));
  const [invoiceStatus, setInvoiceStatus] = useState('Pending');
  const [payment, setPayment] = useState({ invoiceId: '', paymentDate: today(), amount: '', paymentMethod: 'Bank transfer', transactionReference: '', description: '' });
  const [serviceForm, setServiceForm] = useState(newRecurringService);
  const [editingServiceId, setEditingServiceId] = useState('');
  const [assetEditing, setAssetEditing] = useState(null);
  const [assetDraft, setAssetDraft] = useState({ amount: '', currency: 'USD' });
  const [creatingAsset, setCreatingAsset] = useState('');
  const [trackedAssetForm, setTrackedAssetForm] = useState(newTrackedAsset('hosting'));
  const [voidingPayment, setVoidingPayment] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [followupInvoice, setFollowupInvoice] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getClientAccountingAdmin(clientId);
      setRecords({
        invoices: (result.invoices || []).map(normalizeInvoice),
        payments: (result.payments || []).map(normalizePayment),
        recurringServices: (result.recurringServices || []).map(normalizeRecurringService),
        hosting: result.hosting || [],
        domains: result.domains || [],
        followups: result.followups || [],
      });
    } catch (reason) {
      setError(reason?.message || 'Could not load client accounting.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setMode(initialMode || '');
    setFollowupInvoice(null);
    load();
  }, [clientId, initialMode]);

  const totals = useMemo(() => {
    const invoices = records.invoices.filter((invoice) => invoice.currency === currency);
    const payments = records.payments.filter((row) => row.currency === currency && ['completed', 'received', 'paid', 'partially paid'].includes(String(row.status || '').toLowerCase()));
    return {
      billed: invoices.reduce((sum, invoice) => sum + invoice.total, 0),
      outstanding: invoices.reduce((sum, invoice) => sum + invoice.balanceDue, 0),
      received: payments.reduce((sum, row) => sum + row.amount, 0),
      recurringMonthly: records.recurringServices
        .filter((service) => service.currency === currency && String(service.status || '').toLowerCase() === 'active')
        .reduce((sum, service) => sum + monthlyEquivalent(service.amount, service.billingFrequency), 0)
        + records.hosting.filter((row) => row.currency === currency && Number(row.amount) > 0 && String(row.status || '').toLowerCase() === 'active')
          .reduce((sum, row) => sum + monthlyEquivalent(row.amount, row.billing_frequency), 0)
        + records.domains.filter((row) => row.currency === currency && Number(row.renewal_amount) > 0 && !/expired|cancelled|inactive/i.test(String(row.renewal_status || '')))
          .reduce((sum, row) => sum + Number(row.renewal_amount) / 12, 0),
    };
  }, [records, currency]);

  const invoiceEstimate = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unitPrice) || 0), 0);
    const tax = subtotal * Math.max(0, Number(taxRate) || 0) / 100;
    return { subtotal, tax, total: subtotal + tax };
  }, [items, taxRate]);

  const updateItem = (index, key, value) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  };

  const createInvoice = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveClientAccountingRecord(clientId, { type: 'invoice', currency, issueDate, dueDate, taxRate, status: invoiceStatus, lineItems: items });
      setItems([newLine()]);
      setTaxRate(0);
      setMode('');
      await load();
      onSaved?.();
      showNotification?.('Invoice created. Its balance is ready for payment tracking.');
    } catch (reason) {
      setError(reason?.message || 'Could not create the invoice.');
    } finally {
      setBusy(false);
    }
  };

  const recordPayment = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveClientAccountingRecord(clientId, { type: 'payment', ...payment, currency: selectedInvoice?.currency || currency, amount: Number(payment.amount) });
      setPayment({ invoiceId: '', paymentDate: today(), amount: '', paymentMethod: 'Bank transfer', transactionReference: '', description: '' });
      setMode('');
      await load();
      onSaved?.();
      showNotification?.('Payment recorded and receipt issued.');
    } catch (reason) {
      setError(reason?.message || 'Could not record the payment.');
    } finally {
      setBusy(false);
    }
  };

  const selectedInvoice = records.invoices.find((invoice) => invoice.id === payment.invoiceId);
  const startEditingService = (service) => {
    setEditingServiceId(service.id);
    setServiceForm({
      serviceName: service.serviceName,
      serviceType: service.serviceType,
      description: service.description,
      amount: String(service.amount),
      currency: service.currency,
      billingFrequency: service.billingFrequency,
      startDate: service.startDate,
      nextDueDate: service.nextDueDate,
      status: service.status,
    });
    setMode('service');
  };
  const startNewRecurringService = () => {
    setEditingServiceId('');
    setServiceForm({ ...newRecurringService(), currency });
    setMode('service');
  };
  const saveRecurringService = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { ...serviceForm, amount: Number(serviceForm.amount) };
      if (editingServiceId) await updateClientRecurringService(clientId, editingServiceId, payload);
      else await createClientRecurringService(clientId, payload);
      setServiceForm(newRecurringService());
      setEditingServiceId('');
      setMode('');
      await load();
      onSaved?.();
      showNotification?.(editingServiceId ? 'Recurring service updated.' : 'Recurring service added to the schedule.');
    } catch (reason) {
      setError(reason?.message || 'Could not save this recurring service.');
    } finally {
      setBusy(false);
    }
  };
  const updateRecurringStatus = async (service, status) => {
    setBusy(true);
    setError('');
    try {
      await updateClientRecurringService(clientId, service.id, {
        serviceName: service.serviceName,
        serviceType: service.serviceType,
        description: service.description,
        amount: service.amount,
        currency: service.currency,
        billingFrequency: service.billingFrequency,
        startDate: service.startDate,
        nextDueDate: service.nextDueDate,
        status,
      });
      await load();
      onSaved?.();
      showNotification?.(`Recurring service ${status.toLowerCase()}.`);
    } catch (reason) {
      setError(reason?.message || 'Could not update the recurring service.');
    } finally {
      setBusy(false);
    }
  };
  const createRecurringInvoice = async (service) => {
    setBusy(true);
    setError('');
    try {
      const result = await invoiceClientRecurringService(clientId, service.id);
      await load();
      onSaved?.();
      showNotification?.(`Invoice ${result.invoiceNumber || ''} created for ${service.serviceName}.`);
    } catch (reason) {
      setError(reason?.message || 'Could not invoice this recurring service.');
    } finally {
      setBusy(false);
    }
  };
  const startEditingAsset = (line) => {
    setAssetEditing(line);
    setAssetDraft({ amount: line.amount == null ? '' : String(line.amount), currency: line.currency || 'USD' });
  };
  const saveAssetPricing = async (event) => {
    event.preventDefault();
    if (!assetEditing) return;
    setBusy(true);
    setError('');
    try {
      const amount = assetDraft.amount.trim() === '' ? null : Number(assetDraft.amount);
      await updateClientAccountingAsset(clientId, assetEditing.assetType, assetEditing.id, {
        ...(assetEditing.assetType === 'hosting' ? { amount } : { renewalAmount: amount }),
        currency: assetDraft.currency,
      });
      setAssetEditing(null);
      await load();
      onSaved?.();
      showNotification?.('Renewal pricing saved.');
    } catch (reason) {
      setError(reason?.message || 'Could not save renewal pricing.');
    } finally {
      setBusy(false);
    }
  };
  const saveTrackedAsset = async (event) => {
    event.preventDefault();
    if (!creatingAsset) return;
    setBusy(true);
    setError('');
    try {
      const payload = creatingAsset === 'hosting'
        ? { ...trackedAssetForm, amount: trackedAssetForm.amount === '' ? 0 : Number(trackedAssetForm.amount) }
        : {
          ...trackedAssetForm,
          renewalAmount: trackedAssetForm.renewalAmount === '' ? null : Number(trackedAssetForm.renewalAmount),
          nameservers: trackedAssetForm.nameservers.split(/[\r\n,]+/).map((value) => value.trim()).filter(Boolean),
        };
      await createClientAccountingAsset(clientId, creatingAsset, payload);
      const createdType = creatingAsset;
      setCreatingAsset('');
      setTrackedAssetForm(newTrackedAsset('hosting', currency));
      await load();
      onSaved?.();
      showNotification?.(createdType === 'hosting' ? 'Hosting plan added to this client.' : 'Domain added to this client.');
    } catch (reason) {
      setError(reason?.message || 'Could not add this client asset.');
    } finally {
      setBusy(false);
    }
  };
  const voidPayment = async (event) => {
    event.preventDefault();
    if (!voidingPayment) return;
    setBusy(true);
    setError('');
    try {
      await voidClientAccountingPayment(clientId, voidingPayment.id, voidReason);
      setVoidingPayment(null);
      setVoidReason('');
      await load();
      onSaved?.();
      showNotification?.('Payment receipt voided and audit record saved.');
    } catch (reason) {
      setError(reason?.message || 'Could not void this payment.');
    } finally {
      setBusy(false);
    }
  };
  const followupSaved = async () => {
    setFollowupInvoice(null);
    await load();
    await onSaved?.();
    showNotification?.('Follow-up saved to history. No email was sent.');
  };
  const serviceLines = [
    ...records.hosting.map((item) => ({ id: item.id, assetType: 'hosting', name: item.website_name || item.plan || 'Hosting', type: 'Hosting', detail: `${item.provider || 'Provider'} · ${item.billing_frequency || 'Recurring'} · ${item.status || 'Active'}`, amount: Number(item.amount || 0), currency: item.currency || 'USD', due: item.renewal_date })),
    ...records.domains.map((item) => ({ id: item.id, assetType: 'domain', name: item.domain_name || 'Domain', type: 'Domain', detail: `${item.registrar || 'Registrar'} · ${item.renewal_status || 'Active'}`, amount: item.renewal_amount == null ? null : Number(item.renewal_amount), currency: item.currency || 'USD', due: item.expiration_date })),
  ];

  return (
    <div className="crm-inline-a507d6cce5">
      <div className="crm-inline-847d620c36">
        <div>
          <h3 className="crm-inline-108932eb67">Client accounting</h3>
          <p className="crm-inline-1297139dd2">Invoices, payments, receipts, and tracked hosting/domain renewals for this client.</p>
        </div>
        <div className="crm-inline-b41dbad860">
          <select aria-label="Accounting currency" className="crm-themed-form-control crm-themed-form-control--accounting crm-themed-form-control--auto-width" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {['USD', 'EUR', 'GBP', 'UAH'].map((value) => <option key={value}>{value}</option>)}
          </select>
          {canEdit ? <>
            <button type="button" className="aw-button aw-button-quiet" onClick={() => setMode(mode === 'invoice' ? '' : 'invoice')}>New invoice</button>
            <button type="button" className="aw-button aw-button-primary" onClick={() => setMode(mode === 'payment' ? '' : 'payment')}>Record payment</button>
          </> : <span className="crm-inline-8a31515267">Read-only access</span>}
        </div>
      </div>

      <div className="crm-inline-0596749e45">
        {[
          ['Invoiced', totals.billed],
          ['Received', totals.received],
          ['Outstanding', totals.outstanding],
        ].map(([label, value]) => (
          <div key={label} className="crm-accounting-panel">
            <div className="crm-inline-cb8f3567cb">{label} · {currency}</div>
            <div className="crm-inline-36fac4b2ca">{money(value, currency)}</div>
          </div>
        ))}
      </div>

      {error && <div role="alert" className="crm-inline-a8ec97f0b6">{error}</div>}

      {canEdit && mode === 'service' && (
        <form onSubmit={saveRecurringService} className="crm-accounting-panel" data-testid="form-recurring-service">
          <h4 className="crm-inline-ff227d0632">{editingServiceId ? 'Edit recurring service' : 'Add recurring service'}</h4>
          <label className="crm-inline-309a4096b8">Service name
            <input required maxLength={191} className="crm-themed-form-control crm-themed-form-control--accounting" value={serviceForm.serviceName} onChange={(event) => setServiceForm({ ...serviceForm, serviceName: event.target.value })} placeholder="Monthly maintenance plan" />
          </label>
          <label className="crm-inline-309a4096b8">Service type
            <select className="crm-themed-form-control crm-themed-form-control--accounting" value={serviceForm.serviceType} onChange={(event) => setServiceForm({ ...serviceForm, serviceType: event.target.value })}>
              {['Hosting', 'Domain', 'Custom email', 'Site maintenance', 'Support', 'Other'].map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label className="crm-inline-309a4096b8">Description
            <input className="crm-themed-form-control crm-themed-form-control--accounting" value={serviceForm.description} onChange={(event) => setServiceForm({ ...serviceForm, description: event.target.value })} placeholder="Service scope or agreement reference" />
          </label>
          <label className="crm-inline-309a4096b8">Amount
            <input required type="number" min="0.01" max="100000000" step="0.01" className="crm-themed-form-control crm-themed-form-control--accounting" value={serviceForm.amount} onChange={(event) => setServiceForm({ ...serviceForm, amount: event.target.value })} />
          </label>
          <label className="crm-inline-309a4096b8">Currency
            <select className="crm-themed-form-control crm-themed-form-control--accounting" value={serviceForm.currency} onChange={(event) => setServiceForm({ ...serviceForm, currency: event.target.value })}>
              {['USD', 'EUR', 'GBP', 'UAH'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="crm-inline-309a4096b8">Billing frequency
            <select className="crm-themed-form-control crm-themed-form-control--accounting" value={serviceForm.billingFrequency} onChange={(event) => setServiceForm({ ...serviceForm, billingFrequency: event.target.value })}>
              <option value="Monthly">Monthly</option>
              <option value="Yearly">Yearly</option>
            </select>
          </label>
          <label className="crm-inline-309a4096b8">Start date
            <input required type="date" className="crm-themed-form-control crm-themed-form-control--accounting" value={serviceForm.startDate} onChange={(event) => setServiceForm({ ...serviceForm, startDate: event.target.value })} />
          </label>
          <label className="crm-inline-309a4096b8">Next invoice due
            <input required type="date" className="crm-themed-form-control crm-themed-form-control--accounting" value={serviceForm.nextDueDate} onChange={(event) => setServiceForm({ ...serviceForm, nextDueDate: event.target.value })} />
          </label>
          {editingServiceId && <label className="crm-inline-309a4096b8">Status
            <select className="crm-themed-form-control crm-themed-form-control--accounting" value={serviceForm.status} onChange={(event) => setServiceForm({ ...serviceForm, status: event.target.value })}>
              {['Active', 'Paused', 'Cancelled'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>}
          <div className="crm-inline-0cac2cd08b">
            <button type="submit" className="aw-button aw-button-primary" disabled={busy} data-testid="button-save-recurring-service">{busy ? 'Saving…' : editingServiceId ? 'Save changes' : 'Add service schedule'}</button>
            <button type="button" className="aw-button aw-button-quiet" disabled={busy} onClick={() => { setMode(''); setEditingServiceId(''); }}>Cancel</button>
          </div>
          <p className="crm-inline-9c0b477b75">A schedule tracks the billing cycle; it does not automatically charge the client. Invoices are issued separately.</p>
        </form>
      )}

      <div className="crm-accounting-panel">
        <div className="crm-inline-847d620c36">
          <h4 className="crm-inline-e40c8fc448">Recurring services</h4>
          {canEdit && <button type="button" className="aw-button aw-button-quiet" onClick={startNewRecurringService} data-testid="button-add-recurring-service">Add recurring service</button>}
        </div>
        {loading ? <p className="crm-inline-f6c04024cd">Loading recurring services…</p> : records.recurringServices.length === 0
          ? <p className="crm-inline-14ada2b4f3">No recurring services are scheduled for this client.</p>
          : <div className="crm-inline-f2f5079698">
            {records.recurringServices.map((service) => <div key={service.id} className="crm-accounting-panel" data-testid={`row-recurring-service-${service.id}`}>
              <strong>{service.serviceName}</strong>
              <div className="crm-inline-26fbcf6adb">{service.serviceType} · {service.description || 'No description'}</div>
              <div className="crm-inline-eebee80252">{money(service.amount, service.currency)} · {service.billingFrequency} · Next due {service.nextDueDate} · {service.status}</div>
              {canEdit && <div className="crm-inline-0cac2cd08b">
                {String(service.status).toLowerCase() === 'active' && <button type="button" className="aw-button aw-button-primary" disabled={busy} onClick={() => createRecurringInvoice(service)} data-testid={`button-invoice-recurring-service-${service.id}`}>Create invoice</button>}
                <button type="button" className="aw-button aw-button-quiet" disabled={busy} onClick={() => startEditingService(service)} data-testid={`button-edit-recurring-service-${service.id}`}>Edit</button>
                {['Active', 'Paused'].includes(service.status) && <button type="button" className="aw-button aw-button-quiet" disabled={busy} onClick={() => updateRecurringStatus(service, service.status === 'Active' ? 'Paused' : 'Active')} data-testid={`button-toggle-recurring-service-${service.id}`}>{service.status === 'Active' ? 'Pause' : 'Resume'}</button>}
              </div>}
            </div>)}
          </div>}
      </div>

      {canEdit && followupInvoice && <div className="aw-followup-inline" data-testid="panel-followup-form">
        <div className="aw-followup-inline-heading"><h4>Log invoice follow-up</h4><button type="button" className="aw-button aw-button-quiet" onClick={() => setFollowupInvoice(null)}>Close</button></div>
        <InvoiceFollowupForm clientId={clientId} clientName={clientName} invoice={followupInvoice} onCancel={() => setFollowupInvoice(null)} onSaved={followupSaved} />
      </div>}

      {canEdit && mode === 'invoice' && (
        <form onSubmit={createInvoice} className="crm-accounting-panel crm-accounting-panel--invoice-form">
          <h4 className="crm-inline-ff227d0632">Create client invoice</h4>
          {items.map((item, index) => (
            <div key={index} className="crm-inline-97d49b5f69">
              <label className="crm-inline-309a4096b8">Service
                <select className="crm-themed-form-control crm-themed-form-control--accounting" value={item.service} onChange={(e) => updateItem(index, 'service', e.target.value)}>
                  {['Project creation', 'Website creation', 'Hosting', 'Domain', 'Custom email', 'Site maintenance', 'Maintenance', 'Support', 'Other'].map((name) => <option key={name}>{name}</option>)}
                </select>
              </label>
              <label className="crm-inline-309a4096b8">Description
                <input required className="crm-themed-form-control crm-themed-form-control--accounting" value={item.description} onChange={(e) => updateItem(index, 'description', e.target.value)} placeholder="Website build, annual hosting…" />
              </label>
              <label className="crm-inline-309a4096b8">Qty
                <input required type="number" min="0.01" step="0.01" className="crm-themed-form-control crm-themed-form-control--accounting" value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)} />
              </label>
              <label className="crm-inline-309a4096b8">Unit price
                <input required type="number" min="0" step="0.01" className="crm-themed-form-control crm-themed-form-control--accounting" value={item.unitPrice} onChange={(e) => updateItem(index, 'unitPrice', e.target.value)} />
              </label>
              <button type="button" className="aw-row-action aw-item-remove" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, i) => i !== index))} aria-label="Remove invoice item">Remove</button>
            </div>
          ))}
          <div className="crm-inline-0cac2cd08b">
            <button type="button" className="aw-button aw-button-quiet" onClick={() => setItems((current) => [...current, newLine()])}>+ Add service</button>
            <label className="crm-inline-bb812ffe30">Tax %
              <input type="number" min="0" max="100" step="0.01" className="crm-themed-form-control crm-themed-form-control--accounting crm-themed-form-control--narrow" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
            </label>
            <label className="crm-inline-bb812ffe30">Issue date
              <input type="date" className="crm-themed-form-control crm-themed-form-control--accounting crm-themed-form-control--auto-width" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </label>
            <label className="crm-inline-bb812ffe30">Due date
              <input type="date" className="crm-themed-form-control crm-themed-form-control--accounting crm-themed-form-control--auto-width" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <label className="crm-inline-bb812ffe30">Status
              <select className="crm-themed-form-control crm-themed-form-control--accounting crm-themed-form-control--auto-width" value={invoiceStatus} onChange={(e) => setInvoiceStatus(e.target.value)}><option value="Pending">Pending · visible in portal</option><option value="Draft">Keep as draft</option></select>
            </label>
            <strong className="crm-inline-538764830f">Total: {money(invoiceEstimate.total, currency)}</strong>
            <button className="aw-button aw-button-primary" disabled={busy}>{busy ? 'Saving…' : 'Create invoice'}</button>
          </div>
          <p className="crm-inline-9c0b477b75">Pending invoices are visible in the client portal. Creating one does not send an email or charge the client.</p>
        </form>
      )}

      {canEdit && mode === 'payment' && (
        <form onSubmit={recordPayment} className="crm-accounting-panel crm-accounting-panel--payment-form">
          <h4 className="crm-inline-283098717c">Record a payment and issue a receipt</h4>
          <label className="crm-inline-309a4096b8">Apply to invoice
            <select className="crm-themed-form-control crm-themed-form-control--accounting" value={payment.invoiceId} onChange={(e) => {
              const invoice = records.invoices.find((row) => row.id === e.target.value);
              setPayment((current) => ({ ...current, invoiceId: e.target.value, amount: invoice ? String(invoice.balanceDue) : current.amount }));
              if (invoice) setCurrency(invoice.currency);
            }}>
              <option value="">Unallocated payment</option>
              {records.invoices.filter((invoice) => invoice.balanceDue > 0 && invoice.status !== 'Draft').map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {money(invoice.balanceDue, invoice.currency)} due</option>)}
            </select>
          </label>
          <label className="crm-inline-309a4096b8">Amount ({selectedInvoice?.currency || currency})
            <input required type="number" min="0.01" step="0.01" max={selectedInvoice ? selectedInvoice.balanceDue : undefined} className="crm-themed-form-control crm-themed-form-control--accounting" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} />
          </label>
          <label className="crm-inline-309a4096b8">Date received
            <input required type="date" className="crm-themed-form-control crm-themed-form-control--accounting" value={payment.paymentDate} onChange={(e) => setPayment({ ...payment, paymentDate: e.target.value })} />
          </label>
          <label className="crm-inline-309a4096b8">Method
            <select className="crm-themed-form-control crm-themed-form-control--accounting" value={payment.paymentMethod} onChange={(e) => setPayment({ ...payment, paymentMethod: e.target.value })}>{['Bank transfer', 'Card', 'Cash', 'PayPal', 'Other'].map((name) => <option key={name}>{name}</option>)}</select>
          </label>
          <label className="crm-inline-309a4096b8">Reference
            <input className="crm-themed-form-control crm-themed-form-control--accounting" value={payment.transactionReference} onChange={(e) => setPayment({ ...payment, transactionReference: e.target.value })} placeholder="Bank or transaction reference" />
          </label>
          <button className="aw-button aw-button-primary" disabled={busy}>{busy ? 'Saving…' : 'Record & issue receipt'}</button>
          {selectedInvoice && <span className="crm-inline-ac75097fa4">Remaining after payment: {money(Math.max(0, selectedInvoice.balanceDue - (Number(payment.amount) || 0)), selectedInvoice.currency)}</span>}
        </form>
      )}

      {canEdit && voidingPayment && (
        <form onSubmit={voidPayment} className="crm-accounting-panel crm-accounting-panel--danger-form" data-testid="form-void-payment">
          <h4 className="crm-inline-ff227d0632">Void receipt {voidingPayment.receiptNumber || ''}</h4>
          <p className="crm-inline-14ada2b4f3">
            The receipt will remain in the ledger. Its invoice balance will be recalculated and this reason will be recorded in the audit log.
          </p>
          <label className="crm-inline-309a4096b8">Reason (required)
            <textarea required minLength={5} maxLength={500} rows={3} className="crm-themed-form-control crm-themed-form-control--accounting" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Explain why this receipt should be voided" data-testid="input-payment-void-reason" />
          </label>
          <div className="crm-inline-f3ecc27eca">
            <button type="button" className="aw-button aw-button-quiet" disabled={busy} onClick={() => { setVoidingPayment(null); setVoidReason(''); }}>Cancel</button>
            <button className="aw-button aw-button-danger" disabled={busy || voidReason.trim().length < 5} data-testid="button-confirm-payment-void">{busy ? 'Saving…' : 'Void receipt'}</button>
          </div>
        </form>
      )}

      <div className="crm-accounting-panel crm-accounting-panel--scrollable">
        <h4 className="crm-inline-e40c8fc448">Invoices</h4>
        <div className="aw-ledger-mobile-hint">Swipe horizontally to review all invoice columns.</div>
        {loading ? <p className="crm-inline-f6c04024cd">Loading…</p> : records.invoices.length === 0 ? <p className="crm-inline-f6c04024cd">No invoices yet. Create one to start tracking services, amounts, and due dates.</p> : (
          <div className="aw-ledger-detail-scroll" role="region" tabIndex="0" aria-label="Client invoice records. Scroll horizontally to review all columns.">
          <table className="aw-ledger-detail-table crm-inline-bc0dba4e98" >
            <thead><tr>{['Invoice', 'Services', 'Issued', 'Due', 'Total', 'Paid', 'Balance', 'Status', ...(canEdit ? ['Follow-up'] : [])].map((heading) => <th key={heading} className="crm-inline-4c2fa14780">{heading}</th>)}</tr></thead>
            <tbody>{records.invoices.map((invoice) => (
              <tr key={invoice.id} className="crm-inline-29c888978e">
                <td className="crm-inline-a3dd7fd085">{invoice.invoiceNumber}</td><td className="crm-inline-a3dd7fd085">{invoice.lineItems.map((item) => item.service || item.description).join(', ') || 'Agency services'}</td>
                <td className="crm-inline-a3dd7fd085">{invoice.issueDate}</td><td className="crm-inline-a3dd7fd085">{invoice.dueDate}</td><td className="crm-inline-a3dd7fd085">{money(invoice.total, invoice.currency)}</td><td className="crm-inline-a3dd7fd085">{money(invoice.amountPaid, invoice.currency)}</td><td className="crm-inline-a3dd7fd085">{money(invoice.balanceDue, invoice.currency)}</td><td className="crm-inline-a3dd7fd085">{invoice.status}</td>
                {canEdit && <td className="crm-inline-a3dd7fd085">{invoice.balanceDue > 0 && String(invoice.status || '').toLowerCase() !== 'draft'
                  ? <button type="button" className="aw-row-action" onClick={() => setFollowupInvoice(invoice)} data-testid={`button-log-invoice-followup-${invoice.id}`}>Log follow-up</button>
                  : <span className="crm-inline-ab7671bd0d">—</span>}</td>}
              </tr>
            ))}</tbody>
          </table>
          </div>
        )}
      </div>

      <div className="aw-followup-history crm-accounting-panel" data-testid="panel-followup-history">
        <div className="aw-followup-history-heading"><div><h4>Invoice follow-up history</h4><p>Contact notes are internal records; they do not send messages.</p></div><span>{records.followups.length} logged</span></div>
        {loading ? <p className="aw-followup-empty">Loading follow-up history…</p> : records.followups.length === 0
          ? <p className="aw-followup-empty">No follow-ups have been logged for this client.</p>
          : <div className="aw-followup-list">{records.followups.map((row) => <article className="aw-followup-entry" key={row.id} data-testid={`row-invoice-followup-${row.id}`}>
            <div className="aw-followup-entry-meta"><strong>{row.invoice_number || 'Invoice'}</strong><span>{row.contact_date} · {{ email: 'Email contact (logged only)', phone: 'Phone call', meeting: 'Meeting', other: 'Other' }[row.contact_method] || 'Contact'}</span></div>
            <p>{row.note}</p>
            <div className="aw-followup-entry-footer"><span>{row.staff_name ? `Recorded by ${row.staff_name}` : 'Recorded by admin'}</span>{row.next_follow_up_date && <strong>Next follow-up · {row.next_follow_up_date}</strong>}</div>
          </article>)}</div>}
      </div>

      <div className="crm-accounting-panel crm-accounting-panel--scrollable">
        <h4 className="crm-inline-e40c8fc448">Payment receipts</h4>
        <div className="aw-ledger-mobile-hint">Swipe horizontally to review all receipt columns.</div>
        {!loading && records.payments.length === 0 ? <p className="crm-inline-f6c04024cd">No payments recorded yet.</p> : (
          <div className="aw-ledger-detail-scroll" role="region" tabIndex="0" aria-label="Client payment receipts. Scroll horizontally to review all columns.">
          <table className="aw-ledger-receipt-table crm-inline-bc0dba4e98" >
            <thead><tr>{['Receipt', 'Date', 'Linked invoice', 'Method', 'Reference', 'Amount', 'Status', ...(canEdit ? ['Action'] : [])].map((heading) => <th key={heading} className="crm-inline-4c2fa14780">{heading}</th>)}</tr></thead>
            <tbody>{records.payments.map((row) => {
              const invoice = records.invoices.find((candidate) => candidate.id === row.invoiceId);
              const isVoided = String(row.status || '').toLowerCase() === 'voided';
              return <tr key={row.id} className="crm-inline-29c888978e" data-testid={`row-payment-receipt-${row.id}`}>
                <td className="crm-inline-a3dd7fd085">{row.receiptNumber}</td><td className="crm-inline-a3dd7fd085">{row.paymentDate}</td><td className="crm-inline-a3dd7fd085">{invoice?.invoiceNumber || 'Unallocated'}</td><td className="crm-inline-a3dd7fd085">{row.paymentMethod || '—'}</td><td className="crm-inline-a3dd7fd085">{row.transactionReference || '—'}</td>
                <td className="crm-inline-a3dd7fd085" style={{textDecoration: isVoided ? 'line-through' : 'none'}}>{money(row.amount, invoice?.currency || row.currency || currency)}</td>
                <td className="crm-inline-a3dd7fd085">
                  <span style={{ color: isVoided ? '#dda18e' : 'var(--crm-text-primary, #fff)' }}>{row.status || 'Completed'}</span>
                  {isVoided && row.void_reason && <small className="crm-inline-119cdf39ab" title={row.void_reason}>Reason: {row.void_reason}</small>}
                  {isVoided && (row.voided_by || row.voided_at) && <small className="crm-inline-57f1addd15">Audit: {row.voided_by || 'Admin'} · {row.voided_at || 'Date unavailable'}</small>}
                </td>
                {canEdit && <td className="crm-inline-a3dd7fd085">{!isVoided && ['completed', 'received', 'paid', 'partially paid'].includes(String(row.status || '').toLowerCase())
                  ? <button type="button" className="aw-row-action aw-item-remove" disabled={busy} onClick={() => { setVoidingPayment(row); setVoidReason(''); }} data-testid={`button-void-payment-${row.id}`}>Void</button>
                  : isVoided ? <span className="crm-inline-8a31515267">Voided</span> : '—'}</td>}
              </tr>;
            })}</tbody>
          </table>
          </div>
        )}
      </div>

      <div className="crm-accounting-panel">
        <div className="crm-inline-847d620c36">
          <div>
            <h4 className="crm-inline-e40c8fc448">Tracked hosting and domain services</h4>
            <p className="crm-inline-14ada2b4f3">These details appear in this client’s portal. Adding an asset does not create an invoice.</p>
          </div>
          {canEdit && <div className="crm-inline-0cac2cd08b">
            <button type="button" className="aw-button aw-button-quiet" onClick={() => {
              const next = creatingAsset === 'hosting' ? '' : 'hosting';
              setCreatingAsset(next);
              setTrackedAssetForm(newTrackedAsset(next || 'hosting', currency));
            }}>Add hosting</button>
            <button type="button" className="aw-button aw-button-quiet" onClick={() => {
              const next = creatingAsset === 'domain' ? '' : 'domain';
              setCreatingAsset(next);
              setTrackedAssetForm(newTrackedAsset(next || 'hosting', currency));
            }}>Add domain</button>
          </div>}
        </div>
        {canEdit && creatingAsset && (
          <form onSubmit={saveTrackedAsset} className="crm-accounting-panel" data-testid={`form-add-${creatingAsset}`}>
            <h4 className="crm-inline-283098717c">Add {creatingAsset === 'hosting' ? 'hosting plan' : 'domain'}</h4>
            <div className="crm-inline-f2f5079698">
              {creatingAsset === 'hosting' ? <>
                <label className="crm-inline-309a4096b8">Website or service name
                  <input required maxLength={191} className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.websiteName} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, websiteName: event.target.value })} placeholder="Main website" />
                </label>
                <label className="crm-inline-309a4096b8">Hosting plan
                  <input required maxLength={191} className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.plan} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, plan: event.target.value })} placeholder="Managed cloud hosting" />
                </label>
                <label className="crm-inline-309a4096b8">Provider
                  <input maxLength={191} className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.provider} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, provider: event.target.value })} placeholder="Hosting provider" />
                </label>
                <label className="crm-inline-309a4096b8">Status
                  <select className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.status} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, status: event.target.value })}>
                    {['Active', 'Maintenance', 'Suspended'].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="crm-inline-309a4096b8">Start date
                  <input type="date" className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.startDate} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, startDate: event.target.value })} />
                </label>
                <label className="crm-inline-309a4096b8">Renewal date
                  <input type="date" className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.renewalDate} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, renewalDate: event.target.value })} />
                </label>
                <label className="crm-inline-309a4096b8">Billing frequency
                  <select className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.billingFrequency} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, billingFrequency: event.target.value })}>
                    <option value="Monthly">Monthly</option><option value="Annual">Annual</option>
                  </select>
                </label>
                <label className="crm-inline-309a4096b8">Renewal amount
                  <input type="number" min="0" max="100000000" step="0.01" className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.amount} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, amount: event.target.value })} />
                </label>
                <label className="crm-inline-309a4096b8">Currency
                  <select className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.currency} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, currency: event.target.value })}>
                    {['USD', 'EUR', 'GBP', 'UAH', 'CAD', 'AUD', 'CHF', 'PLN'].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="crm-inline-309a4096b8">Server region
                  <input maxLength={191} className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.serverRegion} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, serverRegion: event.target.value })} placeholder="e.g. London, UK" />
                </label>
                <label className="crm-inline-309a4096b8">IP address
                  <input maxLength={191} className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.ipAddress} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, ipAddress: event.target.value })} placeholder="Optional" />
                </label>
                <label className="crm-inline-309a4096b8">Uptime guarantee
                  <input maxLength={64} className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.uptime} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, uptime: event.target.value })} />
                </label>
                <label className="crm-inline-309a4096b8">Auto-renewal
                  <select className="crm-themed-form-control crm-themed-form-control--accounting" value={String(trackedAssetForm.autoRenew)} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, autoRenew: event.target.value === 'true' })}>
                    <option value="true">Enabled</option><option value="false">Manual renewal</option>
                  </select>
                </label>
              </> : <>
                <label className="crm-inline-309a4096b8">Domain name
                  <input required maxLength={253} className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.domainName} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, domainName: event.target.value })} placeholder="example.com" />
                </label>
                <label className="crm-inline-309a4096b8">Registrar
                  <input maxLength={191} className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.registrar} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, registrar: event.target.value })} placeholder="Registrar" />
                </label>
                <label className="crm-inline-309a4096b8">Registration date
                  <input type="date" className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.registrationDate} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, registrationDate: event.target.value })} />
                </label>
                <label className="crm-inline-309a4096b8">Expiry date
                  <input type="date" className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.expirationDate} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, expirationDate: event.target.value })} />
                </label>
                <label className="crm-inline-309a4096b8">Renewal status
                  <select className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.renewalStatus} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, renewalStatus: event.target.value })}>
                    {['Auto-Renew Active', 'Manual Renewal Required', 'Expiring Soon - Action Required', 'Expired', 'Cancelled'].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="crm-inline-309a4096b8">SSL status
                  <select className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.sslStatus} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, sslStatus: event.target.value })}>
                    <option value="">Not monitored</option><option value="Active">Active</option><option value="Expired">Expired</option><option value="Not installed">Not installed</option>
                  </select>
                </label>
                <label className="crm-inline-309a4096b8">DNSSEC status
                  <select className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.dnssecStatus} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, dnssecStatus: event.target.value })}>
                    <option value="">Not monitored</option><option value="Active">Active</option><option value="Inactive">Inactive</option>
                  </select>
                </label>
                <label className="crm-inline-309a4096b8">Annual renewal amount
                  <input type="number" min="0" max="100000000" step="0.01" className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.renewalAmount} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, renewalAmount: event.target.value })} placeholder="Leave blank if unknown" />
                </label>
                <label className="crm-inline-309a4096b8">Currency
                  <select className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.currency} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, currency: event.target.value })}>
                    {['USD', 'EUR', 'GBP', 'UAH', 'CAD', 'AUD', 'CHF', 'PLN'].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </label>
                <label className="crm-inline-309a4096b8">Auto-renewal
                  <select className="crm-themed-form-control crm-themed-form-control--accounting" value={String(trackedAssetForm.autoRenew)} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, autoRenew: event.target.value === 'true' })}>
                    <option value="true">Enabled</option><option value="false">Manual renewal</option>
                  </select>
                </label>
                <label className="crm-inline-309a4096b8">Nameservers
                  <textarea rows={2} className="crm-themed-form-control crm-themed-form-control--accounting" value={trackedAssetForm.nameservers} onChange={(event) => setTrackedAssetForm({ ...trackedAssetForm, nameservers: event.target.value })} placeholder="ns1.example.com, ns2.example.com" />
                </label>
              </>}
            </div>
            <div className="crm-inline-0cac2cd08b">
              <button type="submit" className="aw-button aw-button-primary" disabled={busy} data-testid="button-save-tracked-asset">{busy ? 'Saving…' : `Add ${creatingAsset === 'hosting' ? 'hosting plan' : 'domain'}`}</button>
              <button type="button" className="aw-button aw-button-quiet" disabled={busy} onClick={() => setCreatingAsset('')}>Cancel</button>
            </div>
          </form>
        )}
        {serviceLines.length === 0 ? <p className="crm-inline-14ada2b4f3">No hosting plans or domains are linked to this client yet.</p> : (
          <div className="crm-inline-f2f5079698">
            {serviceLines.map((line, index) => <div key={`${line.type}-${line.id || index}`} className="crm-inline-b579a69c09" data-testid={`card-tracked-asset-${line.assetType}-${line.id}`}>
              <strong className="crm-inline-7a459431c4">{line.name}</strong><div className="crm-inline-26fbcf6adb">{line.type} · {line.detail}</div>
              <div className="crm-inline-eebee80252">{line.amount != null && line.amount > 0 ? `${money(line.amount, line.currency)} · ` : 'Not priced · '}Renewal {line.due || 'not set'}{line.type === 'Domain' && line.amount != null ? ' · annual' : ''}</div>
              {canEdit && <button type="button" className="aw-row-action aw-edit-renewal" onClick={() => startEditingAsset(line)} data-testid={`button-edit-renewal-${line.assetType}-${line.id}`}>{line.amount != null && line.amount > 0 ? 'Edit renewal price' : 'Add renewal price'}</button>}
            </div>)}
          </div>
        )}
      </div>

      {canEdit && assetEditing && (
        <form onSubmit={saveAssetPricing} className="crm-accounting-panel crm-accounting-panel--asset-form" data-testid="form-asset-renewal-price">
          <h4 className="crm-inline-283098717c">Renewal price · {assetEditing.name}</h4>
          <label className="crm-inline-309a4096b8">Amount {assetEditing.assetType === 'domain' ? '(annual, blank = unpriced)' : '(blank not allowed)'}
            <input type="number" min={assetEditing.assetType === 'domain' ? '0' : '0'} step="0.01" className="crm-themed-form-control crm-themed-form-control--accounting" value={assetDraft.amount} onChange={(event) => setAssetDraft((current) => ({ ...current, amount: event.target.value }))} placeholder={assetEditing.assetType === 'domain' ? 'Not priced' : '0.00'} data-testid="input-asset-renewal-amount" />
          </label>
          <label className="crm-inline-309a4096b8">Currency
            <select className="crm-themed-form-control crm-themed-form-control--accounting" value={assetDraft.currency} onChange={(event) => setAssetDraft((current) => ({ ...current, currency: event.target.value }))} data-testid="select-asset-renewal-currency">
              {[...new Set([assetDraft.currency, 'USD', 'EUR', 'GBP', 'UAH', 'CAD', 'AUD', 'CHF', 'PLN'].filter(Boolean))].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <button type="submit" className="aw-button aw-button-primary" disabled={busy || (assetEditing.assetType === 'hosting' && assetDraft.amount.trim() === '')} data-testid="button-save-renewal-price">{busy ? 'Saving…' : 'Save price'}</button>
          <button type="button" className="aw-button aw-button-quiet" disabled={busy} onClick={() => setAssetEditing(null)}>Cancel</button>
        </form>
      )}
    </div>
  );
}