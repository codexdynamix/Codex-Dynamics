import React, { useEffect, useState } from 'react';
import { getClientAccessAdmin, saveClientAccessAdmin } from '../adminApi.js';

const emptyAccess = {
  websiteUrl: '',
  publicWebsiteUrl: '',
  websiteUsername: '',
  emailAddress: '',
  webmailUrl: '',
  imapHost: 'imap.hostinger.com',
  imapPort: 993,
  smtpHost: 'smtp.hostinger.com',
  smtpPort: 465,
  hasWebsitePassword: false,
  hasEmailPassword: false,
};

function Field({ label, children }) {
  return (
    <label className="crm-inline-45536971bb">
      {label}
      {children}
    </label>
  );
}

export default function ClientAccessEditor({ clientId, showNotification, canEdit = true }) {
  const [access, setAccess] = useState(emptyAccess);
  const [websitePassword, setWebsitePassword] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    getClientAccessAdmin(clientId)
      .then((value) => active && setAccess({ ...emptyAccess, ...(value || {}) }))
      .catch((reason) => active && setError(reason?.message || 'Could not load saved access details.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [clientId]);

  const update = (key, value) => setAccess((current) => ({ ...current, [key]: value }));

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await saveClientAccessAdmin(clientId, { ...access, websitePassword, emailPassword });
      setWebsitePassword('');
      setEmailPassword('');
      setAccess((current) => ({
        ...current,
        hasWebsitePassword: current.hasWebsitePassword || Boolean(websitePassword),
        hasEmailPassword: current.hasEmailPassword || Boolean(emailPassword),
      }));
      showNotification?.('Client access details saved securely.');
    } catch (reason) {
      setError(reason?.message || 'Could not save client access details.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="crm-inline-c48346103f">Loading client access…</p>;

  return (
    <form onSubmit={save} className="crm-inline-58babbd6d9">
      <div className="crm-inline-74380c1177">
        <h3 className="crm-inline-a9df14b532">Website back office</h3>
        <p className="crm-inline-0d04252609">
          Clients will see a direct sign-in link and their login details in the portal.
        </p>
        <div className="crm-inline-e27462082f">
          <Field label="Public website URL">
            <input disabled={!canEdit} className="crm-themed-form-control crm-themed-form-control--access" type="url" value={access.publicWebsiteUrl} onChange={(e) => update('publicWebsiteUrl', e.target.value)} placeholder="https://example.com" />
          </Field>
          <Field label="Back-office link">
            <input disabled={!canEdit} className="crm-themed-form-control crm-themed-form-control--access" type="url" value={access.websiteUrl} onChange={(e) => update('websiteUrl', e.target.value)} placeholder="https://example.com/admin" />
          </Field>
          <Field label="Username or email">
            <input disabled={!canEdit} className="crm-themed-form-control crm-themed-form-control--access" value={access.websiteUsername} onChange={(e) => update('websiteUsername', e.target.value)} autoComplete="off" />
          </Field>
          <Field label={`Password${access.hasWebsitePassword ? ' (saved; leave blank to keep)' : ''}`}>
            {canEdit
              ? <input className="crm-themed-form-control crm-themed-form-control--access" type="password" value={websitePassword} onChange={(e) => setWebsitePassword(e.target.value)} autoComplete="new-password" />
              : <div className="crm-themed-form-control crm-themed-form-control--access crm-themed-form-control--value">{access.hasWebsitePassword ? 'Saved securely · value hidden' : 'Not set'}</div>}
          </Field>
        </div>
      </div>

      <div className="crm-inline-74380c1177">
        <h3 className="crm-inline-a9df14b532">Email inbox</h3>
        <p className="crm-inline-0d04252609">
          Configure the mailbox once. The client can read and reply inside their portal; the password stays encrypted on the server.
        </p>
        <div className="crm-inline-e27462082f">
          <Field label="Email address">
            <input disabled={!canEdit} className="crm-themed-form-control crm-themed-form-control--access" type="email" value={access.emailAddress} onChange={(e) => update('emailAddress', e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Hostinger Webmail link">
            <input disabled={!canEdit} className="crm-themed-form-control crm-themed-form-control--access" type="url" value={access.webmailUrl} onChange={(e) => update('webmailUrl', e.target.value)} placeholder="https://mail.hostinger.com" />
          </Field>
          <Field label={`Email password${access.hasEmailPassword ? ' (saved; leave blank to keep)' : ''}`}>
            {canEdit
              ? <input className="crm-themed-form-control crm-themed-form-control--access" type="password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} autoComplete="new-password" />
              : <div className="crm-themed-form-control crm-themed-form-control--access crm-themed-form-control--value">{access.hasEmailPassword ? 'Saved securely · value hidden' : 'Not set'}</div>}
          </Field>
          <Field label="Incoming mail server (IMAP)">
            <input disabled={!canEdit} className="crm-themed-form-control crm-themed-form-control--access" value={access.imapHost} onChange={(e) => update('imapHost', e.target.value)} placeholder="imap.hostinger.com" />
          </Field>
          <Field label="IMAP port">
            <input disabled={!canEdit} className="crm-themed-form-control crm-themed-form-control--access" type="number" min="1" max="65535" value={access.imapPort} onChange={(e) => update('imapPort', Number(e.target.value))} />
          </Field>
          <Field label="Outgoing mail server (SMTP)">
            <input disabled={!canEdit} className="crm-themed-form-control crm-themed-form-control--access" value={access.smtpHost} onChange={(e) => update('smtpHost', e.target.value)} placeholder="smtp.hostinger.com" />
          </Field>
          <Field label="SMTP port">
            <input disabled={!canEdit} className="crm-themed-form-control crm-themed-form-control--access" type="number" min="1" max="65535" value={access.smtpPort} onChange={(e) => update('smtpPort', Number(e.target.value))} />
          </Field>
        </div>
        <div className="crm-inline-e87d5618c1">
          Standard Hostinger settings are prefilled: IMAP over SSL on 993 and SMTP over SSL on 465. Change them if this mailbox uses different settings.
        </div>
      </div>

      {error && <div role="alert" className="crm-inline-a8ec97f0b6">{error}</div>}
      <div className="crm-inline-847d620c36">
        <span className="crm-inline-8a31515267">
          {canEdit
            ? 'Passwords are encrypted at rest and their saved values stay hidden.'
            : 'Read-only access. Saved passwords remain hidden.'}
        </span>
        {canEdit && (
          <button type="submit" disabled={saving} className="crm-inline-11e0656af0" style={{cursor: saving ? 'wait' : 'pointer'}}>
            {saving ? 'Saving…' : 'Save client access'}
          </button>
        )}
      </div>
    </form>
  );
}