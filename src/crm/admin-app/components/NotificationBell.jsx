import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { usePlatformSettings } from '../../platformDefaults';
import {
  getAdminToken,
  getAdminUnreadMessageCounts,
  getAdminNotificationsUnread,
  markAllAdminNotificationsRead,
  markAllAdminMessagesRead,
} from '../adminApi';
import { ROLE } from '../shared';
import './NotificationBell.css';

const POLL_INTERVAL_MS = 30_000;

function useAdminUnreadCounts(messagesEnabled, notificationsEnabled) {
  const [counts, setCounts] = useState({ messages: 0, notifications: 0 });
  const messageUserIds = useRef([]);
  const previousTotal = useRef(0);
  const [ring, setRing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');

  const poll = useCallback(async () => {
    if (!messagesEnabled && !notificationsEnabled) return;

    try {
      const [messages, notifications] = await Promise.all([
        messagesEnabled
          ? getAdminUnreadMessageCounts()
          : Promise.resolve({ counts: {}, total: 0 }),
        notificationsEnabled
          ? getAdminNotificationsUnread()
          : Promise.resolve({ unreadCount: 0 }),
      ]);
      const messageCount = messages.total || 0;
      const notificationCount = notifications.unreadCount || 0;
      const total = messageCount + notificationCount;

      messageUserIds.current = Object.keys(messages.counts || {}).filter(
        (userId) => (messages.counts[userId] || 0) > 0
      );
      setCounts({ messages: messageCount, notifications: notificationCount });
      setError('');

      if (total > previousTotal.current && previousTotal.current >= 0) {
        setRing(true);
        setTimeout(() => setRing(false), 1200);
      }
      previousTotal.current = total;
    } catch (error) {
      console.error('[NotificationBell] Failed to refresh unread counts:', error);
      setError(error?.message || 'Unread activity could not be refreshed.');
    }
  }, [messagesEnabled, notificationsEnabled]);

  useEffect(() => {
    setCounts((current) => ({
      messages: messagesEnabled ? current.messages : 0,
      notifications: notificationsEnabled ? current.notifications : 0,
    }));
    if (!messagesEnabled && !notificationsEnabled) return undefined;

    void poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [messagesEnabled, notificationsEnabled, poll]);

  const markAllRead = useCallback(async () => {
    if (clearing || (!messagesEnabled && !notificationsEnabled)) return;
    setClearing(true);
    try {
      await Promise.all([
        notificationsEnabled ? markAllAdminNotificationsRead() : Promise.resolve(),
        messagesEnabled ? markAllAdminMessagesRead(messageUserIds.current) : Promise.resolve(),
      ]);
      setCounts({ messages: 0, notifications: 0 });
      previousTotal.current = 0;
    } catch (error) {
      console.error('[NotificationBell] Failed to clear unread activity:', error);
      setError(error?.message || 'Unread activity could not be marked as read.');
    } finally {
      setClearing(false);
      void poll();
    }
  }, [clearing, messagesEnabled, notificationsEnabled, poll]);

  return { counts, ring, clearing, error, markAllRead };
}

const ROLE_DESTINATIONS = {
  [ROLE.SUPER_ADMIN]: {
    alerts: { tab: 'Client Management', subTab: 'Notifications' },
    messages: { tab: 'Client Management', subTab: 'Client Management' },
  },
  [ROLE.AGENT]: {
    alerts: { tab: 'notifications' },
    messages: { tab: 'clients' },
  },
  [ROLE.TEAM_LEAD]: {
    alerts: { tab: 'notifications' },
    messages: { tab: 'clients' },
  },
  [ROLE.OFFICE_MANAGER]: {
    alerts: { tab: 'notifications' },
    messages: { tab: 'clients' },
  },
};

function BellIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export default function NotificationBell({ user, messagesEnabled, notificationsEnabled }) {
  const isAuthenticated = Boolean(user && getAdminToken());
  const isSuperAdmin = user?.role === ROLE.SUPER_ADMIN;
  const canReadMessages = isSuperAdmin || messagesEnabled;
  const canReadNotifications = isSuperAdmin || notificationsEnabled;
  const { counts, ring, clearing, error, markAllRead } = useAdminUnreadCounts(
    isAuthenticated && canReadMessages,
    isAuthenticated && canReadNotifications
  );
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);
  const dropdownRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, right: 12 });
  const [mode, setMode] = useState('dark');
  const navigate = useNavigate();
  const settings = usePlatformSettings();
  const total = counts.messages + counts.notifications;
  const dropdownId = 'crm-notification-summary';

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const crmRoot = document.querySelector('.crm-admin-app');
    if (crmRoot) setMode(crmRoot.getAttribute('data-crm-mode') || 'dark');
    setPosition({
      top: rect.bottom + 8,
      right: Math.max(12, window.innerWidth - rect.right),
    });
  }, []);

  useEffect(() => {
    if (!isSuperAdmin || !isAuthenticated) return;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch((error) => {
        console.warn('[NotificationBell] Browser notification permission was unavailable:', error);
      });
    }
  }, [isSuperAdmin, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const title = `${settings.platformName || 'Codex Dynamics'} Admin`;
    document.title = total > 0 ? `(${total}) ${title}` : title;
    return () => { document.title = title; };
  }, [total, settings.platformName, isAuthenticated]);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (
        wrapperRef.current
        && !wrapperRef.current.contains(event.target)
        && !dropdownRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const navigateTo = (kind) => {
    const destination = ROLE_DESTINATIONS[user?.role]?.[kind] || ROLE_DESTINATIONS[ROLE.AGENT][kind];
    if (isSuperAdmin) {
      window.dispatchEvent(new CustomEvent('admin:goto-tab', { detail: destination }));
    } else {
      navigate(destination.tab);
    }
    setOpen(false);
  };

  if (!isAuthenticated || (!canReadMessages && !canReadNotifications)) return null;

  return (
    <div className="crm-notification-bell" ref={wrapperRef}>
      <button
        type="button"
        className={`crm-notification-bell__trigger${ring ? ' is-ringing' : ''}`}
        ref={buttonRef}
        onClick={() => {
          updatePosition();
          setOpen((current) => !current);
        }}
        title="Notifications"
        aria-label={total > 0 ? `${total} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls={dropdownId}
      >
        <BellIcon />
        {total > 0 && (
          <span className="crm-notification-bell__badge" aria-hidden="true">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && createPortal(
        <section
          id={dropdownId}
          className="crm-notification-menu"
          ref={dropdownRef}
          role="dialog"
          aria-label="Notifications summary"
          data-crm-mode={mode}
          style={{ top: position.top, right: position.right }}
        >
          <header className="crm-notification-menu__header">
            <span>Activity</span>
            {total > 0 && <span className="crm-notification-menu__count">{total} unread</span>}
          </header>
          <div className="crm-notification-menu__items">
            {canReadMessages && (
              <button type="button" className="crm-notification-menu__item" onClick={() => navigateTo('messages')}>
                <span aria-hidden="true">💬</span>
                <span className="crm-notification-menu__label">Client messages</span>
                {counts.messages > 0
                  ? <span className="crm-notification-menu__badge">{counts.messages}</span>
                  : <span className="crm-notification-menu__status">All read</span>}
                <span className="crm-notification-menu__chevron" aria-hidden="true">›</span>
              </button>
            )}
            {canReadNotifications && (
              <button type="button" className="crm-notification-menu__item" onClick={() => navigateTo('alerts')}>
                <span aria-hidden="true">🔔</span>
                <span className="crm-notification-menu__label">System alerts</span>
                {counts.notifications > 0
                  ? <span className="crm-notification-menu__badge">{counts.notifications}</span>
                  : <span className="crm-notification-menu__status">All read</span>}
                <span className="crm-notification-menu__chevron" aria-hidden="true">›</span>
              </button>
            )}
          </div>
          {error && <div className="crm-notification-menu__error" role="alert">{error}</div>}
          <footer className="crm-notification-menu__footer">
            {total > 0
              ? <button type="button" onClick={markAllRead} disabled={clearing}>{clearing ? 'Clearing…' : 'Mark all as read'}</button>
              : <span>All caught up</span>}
            <small>Refreshes every 30 s</small>
          </footer>
        </section>,
        document.body
      )}
    </div>
  );
}
