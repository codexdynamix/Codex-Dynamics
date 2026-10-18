import React, { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { enterClientPortal } from '../clientImpersonation.js';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  ROLE, CLIENT_STATUSES, normalizeStage,
  getOfficeName, getTeamName, getUserName, getCountryFlag, statusClass,
  formatClientId, EditClientModal, CreateClientModal, stageColor,
  StatusDropdown,
} from '../shared';
import { useConfirmDialog } from '../components/ConfirmModal/ConfirmModal';
import { SearchAutocomplete } from '../components/UserChrome.jsx';
import { searchAdminClients, createUserAppointment } from '../adminApi';
import {
  getAdminMessages, sendAdminMessage, markAdminMessagesRead, getAdminUnreadMessageCounts,
  deleteAdminMessage, clearAdminChat, adminSetClientPassword, getClientPortalPasswordAdmin,
  deleteClientCommentApi, deleteClientstatusEntryApi, clearClientCommentsApi, clearClientStatusHistoryApi, getClientNotificationsAsAdmin,
  postAdminPresence, getAdminMessageAttachmentUrl, getStaffCapabilities, fetchAdminMe,
  updateClientApi, getClientProfilePermissionsAdmin,
} from '../adminApi';
import AdminNotificationsInbox from '../components/AdminNotificationsInbox/AdminNotificationsInbox.jsx';
import ReactCapabilityWorkspace from '../components/ReactCapabilityWorkspace.jsx';
import { getClientProfilePath, getRoleScopedClients, getRoleWorkspacePath } from '../clientProfileRouting';
import { portalDb } from '../../../services/portalDatabase';
import ClientAccessEditor from '../components/ClientAccessEditor.jsx';
import ClientAccountingPanel from '../components/ClientAccountingPanel.jsx';
import ClientProfilePermissionManager from '../components/ClientProfilePermissionManager.jsx';
import { ClientEmailAccounts, CommunicationActionModal } from '../components/HostingerMailAdmin.jsx';

