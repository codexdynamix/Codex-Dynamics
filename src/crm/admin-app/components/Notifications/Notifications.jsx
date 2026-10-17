import React, { useState, useEffect, useRef, useCallback } from 'react';
import ConfirmModal from '../ConfirmModal/ConfirmModal';
import { Send, Users, User, Info, Settings, ClipboardList, Receipt, Shield, AlertTriangle, Ban } from 'lucide-react';
import {
  sendClientNotificationApi,
  searchClientUsersForNotify,
  getNotificationSentLog,
  recallNotificationApi,
  clearNotificationsSentLogApi,
  clearUserNotificationsApi,
  getUserNotificationsForAdminApi,
  deleteClientNotificationsApi,
} from '../../adminApi';
import './Notifications.css';

const KIND_OPTIONS = [
  { value: 'info',     label: 'Info',                 color: 'var(--crm-text-secondary)' },
  { value: 'system',   label: 'System',               color: 'var(--crm-accent)' },
  { value: 'project',  label: 'Project milestone',    color: '#30D158' },
  { value: 'billing',  label: 'Billing & invoice',    color: '#30D158' },
  { value: 'security', label: 'Security',             color: '#FF453A' },
  { value: 'warning',  label: 'Warning',              color: '#FF9F0A' },
  { value: 'alert',    label: 'Action required',      color: '#FF453A' },
];

const KIND_MAP = {
  info:     { icon: 'i', color: 'var(--crm-text-secondary)', label: 'Info' },
  system:   { icon: 'S',  color: 'var(--crm-accent)', label: 'System' },
  project:  { icon: 'P', color: '#30D158', label: 'Project milestone' },
  billing:  { icon: 'B', color: '#30D158', label: 'Billing' },
  security: { icon: '!', color: '#FF453A', label: 'Security' },
  warning:  { icon: '!', color: '#FF9F0A', label: 'Warning' },
  alert:    { icon: '!', color: '#FF453A', label: 'Action required' },
};

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function fmt(ts) {
  if (!ts) return '-';
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return ts; }
}

