import React, { useState, useEffect, useCallback } from 'react';
import {
  listAdminNotificationsPage,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  deleteAdminNotificationApi,
  clearAdminNotificationsApi,
} from '../../adminApi';
import ConfirmModal from '../ConfirmModal/ConfirmModal';

export default function AdminNotificationsInbox({ pollMs = 30000 }) {
  const [rows, setRows] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await listAdminNotificationsPage({ limit: 50 });
      setRows(data.notifications || []);
      setUnreadCount(data.unreadCount ?? 0);
      setError('');
    } catch (e) {
      setError(e?.message || 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  const handleRead = async (id) => {
    try {
      await markAdminNotificationRead(id);
      setRows((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (_) {}
  };

  const handleReadAll = async () => {
    try {
      await markAllAdminNotificationsRead();
      setRows((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (_) {}
  };

  const handleDelete = async (id) => {
    try {
      await deleteAdminNotificationApi(id);
      const wasUnread = rows.find(n => n.id === id && !n.read);
      setRows((prev) => prev.filter((n) => n.id !== id));
      if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
    } catch (_) {}
  };

  const handleClearAll = () => {
    setConfirm({
      message: 'Clear all admin notifications? This cannot be undone.',
      onConfirm: async () => {
        setConfirm(null);
        try {
          await clearAdminNotificationsApi();
          setRows([]);
          setUnreadCount(0);
        } catch (_) {}
      },
    });
  };

  if (loading && rows.length === 0) {
    return <p className="crm-inline-47c22073b5">Loading notifications...</p>;
  }

  return (
    <div>
      <div className="crm-inline-8e9c39052e">
        <span className="crm-inline-37d0b7ce9d">
          {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        </span>
        <div className="crm-inline-7b9e780fca">
          {unreadCount > 0 && (
            <button type="button" className="crm-small-btn" onClick={handleReadAll}>
              Mark all read
            </button>
          )}
          {rows.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="crm-inline-13b62326ae"
            >
              🗑 Clear All
            </button>
          )}
        </div>
      </div>
      {error && <p className="crm-inline-8faad8e94e">{error}</p>}
      {rows.length === 0 ? (
        <p className="crm-inline-47c22073b5">No admin alerts yet - billing, project updates, and messages appear here.</p>
      ) : (
        <ul className="crm-inline-a5df20e21a">
          {rows.map((n) => (
            <li
              key={n.id}
              className="crm-inline-a097334973" style={{background: n.read ? 'transparent' : 'color-mix(in srgb, var(--crm-accent) 8%, transparent)', border: `1px solid ${n.read ? '#2B3139' : 'color-mix(in srgb, var(--crm-accent) 25%, transparent)'}`, cursor: n.read ? 'default' : 'pointer'}}
              onClick={() => !n.read && handleRead(n.id)}
            >
              <div className="crm-inline-cbb88a9394">
                <div className="crm-inline-10be3089a8">{n.title || n.kind}</div>
                {n.body && <div className="crm-inline-50f28179a6">{n.body}</div>}
                <div className="crm-inline-f1142798d1">
                  {n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}
                </div>
              </div>
              <button
                title="Delete notification"
                onClick={(e) => { e.stopPropagation(); handleDelete(n.id); }}
                className="crm-inline-b8b257da38"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
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
}