// macOS-style funnel filter button + popover for column header filters.
function FilterPopover({ label, value, options, open, onToggle, onSelect, onClose, formatLabel }) {
  const popRef = useRef(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) { setSearch(''); return; }
    const handleClick = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) onClose();
    };
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  const display = (opt) => (formatLabel ? formatLabel(opt) : (opt ?? '-'));
  const filtered = options.filter((opt) =>
    String(display(opt)).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <button
        type="button"
        className="crm-column-filter-btn"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-label={`Filter ${label}`}
        title={`Filter ${label}`}
      />
      {open && (
        <div ref={popRef} className="crm-mac-popover" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            autoFocus
            className="crm-mac-popover-search"
            placeholder={`Filter ${label.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="crm-mac-popover-list">
            <div
              className={`crm-mac-popover-item ${value === '' ? 'crm-selected' : ''}`}
              onClick={() => onSelect('')}
            >
              <span className="crm-mac-popover-check">{value === '' ? '✓' : ''}</span>
              <span>All</span>
            </div>
            {filtered.length === 0 ? (
              <div className="crm-mac-popover-empty">No matches</div>
            ) : (
              filtered.map((opt) => (
                <div
                  key={String(opt)}
                  className={`crm-mac-popover-item ${value === opt ? 'crm-selected' : ''}`}
                  onClick={() => onSelect(opt)}
                >
                  <span className="crm-mac-popover-check">{value === opt ? '✓' : ''}</span>
                  <span>{display(opt)}</span>
                </div>
              ))
            )}
          </div>
          {value !== '' && (
            <>
              <div className="crm-mac-popover-divider" />
              <div className="crm-mac-popover-footer">
                <button type="button" onClick={() => onSelect('')}>Clear filter</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

// Inline SVG icons for the client-profile action buttons.
const PA_ICONS = {
  activity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  ),
  appointment: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M8 3v4" /><path d="M16 3v4" />
    </svg>
  ),
  security: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
    </svg>
  ),
  support: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 1 1-3-6.2L21 4l-1 4-3.8 0" /><path d="M8 12h.01M12 12h.01M16 12h.01" />
    </svg>
  ),
  login: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" />
    </svg>
  ),
};
const PaIcon = ({ name }) => <span className="crm-pa-icon">{PA_ICONS[name]}</span>;

function AgentPanel({ data, currentUser, setData, setUserLoginState, createClient, canManageClientSecurity, canUseChat, canUseNotifications, showNotification }) {
  const navigate = useNavigate();
  const location = useLocation();
  const myClients = data.clients.filter((client) => client.assignedToAgent === currentUser.id);
  // Per-client unread chat-message counts, keyed by user/client id. Polled in
  // one round-trip via /api/admin/messages/unread_counts so the client list
  // can render a small red badge on each row that has new client replies
  // without firing N parallel fetches.
  const [unreadByClient, setUnreadByClient] = useState({});
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!canUseChat || document.hidden) return;
      try {
        const { counts } = await getAdminUnreadMessageCounts();
        if (!cancelled) setUnreadByClient(counts || {});
      } catch (error) {
        console.error('[AgentPanel] failed to load unread support counts', error);
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [canUseChat]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filterCountry, setFilterCountry] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFunnel, setFilterFunnel] = useState('');
  const [filterAffiliate, setFilterAffiliate] = useState('');
  const [filterLastComment, setFilterLastComment] = useState('');
  const [filterRegistered, setFilterRegistered] = useState('');
  const [activeFilterDropdown, setActiveFilterDropdown] = useState('');
  const [sortColumn, setSortColumn] = useState('');
  const [sortDirection, setSortDirection] = useState('asc');
  const nativeTabs = ['clients', ...(canUseNotifications ? ['inbox'] : [])];
  const tabStorageKey = `agent_activeTab:${currentUser?.id || 'unknown'}`;
  const [activeTab, setActiveTab] = useState(() => {
    const saved = sessionStorage.getItem(tabStorageKey);
    return nativeTabs.includes(saved) ? saved : 'clients';
  });
  const [clientUploadEnabled, setClientUploadEnabled] = useState(Boolean(currentUser?.capabilities?.client_upload));
  const [clientUploadLoading, setClientUploadLoading] = useState(true);
  const [showCreateClient, setShowCreateClient] = useState(false);
  const nativeTabActive = ['clients', 'inbox'].includes(activeTab);
  useEffect(() => {
    if (!canUseNotifications && activeTab === 'inbox') setActiveTab('clients');
  }, [activeTab, canUseNotifications]);
  useEffect(() => { sessionStorage.setItem(tabStorageKey, activeTab); }, [activeTab, tabStorageKey]);
  useEffect(() => {
    let cancelled = false;
    setClientUploadLoading(true);
    const loadCapability = async () => {
      try {
        let result;
        try {
          result = await getStaffCapabilities(currentUser.id);
        } catch (_) {
          const profile = await fetchAdminMe();
          result = { capabilities: profile.capabilities || {} };
        }
        if (!cancelled) setClientUploadEnabled(Boolean(result.capabilities?.client_upload));
      } catch (_) {
        if (!cancelled) setClientUploadEnabled(false);
      } finally {
        if (!cancelled) setClientUploadLoading(false);
      }
    };
    if (currentUser?.id) loadCapability();
    return () => { cancelled = true; };
  }, [currentUser?.id]);
  useEffect(() => {
    const handler = (e) => setActiveTab(e.detail.tab);
    window.addEventListener('admin:goto-tab', handler);
    return () => window.removeEventListener('admin:goto-tab', handler);
  }, []);
  const returnTo = location.state?.returnTo;
  const returnLabel = location.state?.returnLabel || 'Back to Team Leader';


  const handleFilterChange = (column, value) => {
    if (column === 'country') setFilterCountry(value);
    if (column === 'status') setFilterStatus(value);
    if (column === 'funnel') setFilterFunnel(value);
    if (column === 'affiliate') setFilterAffiliate(value);
    if (column === 'lastComment') setFilterLastComment(value);
    if (column === 'registered') setFilterRegistered(value);
    setActiveFilterDropdown('');
  };

  const handleClearAll = () => {
    setFilterCountry('');
    setFilterStatus('');
    setFilterFunnel('');
    setFilterAffiliate('');
    setFilterLastComment('');
    setFilterRegistered('');
    setSortColumn('');
    setSortDirection('asc');
    setSearch('');
    setPage(1);
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const countries = Array.from(new Set(myClients.map((client) => client.country || '').filter(Boolean))).sort();
  const statuses = Array.from(new Set(myClients.map((client) => normalizeStage(client.stage || '')).filter(Boolean))).sort();
  const funnels = Array.from(new Set(myClients.map((client) => client.funnel || '').filter(Boolean))).sort();
  const affiliates = Array.from(new Set(myClients.map((client) => client.affiliate || '').filter(Boolean))).sort();
  const lastComments = Array.from(new Set(myClients.map((client) => client.lastCommentDate || '').filter(Boolean))).sort();
  const registeredDates = Array.from(new Set(myClients.map((client) => client.registeredDate || '').filter(Boolean))).sort();

  const filteredClients = myClients.filter((client) => {
    const lower = search.toLowerCase();
    const stage = normalizeStage(client.stage || '');

    if (filterCountry && client.country !== filterCountry) return false;
    if (filterStatus && stage !== filterStatus) return false;
    if (filterFunnel && (client.funnel || '') !== filterFunnel) return false;
    if (filterAffiliate && (client.affiliate || '') !== filterAffiliate) return false;
    if (filterLastComment && (client.lastCommentDate || '') !== filterLastComment) return false;
    if (filterRegistered && (client.registeredDate || '') !== filterRegistered) return false;

    return (
      client.id.toLowerCase().includes(lower) ||
      client.firstName.toLowerCase().includes(lower) ||
      client.lastName.toLowerCase().includes(lower) ||
      client.phone.toLowerCase().includes(lower) ||
      client.email.toLowerCase().includes(lower) ||
      client.country.toLowerCase().includes(lower) ||
      (client.funnel || '').toLowerCase().includes(lower) ||
      (client.affiliate || '').toLowerCase().includes(lower) ||
      stage.toLowerCase().includes(lower)
    );
  });

  const sortedClients = [...filteredClients].sort((a, b) => {
    if (!sortColumn) return 0;
    let aVal, bVal;
    switch (sortColumn) {
      case 'firstName': aVal = a.firstName; bVal = b.firstName; break;
      case 'lastName': aVal = a.lastName; bVal = b.lastName; break;
      case 'country': aVal = a.country; bVal = b.country; break;
      case 'status': aVal = normalizeStage(a.stage); bVal = normalizeStage(b.stage); break;
      case 'funnel': aVal = a.funnel || ''; bVal = b.funnel || ''; break;
      case 'affiliate': aVal = a.affiliate || ''; bVal = b.affiliate || ''; break;
      case 'lastComment': aVal = a.lastCommentDate || ''; bVal = b.lastCommentDate || ''; break;
      case 'registered': aVal = a.registeredDate || ''; bVal = b.registeredDate || ''; break;
      default: return 0;
    }
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const pendingAppointments = myClients
    .flatMap((client) => (client.appointments || []).map((appt) => ({
      ...appt,
      clientName: `${client.firstName} ${client.lastName}`,
      clientId: client.id,
    })))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  const totalPages = Math.max(1, Math.ceil(sortedClients.length / pageSize));
  useEffect(() => {
    setPage(1);
  }, [search, pageSize, myClients.length]);

  const pagedClients = sortedClients.slice((page - 1) * pageSize, page * pageSize);

  if (!currentUser) {
    return (
      <div className="crm-card">
        <h2>Agent Portfolio</h2>
        <p>No agent data found. Please select or login as an Agent.</p>
      </div>
    );
  }

  return (
    <div className="crm-card crm-agent-portfolio">
      <div className="crm-agent-hero">
        <div>
          <h2>Agent Portfolio</h2>
          <p>{currentUser.name} - {getTeamName(currentUser.teamId, data.teams)} / {getOfficeName(currentUser.officeId, data.offices)}</p>
        </div>
        <div className="crm-agent-hero-actions">
          {returnTo && (
            <button className="crm-small-btn" onClick={() => navigate(returnTo)}>
              Back: {returnLabel}
            </button>
          )}
          {!clientUploadLoading && clientUploadEnabled && createClient && (
            <button className="crm-small-btn crm-pagination-btn-gold" onClick={() => setShowCreateClient(true)}>
              + New Client
            </button>
          )}
          <div className="crm-agent-status-chip">{currentUser.isLoggedIn ? 'Online' : 'Offline'}</div>
        </div>
      </div>

      <div className="crm-super-admin-header crm-role-panel-header crm-inline-3907588b81" >
        <div className="crm-super-admin-tabs">
          {['clients', ...(canUseNotifications ? ['inbox'] : [])].map((tab) => (
            <button
              key={tab}
              className={`crm-super-admin-tab-btn ${activeTab === tab ? 'crm-active' : ''}`}
              onClick={() => setActiveTab(tab)}
              aria-label={`Switch to ${tab === 'clients' ? 'Client Management' : 'Notification Inbox'}`}
            >
              {tab === 'clients' ? 'Client Management' : 'Notification Inbox'}
            </button>
          ))}
        </div>
      </div>
      <ReactCapabilityWorkspace
        data={data}
        currentUser={currentUser}
        showNotification={showNotification}
        activeTab={activeTab}
        onActiveChange={setActiveTab}
        nativeTabKeys={nativeTabs}
        fallbackTab="clients"
        showPanel={!nativeTabActive}
      />
      {nativeTabActive && pendingAppointments.length > 0 && (
        <div className="crm-card crm-inline-aad1551b23" >
          <h3>Pending Appointments</h3>
          <ul className="crm-pending-appointments-list">
            {pendingAppointments.slice(0, 8).map((appt) => (
              <li key={`${appt.id}-${appt.clientId}`}>
                <strong>{appt.date} {appt.time}</strong> - {appt.title || 'Untitled'} for {appt.clientName}
              </li>
            ))}
          </ul>
          {pendingAppointments.length > 8 && <small>{pendingAppointments.length} upcoming appointments total</small>}
        </div>
      )}

      {nativeTabActive && activeTab === 'clients' && (
        <div className="crm-agent-clients-content">
          <div className="agent-tools-row crm-inline-72d6c38e5f" >
            <SearchAutocomplete
              className="crm-input crm-inline-02c31cf512"
              placeholder="Search clients..."
              value={search}
              onChange={(v) => setSearch(v)}
              fetchSuggestions={searchAdminClients}

              buildSuggestions={(q) => {
                const ql = q.toLowerCase();
                return myClients
                  .filter(l => {
                    const full = `${l.firstName || ''} ${l.lastName || ''}`.toLowerCase();
                    return (
                      full.includes(ql) ||
                      String(l.id || '').toLowerCase().includes(ql) ||
                      (l.email || '').toLowerCase().includes(ql) ||
                      (l.phone || '').toLowerCase().includes(ql) ||
                      (l.country || '').toLowerCase().includes(ql) ||
                      (l.funnel || '').toLowerCase().includes(ql) ||
                      (l.affiliate || '').toLowerCase().includes(ql) ||
                      (l.stage || '').toLowerCase().includes(ql)
                    );
                  })
                  .slice(0, 8)
                  .map(l => ({
                    key: l.id,
                    value: `${l.firstName || ''} ${l.lastName || ''}`.trim() || l.email || l.phone || String(l.id || ''),
                    label: `${l.firstName || ''} ${l.lastName || ''}`.trim() || '(no name)',
                    meta: [l.country, l.stage].filter(Boolean).join('  /  '),
                  }));
              }}
            />
            <label>
              Page size:
              <select className="small-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <button className="crm-small-btn" onClick={handleClearAll}>Clear All Filters</button>
          </div>

          <div className="crm-client-table-wrapper">
            <table className="crm-table crm-client-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th onClick={() => handleSort('firstName')} className="crm-sortable">
                    First {sortColumn === 'firstName' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                  </th>
                  <th onClick={() => handleSort('lastName')} className="crm-sortable">
                    Last {sortColumn === 'lastName' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                  </th>
                  <th>Online</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th className={`crm-filter-column ${filterCountry ? 'crm-filtered' : ''}`}>
                    Country
                    <FilterPopover
                      label="Country"
                      value={filterCountry}
                      options={countries}
                      open={activeFilterDropdown === 'country'}
                      onToggle={() => setActiveFilterDropdown(activeFilterDropdown === 'country' ? '' : 'country')}
                      onSelect={(v) => handleFilterChange('country', v)}
                      onClose={() => setActiveFilterDropdown('')}
                    />
                  </th>
                  <th className={`crm-filter-column ${filterStatus ? 'crm-filtered' : ''}`}>
                    Status
                    <FilterPopover
                      label="Status"
                      value={filterStatus}
                      options={statuses}
                      open={activeFilterDropdown === 'status'}
                      onToggle={() => setActiveFilterDropdown(activeFilterDropdown === 'status' ? '' : 'status')}
                      onSelect={(v) => handleFilterChange('status', v)}
                      onClose={() => setActiveFilterDropdown('')}
                    />
                  </th>
                  <th className={`crm-filter-column ${filterFunnel ? 'crm-filtered' : ''}`}>
                    Funnel
                    <FilterPopover
                      label="Funnel"
                      value={filterFunnel}
                      options={funnels}
                      open={activeFilterDropdown === 'funnel'}
                      onToggle={() => setActiveFilterDropdown(activeFilterDropdown === 'funnel' ? '' : 'funnel')}
                      onSelect={(v) => handleFilterChange('funnel', v)}
                      onClose={() => setActiveFilterDropdown('')}
                    />
                  </th>
                  <th className={`crm-filter-column ${filterAffiliate ? 'crm-filtered' : ''}`}>
                    Affiliate
                    <FilterPopover
                      label="Affiliate"
                      value={filterAffiliate}
                      options={affiliates}
                      open={activeFilterDropdown === 'affiliate'}
                      onToggle={() => setActiveFilterDropdown(activeFilterDropdown === 'affiliate' ? '' : 'affiliate')}
                      onSelect={(v) => handleFilterChange('affiliate', v)}
                      onClose={() => setActiveFilterDropdown('')}
                    />
                  </th>
                  <th className={`crm-filter-column ${filterLastComment ? 'crm-filtered' : ''}`}>
                    Last Comment
                    <FilterPopover
                      label="Last comment"
                      value={filterLastComment}
                      options={lastComments}
                      open={activeFilterDropdown === 'lastComment'}
                      onToggle={() => setActiveFilterDropdown(activeFilterDropdown === 'lastComment' ? '' : 'lastComment')}
                      onSelect={(v) => handleFilterChange('lastComment', v)}
                      onClose={() => setActiveFilterDropdown('')}
                    />
                  </th>
                  <th className={`crm-filter-column ${filterRegistered ? 'crm-filtered' : ''}`}>
                    Registered
                    <FilterPopover
                      label="Registered"
                      value={filterRegistered}
                      options={registeredDates}
                      open={activeFilterDropdown === 'registered'}
                      onToggle={() => setActiveFilterDropdown(activeFilterDropdown === 'registered' ? '' : 'registered')}
                      onSelect={(v) => handleFilterChange('registered', v)}
                      onClose={() => setActiveFilterDropdown('')}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedClients.map((client) => {
                  const unread = unreadByClient[client.id] || 0;
                  return (
                  <tr key={client.id} onClick={() => navigate(getClientProfilePath(ROLE.AGENT, currentUser.id, client.id))}>
                    <td>
                      {formatClientId(client.id)}
                      {unread > 0 && (
                        <span
                          title={`${unread} unread message${unread === 1 ? '' : 's'}`}
                          className="crm-inline-4fd623dee1"
                        >
                          <i className="fas fa-comment-dots crm-inline-300e45b660"  />
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </td>
                    <td>{client.firstName}</td>
                    <td>{client.lastName}</td>
                    <td>
                      <span className={`crm-online-dot ${client.isOnline ? 'crm-online' : 'crm-offline'}`} title={client.isOnline ? 'Online' : 'Offline'}></span>
                    </td>
                    <td>{client.phone}</td>
                    <td>{client.email}</td>
                    <td>{getCountryFlag(client.countryCode, client.country)}</td>
                    <td><span className={`crm-status-chip ${statusClass(normalizeStage(client.stage))}`}>{normalizeStage(client.stage)}</span></td>
                    <td>{client.funnel || '-'}</td>
                    <td>{client.affiliate || '-'}</td>
                    <td>{client.lastCommentDate || '-'}</td>
                    <td>{client.registeredDate || (client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '-')}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredClients.length === 0 && <div className="crm-empty-state">No assigned clients</div>}
          </div>

          <div className="crm-table-controls crm-inline-c312289912" >
            <span>Showing {pagedClients.length} of {sortedClients.length} clients</span>
            <button className="crm-small-btn crm-pagination-btn-gold" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
            <span>Page {page}/{totalPages}</span>
            <button className="crm-small-btn crm-pagination-btn-gold" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        </div>
      )}

      {canUseNotifications && nativeTabActive && activeTab === 'inbox' && (
        <div className="crm-card">
          <h3>Notifications</h3>
          <AdminNotificationsInbox pollMs={30000} />
        </div>
      )}

      {showCreateClient && createClient && (
        <CreateClientModal
          scope={{ officeId: currentUser.officeId, teamId: currentUser.teamId, agentId: currentUser.id }}
          teamsForOffice={[]}
          agents={[]}
          onClose={() => setShowCreateClient(false)}
          onCreate={async (payload) => {
            const created = await createClient(payload);
            if (created) setShowCreateClient(false);
          }}
        />
      )}

    </div>
  );
}

function ClientProfilePage({ role, viewingUser, data, setData, updateClient, canManageClientSecurity, showNotification }) {
  const { clientId } = useParams();
  const currentUser = viewingUser;
  const isSuperAdmin = currentUser?.role === ROLE.SUPER_ADMIN;
  const navigate = useNavigate();
  const [confirmDialog, confirm] = useConfirmDialog();
  const workspacePath = getRoleWorkspacePath(role, currentUser?.id);
  const visibleClients = getRoleScopedClients(data, role, currentUser);
  const client = visibleClients.find((l) => l.id === clientId);
  const [profileSectionPermissions, setProfileSectionPermissions] = useState({});
  const [profilePermissionsError, setProfilePermissionsError] = useState('');
  const canReadAccessSection = isSuperAdmin || ['read', 'edit'].includes(profileSectionPermissions.access);
  const canEditAccessSection = isSuperAdmin || profileSectionPermissions.access === 'edit';
  const canReadAccountingSection = isSuperAdmin || ['read', 'edit'].includes(profileSectionPermissions.accounting);
  const canEditAccountingSection = isSuperAdmin || profileSectionPermissions.accounting === 'edit';
  const [status, setStatus] = useState(normalizeStage(client?.stage || 'New'));
  const [statusSaving, setStatusSaving] = useState(false);
  const [comment, setComment] = useState(client?.comment || '');
  const [passwordInput, setPasswordInput] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState('');
  // Live messages from the backend. The thread is keyed by client.id (which
  // is the same as users.id since the unify-people migration). Sender is
  // 'agent' for staff replies, 'client' for the client's own messages.
  const [clientChat, setClientChat] = useState([]);
  const [attachmentUrls, setAttachmentUrls] = useState({});
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [appointmentTitle, setAppointmentTitle] = useState('');
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [appointmentSaving, setAppointmentSaving] = useState(false);
  const [showAppointmentModal, setShowAppointmentModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [liveClientPassword, setLiveClientPassword] = useState('');
  const [passwordLoadError, setPasswordLoadError] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [showClientPassword, setShowClientPassword] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showEditClientModal, setShowEditClientModal] = useState(false);
  const [communicationOpen, setCommunicationOpen] = useState(false);
  const [emailAccountsOpen, setEmailAccountsOpen] = useState(false);
  const [isEditingRegistered, setIsEditingRegistered] = useState(false);
  const [registeredDateInput, setRegisteredDateInput] = useState('');

  useEffect(() => {
    if (client) {
      const reg = client.registeredDate || client.registered_date || (client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '');
      setRegisteredDateInput(reg);
    }
  }, [client?.id, client?.registeredDate, client?.createdAt]);

  useEffect(() => {
    let active = true;
    setProfileSectionPermissions({});
    setProfilePermissionsError('');
    if (!client?.id || !currentUser?.id || isSuperAdmin) {
      return () => { active = false; };
    }

    getClientProfilePermissionsAdmin(client.id)
      .then((result) => {
        if (active) setProfileSectionPermissions(result.myPermissions || {});
      })
      .catch(() => {
        if (active) setProfilePermissionsError('Could not verify access to this client’s account sections. They remain hidden until access can be checked.');
      });
    return () => { active = false; };
  }, [client?.id, currentUser?.id, isSuperAdmin]);

  const displayRegisteredDate = (() => {
    const raw = client?.registeredDate || client?.registered_date || client?.createdAt || client?.created_at;
    if (!raw) return 'Recently';
    try {
      const d = new Date(raw);
      return !isNaN(d.getTime()) ? d.toLocaleDateString() : String(raw);
    } catch {
      return String(raw);
    }
  })();
  const chatEndRef       = useRef(null);
  const typingTimeoutRef = useRef(null);
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [clientChat, showChatModal]);

  // Pull the chat thread from the backend and poll while the chat modal is
  // open. Once closed we stop polling so we don't burn requests on every
  // open client detail page that nobody is looking at. We also stamp every
  // unread CLIENT message as read on the very first load - opening the
  // chat IS the act of reading it, so the row badge clears in the same
  // tick the agent looks at the conversation.
  useEffect(() => {
    if (!client?.id || !showChatModal) return undefined;
    let cancelled = false;
    let inFlight = false;
    let firstLoad = true;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await getAdminMessages(client.id, { limit: 200 });
        if (cancelled) return;
        setClientChat(result.messages);
        if (firstLoad && result.unreadCount > 0) {
          markAdminMessagesRead(client.id).catch(() => {});
        }
        firstLoad = false;
      } catch (err) {
        if (!cancelled) setChatError(err?.message || 'Could not load messages.');
      } finally {
        inFlight = false;
      }
    };
    load();
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [client?.id, showChatModal]);

  useEffect(() => {
    if (!showChatModal) return undefined;
    let cancelled = false;
    const loadAttachments = async () => {
      const rows = clientChat.filter(m => m.attachment && !attachmentUrls[m.id]);
      const loaded = await Promise.all(rows.map(async m => {
        try { return [m.id, await getAdminMessageAttachmentUrl(m.id)]; } catch (_) { return null; }
      }));
      const resolved = loaded.filter(Boolean);
      if (!cancelled && resolved.length > 0) {
        setAttachmentUrls(prev => ({ ...prev, ...Object.fromEntries(resolved) }));
      }
    };
    loadAttachments();
    return () => { cancelled = true; };
  }, [clientChat, showChatModal, attachmentUrls]);

  useEffect(() => {
    if (!showChatModal) setAttachmentUrls({});
  }, [client?.id, showChatModal]);

  // Presence heartbeat: report agent as online while the chat modal is open.
  // Expires naturally on the client side (>60s = offline) when modal is closed.
  useEffect(() => {
    if (!client?.id || !showChatModal) return undefined;
    const beat = () => postAdminPresence(client.id, { isTyping: false }).catch(() => {});
    beat();
    const id = setInterval(beat, 20000);
    return () => clearInterval(id);
  }, [client?.id, showChatModal]);

  // Typing indicator: fire is_typing=true on input change, then reset after 4s idle.
  useEffect(() => {
    if (!client?.id || !showChatModal || !chatInput.trim()) return;
    postAdminPresence(client.id, { isTyping: true }).catch(() => {});
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      postAdminPresence(client.id, { isTyping: false }).catch(() => {});
    }, 4000);
  }, [chatInput, client?.id, showChatModal]);

  // Delete a single message on both sides. Optimistically removes the
  // bubble locally, then asks the backend. Rollback on failure so the
  // agent never sees a "ghost-deleted" row reappear on the next poll.
  const handleDeleteMessage = async (messageId) => {
    if (!messageId || String(messageId).startsWith('tmp-')) return;
    const ok = await confirm({
      title: 'Delete message?',
      message: 'This removes the message for both the agent and the client. There will be no trace.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    const snapshot = clientChat;
    setClientChat(prev => prev.filter(m => m.id !== messageId));
    try {
      await deleteAdminMessage(messageId);
    } catch (err) {
      setClientChat(snapshot);
      showNotification && showNotification(err?.message || 'Failed to delete message.');
    }
  };

  // Wipe the entire conversation on both sides. Same confirm-then-call
  // pattern. We close the modal afterwards because there's nothing left
  // to look at.
  const handleClearChat = async () => {
    if (!client?.id) return;
    const ok = await confirm({
      title: 'Clear entire chat?',
      message: `This deletes every message between you and ${client.firstName} ${client.lastName} for both sides. There will be no trace.`,
      confirmLabel: 'Clear chat',
      tone: 'danger',
    });
    if (!ok) return;
    const snapshot = clientChat;
    setClientChat([]);
    try {
      await clearAdminChat(client.id);
      showNotification && showNotification('Chat cleared.');
    } catch (err) {
      setClientChat(snapshot);
      showNotification && showNotification(err?.message || 'Failed to clear chat.');
    }
  };


  const handleSetClientPassword = async () => {
    if (!client || !passwordInput.trim()) return;
    const pwd = passwordInput.trim();
    try {
      await adminSetClientPassword(client.id, pwd);
      setLiveClientPassword(pwd);
      setPasswordInput('');
      showNotification(`Password updated for ${client.firstName} ${client.lastName}.`, 'success');
    } catch (err) {
      showNotification(`Failed to set password: ${err.message || 'unknown error'}`, 'error');
    }
  };

  useEffect(() => {
    if (client) {
      setStatus(normalizeStage(client.stage || 'New'));
      setComment(client.comment || '');
      setPasswordInput('');
    }
  }, [client?.id, client?.stage]);

  useEffect(() => {
    if (!canManageClientSecurity || !client?.id || !showSecurityModal) {
      setLiveClientPassword('');
      setPasswordLoadError('');
      setPasswordLoading(false);
      return;
    }
    let cancelled = false;
    setLiveClientPassword('');
    setPasswordLoadError('');
    setPasswordLoading(true);
    getClientPortalPasswordAdmin(client.id)
      .then((password) => {
        if (!cancelled) setLiveClientPassword(password);
      })
      .catch((error) => {
        if (!cancelled) setPasswordLoadError(error?.message || 'Could not load the saved portal password.');
      })
      .finally(() => {
        if (!cancelled) setPasswordLoading(false);
      });
    return () => { cancelled = true; };
  }, [canManageClientSecurity, showSecurityModal, client?.id]);

  const handleSendClientMessage = async () => {
    const text = chatInput.trim();
    if (!client || !text || chatSending) return;
    setChatSending(true);
    setChatError('');
    clearTimeout(typingTimeoutRef.current);
    postAdminPresence(client.id, { isTyping: false }).catch(() => {});
    // Optimistic insert so the agent sees their message immediately even
    // before the backend confirms. We tag it with a temp id and overwrite
    // the row when the saved message comes back.
    const tempId = `tmp-${Date.now()}`;
    const optimistic = {
      id:        tempId,
      sender:    'agent',
      text,
      body:      text,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      readAt:    null,
      pending:   true,
    };
    setClientChat(prev => [...prev, optimistic]);
    setChatInput('');
    try {
      const saved = await sendAdminMessage(client.id, text);
      setClientChat(prev => prev.map(m => (m.id === tempId && saved ? saved : m)));
    } catch (err) {
      // Roll back the optimistic insert and put the text back so the
      // agent can retry without retyping.
      setClientChat(prev => prev.filter(m => m.id !== tempId));
      setChatInput(text);
      setChatError(err?.message || 'Failed to send message.');
      showNotification && showNotification(err?.message || 'Failed to send message.');
    } finally {
      setChatSending(false);
    }
  };

  if (!client) {
    return (
      <div className="crm-card">
        <h2>Client Not Found</h2>
        <p>This client either does not exist or is not available to this admin.</p>
        <button className="crm-small-btn" onClick={() => navigate(workspacePath)}>Back to clients</button>
      </div>
    );
  }

  const currentIndex = visibleClients.findIndex((l) => l.id === client.id);
  const prevClient = visibleClients[currentIndex - 1] || null;
  const nextClient = visibleClients[currentIndex + 1] || null;

  const handleStatusChange = (newStatus) => {
    setStatus(newStatus);
  };

  const handleSaveStatus = async () => {
    if (status === client.stage || statusSaving) {
      if (status === client.stage) showNotification('Status unchanged.');
      return;
    }
    setStatusSaving(true);
    try {
      const savedClient = await updateClient(client.id, {
        stage: status,
        _actorName: actorName,
        _actorId: currentUser?.id,
      });
      if (savedClient) showNotification('Status saved to workflow.');
    } finally {
      setStatusSaving(false);
    }
  };

  const actorName = currentUser?.name || 'Unknown';
  const handclientdComment = async () => {
    if (!comment.trim()) return;
    const savedClient = await updateClient(client.id, {
      comment: comment.trim(),
      lastCommentDate: new Date().toISOString().slice(0, 10),
      _actorName: actorName,
      _actorId: currentUser?.id,
    });
    if (!savedClient) return;
    showNotification('Comment posted successfully.');
    setComment('');
  };

  const handleClearComments = async () => {
    if (!isSuperAdmin || !commentHistory.length) return;
    const ok = await confirm({
      title: 'Clear comment history?',
      message: 'Permanently delete all comments from this client profile? This cannot be undone.',
      confirmLabel: 'Clear Comments',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const updated = await clearClientCommentsApi(client.id);
      setData((previous) => ({
        ...previous,
        clients: previous.clients.map((item) => item.id === client.id ? updated : item),
      }));
      showNotification('Comment history cleared.');
    } catch (error) {
      console.error('[AgentPanel] clearComments failed', error);
      showNotification(error?.message || 'Failed to clear comments.');
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!isSuperAdmin) return;
    const ok = await confirm({
      title: 'Delete comment?',
      message: 'Delete this comment from the client history? This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const updated = await deleteClientCommentApi(client.id, commentId);
      if (updated && updated.id) {
        setData((previous) => ({
          ...previous,
          clients: previous.clients.map((item) => item.id === client.id ? updated : item),
        }));
      }
      showNotification('Comment removed.');
    } catch (err) {
      console.error('[AgentPanel] deleteComment failed', err);
      showNotification('Failed to delete comment.');
    }
  };

  const handleDeleteStatusEntry = async (idx) => {
    if (!isSuperAdmin) return;
    const entry = (client.statusHistory || [])[idx];
    if (!entry) return;
    const ok = await confirm({
      title: 'Delete status entry?',
      message: 'Delete this status-change entry from the client history? This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const serverClient = await deleteClientstatusEntryApi(client.id, entry.id);
      if (serverClient?.id) {
        setData((previous) => ({
          ...previous,
          clients: previous.clients.map((item) => item.id === client.id ? serverClient : item),
        }));
      }
      showNotification('Status entry removed.');
    } catch {
      showNotification('Failed to delete status entry - please try again.');
    }
  };

  const handleClearStatusHistory = async () => {
    if (!isSuperAdmin || !statusHistory.length) return;
    const ok = await confirm({
      title: 'Clear status workflow?',
      message: 'Permanently clear the status-change history without changing the client’s current status? This cannot be undone.',
      confirmLabel: 'Clear Workflow',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const updated = await clearClientStatusHistoryApi(client.id);
      setData((previous) => ({
        ...previous,
        clients: previous.clients.map((item) => item.id === client.id ? updated : item),
      }));
      showNotification('Status workflow cleared.');
    } catch (error) {
      console.error('[AgentPanel] clearStatusHistory failed', error);
      showNotification(error?.message || 'Failed to clear status workflow.');
    }
  };

  const handclientdAppointment = async () => {
    if (!appointmentDate || !appointmentTime || !appointmentTitle.trim()) {
      showNotification('Date, time, and title are required to create appointment.');
      return;
    }
    setAppointmentSaving(true);
    try {
      const appointment = await createUserAppointment(client.id, {
        title: appointmentTitle.trim(),
        date: appointmentDate,
        time: appointmentTime,
        notes: appointmentNotes.trim() || 'No additional notes',
        type: 'call',
      });
      if (!appointment?.id) throw new Error('The server did not return the saved appointment.');
      setData((previous) => ({
        ...previous,
        clients: previous.clients.map((item) =>
          item.id === client.id
            ? { ...item, appointments: [...(item.appointments || []), appointment] }
            : item
        ),
      }));
      showNotification('Appointment scheduled successfully.');
      setAppointmentDate('');
      setAppointmentTime('');
      setAppointmentTitle('');
      setAppointmentNotes('');
      setShowAppointmentModal(false);
    } catch (error) {
      showNotification(error?.message || 'Failed to save appointment.');
    } finally {
      setAppointmentSaving(false);
    }
  };

  const commentHistory = (client.commentHistory || []).filter(
    (c) => c && c.text && !/^assigned to\b/i.test(String(c.text).trim())
  ).sort((a, b) => new Date(b.createdAt || b.date || 0).getTime() - new Date(a.createdAt || a.date || 0).getTime());
  const statusHistory = [...(client.statusHistory || [])].sort(
    (a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime()
  );
  const assignedByDisplay = (client.assignedBy || '').split('→').pop().trim() || '-';

  return (
    <>
    {confirmDialog}
    <div className="crm-card crm-agent-profile-full">
      <div className="crm-panel-header">
        <div className="crm-nav-left">
          <button className="crm-small-btn" onClick={() => navigate(workspacePath)}>Back to clients</button>
        </div>
        <div className="crm-nav-right">
          <button className="crm-small-btn" onClick={() => prevClient && navigate(getClientProfilePath(role, currentUser.id, prevClient.id))} disabled={!prevClient}>◀ Prev</button>
          <button className="crm-small-btn" onClick={() => nextClient && navigate(getClientProfilePath(role, currentUser.id, nextClient.id))} disabled={!nextClient}>Next ▶</button>
        </div>
      </div>
      <div className="crm-section-title crm-inline-91c912957d" >
        <div className="crm-inline-6b94054e0a">
          <div className="crm-inline-8d7c2d32f3">
            <span className="crm-inline-37e853796e" style={{background: client.isOnline ? '#0ECB81' : 'var(--crm-text-secondary)'}} />
            <span className="crm-inline-f92d9147b8" style={{color: client.isOnline ? '#0ECB81' : 'var(--crm-text-secondary)'}}>
              {client.isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <h2 className="crm-inline-ff227d0632">Client Profile: {client.firstName || client.name} {client.lastName || ''}</h2>
        </div>
        <div className="crm-inline-d300a8a829">
          <button
            className="crm-small-btn crm-action-btn crm-login-btn crm-inline-93c6e1d4bb"

            onClick={async () => {
              if (!client?.id) return;
              try {
                await enterClientPortal(client.id);
              } catch (error) {
                showNotification(error?.message || 'Could not enter client account.');
              }
            }}
          >
            Enter Client Account
          </button>
        </div>
        <div className="crm-profile-action-buttons">
          <button type="button" className="crm-action-btn crm-activity-btn" onClick={() => setShowActivityModal(true)} title="View client activity"><PaIcon name="activity" />Activity</button>
          <button type="button" className="crm-action-btn crm-appointment-btn" onClick={() => setShowAppointmentModal(true)} title="Schedule appointment"><PaIcon name="appointment" />Appointments</button>
          {canManageClientSecurity && <button type="button" className="crm-action-btn crm-security-btn" onClick={() => setShowSecurityModal(true)} title="Client security settings"><PaIcon name="security" />Client Security</button>}
          <button type="button" className="crm-action-btn crm-support-btn" onClick={() => setShowChatModal(true)} title="Open support chat"><PaIcon name="support" />Client Support</button>
          <button type="button" className="crm-action-btn crm-contact-btn" onClick={() => setCommunicationOpen(true)} title="Email, WhatsApp or call this client">Contact</button>
          {isSuperAdmin && (
            <button
              type="button"
              className="crm-action-btn crm-email-accounts-btn"
              onClick={() => setEmailAccountsOpen((open) => !open)}
              aria-expanded={emailAccountsOpen}
              aria-controls="crm-client-email-accounts"
              title="Manage this client's assigned email accounts"
            >
              Email Accounts
            </button>
          )}
        </div>
      </div>

      {/* Quick Direct Communication Bar */}
      <div className="crm-inline-aad9ec8e0d">
        {client.email && (
          <button
            type="button"
            onClick={() => setCommunicationOpen(true)}
            className="crm-inline-f427bbe513"
            title="Send email"
          >
            <svg className="crm-inline-4a0b60ab32" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            <span>Email: {client.email}</span>
          </button>
        )}
        {client.phone && (
          <button
            type="button"
            onClick={() => setCommunicationOpen(true)}
            className="crm-inline-7ae5c9168f"
            title="Call client"
          >
            <svg className="crm-inline-4a0b60ab32" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            <span>Call: {client.phone}</span>
          </button>
        )}
        {client.phone && (
          <button
            type="button"
            onClick={() => setCommunicationOpen(true)}
            className="crm-inline-90b1bb8b63"
            title="WhatsApp chat"
          >
            <span>WhatsApp Direct</span>
          </button>
        )}
      </div>

      <CommunicationActionModal
        open={communicationOpen}
        title={`${client.firstName || client.name || 'Client'} communication`}
        account={{ email: client.email, phone: client.phone }}
        clientId={client.id}
        onClose={() => setCommunicationOpen(false)}
      />

      {isSuperAdmin && emailAccountsOpen && (
        <section id="crm-client-email-accounts" className="crm-client-email-accounts-panel" aria-label="Client email accounts">
          <div className="crm-client-email-accounts-heading">
            <h3>Email Accounts</h3>
            <button type="button" className="crm-small-btn" onClick={() => setEmailAccountsOpen(false)}>
              Close
            </button>
          </div>
          <ClientEmailAccounts client={client} clients={data?.clients || []} />
        </section>
      )}

      <div className="crm-detail-grid crm-detail-grid-three">
        <div className="crm-detail-column">
          <div className="crm-detail-row"><span className="crm-label">ID</span><span className="crm-value">{formatClientId(client.id)}</span></div>
          <div className="crm-detail-row"><span className="crm-label">Name</span><span className="crm-value">{client.firstName} {client.lastName}</span></div>
          <div className="crm-detail-row"><span className="crm-label">Phone</span><span className="crm-value">{client.phone} <button type="button" className="crm-copy-icon" onClick={() => { navigator.clipboard.writeText(client.phone); showNotification('Phone copied to clipboard'); }} aria-label="Copy phone"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z"/></svg></button></span></div>
          <div className="crm-detail-row"><span className="crm-label">Email</span><span className="crm-value">{client.email} <button type="button" className="crm-copy-icon" onClick={() => { navigator.clipboard.writeText(client.email); showNotification('Email copied to clipboard'); }} aria-label="Copy email"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M16 1H4C2.9 1 2 1.9 2 3V17H4V3H16V1ZM19 5H8C6.9 5 6 5.9 6 7V21C6 22.1 6.9 23 8 23H19C20.1 23 21 22.1 21 21V7C21 5.9 20.1 5 19 5ZM19 21H8V7H19V21Z"/></svg></button></span></div>
          <div className="crm-detail-row"><span className="crm-label">Country</span><span className="crm-value crm-country-value">{getCountryFlag(client.countryCode, client.country)}<span className="crm-country-name">{client.country || '-'}</span></span></div>
        </div>
        <div className="crm-detail-column">
          <div className="crm-detail-row"><span className="crm-label">Company</span><span className="crm-value">{client.company || '-'}</span></div>
          <div className="crm-detail-row"><span className="crm-label">Service</span><span className="crm-value crm-inline-8d06347a1d" >{client.service || client.funnel || '-'}</span></div>
          <div className="crm-detail-row"><span className="crm-label">Budget</span><span className="crm-value crm-inline-3eb74d2458" >{client.budget || '-'}</span></div>
          <div className="crm-detail-row"><span className="crm-label">Timeline</span><span className="crm-value">{client.timeline || '-'}</span></div>
          <div className="crm-detail-row"><span className="crm-label">Origin</span><span className="crm-value">{client.source === 'website_contact_modal' ? 'Website Modal' : client.source === 'website_contact_form' ? 'Website Form' : (client.source || '-')}</span></div>
        </div>
        <div className="crm-detail-column">
          <div className="crm-detail-row"><span className="crm-label">Status</span><span className={`crm-status-chip ${statusClass(status)}`}>{status}</span></div>
          <div className="crm-field-group crm-status-dropdown-right">
            <label>Select Status</label>
            <select value={status} onChange={(e) => handleStatusChange(e.target.value)}>
              {CLIENT_STATUSES.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <button
              type="button"
              className="crm-post-comment-btn crm-inline-e86517ef95"
              onClick={handleSaveStatus}
              disabled={statusSaving}
            >{statusSaving ? 'Saving...' : 'Save Status'}</button>
          </div>
          <div className="crm-detail-row"><span className="crm-label">Office / Team</span><span className="crm-value">{getOfficeName(client.assignedToOffice, data.offices)} · {getTeamName(client.assignedToTeam, data.teams)}</span></div>
          <div className="crm-detail-row">
            <span className="crm-label">Registered</span>
            <span className="crm-value">
              {isEditingRegistered ? (
                <span className="crm-inline-759bb7f41c">
                  <input
                    type="date"
                    value={registeredDateInput ? (isNaN(new Date(registeredDateInput).getTime()) ? '' : new Date(registeredDateInput).toISOString().slice(0, 10)) : ''}
                    onChange={(e) => {
                      if (e.target.value) {
                        const [y, m, d] = e.target.value.split('-');
                        const dObj = new Date(Number(y), Number(m) - 1, Number(d));
                        setRegisteredDateInput(dObj.toLocaleDateString());
                      }
                    }}
                    className="crm-inline-b5cf12137c"
                  />
                  <button
                    type="button"
                    className="crm-small-btn crm-inline-33d697b37d"

                    onClick={async () => {
                      if (!registeredDateInput) return;
                      await updateClient(client.id, { registeredDate: registeredDateInput, registered_date: registeredDateInput });
                      setIsEditingRegistered(false);
                      showNotification && showNotification('Registered date updated.');
                    }}
                  >Save</button>
                  <button
                    type="button"
                    className="crm-small-btn crm-inline-e775409f7f"

                    onClick={() => setIsEditingRegistered(false)}
                  >✕</button>
                </span>
              ) : (
                <span className="crm-inline-19084e6959">
                  <span>{displayRegisteredDate}</span>
                  <button
                    type="button"
                    onClick={() => setIsEditingRegistered(true)}
                    className="crm-inline-e33ed14f2e"
                    title="Click to edit registered date"
                  >
                    Edit
                  </button>
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Customer Submission Message */}
      {client.message && (
        <div className="crm-inline-bf7fbdd9f1">
          <div className="crm-inline-42e562353d">
            Customer Submission Message
          </div>
          <div className="crm-inline-c5fd0c267b">
            "{client.message}"
          </div>
        </div>
      )}

      {/* Internal Staff Follow-Up Notes */}
      {client.notes && (
        <div className="crm-inline-a248245451">
          <div className="crm-inline-075ac62c27">
            Internal Staff Follow-Up Notes
          </div>
          <div className="crm-inline-035803fe57">
            {client.notes}
          </div>
        </div>
      )}

      {profilePermissionsError && !isSuperAdmin && (
        <div role="alert" className="crm-inline-380edd0ade">
          {profilePermissionsError}
        </div>
      )}

      {(canReadAccessSection || canReadAccountingSection || isSuperAdmin) && (
        <details aria-label="Client account sections" className="crm-client-account-details">
          <summary>Client Account</summary>
          <div className="crm-client-account-panels">
            {canReadAccessSection && (
              <details className="crm-client-account-panel">
                <summary>Client Access</summary>
                <div className="crm-inline-2fc162ef25">
                  <ClientAccessEditor clientId={client.id} showNotification={showNotification} canEdit={canEditAccessSection} />
                </div>
              </details>
            )}
            {canReadAccountingSection && (
              <details className="crm-client-account-panel">
                <summary>Client Accounting</summary>
                <div className="crm-inline-2fc162ef25">
                  <ClientAccountingPanel clientId={client.id} clientName={client.name || client.company || 'Client'} clientEmail={client.email || ''} showNotification={showNotification} canEdit={canEditAccountingSection} />
                </div>
              </details>
            )}
            {isSuperAdmin && (
              <details className="crm-client-account-panel">
                <summary>Staff Access to this Client</summary>
                <div className="crm-inline-2fc162ef25">
                  <ClientProfilePermissionManager clientId={client.id} showNotification={showNotification} />
                </div>
              </details>
            )}
          </div>
        </details>
      )}

      <div className="crm-profile-grid">
        <div className="crm-profile-column crm-comment-column">
          <div className="crm-comment-card">
            <h3>Comment</h3>
            <div className="crm-comment-input-area">
              <textarea rows={10} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note about this client..." />
              <div className="crm-comment-input-actions">
                <button className="crm-post-comment-btn" onClick={handclientdComment} disabled={!comment.trim()}>Save</button>
              </div>
            </div>
          </div>

          <div className="crm-comment-history-card">
            <div className="crm-profile-history-header">
              <h3>Comment History</h3>
              {isSuperAdmin && commentHistory.length > 0 && (
                <button type="button" className="crm-history-clear-btn" onClick={handleClearComments}>Clear comments</button>
              )}
            </div>
            {commentHistory.length === 0 ? (
              <p>No comments yet. Please add client interaction notes.</p>
            ) : (
              <div className="crm-comment-history-container">
                <ul className="crm-comment-history-list">
                  {commentHistory.map((entry, idx) => (
                    <li key={entry.id || `${entry.createdAt || entry.date}-${idx}`} className="crm-comment-history-item">
                      <div className="crm-comment-meta">
                        <span className="crm-comment-author">{entry.by || 'Unknown'}</span>
                        <span className="crm-comment-date">
                          <span>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : entry.date}</span>
                          {isSuperAdmin && (
                            <button
                              type="button"
                              onClick={() => handleDeleteComment(entry.id)}
                              className="crm-inline-107472a404"
                              title="Delete comment (super admin)"
                            >✕</button>
                          )}
                        </span>
                      </div>
                      <div className="crm-comment-text">{entry.text}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="crm-status-workflow-column">
          <div className="crm-status-workflow-card">
            <div className="crm-profile-history-header">
              <h3>Status Workflow</h3>
              {isSuperAdmin && statusHistory.length > 0 && (
                <button type="button" className="crm-history-clear-btn" onClick={handleClearStatusHistory}>Clear workflow</button>
              )}
            </div>
            <div className="crm-status-timeline">
              {statusHistory.length === 0 ? (
                <div className="crm-status-timeline-empty">No status changes recorded yet. Update the status to start tracking the workflow.</div>
              ) : (
                statusHistory.map((entry, idx) => {
                  return (
                    <div key={entry.id || idx} className="crm-status-timeline-row">
                      <div className="crm-status-timeline-arrow">
                        <span className="crm-status-pill crm-inline-80bcfb521b"  style={{color: stageColor(entry.from), border: `1px solid ${stageColor(entry.from)}`}}>{entry.from}</span>
                        <span className="crm-status-pill-arrow">→</span>
                        <span className="crm-status-pill crm-inline-80bcfb521b"  style={{color: stageColor(entry.to), border: `1px solid ${stageColor(entry.to)}`}}>{entry.to}</span>
                      </div>
                      <div className="crm-status-timeline-meta">
                      <span>By <span className="crm-by">{entry.byName || 'Unknown'}</span></span>
                      <span>{entry.at ? new Date(entry.at).toLocaleString() : ''}</span>
                    </div>
                    {isSuperAdmin && (
                      <div className="crm-inline-9a325a2ee1">
                        <button type="button" className="crm-delete-entry-btn" onClick={() => handleDeleteStatusEntry(idx)}>✕ Delete entry</button>
                      </div>
                    )}
                  </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {showAppointmentModal && (
        <div className="crm-modal-overlay" onClick={() => setShowAppointmentModal(false)}>
          <div className="crm-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="crm-modal-header">
              <h3>Schedule Appointment for {client.firstName} {client.lastName}</h3>
              <button className="crm-small-btn" onClick={() => setShowAppointmentModal(false)}>Close</button>
            </div>
            <div className="crm-field-group">
              <label>Title</label>
              <input className="crm-input" type="text" value={appointmentTitle} placeholder="e.g., Proposal meeting" onChange={(e) => setAppointmentTitle(e.target.value)} />
            </div>
            <div className="crm-field-group">
              <label>Date</label>
              <input className="crm-input" type="date" value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} />
            </div>
            <div className="crm-field-group">
              <label>Time</label>
              <input className="crm-input" type="time" value={appointmentTime} onChange={(e) => setAppointmentTime(e.target.value)} />
            </div>
            <div className="crm-field-group">
              <label>Notes</label>
              <textarea className="crm-input" rows={4} value={appointmentNotes} placeholder="Optional notes" onChange={(e) => setAppointmentNotes(e.target.value)} />
            </div>
            <div className="crm-comment-input-actions crm-inline-ec035d0d30" >
              <button className="crm-post-comment-btn" onClick={handclientdAppointment} disabled={appointmentSaving || !appointmentDate || !appointmentTime || !appointmentTitle.trim()}>{appointmentSaving ? 'Saving…' : 'Save Appointment'}</button>
            </div>
          </div>
        </div>
      )}

      {canManageClientSecurity && showSecurityModal && (
        <div className="crm-modal-overlay" onClick={() => setShowSecurityModal(false)}>
          <div className="crm-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="crm-modal-header">
              <h3>Client Security - {client.firstName} {client.lastName}</h3>
              <button className="crm-small-btn" onClick={() => setShowSecurityModal(false)}>Close</button>
            </div>
            <div className="crm-field-group crm-inline-72d6c38e5f" >
              <label>Current Password</label>
              <div className="crm-inline-9484aff0bd">
                <input
                  className="crm-input crm-inline-ee3d55bf99"
                  type={showClientPassword ? 'text' : 'password'}
                  value={liveClientPassword}
                  readOnly
                  placeholder="Not set"

                />
                <button
                  className="crm-small-btn"
                  type="button"
                  onClick={() => setShowClientPassword((prev) => !prev)}
                >
                  {showClientPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {passwordLoading && <small>Loading saved password…</small>}
              {passwordLoadError && <small role="alert">{passwordLoadError}</small>}
              {!passwordLoading && !passwordLoadError && !liveClientPassword && <small>No recoverable password is saved. Set a new password to enable viewing.</small>}
            </div>
            <div className="crm-field-group crm-inline-72d6c38e5f" >
              <label>New Password</label>
              <input className="crm-input" type="text" value={passwordInput} placeholder="Enter new password" onChange={(e) => setPasswordInput(e.target.value)} autoComplete="off" />
            </div>
            <div className="crm-row crm-inline-13862e6b2a" >
              <button className="crm-small-btn" onClick={handleSetClientPassword} disabled={!passwordInput.trim()}>Save Password</button>
            </div>
          </div>
        </div>
      )}

      {showChatModal && (
        <div className="crm-modal-overlay" onClick={() => setShowChatModal(false)}>
          <div className="crm-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="crm-modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <h3>Support Chat with {client.firstName}</h3>
              <div className="crm-inline-54a4986ffc" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
                <button
                  className="crm-small-btn crm-inline-420f1b2708"
                  onClick={handleClearChat}
                  disabled={clientChat.length === 0}
                   style={{opacity: clientChat.length === 0 ? 0.5 : 1}}
                  title="Delete every message in this conversation, on both sides"
                >
                  <i className="fas fa-trash crm-inline-043e245cc1"  /> Clear chat
                </button>
                <button className="crm-small-btn" onClick={() => setShowChatModal(false)}>Close</button>
              </div>
            </div>
            <div className="crm-chat-window">
              <div className="crm-chat-header">
                <span>{client.firstName} {client.lastName}</span>
                <span className={`crm-online-dot ${client.isOnline ? 'crm-online' : 'crm-offline'}`} />
              </div>
              <div className="crm-chat-box">
                {clientChat.length === 0 && <div className="crm-chat-empty">No messages yet. Start the chat below.</div>}
                {clientChat.map((msg) => {
                  const canDelete = !msg.pending && !String(msg.id).startsWith('tmp-');
                  return (
                  <div key={msg.id} className={`crm-chat-message ${msg.sender === 'agent' ? 'crm-chat-agent' : 'crm-chat-client'}`}>
                    {canDelete && msg.sender !== 'agent' && (
                      <button
                        type="button"
                        onClick={() => handleDeleteMessage(msg.id)}
                        title="Delete message for both sides"
                        aria-label="Delete message"
                        className="crm-chat-delete-btn"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    )}
                    <div className="crm-chat-msg-col">
                      <div className="crm-chat-sender-label">
                        {msg.sender === 'agent'
                          ? (msg.senderName || msg.name || currentUser?.name || 'Agent')
                          : `${client.firstName} ${client.lastName}`}
                      </div>
                      <div className="crm-chat-bubble">
                        <span>{msg.text}{msg.pending ? '  /  sending...' : ''}</span>
                        {msg.attachment && (attachmentUrls[msg.id]
                          ? (
                            <div className="crm-chat-attachment">
                              <img src={attachmentUrls[msg.id]} alt={msg.attachment.name || 'Client attached photo'} />
                              <a
                                href={attachmentUrls[msg.id]}
                                download={msg.attachment.name || 'client-photo'}
                                className="crm-chat-attachment-download"
                              >
                                <i className="fas fa-download" /> Download photo
                              </a>
                            </div>
                          )
                          : <small>Loading attached photo...</small>)}
                        <small>{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}</small>
                      </div>
                    </div>
                    {canDelete && msg.sender === 'agent' && (
                      <button
                        type="button"
                        onClick={() => handleDeleteMessage(msg.id)}
                        title="Delete message for both sides"
                        aria-label="Delete message"
                        className="crm-chat-delete-btn"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
              {chatError && (
                <div className="crm-chat-empty crm-inline-b5eaf818d4" role="alert" >{chatError}</div>
              )}
              <div className="crm-chat-input-row">
                <input
                  type="text"
                  className="crm-input"
                  placeholder="Type a message (Enter to send)"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendClientMessage();
                    }
                  }}
                  disabled={chatSending}
                  autoComplete="off"
                />
                <button className="crm-small-btn" onClick={handleSendClientMessage} disabled={chatSending || !chatInput.trim()}>
                  {chatSending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Activity Modal */}
      {showActivityModal && (
        <div className="crm-modal-overlay" onClick={() => setShowActivityModal(false)}>
          <div className="crm-modal-content crm-extra-large-modal">
            <div className="crm-modal-header">
              <h3>[chart] Client Activity - {client.firstName} {client.lastName}</h3>
              <button className="crm-close-btn" onClick={() => setShowActivityModal(false)}>×</button>
            </div>
            <div className="crm-modal-body">
              <div className="crm-activity-container">
                <div className="crm-activity-overview">
                  <div className="crm-activity-card">
                    <div className="crm-activity-icon">View</div>
                    <div className="crm-activity-value">{client.activityRecord?.pageViews || 0}</div>
                    <div className="crm-activity-label">Page Views</div>
                  </div>
                  <div className="crm-activity-card">
                    <div className="crm-activity-icon">🔄</div>
                    <div className="crm-activity-value">{client.activityRecord?.sessions || 0}</div>
                    <div className="crm-activity-label">Sessions</div>
                  </div>
                  <div className="crm-activity-card">
                    <div className="crm-activity-icon">📅</div>
                    <div className="crm-activity-value">
                      {client.activityRecord?.lastLogin ?
                        Math.floor((new Date() - new Date(client.activityRecord.lastLogin)) / (1000 * 60 * 60 * 24)) : 0
                      }
                    </div>
                    <div className="crm-activity-label">Days Since Login</div>
                  </div>
                  <div className="crm-activity-card">
                    <div className="crm-activity-icon">⚡</div>
                    <div className="crm-activity-value">
                      {client.activityRecord?.pageViews && client.activityRecord?.sessions ?
                        Math.round(client.activityRecord.pageViews / client.activityRecord.sessions) : 0
                      }
                    </div>
                    <div className="crm-activity-label">Avg Pages/Session</div>
                  </div>
                </div>

                <div className="crm-activity-chart">
                  <h4>Activity Timeline</h4>
                  <div className="crm-activity-timeline">
                    {client.activityRecord ? (
                      <>
                        <div className="crm-timeline-item">
                          <div className="crm-timeline-icon">🔑</div>
                          <div className="crm-timeline-content">
                            <div className="crm-timeline-title">Last Login</div>
                            <div className="crm-timeline-description">Client last accessed their account</div>
                            <div className="crm-timeline-time">{new Date(client.activityRecord.lastLogin).toLocaleDateString('en-US', {
                              weekday: 'long',
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}</div>
                          </div>
                        </div>
                        <div className="crm-timeline-item">
                          <div className="crm-timeline-icon">[chart]</div>
                          <div className="crm-timeline-content">
                            <div className="crm-timeline-title">Session Activity</div>
                            <div className="crm-timeline-description">{client.activityRecord.sessions} sessions recorded</div>
                            <div className="crm-timeline-time">Total page views: {client.activityRecord.pageViews}</div>
                          </div>
                        </div>
                        <div className="crm-timeline-item">
                          <div className="crm-timeline-icon">[agent]</div>
                          <div className="crm-timeline-content">
                            <div className="crm-timeline-title">Engagement Metrics</div>
                            <div className="crm-timeline-description">Client engagement and platform usage</div>
                            <div className="crm-timeline-time">Average {Math.round(client.activityRecord.pageViews / client.activityRecord.sessions) || 0} pages per session</div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="crm-timeline-item">
                        <div className="crm-timeline-icon"></div>
                        <div className="crm-timeline-content">
                          <div className="crm-timeline-title">No Activity Recorded</div>
                          <div className="crm-timeline-description">Activity data will appear here once the client starts using the platform</div>
                          <div className="crm-timeline-time">Monitoring started: {new Date().toLocaleDateString()}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="crm-export-section">
                  <button className="crm-export-btn" onClick={() => {
                    const data = client.activityRecord ? [{
                      lastLogin: client.activityRecord.lastLogin,
                      pageViews: client.activityRecord.pageViews,
                      sessions: client.activityRecord.sessions
                    }] : [];
                    const csv = 'Last Login,Page Views,Sessions\n' + data.map(d => `${d.lastLogin},${d.pageViews},${d.sessions}`).join('\n');
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `activity-report-${client.firstName}-${client.lastName}.csv`;
                    a.click();
                    showNotification('Activity report exported successfully');
                  }}>
                    [chart] Export Report
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditClientModal && (
        <EditClientModal
          client={client}
          onClose={() => setShowEditClientModal(false)}
          onSave={(updates) => {
            updateClient(client.id, { ...updates, _actorName: actorName, _actorId: currentUser?.id });
            setShowEditClientModal(false);
            showNotification(`Profile updated for ${updates.firstName || client.firstName} ${updates.lastName || client.lastName}`);
          }}
        />
      )}

    </div>
    </>
  );
}

export { ClientProfilePage };
export default AgentPanel;
