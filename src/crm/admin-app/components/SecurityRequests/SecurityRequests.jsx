import React, { useState, useEffect, useCallback } from 'react';
import { listPasswordResetRequests, sendPasswordResetCode } from '../../adminApi';
import { usePlatformSettings } from '../../../platformDefaults';
import '../modal.css';

function timeAgo(iso) {
  if (!iso) return '-';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function buildEmailTemplate(name, code, platformName) {
  return `Subject: Your ${platformName} Password Reset Code

Dear ${name},

We received a request to reset the password on your ${platformName} account.

Your password reset code is:

    ${code}

This code is valid for 1 hour. Please visit the ${platformName} platform, enter your email address, and use the code above when prompted.

If you did not request a password reset, please ignore this email. Your account remains secure.

Best regards,
${platformName} Support Team`;
}

function CopyTemplate({ name, code, platformName }) {
  const [copied, setCopied] = useState(false);
  const text = buildEmailTemplate(name, code, platformName);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div className="crm-inline-13a252a564">
      <div className="crm-inline-6c8909a197">
        <span className="crm-inline-58fe72ee41">
          [list] Email template - copy &amp; send manually
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="crm-inline-7f1df18f9e" style={{background: copied ? 'rgba(14,203,129,0.15)' : 'transparent', color: copied ? '#0ECB81' : 'var(--crm-text-secondary)'}}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="crm-inline-b9ddfbd8bb">
        {text}
      </pre>
    </div>
  );
}

export default function SecurityRequests({ showNotification }) {
  const settings = usePlatformSettings();
  const platformName = settings.platformName || 'Codex Dynamics';

  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);
  const [code, setCode]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items: rows } = await listPasswordResetRequests();
      setItems(rows);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openModal = (item) => {
    setAction(item);
    setCode('');
    setErr('');
  };

  const handleSend = async () => {
    if (!/^\d{6}$/.test(code)) {
      setErr('Code must be exactly 6 digits.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await sendPasswordResetCode(action.user_id, code);
      showNotification?.(`Reset code sent to ${action.user_email}`);
      setAction(null);
      load();
    } catch (e) {
      setErr(e?.message || 'Failed to send code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="crm-inline-0acd0995e2">
      <div className="crm-inline-54e2fcd710">
        <div>
          <h2 className="crm-inline-6ef33a0d72">Password Reset Requests</h2>
          <p className="crm-inline-e194a4dfdb">
            Clients who requested a password reset. Set a 6-digit code and copy the email template to send it manually.
          </p>
        </div>
        <button type="button" className="crm-small-btn" onClick={load}>Refresh</button>
      </div>

      {action && (
        <div className="dr-modal-overlay crm-inline-292d3785c3"  onClick={() => !busy && setAction(null)}>
          <div className="dr-modal crm-inline-eb1967695a"  onClick={e => e.stopPropagation()}>
            <div className="dr-modal__header">
              <h3 className="dr-modal__title">🔑 Send reset code</h3>
              <p className="dr-modal__subtitle">{action.user_name}  /  {action.user_email}</p>
            </div>

            <div className="dr-modal__body">
              <label className="dr-modal__label">Set a 6-digit reset code</label>
              <input
                className="dr-modal__input crm-inline-5e0035e459"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="e.g. 847291"
                inputMode="numeric"
                maxLength={6}

              />
              <p className="crm-inline-0703de4005">
                The client will enter this code to verify their identity before setting a new password.
              </p>

              {code.length === 6 && (
                <CopyTemplate name={action.user_name} code={code} platformName={platformName} />
              )}
            </div>

            <div className="dr-modal__footer">
              {err && <div className="dr-modal__error">{err}</div>}
              <div className="dr-modal__actions">
                <button
                  type="button"
                  className="dr-modal__btn dr-modal__btn--ghost"
                  disabled={busy}
                  onClick={() => setAction(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="dr-modal__btn dr-modal__btn--approve"
                  disabled={busy || code.length !== 6}
                  onClick={handleSend}
                >
                  {busy ? 'Sending...' : 'Send code & notify client'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="crm-inline-54aeff80c9">Loading...</p>
      ) : items.length === 0 ? (
        <div className="crm-inline-2f5529b3a6">
          <div className="crm-inline-d8842c14d2">🔒</div>
          <p className="crm-inline-d66f85320c">No pending password reset requests</p>
        </div>
      ) : (
        <table className="crm-table crm-inline-69d66e5b2e" >
          <thead>
            <tr>
              <th>Client</th>
              <th>Email</th>
              <th>Requested</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map(row => (
              <tr key={row.id}>
                <td className="crm-inline-5c05f4afaf">{row.user_name}</td>
                <td className="crm-inline-54aeff80c9">{row.user_email}</td>
                <td className="crm-inline-37d0b7ce9d">{timeAgo(row.requested_at)}</td>
                <td>
                  <button
                    type="button"
                    className="crm-small-btn"
                    onClick={() => openModal(row)}
                  >
                    Send Code
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
