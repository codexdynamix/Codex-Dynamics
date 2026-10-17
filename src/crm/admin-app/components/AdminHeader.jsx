import React from 'react';
import { usePlatformSettings } from '../../platformDefaults';
import { UserChrome } from './UserChrome.jsx';
import NotificationBell from './NotificationBell.jsx';

function AdminBrand() {
  const settings = usePlatformSettings();
  const name = settings.platformName?.trim() || 'Codex Dynamics';
  const [first, ...rest] = name.split(/[-/\s]+/);
  const second = rest.join(' ');

  return (
    <div className="crm-brand">
      <span className="crm-brand-mark">{settings.platformAbbreviation || 'CD'}</span>
      <span className="crm-brand-text">
        {name ? `${first}${second ? ` ${second}` : ''}` : 'Codex Dynamics'}
        <span className="crm-brand-tag">CRM</span>
      </span>
    </div>
  );
}

export default function AdminHeader({
  user,
  data,
  setData,
  messagesEnabled,
  notificationsEnabled,
  roleMismatch = false,
}) {
  return (
    <header className="crm-topbar crm-admin-header">
      <AdminBrand />
      {roleMismatch ? (
        <div className="crm-top-actions">Role mismatch</div>
      ) : (
        <div className="crm-top-actions">
          <NotificationBell
            user={user}
            messagesEnabled={messagesEnabled}
            notificationsEnabled={notificationsEnabled}
          />
          <UserChrome
            user={user}
            data={data}
            setData={setData}
          />
        </div>
      )}
    </header>
  );
}