// ---------------------------------------------------------------------------
// Compose panel
// ---------------------------------------------------------------------------
const Compose = ({ onSent, isSuperAdmin, clients = [] }) => {
  const [recipientMode, setRecipientMode] = useState(isSuperAdmin ? 'all' : 'specific');
  const [search, setSearch]               = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedUser, setSelectedUser]   = useState(null);
  const [showDD, setShowDD]               = useState(false);
  const [kind, setKind]                   = useState('info');
  const [message, setMessage]             = useState('');
  const [busy, setBusy]                   = useState(false);
  const [result, setResult]               = useState(null);
  const ddRef = useRef(null);

  // Fast instant search while typing - fetches immediately on focus or input change
  useEffect(() => {
    if (recipientMode !== 'specific') {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    searchClientUsersForNotify(search).then((res) => {
      if (cancelled) return;
      const visibleClientIds = new Set(clients.map((client) => String(client.id)));
      setSearchResults(isSuperAdmin ? (res || []) : (res || []).filter((user) => visibleClientIds.has(String(user.id))));
    });
    return () => { cancelled = true; };
  }, [search, recipientMode, isSuperAdmin, clients]);

  useEffect(() => {
    const h = (e) => { if (ddRef.current && !ddRef.current.contains(e.target)) setShowDD(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selectUser = (u) => { setSelectedUser(u); setSearch(''); setSearchResults([]); setShowDD(false); };
  const clearUser  = ()  => { setSelectedUser(null); setSearch(''); };

  const handleSend = async () => {
    if (!message.trim()) return;
    if (recipientMode === 'all' && !isSuperAdmin) return;
    if (recipientMode === 'specific' && !selectedUser) return;
    setBusy(true); setResult(null);
    try {
      const res = await sendClientNotificationApi({
        userId:  recipientMode === 'specific' ? selectedUser.id : null,
        message: message.trim(),
        kind,
      });
      if (!Number.isFinite(Number(res?.sent))) {
        throw new Error('Notification was sent, but the server did not return a recipient count.');
      }
      setResult({ ok: true, sent: res.sent });
      setMessage('');
      if (recipientMode === 'specific') clearUser();
      if (onSent) onSent();
    } catch (err) {
      setResult({ error: err.message || 'Failed to send notification.' });
    } finally {
      setBusy(false);
    }
  };

  const canSend = !busy && message.trim().length > 0
    && (recipientMode === 'specific' ? Boolean(selectedUser) : isSuperAdmin);

  return (
    <div className="crm-notification-section">
      <div className="crm-notification-section-head"><Send size={16} /> Send notification</div>

      <div className="crm-inline-3907588b81">
        <label className="crm-notification-label">Recipient</label>
        <div className="crm-inline-54a4986ffc">
          {(isSuperAdmin ? ['all', 'specific'] : ['specific']).map(mode => (
            <button key={mode}
              onClick={() => { setRecipientMode(mode); clearUser(); setResult(null); }}
              className="crm-inline-157309d153 crm-notification-recipient-mode"
              aria-pressed={recipientMode === mode}
            >
              {mode === 'all' ? 'All clients' : 'Specific client'}
            </button>
          ))}
        </div>
      </div>

      {recipientMode === 'specific' && (
        <div className="crm-inline-3907588b81">
          <label className="crm-notification-label">Search Client</label>
          {selectedUser ? (
            <div className="crm-notification-pill">
              <span className="crm-inline-5c05f4afaf">{selectedUser.name || selectedUser.email}</span>
              <span className="crm-inline-4a91c1bc1e">{selectedUser.email}</span>
              <button className="crm-notification-pill-remove" onClick={clearUser} title="Remove">✕</button>
            </div>
          ) : (
            <div className="crm-notification-dropdown-wrap" ref={ddRef}>
              <input className="crm-notification-input" placeholder="Type name or email..." value={search}
                onChange={e => { setSearch(e.target.value); setShowDD(true); }}
                onFocus={() => setShowDD(true)} />
              {showDD && searchResults.length > 0 && (
                <div className="crm-notification-dropdown-list">
                  {searchResults.map(u => (
                    <div key={u.id} className="crm-notification-client-option crm-notification-client-option-spread"
                      onMouseDown={() => selectUser(u)}
                    >
                      <div>
                        <span className="crm-inline-5c05f4afaf">{u.name || '(no name)'}</span>
                        {u.company && <span className="crm-inline-2d4f792665">({u.company})</span>}
                        <span className="crm-inline-e5cb52d4f8">{u.email}</span>
                      </div>
                      <span className="crm-inline-b429cb5465">
                        Client
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {showDD && search.length > 0 && searchResults.length === 0 && (
                <div className="crm-notification-dropdown-list">
                  <div className="crm-notification-client-option is-muted">No clients found.</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="crm-inline-3907588b81">
        <label className="crm-notification-label">Notification Type</label>
        <select
          value={kind}
          onChange={e => setKind(e.target.value)}
          className="crm-inline-90799b5ca7"
        >
          {KIND_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="crm-inline-3eaa7b5ced">
        <label className="crm-notification-label">
          Message
          <span className="crm-inline-e557b2f6e5">{message.length}/1000</span>
        </label>
        <textarea className="crm-notification-textarea" placeholder="Write your notification message here..."
          value={message} onChange={e => setMessage(e.target.value.slice(0, 1000))} />
      </div>

      {result && (
        <div className="crm-inline-f9b40a8bf4 crm-notification-result" data-status={result.ok ? 'success' : 'error'}>
          {result.ok
            ? `✓ Notification sent to ${result.sent} client${result.sent !== 1 ? 's' : ''}.`
            : `✗ ${result.error}`}
        </div>
      )}

      <button className="crm-notifications-send-btn" onClick={handleSend} disabled={!canSend}>
        {busy ? 'Sending...' : 'Send Notification'}
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Recall button - per-row inline confirm + feedback
// ---------------------------------------------------------------------------
const RecallButton = ({ row, onRecalled }) => {
  const [phase, setPhase]   = useState('idle'); // 'idle' | 'confirm' | 'busy' | 'done' | 'error'
  const [info, setInfo]     = useState(null);   // { recalled, already_read } | error string
  const isRecalled = row.recalled_at !== null && row.recalled_at !== undefined;

  if (isRecalled) {
    return (
      <span className="crm-inline-428719107e">
        Recalled
        {row.recalled_count != null && (
          <span className="crm-inline-e5e6786385">({row.recalled_count})</span>
        )}
      </span>
    );
  }

  if (phase === 'done') {
    return (
      <span className="crm-inline-3edaf63289" title={info ? `${info.already_read} already read` : ''}>
        Recalled {info?.recalled != null ? `(${info.recalled})` : ''}
      </span>
    );
  }

  if (phase === 'error') {
    return (
      <span className="crm-inline-2777afa54d"
        title={typeof info === 'string' ? info : ''}>
        ✗ Failed
        <button onClick={() => setPhase('idle')}
          className="crm-inline-b184d7d6ad">
          retry
        </button>
      </span>
    );
  }

  if (phase === 'busy') {
    return <span className="crm-inline-4a91c1bc1e">Recalling...</span>;
  }

  if (phase === 'confirm') {
    return (
      <span className="crm-inline-6ae2c37c91">
        <button
          onClick={async (e) => {
            e.stopPropagation();
            setPhase('busy');
            try {
              const res = await recallNotificationApi(row.id);
              setInfo({ recalled: res.recalled, already_read: res.already_read });
              setPhase('done');
              if (onRecalled) onRecalled(row.id, res);
            } catch (err) {
              setInfo(err.message || 'Failed.');
              setPhase('error');
            }
          }}
          className="crm-inline-6267aeda34"
        >
          Confirm
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setPhase('idle'); }}
          className="crm-inline-f01e74284e"
        >
          ✕
        </button>
      </span>
    );
  }

  // idle
  return (
    <button
      onClick={(e) => { e.stopPropagation(); setPhase('confirm'); }}
      title="Remove this notification from all unread client inboxes"
      className="crm-inline-cc6a0affd2 crm-notification-recall"
    >
      Recall
    </button>
  );
};

// ---------------------------------------------------------------------------
// Sent History panel
// ---------------------------------------------------------------------------
const PAGE_SIZE = 20;

const SentHistory = ({ refreshKey, isSuperAdmin }) => {
  const [log, setLog]           = useState([]);
  const [total, setTotal]       = useState(0);
  const [offset, setOffset]     = useState(0);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [expanded, setExpanded] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [confirm,  setConfirm]  = useState(null);

  const load = useCallback(async (off = 0) => {
    setLoading(true); setError('');
    try {
      const res = await getNotificationSentLog({ limit: PAGE_SIZE, offset: off });
      setLog(res.log);
      setTotal(res.total);
      setOffset(off);
    } catch (e) {
      setError(e.message || 'Failed to load history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(0); }, [load, refreshKey]);

  const handleClearAll = () => {
    setConfirm({
      message: 'Clear the entire notifications sent history? This cannot be undone.',
      onConfirm: async () => {
        setConfirm(null);
        setClearing(true);
        try {
          await clearNotificationsSentLogApi();
          setLog([]);
          setTotal(0);
        } catch (err) {
          setError(err.message || 'Failed to clear history.');
        } finally {
          setClearing(false);
        }
      },
    });
  };

  // After a recall completes, update the row in local state without a full reload.
  const handleRecalled = useCallback((rowId, res) => {
    const now = new Date().toISOString();
    setLog(prev => prev.map(r =>
      r.id === rowId
        ? { ...r, recalled_at: now, recalled_count: res.recalled }
        : r
    ));
  }, []);

  const totalPages  = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Column layout: type | message | recipient | sent-by | timestamp | reached | recall
  return (
    <div className="crm-notification-section crm-notification-section-history">
      <div className="crm-inline-89f1352d55">
        <div className="crm-notification-section-head">
          <span>[list]</span> Sent Notifications History
          {total > 0 && (
            <span className="crm-inline-f7c285f6fd">
              ({total} total)
            </span>
          )}
        </div>
        <div className="crm-inline-7b9e780fca">
          {isSuperAdmin && total > 0 && (
            <button onClick={handleClearAll} disabled={clearing || loading}
              className="crm-inline-456e27130a">
              {clearing ? 'Clearing...' : '🗑 Clear All'}
            </button>
          )}
          <button onClick={() => load(offset)} disabled={loading}
            className="crm-inline-a6b1bfda29">
            {loading ? '...' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="crm-inline-b0aa208f85">
          {error}
        </div>
      )}

      {!loading && log.length === 0 && !error && (
        <div className="crm-inline-fca897b636">
          <div className="crm-inline-4c42dbefcf">📭</div>
          <div className="crm-inline-eefff2f8dd">No notifications have been sent yet.</div>
          <div className="crm-inline-eff46c5aad">Use the composer above to send your first one.</div>
        </div>
      )}

      {loading && log.length === 0 && (
        <div className="crm-inline-644df43e73">Loading...</div>
      )}

      {log.length > 0 && (
        <>
          {/* Header */}
          <div className="crm-inline-319ccb5fd9 crm-notification-sent-grid">
            <div>Type</div>
            <div>Message</div>
            <div>Recipient</div>
            <div>Sent by</div>
            <div>Timestamp</div>
            <div className="crm-inline-72a68ac344">Sent</div>
            <div className="crm-inline-13cbe03b9a">Action</div>
          </div>

          <div className="crm-inline-faca856376">
            {log.map((row) => {
              const k = KIND_MAP[row.kind] || KIND_MAP.info;
              const isExpanded = expanded === row.id;
              const isRecalled = row.recalled_at !== null && row.recalled_at !== undefined;
              const preview = row.message.length > 55 ? row.message.slice(0, 55) + '...' : row.message;
              const recipientLabel = row.is_broadcast === 1 || row.is_broadcast === '1'
                ? '📢 All Clients'
                : (row.user_name || row.user_email || row.user_id || '-');

              return (
                <div key={row.id} className="crm-inline-3b6dd06049" data-recalled={isRecalled}>
                  <div
                    onClick={() => setExpanded(isExpanded ? null : row.id)}
                    className="crm-inline-b52024d248 crm-sent-notification-row crm-notification-sent-grid"
                    aria-expanded={isExpanded}
                  >
                    {/* Kind badge */}
                    <div className="crm-inline-6781c18518">
                      <span className="crm-inline-966005a32e crm-notification-kind" style={{'--notification-kind-color': k.color}}>
                        {k.icon} {k.label}
                      </span>
                    </div>

                    {/* Message preview */}
                    <div className="crm-inline-7fd2742b55">
                      <span className="crm-inline-711b420301">
                        {preview}
                      </span>
                      {row.message.length > 55 && (
                        <span className="crm-inline-007060ecfe">
                          {isExpanded ? '▲' : '▼'}
                        </span>
                      )}
                    </div>

                    {/* Recipient */}
                    <div className="crm-inline-b3ee0eb691" data-broadcast={row.is_broadcast === 1 || row.is_broadcast === '1'}>
                      {recipientLabel}
                    </div>

                    {/* Admin */}
                    <div className="crm-inline-552c23bd56">
                      {row.admin_name || '-'}
                    </div>

                    {/* Timestamp */}
                    <div className="crm-inline-2b644c5359">
                      {fmt(row.created_at)}
                    </div>

                    {/* Recipient count */}
                    <div className="crm-inline-36e5f96ded">
                      {row.recipient_count}
                    </div>

                    {/* Recall action - stops row expand click */}
                    <div className="crm-inline-0a4eb7d243"
                      onClick={e => e.stopPropagation()}>
                      {isSuperAdmin && <RecallButton row={row} onRecalled={handleRecalled} />}
                    </div>
                  </div>

                  {/* Expanded detail panel */}
                  {isExpanded && (
                    <div className="crm-inline-0aca4452ea" style={{borderLeft: `3px solid ${k.color}`}}>
                      <div className="crm-inline-e0c9208788">
                        Full Message
                      </div>
                      <div className="crm-inline-04b70cb38a">
                        {row.message}
                      </div>

                      <div className="crm-inline-94433b82fc">
                        {(row.is_broadcast !== 1 && row.is_broadcast !== '1') && row.user_email && (
                          <div className="crm-inline-37d0b7ce9d">
                            Sent to: <span className="crm-inline-3414b99eb6">
                              {row.user_name ? `${row.user_name} (${row.user_email})` : row.user_email}
                            </span>
                          </div>
                        )}
                        {isRecalled && (
                          <div className="crm-inline-37d0b7ce9d">
                            Recalled at: <span className="crm-inline-3414b99eb6">{fmt(row.recalled_at)}</span>
                            {row.recalled_count != null && (
                              <span className="crm-inline-09f9b349b5">
                                - removed from <span className="crm-inline-47f1c3c9f1">{row.recalled_count}</span> unread inbox{row.recalled_count !== 1 ? 'es' : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Recall action inside expanded panel too */}
                      {isSuperAdmin && !isRecalled && (
                        <div className="crm-inline-fbcac01a4a">
                          <span className="crm-inline-37d0b7ce9d">Recall this notification from all unread inboxes:</span>
                          <RecallButton row={row} onRecalled={handleRecalled} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="crm-inline-a4769f0023">
              <button
                onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0 || loading}
                className="crm-inline-7557870a09"
              >
                Previous
              </button>
              <span className="crm-inline-37d0b7ce9d">
                Page {currentPage} of {totalPages} &nbsp; / &nbsp; {total} entries
              </span>
              <button
                onClick={() => load(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total || loading}
                className="crm-inline-7557870a09"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
      {confirm && (
        <ConfirmModal
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
          confirmLabel="Clear All"
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// WipeUserNotifications - Super Admin section to clear a user's full inbox
// ---------------------------------------------------------------------------
const WipeUserNotifications = () => {
  const [search, setSearch]             = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showDD, setShowDD]             = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [busy, setBusy]                 = useState(false);
  const [result, setResult]             = useState(null);
  const ddRef = useRef(null);
  const debouncedSearch = useDebounce(search, 280);

  useEffect(() => {
    if (debouncedSearch.length < 1) { setSearchResults([]); return; }
    searchClientUsersForNotify(debouncedSearch).then(setSearchResults);
  }, [debouncedSearch]);

  useEffect(() => {
    const h = (e) => { if (ddRef.current && !ddRef.current.contains(e.target)) setShowDD(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selectUser = (u) => { setSelectedUser(u); setSearch(''); setSearchResults([]); setShowDD(false); setResult(null); };
  const clearUser  = ()  => { setSelectedUser(null); setSearch(''); setResult(null); };

  const handleWipe = async () => {
    if (!selectedUser || busy) return;
    const confirmed = window.confirm(
      `Permanently delete ALL notifications for ${selectedUser.name || selectedUser.email}? This cannot be undone.`
    );
    if (!confirmed) return;
    setBusy(true); setResult(null);
    try {
      const res = await clearUserNotificationsApi(selectedUser.id);
      setResult({ ok: true, deleted: res.deleted ?? 0, userName: selectedUser.name || selectedUser.email });
      clearUser();
    } catch (err) {
      setResult({ error: err.message || 'Failed to clear notifications.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="crm-notification-section crm-notification-section-danger">
      <div className="crm-notification-section-head"><span>🗑</span> Wipe User Notifications</div>
      <p className="crm-inline-e180b480f2">
        Permanently deletes every notification from a specific user's inbox, leaving it completely empty.
      </p>

      <div className="crm-inline-3907588b81">
        <label className="crm-notification-label">Select Client</label>
        {selectedUser ? (
          <div className="crm-notification-pill">
            <span className="crm-inline-5c05f4afaf">{selectedUser.name || selectedUser.email}</span>
            <span className="crm-inline-4a91c1bc1e">{selectedUser.email}</span>
            <button className="crm-notification-pill-remove" onClick={clearUser} title="Remove">✕</button>
          </div>
        ) : (
          <div className="crm-notification-dropdown-wrap" ref={ddRef}>
            <input
              className="crm-notification-input"
              placeholder="Type name or email..."
              value={search}
              onChange={e => { setSearch(e.target.value); setShowDD(true); }}
              onFocus={() => setShowDD(true)}
            />
            {showDD && searchResults.length > 0 && (
              <div className="crm-notification-dropdown-list">
                {searchResults.map(u => (
                  <div key={u.id} className="crm-notification-client-option"
                    onMouseDown={() => selectUser(u)}
                  >
                    <span className="crm-inline-5c05f4afaf">{u.name || '(no name)'}</span>
                    <span className="crm-inline-e5cb52d4f8">{u.email}</span>
                  </div>
                ))}
              </div>
            )}
            {showDD && search.length > 0 && searchResults.length === 0 && (
              <div className="crm-notification-dropdown-list">
                <div className="crm-notification-client-option is-muted">No clients found.</div>
              </div>
            )}
          </div>
        )}
      </div>

      <button
        onClick={handleWipe}
        disabled={!selectedUser || busy}
        className="crm-inline-44f70beec9 crm-notification-wipe-btn"
      >
        {busy ? 'Clearing...' : '🗑 Wipe All Notifications'}
      </button>

      {result?.ok && (
        <div className="crm-inline-067a6ed1de">
          OK Cleared <strong>{result.deleted}</strong> notification{result.deleted !== 1 ? 's' : ''} from {result.userName}'s inbox.
        </div>
      )}
      {result?.error && (
        <div className="crm-inline-b6746f19ae">
          ⚠ {result.error}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// BrowseDeleteNotifications - browse a client's inbox and delete selectively
// ---------------------------------------------------------------------------
const BrowseDeleteNotifications = () => {
  const [search, setSearch]             = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showDD, setShowDD]             = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading]           = useState(false);
  const [loadError, setLoadError]       = useState('');
  const [selected, setSelected]         = useState(new Set());
  const [expanded, setExpanded]         = useState(null);
  const [deleting, setDeleting]         = useState(false);
  const [result, setResult]             = useState(null);
  const [confirm, setConfirm]           = useState(null);
  const ddRef = useRef(null);
  const debouncedSearch = useDebounce(search, 280);

  useEffect(() => {
    if (debouncedSearch.length < 1) { setSearchResults([]); return; }
    searchClientUsersForNotify(debouncedSearch).then(setSearchResults);
  }, [debouncedSearch]);

  useEffect(() => {
    const h = (e) => { if (ddRef.current && !ddRef.current.contains(e.target)) setShowDD(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const loadNotifications = useCallback(async (user) => {
    if (!user) return;
    setLoading(true); setLoadError(''); setResult(null); setSelected(new Set()); setExpanded(null);
    try {
      const res = await getUserNotificationsForAdminApi(user.id);
      setNotifications(res.notifications || []);
    } catch (e) {
      setLoadError(e.message || 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  const selectUser = (u) => {
    setSelectedUser(u); setSearch(''); setSearchResults([]); setShowDD(false);
    setNotifications([]); setSelected(new Set()); setResult(null);
    loadNotifications(u);
  };
  const clearUser = () => {
    setSelectedUser(null); setSearch(''); setNotifications([]);
    setSelected(new Set()); setExpanded(null); setResult(null); setLoadError('');
  };

  const allIds      = notifications.map(n => n.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  const toggleOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (!selectedUser || selected.size === 0 || deleting) return;
    const ids = [...selected];
    const label = ids.length === 1 ? '1 notification' : `${ids.length} notifications`;
    setConfirm({
      message: `Permanently delete ${label} from ${selectedUser.name || selectedUser.email}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirm(null);
        setDeleting(true); setResult(null);
        try {
          const res = await deleteClientNotificationsApi(selectedUser.id, ids);
          setNotifications(prev => prev.filter(n => !selected.has(n.id)));
          setSelected(new Set());
          setResult({ ok: true, deleted: res.deleted });
        } catch (err) {
          setResult({ error: err.message || 'Failed to delete.' });
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  const handleDeleteAll = () => {
    if (!selectedUser || notifications.length === 0 || deleting) return;
    const count = notifications.length;
    setConfirm({
      message: `Permanently delete ALL ${count} notification${count !== 1 ? 's' : ''} from ${selectedUser.name || selectedUser.email}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirm(null);
        setDeleting(true); setResult(null);
        try {
          const ids = notifications.map(n => n.id);
          const res = await deleteClientNotificationsApi(selectedUser.id, ids);
          setNotifications([]);
          setSelected(new Set());
          setResult({ ok: true, deleted: res.deleted });
        } catch (err) {
          setResult({ error: err.message || 'Failed to delete.' });
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  return (
    <div className="crm-notification-section crm-notification-section-browse">
      <div className="crm-notification-section-head"><span>[search]</span> Browse &amp; Delete Client Notifications</div>
      <p className="crm-inline-e180b480f2">
        View a client's notification inbox and delete individual, selected, or all notifications.
      </p>

      {/* User picker */}
      <div className="crm-inline-3907588b81">
        <label className="crm-notification-label">Select Client</label>
        {selectedUser ? (
          <div className="crm-inline-2a907996ec">
            <div className="crm-notification-pill">
              <span className="crm-inline-5c05f4afaf">{selectedUser.name || selectedUser.email}</span>
              <span className="crm-inline-4a91c1bc1e">{selectedUser.email}</span>
              <button className="crm-notification-pill-remove" onClick={clearUser} title="Remove">✕</button>
            </div>
            <button
              onClick={() => loadNotifications(selectedUser)}
              disabled={loading}
              className="crm-inline-7f48fc0202"
            >
              {loading ? '...' : '↺ Refresh'}
            </button>
          </div>
        ) : (
          <div className="crm-notification-dropdown-wrap" ref={ddRef}>
            <input
              className="crm-notification-input"
              placeholder="Type name or email..."
              value={search}
              onChange={e => { setSearch(e.target.value); setShowDD(true); }}
              onFocus={() => setShowDD(true)}
            />
            {showDD && searchResults.length > 0 && (
              <div className="crm-notification-dropdown-list">
                {searchResults.map(u => (
                  <div key={u.id} className="crm-notification-client-option"
                    onMouseDown={() => selectUser(u)}
                  >
                    <span className="crm-inline-5c05f4afaf">{u.name || '(no name)'}</span>
                    <span className="crm-inline-e5cb52d4f8">{u.email}</span>
                  </div>
                ))}
              </div>
            )}
            {showDD && search.length > 0 && searchResults.length === 0 && (
              <div className="crm-notification-dropdown-list">
                <div className="crm-notification-client-option is-muted">No clients found.</div>
              </div>
            )}
          </div>
        )}
      </div>

      {loadError && (
        <div className="crm-inline-84944d05bf">
          {loadError}
        </div>
      )}

      {result?.ok && (
        <div className="crm-inline-37414b23a3">
          OK Deleted <strong>{result.deleted}</strong> notification{result.deleted !== 1 ? 's' : ''}.
        </div>
      )}
      {result?.error && (
        <div className="crm-inline-016866731f">
          ⚠ {result.error}
        </div>
      )}

      {selectedUser && !loading && notifications.length === 0 && !loadError && (
        <div className="crm-inline-fe89d58623">
          <div className="crm-inline-5219792eab">📭</div>
          <div className="crm-inline-eefff2f8dd">This client has no notifications.</div>
        </div>
      )}

      {loading && (
        <div className="crm-inline-9572a0836d">Loading...</div>
      )}

      {!loading && notifications.length > 0 && (
        <>
          {/* Toolbar */}
          <div className="crm-inline-e8e91d8bd0">
            <div className="crm-inline-9484aff0bd">
              <label className="crm-inline-bd2b54a52b">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="crm-inline-3ec170b5ad"
                />
                {allSelected ? 'Deselect All' : `Select All (${notifications.length})`}
              </label>
              {someSelected && (
                <span className="crm-inline-a81558e644">
                  {selected.size} selected
                </span>
              )}
            </div>
            <div className="crm-inline-54a4986ffc">
              <button
                onClick={handleDeleteSelected}
                disabled={!someSelected || deleting}
                className="crm-inline-4ea17bfafb crm-notification-delete-selected"
              >
                🗑 Delete Selected{someSelected ? ` (${selected.size})` : ''}
              </button>
              <button
                onClick={handleDeleteAll}
                disabled={deleting}
                className="crm-inline-d81b92006b"
              >
                🗑 Delete All ({notifications.length})
              </button>
            </div>
          </div>

          {/* Header row */}
          <div className="crm-inline-231af52a20">
            <div></div>
            <div>Type</div>
            <div>Message</div>
            <div>Status</div>
            <div>Date</div>
            <div></div>
          </div>

          {/* Rows */}
          <div className="crm-inline-faca856376">
            {notifications.map(n => {
              const k = KIND_MAP[n.kind] || KIND_MAP.info;
              const isRead = n.read_at !== null && n.read_at !== undefined;
              const isChecked = selected.has(n.id);
              const isExpanded = expanded === n.id;
              const preview = n.message.length > 70 ? n.message.slice(0, 70) + '...' : n.message;
              return (
                <div key={n.id} className="crm-inline-15944fbfc9">
                  {/* Row */}
                  <div
                    onClick={() => setExpanded(isExpanded ? null : n.id)}
                    className="crm-inline-7cb20b9fed crm-user-notification-row"
                    aria-expanded={isExpanded}
                    aria-selected={isChecked}
                  >
                    {/* Checkbox */}
                    <div className="crm-inline-3c587b144a"
                      onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOne(n.id)}
                        className="crm-inline-3ec170b5ad"
                      />
                    </div>

                    {/* Kind badge */}
                    <div>
                      <span className="crm-inline-966005a32e crm-notification-kind" style={{'--notification-kind-color': k.color}}>
                        {k.icon} {k.label}
                      </span>
                    </div>

                    {/* Message preview + chevron */}
                    <div className="crm-inline-043e3b8311">
                      <span className="crm-inline-06b69ad69a">
                        {preview}
                      </span>
                      <span className="crm-inline-385ab87e2d">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>

                    {/* Read/Unread */}
                    <div>
                      <span className="crm-inline-33e164e139 crm-notification-read-status" data-read={isRead}>
                        {isRead ? '✓ Read' : ' Unread'}
                      </span>
                    </div>

                    {/* Date */}
                    <div className="crm-inline-a81558e644">
                      {fmt(n.created_at)}
                    </div>

                    {/* Delete single */}
                    <div onClick={e => e.stopPropagation()}>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (deleting) return;
                          setDeleting(true); setResult(null);
                          try {
                            await deleteClientNotificationsApi(selectedUser.id, [n.id]);
                            setNotifications(prev => prev.filter(x => x.id !== n.id));
                            setSelected(prev => { const next = new Set(prev); next.delete(n.id); return next; });
                            if (expanded === n.id) setExpanded(null);
                            setResult({ ok: true, deleted: 1 });
                          } catch (err) {
                            setResult({ error: err.message || 'Failed.' });
                          } finally {
                            setDeleting(false);
                          }
                        }}
                        title="Delete this notification"
                        className="crm-inline-a76b77a723 crm-notification-delete"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Preview panel */}
                  {isExpanded && (
                    <div className="crm-inline-9feacaa658 crm-notification-preview" style={{'--notification-kind-color': k.color}}>
                      <div className="crm-inline-2699505867">
                        Full Message
                      </div>
                      <div className="crm-inline-52953f4d9d">
                        {n.message}
                      </div>
                      <div className="crm-inline-9bb56cca90">
                        <div className="crm-inline-54d4134070">
                          <span className="crm-inline-37d0b7ce9d">
                            Type: <span className="crm-inline-5c05f4afaf crm-notification-kind-text" style={{'--notification-kind-color': k.color}}>{k.icon} {k.label}</span>
                          </span>
                          <span className="crm-inline-37d0b7ce9d">
                            Status: <span className="crm-inline-5c05f4afaf crm-notification-read-text" data-read={isRead}>{isRead ? '✓ Read' : ' Unread'}</span>
                          </span>
                          {isRead && n.read_at && (
                            <span className="crm-inline-37d0b7ce9d">
                              Read at: <span className="crm-inline-3414b99eb6">{fmt(n.read_at)}</span>
                            </span>
                          )}
                          <span className="crm-inline-37d0b7ce9d">
                            Sent: <span className="crm-inline-3414b99eb6">{fmt(n.created_at)}</span>
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (deleting) return;
                            setConfirm({
                              message: 'Permanently delete this notification? This cannot be undone.',
                              onConfirm: async () => {
                                setConfirm(null);
                                setDeleting(true); setResult(null);
                                try {
                                  await deleteClientNotificationsApi(selectedUser.id, [n.id]);
                                  setNotifications(prev => prev.filter(x => x.id !== n.id));
                                  setSelected(prev => { const next = new Set(prev); next.delete(n.id); return next; });
                                  setExpanded(null);
                                  setResult({ ok: true, deleted: 1 });
                                } catch (err) {
                                  setResult({ error: err.message || 'Failed.' });
                                } finally {
                                  setDeleting(false);
                                }
                              },
                            });
                          }}
                          className="crm-inline-2e5fa4901e"
                        >
                          🗑 Delete this notification
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      {confirm && (
        <ConfirmModal
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
          confirmLabel="Delete"
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------
const Notifications = ({ onSent, isSuperAdmin = false, clients = [] } = {}) => {
  const [historyKey, setHistoryKey] = useState(0);
  const refreshHistory = useCallback(() => setHistoryKey(k => k + 1), []);

  return (
    <div id="notifications-section" className="crm-notifications-workspace">
      <Compose onSent={refreshHistory} isSuperAdmin={isSuperAdmin} clients={clients} />
      {isSuperAdmin && <BrowseDeleteNotifications />}
      {isSuperAdmin && <WipeUserNotifications />}
      <SentHistory refreshKey={historyKey} isSuperAdmin={isSuperAdmin} />
    </div>
  );
};

export default Notifications;
