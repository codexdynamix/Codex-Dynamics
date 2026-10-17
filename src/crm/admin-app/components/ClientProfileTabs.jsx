import React from 'react';

const PROFILE_TABS = [
  { id: 'overview', label: '📋 Profile & Scope' },
  { id: 'security', label: '🔒 Client Security' },
  { id: 'chat', label: '💬 Client Support' },
  { id: 'activity', label: '📊 Client Activity' },
  { id: 'mailboxes', label: 'Email Accounts' },
];

export default function ClientProfileTabs({ activeTab, onChange, chatCount, isSuperAdmin }) {
  const tabs = PROFILE_TABS
    .filter((tab) => tab.id !== 'mailboxes' || isSuperAdmin)
    .map((tab) => tab.id === 'chat' && chatCount
      ? { ...tab, label: `${tab.label} (${chatCount})` }
      : tab);

  return (
    <div className="crm-inline-8770695224" role="tablist" aria-label="Client profile sections">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`crm-button ${isActive ? 'crm-button-primary' : 'crm-button-secondary'} crm-inline-64c753f0c8`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
