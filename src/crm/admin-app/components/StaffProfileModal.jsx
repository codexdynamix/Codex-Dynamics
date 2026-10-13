import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ROLE,
  getOfficeName,
  getTeamName,
} from '../shared.jsx';
import { getStaffProfilePath, getRoleWorkspacePath } from '../clientProfileRouting.js';
import { CommunicationActionModal } from './HostingerMailAdmin.jsx';

const ROLE_BADGE_STYLE = {
  [ROLE.OFFICE_MANAGER]: {
    background: 'color-mix(in srgb, var(--crm-accent) 15%, transparent)',
    color: 'var(--crm-accent)',
    border: '1px solid color-mix(in srgb, var(--crm-accent) 35%, transparent)',
  },
  [ROLE.TEAM_LEAD]: {
    background: 'rgba(69,210,160,0.15)',
    color: '#45d2a0',
    border: '1px solid rgba(69,210,160,0.35)',
  },
  [ROLE.AGENT]: {
    background: 'rgba(52,152,219,0.15)',
    color: '#3498db',
    border: '1px solid rgba(52,152,219,0.35)',
  },
};

function getInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return (parts.map((p) => p[0] || '').join('') || '?').slice(0, 2).toUpperCase();
}

export default function StaffProfileModal({
  staff,
  onClose,
  data,
  currentUser,
  showNotification,
}) {
  const navigate = useNavigate();

  const liveStaff = useMemo(() => {
    if (!staff) return null;
    if (staff.isOfficeOnly && staff.officeId) {
      const mgr = (data?.users || []).find(
        (u) => u.role === ROLE.OFFICE_MANAGER && u.officeId === staff.officeId
      );
      if (mgr) return mgr;
      return staff;
    }
    if (staff.isTeamOnly && staff.teamId) {
      const ldr = (data?.users || []).find(
        (u) => u.role === ROLE.TEAM_LEAD && u.teamId === staff.teamId
      );
      if (ldr) return ldr;
      return staff;
    }
    return (data?.users || []).find((u) => u.id === staff.id) || staff;
  }, [data?.users, staff]);

  const isVirtual = Boolean(liveStaff?.isOfficeOnly || liveStaff?.isTeamOnly);
  const isBlocked = liveStaff?.status === 'Suspended' || liveStaff?.status === 'Disabled';

  const officeObj = useMemo(() => {
    if (!data?.offices || !liveStaff) return null;
    if (liveStaff.officeId) {
      return data.offices.find((o) => o.id === liveStaff.officeId) || null;
    }
    return data.offices.find((o) => o.managerId === liveStaff.id) || null;
  }, [data?.offices, liveStaff]);

  const teamObj = useMemo(() => {
    if (!data?.teams || !liveStaff) return null;
    if (liveStaff.teamId) {
      return data.teams.find((t) => t.id === liveStaff.teamId) || null;
    }
    return data.teams.find((t) => t.leaderId === liveStaff.id) || null;
  }, [data?.teams, liveStaff]);

  const resolvedOfficeId = officeObj?.id || liveStaff?.officeId || teamObj?.officeId || '';
  const resolvedTeamId = teamObj?.id || liveStaff?.teamId || '';

  const officeName = getOfficeName(resolvedOfficeId, data?.offices || []);
  const teamName = getTeamName(resolvedTeamId, data?.teams || []);

  const officeTeamsCount = useMemo(() => {
    if (!resolvedOfficeId) return 0;
    return (data?.teams || []).filter((t) => t.officeId === resolvedOfficeId).length;
  }, [data?.teams, resolvedOfficeId]);

  const officeAgentsCount = useMemo(() => {
    if (!resolvedOfficeId) return 0;
    return (data?.users || []).filter(
      (u) => u.role === ROLE.AGENT && u.officeId === resolvedOfficeId
    ).length;
  }, [data?.users, resolvedOfficeId]);

  const teamAgentsCount = useMemo(() => {
    if (!resolvedTeamId) return 0;
    return (data?.users || []).filter(
      (u) => u.role === ROLE.AGENT && u.teamId === resolvedTeamId
    ).length;
  }, [data?.users, resolvedTeamId]);

  const staffClients = useMemo(() => {
    if (!liveStaff) return [];
    const allClients = data?.clients || [];
    if (liveStaff.role === ROLE.OFFICE_MANAGER) {
      return allClients.filter((l) => l.assignedToOffice === resolvedOfficeId);
    }
    if (liveStaff.role === ROLE.TEAM_LEAD) {
      return allClients.filter((l) =>
        (resolvedTeamId && l.assignedToTeam === resolvedTeamId) ||
        l.assignedToTeamLeader === liveStaff.id
      );
    }
    return allClients.filter((l) => l.assignedToAgent === liveStaff.id);
  }, [data?.clients, liveStaff, resolvedOfficeId, resolvedTeamId]);

  const depositsCount = useMemo(
    () => staffClients.filter((l) => l.stage === 'Deposit').length,
    [staffClients]
  );
  const conversionRate =
    staffClients.length > 0 ? ((depositsCount / staffClients.length) * 100).toFixed(1) : '0.0';

  if (!liveStaff) return null;

  const panelPath =
    liveStaff.role === ROLE.OFFICE_MANAGER
      ? `/admin/office-manager/${liveStaff.id}`
      : liveStaff.role === ROLE.TEAM_LEAD
      ? `/admin/team-leader/${liveStaff.id}`
      : `/admin/agent/${liveStaff.id}`;

  const viewerRole = currentUser?.role || ROLE.SUPER_ADMIN;
  const viewerId =
    currentUser?.id ||
    (data?.users || []).find((u) => u.role === ROLE.SUPER_ADMIN)?.id ||
    '';
  const fullProfilePath = getStaffProfilePath(viewerRole, viewerId, liveStaff.id);
  const returnPath = getRoleWorkspacePath(viewerRole, viewerId);
  const [communicationOpen, setCommunicationOpen] = React.useState(false);

  const copyText = async (val, label = 'Copied to clipboard') => {
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      showNotification?.(label);
    } catch {
      showNotification?.('Copy failed, please copy manually.');
    }
  };

  return (
    <div
      className="crm-inline-ff5339ed77"
      onClick={onClose}
    >
      <div
        className="crm-inline-a61fd076b8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Summary Header */}
        <div
          className="crm-inline-f948779d4c"
        >
          <div className="crm-inline-9051ea271c">
            <div
              className="crm-inline-2f1f573b1e"
            >
              {getInitials(liveStaff.name)}
            </div>
            <div className="crm-inline-2cd52ab948">
              <div className="crm-inline-1d17149d73">
                <h2
                  className="crm-inline-f191cc97f2"
                >
                  {liveStaff.name}
                </h2>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 9999,
                    ...(ROLE_BADGE_STYLE[liveStaff.role] || ROLE_BADGE_STYLE[ROLE.AGENT]),
                  }}
                >
                  {liveStaff.role}
                </span>
              </div>
              <div
                className="crm-inline-da1de8a0e1"
              >
                <span className={`crm-badge ${isBlocked ? 'crm-badge-danger' : 'crm-badge-success'}`}>
                  {isVirtual ? 'Unassigned Account' : isBlocked ? 'Blocked' : 'Active'}
                </span>
                {!isVirtual && (
                  <span
                    className="crm-inline-71ad56f7a4" style={{color: liveStaff.isLoggedIn ? '#30D158' : '#8E8E93', background: liveStaff.isLoggedIn ? 'rgba(48,209,88,0.12)' : 'rgba(255,255,255,0.05)', border: `1px solid ${liveStaff.isLoggedIn ? 'rgba(48,209,88,0.35)' : 'var(--crm-border, rgba(255,255,255,0.08))'}`}}
                  >
                    <span
                      className="crm-inline-64d7ced97c" style={{background: liveStaff.isLoggedIn ? '#30D158' : '#8E8E93'}}
                    />
                    {liveStaff.isLoggedIn ? 'Online' : 'Offline'}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="crm-modal-close-btn"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Concise Staff Summary Grid */}
        <div
          className="crm-inline-8586cffaba"
        >
          <div>
            <div className="crm-inline-d00a6834cc">Staff ID</div>
            <div className="crm-inline-0fb1e7e8a4">
              {liveStaff.id}
              <button
                type="button"
                onClick={() => copyText(liveStaff.id, 'ID copied')}
                className="crm-inline-38671ee20f"
                title="Copy ID"
              >
                📋
              </button>
            </div>
          </div>

          <div>
            <div className="crm-inline-d00a6834cc">Email</div>
            <div
              className="crm-inline-3b1be71185"
            >
              {liveStaff.email || '-'}
            </div>
          </div>

          <div>
            <div className="crm-inline-d00a6834cc">Office</div>
            <div className="crm-inline-3623745eed">{officeName}</div>
          </div>

          <div>
            <div className="crm-inline-4a087de929">
              {liveStaff.role === ROLE.OFFICE_MANAGER ? 'Office Structure' : 'Team'}
            </div>
            <div className="crm-inline-4305aada87">
              {liveStaff.role === ROLE.OFFICE_MANAGER
                ? `${officeTeamsCount} Team${officeTeamsCount !== 1 ? 's' : ''} · ${officeAgentsCount} Agent${officeAgentsCount !== 1 ? 's' : ''}`
                : teamName}
            </div>
          </div>

          {liveStaff.role === ROLE.TEAM_LEAD && (
            <div>
              <div className="crm-inline-4a087de929">Team Roster</div>
              <div className="crm-inline-4305aada87">
                {teamAgentsCount} / {teamObj?.maxSize || '-'} Agents
              </div>
            </div>
          )}

          <div>
            <div className="crm-inline-4a087de929">Last Login</div>
            <div className="crm-inline-54aeff80c9">
              {liveStaff.lastLoginAt
                ? new Date(liveStaff.lastLoginAt).toLocaleDateString()
                : 'Never'}
            </div>
          </div>
        </div>

        {/* Compact KPI Summary */}
        <div
          className="crm-inline-ca31838d01"
        >
          {[
            {
              label:
                liveStaff.role === ROLE.OFFICE_MANAGER
                  ? 'Office Clients'
                  : liveStaff.role === ROLE.TEAM_LEAD
                  ? 'Team Clients'
                  : 'Assigned Clients',
              value: staffClients.length,
              color: '#0A84FF',
            },
            { label: 'Deposits', value: depositsCount, color: '#0ECB81' },
            { label: 'Conversion', value: `${conversionRate}%`, color: 'var(--crm-accent)' },
          ].map((kpi) => (
            <div
              key={kpi.label}
              className="crm-inline-7b64722dd8"
            >
              <div className="crm-inline-a0e6d1cad8">{kpi.label}</div>
              <div className="crm-inline-6457d2bbb3" style={{color: kpi.color}}>{kpi.value}</div>
            </div>
          ))}
        </div>

        {/* Footer Navigation Buttons */}
        <div
          className="crm-inline-e53f79c03a"
        >
          <button
            type="button"
            onClick={() => setCommunicationOpen(true)}
            className="crm-inline-707bdd920e"
          >
            ✦ Contact
          </button>

          <button
            type="button"
            onClick={() => {
              onClose?.();
              navigate(fullProfilePath, {
                state: {
                  returnTo: returnPath,
                  returnLabel: 'Back to Staff',
                },
              });
            }}
            className="crm-inline-3113fe2e87"
          >
            👤 Open Full Profile
          </button>

          {!isVirtual && (
            <button
              type="button"
              onClick={() => {
                onClose?.();
                navigate(panelPath, {
                  state: {
                    returnTo: returnPath,
                    returnLabel: 'Back to Staff',
                    impersonatedFrom: currentUser?.id,
                  },
                });
              }}
              className="crm-inline-9c3b4218fd"
            >
              ↗ View Workspace Panel
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="crm-inline-b727eede1c"
          >
            Close
          </button>
        </div>

        <CommunicationActionModal
          open={communicationOpen}
          title={`${liveStaff.name} communication`}
          account={{
            email: liveStaff.email,
            phone: liveStaff.phone || liveStaff.mobilePhone || liveStaff.phoneNumber,
          }}
          onClose={() => setCommunicationOpen(false)}
        />
      </div>
    </div>
  );
}
