import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Routes,
  Route,
  Link,
  Navigate,
  useParams,
  useNavigate,
} from 'react-router-dom';
import './admin.css';
import './CrmTheme.css';
import './CRMInlineStyles.css';
import StaffLogin from './components/Login/StaffLogin.jsx';
import RoleLogin from './components/Login/RoleLogin.jsx';
import {
  getAdminToken,
  getStoredAdminProfile,
  getStaffCapabilities,
  mapAdminToUser,
  fetchAdminMe,
  createOffice,
  createTeam,
  createAgentApi,
  createStaffApi,
  assignOfficeManagerApi,
  blockStaffApi,
  unblockStaffApi,
  listOffices,
  listTeams,
  listClients,
  fetchAllClients,
  fetchClientById,
  listStaff,
  updateClientApi,
  assignClientApi,
  createClientApi,
  sendHeartbeat,
} from './adminApi';

import {
  ROLE,
  ErrorBoundary,
  makeLoginLink,
  initialData,
  getOfficeName,
  getTeamName,
  getUserName,
  getTeamAgentCount,
  normalizeClientAssignment,
} from './shared';

import SuperAdminPanel from './panels/SuperAdminPanel.jsx';
import OfficeManagerPanel from './panels/OfficeManagerPanel.jsx';
import TeamLeaderPanel from './panels/TeamLeaderPanel.jsx';
import AgentPanel, { ClientProfilePage } from './panels/AgentPanel.jsx';
import StaffProfilePage from './components/StaffProfilePage.jsx';
import AdminHeader from './components/AdminHeader.jsx';
import ReactCapabilityWorkspace from './components/ReactCapabilityWorkspace.jsx';
import { Crown, Building2, Users, UserCheck, Briefcase, ArrowRight, ShieldCheck } from 'lucide-react';
import { applyCrmThemeToDom, loadCrmThemeFromServer } from './components/CrmSettings/crmThemeState';
import { useSiteConfig } from '../../context/SiteConfigContext';
import './crm-matte.css';
import './components/AdminHeader.css';

const CRM_ICON_TOKENS = {
  office: '🏢',
  users: '👥',
  agents: '👥',
  agent: '👤',
  user: '👤',
  money: '💰',
  card: '💳',
  list: '☷',
  search: '⌕',
  upload: '↥',
  file: '▤',
  chart: '▥',
  status: '●',
  trend: '↗',
  top: '★',
  pending: '◷',
  deposit: '💰',
  security: '🔒',
  reload: '↻',
  close: '×',
  unknown: '?',
};

const WINDOWS_1252_BYTES = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c,
  'ž': 0x9e, 'Ÿ': 0x9f,
};

function repairLegacyUtf8(value) {
  if (!/[ðâÃ]/.test(value)) return value;
  const bytes = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0xff) bytes.push(codePoint);
    else if (WINDOWS_1252_BYTES[character] !== undefined) bytes.push(WINDOWS_1252_BYTES[character]);
    else return value;
  }
  try {
    const repaired = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
    return repaired.includes('�') ? value : repaired;
  } catch (_) {
    return value;
  }
}

function normalizeCrmText(value) {
  const repaired = repairLegacyUtf8(value).replace(/\[([a-z][a-z -]{1,40})\]/gi, (token, name) => (
    CRM_ICON_TOKENS[name.toLowerCase()] || token
  ));
  return repaired.replace(/ðŸ¢/g, '🏢');
}

function useCrmTextNormalization() {
  useEffect(() => {
    let scheduled = false;

    const normalize = () => {
      const root = document.querySelector('.crm-admin-app');
      if (!root) return;

      observer?.disconnect();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      let node = walker.nextNode();
      while (node) {
        if (!node.parentElement?.closest('script, style')) textNodes.push(node);
        node = walker.nextNode();
      }
      textNodes.forEach((textNode) => {
        const nextValue = normalizeCrmText(textNode.nodeValue || '');
        if (nextValue !== textNode.nodeValue) textNode.nodeValue = nextValue;
      });

      root.querySelectorAll('[placeholder], [title], [aria-label], optgroup[label]').forEach((element) => {
        ['placeholder', 'title', 'aria-label', 'label'].forEach((attribute) => {
          if (!element.hasAttribute(attribute)) return;
          const currentValue = element.getAttribute(attribute);
          const nextValue = normalizeCrmText(currentValue || '');
          if (nextValue !== currentValue) element.setAttribute(attribute, nextValue);
        });
      });

      observer?.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'title', 'aria-label', 'label'],
      });
    };

    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        normalize();
      });
    });
    normalize();
    return () => observer.disconnect();
  }, []);
}

// Re-export shared symbols that admin sub-components still import from `../../App`.
// Keeping this barrel export prevents a sweeping import-path rewrite across
// every component file just to support the panel split.
export { DataContext, NotificationContext, CLIENT_STATUSES } from './shared';

function RolePage({ data, dataLoading, role, setClientAssignment, assignOfficeManager, createOfficeWithManager, createStandaloneOfficeManager, assignTeamLeader, createTeamLeader, createStandaloneTeamLeader, createAgent, assignAgent, toggleStaffBlocked, setData, setUserLoginState, updateClient, createClient, showNotification }) {
  const { userId } = useParams();
  const user = data.users.find((u) => u.id === userId);
  const [capabilities, setCapabilities] = useState({});
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);

  useEffect(() => {
    if (![ROLE.OFFICE_MANAGER, ROLE.TEAM_LEAD, ROLE.AGENT].includes(role) || !user?.id) {
      setCapabilities({});
      setCapabilitiesLoaded(false);
      return;
    }
    let cancelled = false;
    const loadCapabilities = async () => {
      setCapabilitiesLoaded(false);
      try {
        const result = await getStaffCapabilities(user.id);
        if (cancelled) return;
        setCapabilities(result?.capabilities || {});
        setCapabilitiesLoaded(true);
      } catch (error) {
        console.error('[RolePage] failed to load staff capabilities', error);
        if (!cancelled) showNotification(error?.message || 'Could not load your CRM permissions.');
      }
    };
    loadCapabilities();
    const handleCapabilitiesUpdated = (event) => {
      if (!event.detail?.staffId || event.detail.staffId === user.id) loadCapabilities();
    };
    window.addEventListener('codex-capabilities-updated', handleCapabilitiesUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('codex-capabilities-updated', handleCapabilitiesUpdated);
    };
  }, [role, user?.id]);
  const canCreateAgent = capabilitiesLoaded
    && capabilities.create_agent !== false
    && (role !== ROLE.TEAM_LEAD || Boolean(user?.teamId));
  const canUploadClient = capabilitiesLoaded && capabilities.client_upload !== false;
  const canManageClientSecurity = role === ROLE.SUPER_ADMIN
    || (capabilitiesLoaded && capabilities.security !== false);
  const canUseChat = capabilitiesLoaded && capabilities.chat !== false;
  const canUseNotifications = capabilitiesLoaded && capabilities.notifications !== false;

  if (!user) {
    if (dataLoading) {
      return (
        <div className="crm-inline-0e55b72440">
          Loading...
        </div>
      );
    }
    return <Navigate to="/admin" replace />;
  }
  if (user.role !== role) {
    return (
      <div className="crm-app-shell">
        <AdminHeader roleMismatch />
        <div className="crm-body-grid">
          <aside className="crm-sidebar">
            <h2>Dashboard</h2>
            <Link className="crm-nav-link" to="">Home</Link>
          </aside>
          <main className="crm-main-content">
            <div className="crm-card"><h3>Access Denied</h3><p>Client role mismatch for this route.</p><Link className="crm-link-item" to="">Back Home</Link></div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="crm-app-shell">
      <AdminHeader
        user={user}
        data={data}
        setData={setData}
        messagesEnabled={capabilitiesLoaded && capabilities.chat !== false}
        notificationsEnabled={capabilitiesLoaded && capabilities.notifications !== false}
      />

      <div className={`crm-body-grid ${user.role === ROLE.AGENT ? 'crm-agent-view' : ''} ${user.role === ROLE.TEAM_LEAD ? 'crm-no-sidebar' : ''} ${user.role === ROLE.OFFICE_MANAGER ? 'crm-no-sidebar' : ''} ${user.role === ROLE.SUPER_ADMIN ? 'crm-no-sidebar' : ''}`}>
        {user.role === ROLE.SUPER_ADMIN && (
          <aside className="crm-sidebar">
            <h2>Menu</h2>
            <Link className="crm-nav-link" to="/admin">Home</Link>
            <Link className="crm-nav-link" to={`/admin/super-admin/${user.id}`}>Workspace</Link>

            <div className="crm-sidebar-subhead">Office Managers</div>
            {data.users.filter((u) => u.role === ROLE.OFFICE_MANAGER).map((mgr) => (
              <Link key={mgr.id} className="crm-nav-link" to={`/admin/office-manager/${mgr.id}`}>{mgr.name}</Link>
            ))}

            <div className="crm-sidebar-note">
              <strong>Current</strong>
              <div>{user.name}</div>
              <div>Office: {getOfficeName(user.officeId, data.offices)}</div>
              <div>Team: {getTeamName(user.teamId, data.teams)}</div>
            </div>
          </aside>
        )}

        <main className="crm-main-content">
          <Routes>
            <Route
              path="client/:clientId"
              element={<ClientProfilePage role={role} viewingUser={user} data={data} setData={setData} updateClient={updateClient} canManageClientSecurity={canManageClientSecurity} showNotification={showNotification} />}
            />
            <Route
              path="staff/:staffId"
              element={<StaffProfilePage role={role} viewingUser={user} data={data} setData={setData} toggleStaffBlocked={toggleStaffBlocked} setUserLoginState={setUserLoginState} updateClient={updateClient} showNotification={showNotification} />}
            />
            <Route
              path=""
              element={(
                <>
                  {role === ROLE.SUPER_ADMIN && <SuperAdminPanel data={data} currentUser={user} setData={setData} assignOfficeManager={assignOfficeManager} createOfficeWithManager={createOfficeWithManager} createStandaloneOfficeManager={createStandaloneOfficeManager} createTeamLeader={createTeamLeader} createStandaloneTeamLeader={createStandaloneTeamLeader} createAgent={createAgent} toggleStaffBlocked={toggleStaffBlocked} setClientAssignment={setClientAssignment} setUserLoginState={setUserLoginState} createClient={createClient} showNotification={showNotification} />}
                  {role === ROLE.OFFICE_MANAGER && <OfficeManagerPanel data={data} setData={setData} currentUser={user} assignTeamLeader={assignTeamLeader} createTeamLeader={createTeamLeader} createAgent={createAgent} canCreateAgent={canCreateAgent} canUploadClient={canUploadClient} toggleStaffBlocked={toggleStaffBlocked} setClientAssignment={setClientAssignment} updateClient={updateClient} createClient={createClient} setUserLoginState={setUserLoginState} showNotification={showNotification} />}
                  {role === ROLE.TEAM_LEAD && <TeamLeaderPanel data={data} setData={setData} currentUser={user} createAgent={createAgent} canCreateAgent={canCreateAgent} canUploadClient={canUploadClient} toggleStaffBlocked={toggleStaffBlocked} setClientAssignment={setClientAssignment} updateClient={updateClient} createClient={createClient} setUserLoginState={setUserLoginState} showNotification={showNotification} />}
                  {role === ROLE.AGENT && <AgentPanel data={data} currentUser={user} setData={setData} setUserLoginState={setUserLoginState} createClient={createClient} canManageClientSecurity={canManageClientSecurity} canUseChat={canUseChat} canUseNotifications={canUseNotifications} showNotification={showNotification} />}
                </>
              )}
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function BackofficeLanding() {
  const navigate = useNavigate();
  const { config } = useSiteConfig();
  const name = config.siteName || 'Codex Dynamics';
  const [first, ...rest] = (name || 'Codex Dynamics').split(/[- / \s]+/);
  const second = rest.join(' ') || 'Dynamics';
  const initial = name.trim().charAt(0).toUpperCase() || 'C';

  const portals = [
    { to: '/admin/login/super-admin',    icon: Crown, title: 'Super Admin',    desc: 'Full system governance: offices, teams, staff & clients', accent: '#FF9F0A' },
    { to: '/admin/login/office-manager', icon: Building2, title: 'Office Manager', desc: 'Oversee your office branch, teams, agents and pipeline',  accent: '#0A84FF' },
    { to: '/admin/login/team-leader',    icon: Users, title: 'Team Leader',    desc: 'Coach your unit: monitor agents, calls & active clients',     accent: '#5E5CE6' },
    { to: '/admin/login/agent',          icon: UserCheck, title: 'Sales Agent', desc: 'Work assigned clients, log touchpoints & record deposits', accent: '#30D158' },
  ];

  return (
    <div className="crm-inline-86deeb14b8">
      {/* Background ambient lighting */}
      <div className="crm-inline-df5423c714" />

      {/* Brand Header */}
      <div className="crm-inline-4f6bd6c966">
        <div className="crm-inline-42c2f55563">
          <div className="crm-inline-b1d484ca6f">
            <span className="crm-inline-bb9c0d7fa1">{initial}</span>
          </div>
          <div className="crm-inline-2b34562c9f">
            {first} {second}
          </div>
        </div>
        <div className="crm-inline-98c9d94773">Apple iOS Inspired Backoffice Suite</div>
        <div className="crm-inline-3f22e3d191">Select a role workspace to launch an instant authenticated session.</div>
      </div>

      {/* Role Cards Grid */}
      <div className="crm-inline-93eb14986a">
        {portals.map((p) => {
          const IconComp = p.icon;
          return (
            <div
              key={p.to}
              onClick={() => navigate(p.to)}
              className="crm-inline-776b91ae58 crm-role-portal-card"
              style={{ '--crm-portal-accent': p.accent }}
            >
              <div className="crm-inline-ffab205caa" style={{ background: p.accent }}>
                <IconComp size={24} strokeWidth={2.2} />
              </div>
              <div className="crm-inline-77db9c4b57">{p.title}</div>
              <div className="crm-inline-182f7382ce">{p.desc}</div>
            </div>
          );
        })}
      </div>

      {/* Client Portal Link */}
      <div
        onClick={() => {
          if (typeof window !== 'undefined' && typeof window.cdxNavigate === 'function') {
            window.cdxNavigate('/login');
          } else {
            window.location.assign('/login');
          }
        }}
        className="crm-inline-9ded8c5375 crm-client-portal-link"
      >
        <div className="crm-inline-329df74ede">
          <Briefcase size={14} />
        </div>
        <div className="crm-inline-26cef2c5d8">
          <div className="crm-inline-bdf358a185">Client Workspace Portal</div>
        </div>
        <ArrowRight size={14} className="crm-inline-c646b79021" />
      </div>
    </div>
  );
}

/**
 * Injects a real admin user (from the backend) into a user list,
 * replacing any existing entry with the same id so there are no duplicates.
 */
function injectAdminUser(users, adminUser) {
  const filtered = users.filter((u) => u.id !== adminUser.id);
  return [...filtered, adminUser];
}

// The admin app is backend-driven: offices, teams, clients, and staff users
// hydrate via `loadBackendAdminData()` and the per-panel APIs. Earlier
// localStorage snapshots that cached the entire `data` object client-side
// are removed on mount so client history and assignments stay consistent across
// sessions and admins. Only the admin's own profile is rehydrated synchronously
// (via `getStoredAdminProfile`) so panel routes can find the user in
// `data.users` before the network returns.
const LEGACY_ADMIN_CACHE_KEYS = ['codex_admin_data_legacy'];

function App() {
  useCrmTextNormalization();

  useEffect(() => {
    applyCrmThemeToDom();
    loadCrmThemeFromServer().catch(() => {});
    const handleThemeChange = () => applyCrmThemeToDom();
    window.addEventListener('cdx:crm-theme-changed', handleThemeChange);
    return () => window.removeEventListener('cdx:crm-theme-changed', handleThemeChange);
  }, []);

  const [data, setData] = useState(() => {
    try {
      // Best-effort: clear any legacy data caches so stale client snapshots
      // never resurface from a previous session.
      LEGACY_ADMIN_CACHE_KEYS.forEach((k) => {
        try { localStorage.removeItem(k); } catch (_) {}
      });

      // Synchronously restore the real admin profile so panel routes can find
      // the user in data.users immediately on mount (before any async effect).
      const storedProfile = getStoredAdminProfile();
      if (storedProfile) {
        return {
          ...initialData,
          users: injectAdminUser(initialData.users, mapAdminToUser(storedProfile)),
        };
      }
    } catch (_) {}
    return initialData;
  });
  const [notification, setNotification] = useState('');
  const [appLoaded, setAppLoaded] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const lastClientCreateAt = useRef(0);
  const clientHydrationInProgress = useRef(false);
  const firstPageClientIds = useRef(new Set());

  const loadBackendAdminData = useCallback(async () => {
    const clientsRequestStartedAt = Date.now();
    try {
      const storedProfile = getStoredAdminProfile();
      const isSuperAdmin = storedProfile?.role === ROLE.SUPER_ADMIN;
      const [offices, teams, liveResult, deletedResult, staffRows, deletedOffices, deletedTeams, deletedStaff] = await Promise.all([
        listOffices(),
        listTeams(),
        listClients({ limit: 500, offset: 0 }),
        isSuperAdmin ? listClients({ includeDeleted: 'only', limit: 500, offset: 0 }) : Promise.resolve({ clients: [] }),
        listStaff(),
        isSuperAdmin ? listOffices({ includeDeleted: 'only' }) : Promise.resolve([]),
        isSuperAdmin ? listTeams({ includeDeleted: 'only' }) : Promise.resolve([]),
        isSuperAdmin ? listStaff({ includeDeleted: 'only' }) : Promise.resolve([]),
      ]);

      const recycleBin = [
        ...(deletedOffices || []).map((o) => ({
          id: o.id,
          type: 'office',
          item: o,
          deletedAt: o.deletedAt || new Date().toISOString(),
        })),
        ...(deletedTeams || []).map((t) => ({
          id: t.id,
          type: 'team',
          item: t,
          deletedAt: t.deletedAt || new Date().toISOString(),
        })),
        ...(deletedStaff || []).map((s) => ({
          id: s.id,
          type: 'user',
          item: s,
          deletedAt: s.deletedAt || new Date().toISOString(),
        })),
      ];

      if (clientsRequestStartedAt >= lastClientCreateAt.current) {
        firstPageClientIds.current = new Set((liveResult.clients || []).map((client) => client.id));
      }
      setData((prev) => {
        const storedProfile = getStoredAdminProfile();
        const sessionAdmin = storedProfile
          ? prev.users.find((u) => u.id === storedProfile.id)
          : null;

        let mergedUsers = staffRows;
        if (sessionAdmin && !mergedUsers.some((u) => u.id === sessionAdmin.id)) {
          mergedUsers = [...mergedUsers, sessionAdmin];
        }

        const normalizedClients = clientsRequestStartedAt < lastClientCreateAt.current
          ? prev.clients
          : (liveResult.clients || []).map((client) =>
              normalizeClientAssignment(client, mergedUsers, teams)
            );
        const deletedClients = (deletedResult.clients || []).map((client) =>
          normalizeClientAssignment(client, mergedUsers, teams)
        );

        return {
          ...prev,
          offices,
          teams,
          clients: normalizedClients,
          deletedClients,
          recycleBin,
          users: mergedUsers,
        };
      });

      if (liveResult.hasMore && !clientHydrationInProgress.current) {
        clientHydrationInProgress.current = true;
        void fetchAllClients({ offset: liveResult.clients.length })
          .then(({ clients: remainingClients }) => {
            const completeClientList = [...(liveResult.clients || []), ...remainingClients];
            firstPageClientIds.current = new Set(completeClientList.slice(0, 500).map((client) => client.id));
            setData((prev) => {
              const loaded = completeClientList.map((client) =>
                normalizeClientAssignment(client, prev.users, prev.teams)
              );
              const loadedIds = new Set(loaded.map((client) => client.id));
              const newlyCreated = prev.clients.filter((client) =>
                !loadedIds.has(client.id) && lastClientCreateAt.current > clientsRequestStartedAt
              );
              return {
                ...prev,
                clients: [...loaded, ...newlyCreated],
              };
            });
          })
          .catch((error) => {
            console.warn('[App] background client hydration failed', error);
          })
          .finally(() => {
            clientHydrationInProgress.current = false;
          });
      }

      if (isSuperAdmin && deletedResult.hasMore) {
        void fetchAllClients({
          includeDeleted: 'only',
          offset: deletedResult.clients.length,
        }).then(({ clients: remainingDeletedClients }) => {
          setData((prev) => ({
            ...prev,
            deletedClients: [
              ...(deletedResult.clients || []),
              ...remainingDeletedClients,
            ].map((client) => normalizeClientAssignment(client, prev.users, prev.teams)),
          }));
        }).catch((error) => {
          console.warn('[App] background recycle-bin hydration failed', error);
        });
      }
    } catch (error) {
      console.error('[App] failed to load admin backend data', error);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    setAppLoaded(true);

    window.onerror = (message, source, lineno, colno, error) => {
      console.error('[App] Error:', message, source, lineno, colno, error);
      return true;
    };

    const initSession = async () => {
      try {
        const freshAdmin = await fetchAdminMe();
        const adminUser  = mapAdminToUser(freshAdmin);
        setData((prev) => ({
          ...prev,
          users: injectAdminUser(prev.users, adminUser),
        }));
        await loadBackendAdminData();
      } catch (_) {
        // Token missing or invalid. Do not request protected CRM data before
        // sign-in; addAdminToData loads it after a successful login.
        setDataLoading(false);
      }
    };
    initSession();

    // Keep all role panels fresh while they are open. Search typeahead is
    // server-backed for immediate results; this interval keeps the tables and
    // local selectors in sync too, including clients created by another user.
    const clientRefreshId = setInterval(async () => {
      if (!getAdminToken()) return;
      const refreshStartedAt = Date.now();
      try {
        const liveResult = await listClients({ limit: 500, offset: 0 });
        if (refreshStartedAt < lastClientCreateAt.current) return;
        const previouslyLoadedFirstPage = firstPageClientIds.current;
        firstPageClientIds.current = new Set((liveResult.clients || []).map((client) => client.id));
        setData((prev) => {
          const normalizedClients = (liveResult.clients || []).map((client) =>
            normalizeClientAssignment(client, prev.users, prev.teams)
          );
          const retainedClients = prev.clients.filter((client) =>
            !previouslyLoadedFirstPage.has(client.id)
          );
          return {
            ...prev,
            clients: [...normalizedClients, ...retainedClients],
          };
        });
      } catch (error) {
        console.warn('[App] background client refresh failed', error);
      }
    }, 60000);

    const refreshStaffPresence = () => {
      if (!getAdminToken()) return;
      sendHeartbeat(undefined, window.location.pathname).catch((error) => {
        console.warn('[App] staff presence heartbeat failed', error);
      });
    };
    refreshStaffPresence();
    const staffHeartbeatId = setInterval(refreshStaffPresence, 30000);

    const handleInquirySync = () => {
      loadBackendAdminData();
    };
    window.addEventListener('storage', handleInquirySync);
    window.addEventListener('codex_inquiry_added', handleInquirySync);

    window.onunhandledrejection = (event) => {
      console.error('[App] Unhandled promise rejection:', event.reason);
      return true;
    };
    return () => {
      clearInterval(clientRefreshId);
      clearInterval(staffHeartbeatId);
      window.removeEventListener('storage', handleInquirySync);
      window.removeEventListener('codex_inquiry_added', handleInquirySync);
    };
  }, []);

  if (!appLoaded) {
    return (
      <div className="crm-admin-app crm-inline-55d5573c7a" >
        <h1>Loading application...</h1>
      </div>
    );
  }

  const showNotification = (message) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  /**
   * Called by a login component after a successful real-backend auth.
   * Injects (or replaces) the admin's record in data.users so the panel
   * route can find it via data.users.find(u => u.id === userId).
   */
  const addAdminToData = (adminUser) => {
    setData((prev) => ({
      ...prev,
      users: injectAdminUser(prev.users, adminUser),
    }));
    loadBackendAdminData();
  };

  const setClientAssignment = ({ clientId, officeId, teamId, teamLeaderId, agentId }) => {
    const client = data.clients.find((item) => item.id === clientId);
    if (!client) {
      showNotification(`Client ${clientId} not found`);
      return;
    }

    const agent = agentId ? data.users.find((u) => u.id === agentId) : null;
    if (agentId && !agent) {
      showNotification(`Agent ${agentId} not found`);
      return;
    }

    // When an agent is explicitly specified, derive office/team from the agent record
    // to maintain hierarchy integrity. Otherwise use the explicit values provided.
    // Use explicit null to clear a level; use undefined to keep existing value.
    let targetAgent = agent ? agent.id : (agentId !== undefined ? (agentId || null) : client.assignedToAgent);
    let targetTeam = agent ? agent.teamId : (teamId !== undefined ? (teamId || null) : client.assignedToTeam);
    let targetOffice = agent ? agent.officeId : (officeId !== undefined ? (officeId || null) : client.assignedToOffice);
    const targetTeamLeader = agent
      ? null
      : (teamLeaderId !== undefined ? (teamLeaderId || null) : client.assignedToTeamLeader);

    // If team changed but agent not explicitly changed, clear agent
    if (!agent && teamId !== undefined && teamId !== client.assignedToTeam && agentId === undefined) {
      targetAgent = null;
    }
    // If office changed but team not explicitly changed, clear team and agent
    if (!agent && officeId !== undefined && officeId !== client.assignedToOffice && teamId === undefined) {
      targetTeam = null;
      targetAgent = null;
    }
    // Derive office from team when team is explicitly set but office is not
    if (targetTeam && !targetOffice) {
      const teamObj = data.teams.find(t => t.id === targetTeam);
      if (teamObj) targetOffice = teamObj.officeId;
    }

    const payload = {
      ...client,
      assignedToOffice: targetOffice,
      assignedToTeam: targetTeam,
      assignedToTeamLeader: targetTeamLeader,
      assignedToAgent: targetAgent,
    };

    // Optimistic update keeps the panel snappy; the canonical row from the
    // server replaces it once the assign call returns (so updated_at,
    // assigned_by and any derived names match what the backend stored).
    setData((prev) => ({
      ...prev,
      clients: prev.clients.map((item) =>
        item.id === clientId
          ? {
              ...item,
              assignedToOffice: payload.assignedToOffice,
              assignedToTeam: payload.assignedToTeam,
              assignedToTeamLeader: payload.assignedToTeamLeader,
              assignedToAgent: payload.assignedToAgent,
            }
          : item
      ),
    }));

    assignClientApi(clientId, {
      officeId: payload.assignedToOffice,
      teamId:   payload.assignedToTeam,
      teamLeaderId: payload.assignedToTeamLeader,
      agentId:  payload.assignedToAgent,
    }).then((serverClient) => {
      if (!serverClient || !serverClient.id) return;
      setData((prev) => ({
        ...prev,
        clients: prev.clients.map((item) => (item.id === clientId ? { ...item, ...serverClient } : item)),
      }));
    }).catch(async (error) => {
      console.error('[App] failed to persist client assignment', error);
      let canonicalClient = client;
      try {
        canonicalClient = (await fetchClientById(clientId)) || client;
      } catch (_) {}
      setData((prev) => ({
        ...prev,
        clients: prev.clients.map((item) =>
          item.id === clientId ? { ...item, ...canonicalClient } : item
        ),
      }));
      showNotification(error?.message || 'Could not persist client assignment to backend.');
    });
  };

  /**
   * Create an Office + (optional) Office Manager in a single backend call.
   *
   * The backend assigns canonical ULIDs and is the source of truth - we do
   * NOT fabricate IDs locally any more, otherwise subsequent updates would
   * target rows that don't exist on the server.
   */
  const createOfficeWithManager = async (newOfficeName, newManagerName, newManagerPassword) => {
    try {
      const { office, manager } = await createOffice({
        name:            newOfficeName,
        managerName:     newManagerName || undefined,
        managerPassword: newManagerPassword || undefined,
      });

      const newManager = manager
        ? {
            id:          manager.id,
            name:        manager.name,
            email:       manager.email,
            role:        ROLE.OFFICE_MANAGER,
            officeId:    manager.officeId,
            password:    newManagerPassword || null,
            loginLink:   makeLoginLink(manager.id, ROLE.OFFICE_MANAGER),
            isLoggedIn:  false,
            lastLoginAt: null,
          }
        : null;

      setData((prev) => ({
        ...prev,
        offices: [
          ...prev.offices,
          { id: office.id, name: office.name, managerId: manager ? manager.id : null },
        ],
        users: newManager ? [...prev.users, newManager] : prev.users,
      }));

      return newManager;
    } catch (error) {
      console.error('[App] createOfficeWithManager failed', error);
      showNotification(error.message || 'Could not create office.');
      return undefined;
    }
  };

  const assignOfficeManager = async (officeId, managerId) => {
    // Optimistic UI update first - keeps the panel snappy. On error we'll
    // surface a notification and reload-on-next-mount will reconcile.
    setData((prev) => ({
      ...prev,
      offices: prev.offices.map((office) =>
        office.id === officeId ? { ...office, managerId } : office
      ),
      users: prev.users.map((u) => (u.id === managerId ? { ...u, officeId } : u)),
    }));
    try {
      await assignOfficeManagerApi(officeId, managerId);
    } catch (error) {
      console.error('[App] assignOfficeManager failed', error);
      showNotification(error.message || 'Could not assign office manager.');
    }
  };

  const assignTeamLeader = (teamId, leaderId) => {
    setData((prev) => ({
      ...prev,
      teams: prev.teams.map((team) => (team.id === teamId ? { ...team, leaderId } : team)),
      users: prev.users.map((u) =>
        u.id === leaderId
          ? { ...u, teamId, officeId: prev.teams.find((t) => t.id === teamId)?.officeId || u.officeId }
          : u
      ),
    }));
  };

  /**
   * Create a Team + (optional) Team Leader. Server assigns IDs.
   */
  const createTeamLeader = async (officeId, teamName, leaderName, leaderPassword, teamSize) => {
    try {
      const { team, leader } = await createTeam({
        officeId,
        name:           teamName,
        maxSize:        Number(teamSize) || 8,
        leaderName:     leaderName || undefined,
        leaderPassword: leaderPassword || undefined,
      });

      const newLeader = leader
        ? {
            id:          leader.id,
            name:        leader.name,
            email:       leader.email,
            role:        ROLE.TEAM_LEAD,
            officeId:    leader.officeId,
            teamId:      leader.teamId,
            password:    leaderPassword || null,
            loginLink:   makeLoginLink(leader.id, ROLE.TEAM_LEAD),
            isLoggedIn:  false,
            lastLoginAt: null,
          }
        : null;

      setData((prev) => ({
        ...prev,
        teams: [
          ...prev.teams,
          {
            id:       team.id,
            name:     team.name,
            officeId: team.officeId,
            leaderId: leader ? leader.id : null,
            maxSize:  team.maxSize,
          },
        ],
        users: newLeader ? [...prev.users, newLeader] : prev.users,
      }));

      return newLeader;
    } catch (error) {
      console.error('[App] createTeamLeader failed', error);
      showNotification(error.message || 'Could not create team.');
      return undefined;
    }
  };

  const createStandaloneOfficeManager = async (managerName, managerEmail, managerPassword) => {
    try {
      const created = await createStaffApi({
        role: ROLE.OFFICE_MANAGER,
        officeId: null,
        teamId: null,
        name: managerName,
        email: managerEmail,
        password: managerPassword,
      });
      const manager = {
        id: created.id,
        name: created.name,
        email: created.email,
        role: ROLE.OFFICE_MANAGER,
        officeId: null,
        teamId: null,
        password: managerPassword || null,
        loginLink: makeLoginLink(created.id, ROLE.OFFICE_MANAGER),
        isLoggedIn: false,
        lastLoginAt: null,
      };
      setData((prev) => ({ ...prev, users: [...prev.users, manager] }));
      return manager;
    } catch (error) {
      console.error('[App] createStandaloneOfficeManager failed', error);
      showNotification(error.message || 'Could not create office manager.');
      return null;
    }
  };

  const createStandaloneTeamLeader = async (officeId, leaderName, leaderEmail, leaderPassword) => {
    try {
      const created = await createStaffApi({
        role: ROLE.TEAM_LEAD,
        officeId: officeId || null,
        teamId: null,
        name: leaderName,
        email: leaderEmail,
        password: leaderPassword,
      });
      const leader = {
        id: created.id,
        name: created.name,
        email: created.email,
        role: ROLE.TEAM_LEAD,
        officeId: created.officeId,
        teamId: null,
        password: leaderPassword || null,
        loginLink: makeLoginLink(created.id, ROLE.TEAM_LEAD),
        isLoggedIn: false,
        lastLoginAt: null,
      };
      setData((prev) => ({ ...prev, users: [...prev.users, leader] }));
      return leader;
    } catch (error) {
      console.error('[App] createStandaloneTeamLeader failed', error);
      showNotification(error.message || 'Could not create team leader.');
      return null;
    }
  };

  /**
   * Create an Agent inside a team. Server enforces team capacity (409 if
   * full); we mirror that check client-side for instant feedback but the
   * backend is the source of truth.
   */
  const createAgent = async (teamId, agentName, agentPassword, officeId = null) => {
    const team = teamId ? data.teams.find((t) => t.id === teamId) : null;
    if (teamId && !team) return null;
    const currentCount = team ? getTeamAgentCount(teamId, data.users) : 0;
    if (team && team.maxSize != null && currentCount >= team.maxSize) {
      showNotification(`Team ${team.name} is at capacity.`);
      return null;
    }

    try {
      const created = await createAgentApi({
        teamId: team?.id || null,
        officeId: team ? team.officeId : officeId,
        name:     agentName,
        password: agentPassword,
      });

      const newAgent = {
        id:          created.id,
        name:        created.name,
        email:       created.email,
        role:        ROLE.AGENT,
        officeId:    created.officeId,
        teamId:      created.teamId,
        password:    agentPassword || null,
        loginLink:   makeLoginLink(created.id, ROLE.AGENT),
        isLoggedIn:  false,
        lastLoginAt: null,
      };

      setData((prev) => ({
        ...prev,
        users: [...prev.users, newAgent],
      }));

      return newAgent;
    } catch (error) {
      console.error('[App] createAgent failed', error);
      showNotification(error.message || 'Could not create agent.');
      return null;
    }
  };

  /**
   * Toggle a staff account's Suspended/Active status. Used by the staff
   * tables in SuperAdminPanel + role panels. The argument shape is
   * (staffId, isCurrentlyBlocked) so the panels don't need to know about
   * the API verb.
   */
  const toggleStaffBlocked = async (staffId, currentlyBlocked) => {
    try {
      const fn = currentlyBlocked ? unblockStaffApi : blockStaffApi;
      const updated = await fn(staffId);
      setData((prev) => ({
        ...prev,
        users: prev.users.map((u) =>
          u.id === staffId ? { ...u, status: updated.status } : u
        ),
      }));
      return updated;
    } catch (error) {
      console.error('[App] toggleStaffBlocked failed', error);
      showNotification(error.message || 'Could not update staff status.');
      return null;
    }
  };

  const assignAgent = (agentId, teamId) => {
    setData((prev) => ({
      ...prev,
      users: prev.users.map((u) =>
        u.id === agentId
          ? { ...u, teamId, officeId: prev.teams.find((t) => t.id === teamId)?.officeId || u.officeId }
          : u
      ),
    }));
  };

  const setUserLoginState = (userId, isLoggedIn) => {
    const now = new Date().toISOString();
    setData((prev) => {
      const targetUser = prev.users.find(u => u.id === userId);
      const lastLoginAt = isLoggedIn ? now : (targetUser?.lastLoginAt || null);
      const updatedUsers = prev.users.map((u) => {
        if (u.id !== userId) return u;
        const sessions = Array.isArray(u.loginSessions) ? [...u.loginSessions] : [];
        if (isLoggedIn) {
          sessions.push({ loginAt: now, logoutAt: null, durationMs: 0 });
        } else {
          for (let i = sessions.length - 1; i >= 0; i -= 1) {
            if (!sessions[i].logoutAt) {
              const loginAt = new Date(sessions[i].loginAt).getTime();
              const logoutAt = new Date(now).getTime();
              sessions[i] = { ...sessions[i], logoutAt: now, durationMs: Math.max(0, logoutAt - loginAt) };
              break;
            }
          }
        }
        return { ...u, isLoggedIn, lastLoginAt, loginSessions: sessions.slice(-50) };
      });

      return { ...prev, users: updatedUsers };
    });

  };

  /**
   * Create a brand-new client via the live backend.
   *
   * The backend assigns a canonical ULID, auto-defaults office/team to the
   * caller's scope when omitted (so OM/TL can't accidentally create clients
   * outside their silo), seeds an initial status_history row for the
   * starting stage, and writes an audit_log entry - all in one atomic operation.
   *
   * Returns the canonical server client (already shape-mapped to camelCase)
   * or null on failure. Surfaces errors via showNotification rather than
   * throwing, so callers can branch on `if (created) ...` cleanly.
   */
  const createClient = async (payload) => {
    try {
      const serverClient = await createClientApi(payload);
      if (!serverClient || !serverClient.id) {
        showNotification('Client creation returned no row.');
        return null;
      }
      lastClientCreateAt.current = Date.now();
      setData((prev) => {
        const normalized = normalizeClientAssignment(serverClient, prev.users, prev.teams);
        return {
          ...prev,
          clients: [normalized, ...prev.clients.filter((client) => client.id !== normalized.id)],
        };
      });
      const display = serverClient.name || `${serverClient.firstName || ''} ${serverClient.lastName || ''}`.trim();
      showNotification(`Client "${display || serverClient.id}" created.`);
      return serverClient;
    } catch (error) {
      console.error('[App] createClient failed', error);
      showNotification(error.message || 'Could not create client.');
      return null;
    }
  };

  const updateClient = (clientId, updates) => {
    const { _actorName, _actorId, ...rest } = updates;
    const originalClient = data.clients.find((client) => client.id === clientId);
    setData((prev) => ({
      ...prev,
      clients: prev.clients.map((client) => {
        if (client.id !== clientId) return client;
        const actorName = _actorName
          || getUserName(_actorId || client.assignedToAgent, prev.users)
          || 'Unknown';
        // Append comment to history when comment text supplied (not commentHistory directly)
        const nextHistory = Array.isArray(rest.commentHistory)
          ? rest.commentHistory
          : (client.commentHistory || []).slice();
        if (rest.comment && !Array.isArray(rest.commentHistory)) {
          nextHistory.unshift({
            text: rest.comment,
            by: actorName,
            date: rest.lastCommentDate || new Date().toISOString().slice(0, 10),
          });
        }
        // Track status changes in statusHistory
        const prevStatusHistory = Array.isArray(client.statusHistory) ? client.statusHistory : [];
        let nextStatusHistory = prevStatusHistory;
        if (rest.stage && rest.stage !== client.stage) {
          nextStatusHistory = [...prevStatusHistory, {
            from: client.stage || 'New',
            to: rest.stage,
            by: _actorId || client.assignedToAgent || null,
            byName: actorName,
            at: new Date().toISOString(),
          }].slice(-100);
        }
        return { ...client, ...rest, commentHistory: nextHistory, statusHistory: nextStatusHistory };
      }),
    }));

    return updateClientApi(clientId, rest).then((serverClient) => {
      // Replace optimistic row with the canonical server row so the
      // commentHistory / statusHistory UI always reflects the source of truth.
      if (!serverClient || !serverClient.id) return null;
      setData((prev) => ({
        ...prev,
        clients: prev.clients.map((item) => (item.id === clientId ? { ...item, ...serverClient } : item)),
      }));
      return serverClient;
    }).catch(async (error) => {
      console.error('[App] updateClient failed', error);
      let canonicalClient = originalClient;
      try {
        canonicalClient = (await fetchClientById(clientId)) || originalClient;
      } catch (_) {}
      if (canonicalClient) {
        setData((prev) => ({
          ...prev,
          clients: prev.clients.map((item) =>
            item.id === clientId ? { ...item, ...canonicalClient } : item
          ),
        }));
      }
      showNotification(error?.message || 'Failed to save client update to backend.');
      return null;
    });
  };

  return (
    <div className="crm-admin-app">
      {notification && (
        <div className="crm-toast-notification">
          {notification}
        </div>
      )}
      <ErrorBoundary>
        <Routes>
          <Route path="" element={<BackofficeLanding />} />
          <Route path="admin" element={<BackofficeLanding />} />

          {/* Dedicated, separate login routes per role (button-only login) */}
          <Route path="login" element={<Navigate to="/admin" replace />} />
          <Route path="admin/login" element={<Navigate to="/admin" replace />} />

          <Route path="login/super-admin" element={<RoleLogin role={ROLE.SUPER_ADMIN} onAdminLogin={addAdminToData} />} />
          <Route path="admin/login/super-admin" element={<RoleLogin role={ROLE.SUPER_ADMIN} onAdminLogin={addAdminToData} />} />

          <Route path="login/office-manager" element={<RoleLogin role={ROLE.OFFICE_MANAGER} onAdminLogin={addAdminToData} />} />
          <Route path="admin/login/office-manager" element={<RoleLogin role={ROLE.OFFICE_MANAGER} onAdminLogin={addAdminToData} />} />

          <Route path="login/team-leader" element={<RoleLogin role={ROLE.TEAM_LEAD} onAdminLogin={addAdminToData} />} />
          <Route path="admin/login/team-leader" element={<RoleLogin role={ROLE.TEAM_LEAD} onAdminLogin={addAdminToData} />} />

          <Route path="login/agent" element={<RoleLogin role={ROLE.AGENT} onAdminLogin={addAdminToData} />} />
          <Route path="admin/login/agent" element={<RoleLogin role={ROLE.AGENT} onAdminLogin={addAdminToData} />} />

          {/* Bare role paths redirect to that role's dedicated login */}
          <Route path="super-admin" element={<Navigate to="/admin/login/super-admin" replace />} />
          <Route path="admin/super-admin" element={<Navigate to="/admin/login/super-admin" replace />} />
          <Route path="office-manager" element={<Navigate to="/admin/login/office-manager" replace />} />
          <Route path="admin/office-manager" element={<Navigate to="/admin/login/office-manager" replace />} />
          <Route path="team-leader" element={<Navigate to="/admin/login/team-leader" replace />} />
          <Route path="admin/team-leader" element={<Navigate to="/admin/login/team-leader" replace />} />
          <Route path="agent" element={<Navigate to="/admin/login/agent" replace />} />
          <Route path="admin/agent" element={<Navigate to="/admin/login/agent" replace />} />

          {/* Legacy combined staff login retained for backward compatibility */}
          <Route path="staff-login" element={<StaffLogin onAdminLogin={addAdminToData} />} />
          <Route path="admin/staff-login" element={<StaffLogin onAdminLogin={addAdminToData} />} />

          <Route path="super-admin/:userId/*" element={<RolePage role={ROLE.SUPER_ADMIN} data={data} dataLoading={dataLoading} setData={setData} setClientAssignment={setClientAssignment} assignOfficeManager={assignOfficeManager} createOfficeWithManager={createOfficeWithManager} createStandaloneOfficeManager={createStandaloneOfficeManager} createTeamLeader={createTeamLeader} createStandaloneTeamLeader={createStandaloneTeamLeader} createAgent={createAgent} toggleStaffBlocked={toggleStaffBlocked} setUserLoginState={setUserLoginState} updateClient={updateClient} createClient={createClient} showNotification={showNotification} />} />
          <Route path="admin/super-admin/:userId/*" element={<RolePage role={ROLE.SUPER_ADMIN} data={data} dataLoading={dataLoading} setData={setData} setClientAssignment={setClientAssignment} assignOfficeManager={assignOfficeManager} createOfficeWithManager={createOfficeWithManager} createStandaloneOfficeManager={createStandaloneOfficeManager} createTeamLeader={createTeamLeader} createStandaloneTeamLeader={createStandaloneTeamLeader} createAgent={createAgent} toggleStaffBlocked={toggleStaffBlocked} setUserLoginState={setUserLoginState} updateClient={updateClient} createClient={createClient} showNotification={showNotification} />} />

          <Route path="office-manager/:userId/*" element={<RolePage role={ROLE.OFFICE_MANAGER} data={data} dataLoading={dataLoading} setData={setData} setClientAssignment={setClientAssignment} assignTeamLeader={assignTeamLeader} createTeamLeader={createTeamLeader} createAgent={createAgent} toggleStaffBlocked={toggleStaffBlocked} updateClient={updateClient} createClient={createClient} setUserLoginState={setUserLoginState} showNotification={showNotification} />} />
          <Route path="admin/office-manager/:userId/*" element={<RolePage role={ROLE.OFFICE_MANAGER} data={data} dataLoading={dataLoading} setData={setData} setClientAssignment={setClientAssignment} assignTeamLeader={assignTeamLeader} createTeamLeader={createTeamLeader} createAgent={createAgent} toggleStaffBlocked={toggleStaffBlocked} updateClient={updateClient} createClient={createClient} setUserLoginState={setUserLoginState} showNotification={showNotification} />} />

          <Route path="team-leader/:userId/*" element={<RolePage role={ROLE.TEAM_LEAD} data={data} dataLoading={dataLoading} setData={setData} setClientAssignment={setClientAssignment} assignAgent={assignAgent} createAgent={createAgent} toggleStaffBlocked={toggleStaffBlocked} updateClient={updateClient} createClient={createClient} setUserLoginState={setUserLoginState} showNotification={showNotification} />} />
          <Route path="admin/team-leader/:userId/*" element={<RolePage role={ROLE.TEAM_LEAD} data={data} dataLoading={dataLoading} setData={setData} setClientAssignment={setClientAssignment} assignAgent={assignAgent} createAgent={createAgent} toggleStaffBlocked={toggleStaffBlocked} updateClient={updateClient} createClient={createClient} setUserLoginState={setUserLoginState} showNotification={showNotification} />} />

          <Route path="agent/:userId/*" element={<RolePage role={ROLE.AGENT} data={data} dataLoading={dataLoading} setData={setData} setUserLoginState={setUserLoginState} updateClient={updateClient} createClient={createClient} showNotification={showNotification} />} />
          <Route path="admin/agent/:userId/*" element={<RolePage role={ROLE.AGENT} data={data} dataLoading={dataLoading} setData={setData} setUserLoginState={setUserLoginState} updateClient={updateClient} createClient={createClient} showNotification={showNotification} />} />

          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </ErrorBoundary>
    </div>
  );
}

export default App;
