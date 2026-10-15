import React, { useState, useEffect, useMemo, useRef } from 'react';
import { enterClientPortal } from '../clientImpersonation.js';
import { useNavigate } from 'react-router-dom';
import {
  ROLE, CLIENT_STATUSES, normalizeStage, NotificationContext, DataContext,
  getOfficeName, getTeamName, getUserName, getCountryFlag, statusClass,
  EditClientModal, makeLoginLink,
  EditOfficeModal, EditTeamModal, EditAgentModal,
  StatusDropdown,
} from '../shared';
import { useConfirmDialog } from '../components/ConfirmModal/ConfirmModal';
import Dashboard from '../components/Dashboard/Dashboard.jsx';
import SiteSettingsTab from '../components/SiteSettings/SiteSettingsTab.jsx';
import CrmSettingsTab from '../components/CrmSettings/CrmSettingsTab.jsx';
import ProjectsTab from '../components/Projects/ProjectsTab.jsx';
import ClientProjectsWorkspace from '../components/ClientProjectsWorkspace.jsx';
import IdentityReviewsWorkspace from '../components/IdentityReviewsWorkspace.jsx';
import SiteCrmWorkspace from '../components/SiteCrmWorkspace.jsx';
import ClientProfileModal from '../components/ClientProfileModal.jsx';
import StaffProfileModal from '../components/StaffProfileModal.jsx';
import AuditLog from '../components/AuditLog/AuditLog.jsx';
import Notifications from '../components/Notifications/Notifications.jsx';
import NotificationToast from '../components/NotificationToast/NotificationToast.jsx';
import AccountingWorkspace from '../components/AccountingWorkspace.jsx';
import SecurityRequests from '../components/SecurityRequests/SecurityRequests.jsx';
import Sessions from '../components/Sessions/Sessions.jsx';
import AgentAccess from '../components/AgentAccess.jsx';
import HealthIndicator from '../components/HealthIndicator/HealthIndicator.jsx';
import { SearchAutocomplete } from '../components/UserChrome.jsx';
import { CountrySelect, PhoneInput, buildStoredPhone } from '../components/CountryPhoneInput/CountryPhoneInput';
import { COUNTRY_LIST } from '../countryData';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBell, faBuilding, faCog, faPalette, faHistory, faIdCard, faTachometerAlt, faTrash, faUser, faUserPlus, faUsers,
  faArrowDown, faArrowUp, faKey, faGlobe, faComments, faBriefcase, faFileInvoiceDollar,
} from '@fortawesome/free-solid-svg-icons';
import {
  getAdminToken, getUserProfileHistoryApi,
  bulkAssignClientsApi, bulkAssignClientAssignmentsApi, deleteOffice, deleteTeam, deleteStaffApi, updateOffice, updateTeam,
  listAdminClients, getAdminClientProjects, createAdminClientProject, updateAdminClientProject, archiveAdminClientProject,
  getAdminClientIdentityReviews, resolveAdminClientIdentityReview,
  createStaffApi, updateStaffApi, resetClientstatusApi, clearClientCommentsApi,
  updateClientApi, deleteClientApi, restoreClientApi,
  getClientNotificationsAsAdmin, getAdminPendingCounts,
  restoreOfficeApi, restoreTeamApi, restoreStaffApi, deleteOfficePermanent, deleteTeamPermanent,
  blockStaffApi, unblockStaffApi,
  listRecentAuditLog,
  deleteProfileHistoryEntryApi, clearProfileHistoryApi,
  importClientsApi, bulkUpdateClientstatusApi, cleanupBinApi, purgeBinClients,
  sendHeartbeat,
  searchAdminClients,
} from '../adminApi';
import { fetchAdminSettings } from '../../platformDefaults';
import { getClientProfilePath } from '../clientProfileRouting';
import { matchesClientOwnershipFilter, matchesStaffStructureFilter } from '../clientOwnership';
import { normalizeCsvHeader, parseCsvRows } from '../csvUtils';
const createLogAdminAction = (setAuditLog) => (admin, action, details, clientName = '') => {
  if (typeof setAuditLog === 'function') {
    setAuditLog((prev) => [
      {
        id: 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        admin: typeof admin === 'string' ? admin : (admin?.name || admin?.username || 'Admin'),
        action: typeof action === 'string' ? action : 'action',
        details: typeof details === 'string' ? details : JSON.stringify(details || ''),
        clientName: clientName || '',
        timestamp: new Date(),
      },
      ...(Array.isArray(prev) ? prev : []),
    ]);
  }
};

const createLogActivity = (setActivityLog) => (userId, type, details) => {
  if (typeof setActivityLog === 'function') {
    setActivityLog((prev) => [
      {
        id: 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        userId: userId || '',
        type: type || 'activity',
        details: typeof details === 'string' ? details : JSON.stringify(details || ''),
        timestamp: new Date(),
      },
      ...(Array.isArray(prev) ? prev : []),
    ]);
  }
};


function AllClientsTable({ data, currentUser, setData, setClientAssignment, showNotification, onOpenProfile }) {
  const navigate = useNavigate();
  const [confirmDialog, confirm] = useConfirmDialog();
  const [search, setSearch] = useState('');
  const [filterOffice, setFilterOffice] = useState('');
  const [filterTeam, setFilterTeam] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterTeamLeader, setFilterTeamLeader] = useState('');
  const [filterOwnership, setFilterOwnership] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [binPage, setBinPage] = useState(1);
  const pageSize = 20;
  const [view, setView] = useState('active'); // 'active' | 'bin'

  // Bulk selection & assignment state
  const [selected, setSelected] = useState([]);
  const [binSelected, setBinSelected] = useState([]);
  const [bulkMode, setBulkMode] = useState(null); // null | 'assign' | 'shuffle'
  const [bulkOfficeId, setBulkOfficeId] = useState('');
  const [bulkTeamId, setBulkTeamId] = useState('');
  const [bulkTeamLeaderId, setBulkTeamLeaderId] = useState('');
  const [bulkAgentId, setBulkAgentId] = useState('');
  const [shuffleScope, setShuffleScope] = useState('agents'); // 'offices' | 'teams' | 'agents'
  const [shuffleTargets, setShuffleTargets] = useState([]); // array of ids
  const [shuffleStatus, setShuffleStatus] = useState(''); // optional pre-filter

  // Client profile modal state
  const [profileClient, setProfileClient] = useState(null);
  const [profileStage, setProfileStage] = useState('');
  const [profileComment, setProfileComment] = useState('');
  const [reassignOfficeId, setReassignOfficeId] = useState('');
  const [reassignTeamId, setReassignTeamId] = useState('');
  const [reassignAgentId, setReassignAgentId] = useState('');

  // Profile change history (fetched when client profile modal opens)
  const [profileHistory, setProfileHistory] = useState([]);
  const [profileHistoryLoading, setProfileHistoryLoading] = useState(false);
  const [profileHistoryError, setProfileHistoryError] = useState('');

  // Edit modal state for inline row buttons
  const [editingClient, setEditingClient] = useState(null);

  // Quick per-row assign popover
  const [quickAssignClientId, setQuickAssignClientId] = useState(null);
  const [quickAssignAgentId, setQuickAssignAgentId] = useState('');

  // Client ID lookup
  const [idLookupQuery, setIdLookupQuery] = useState('');

  const handleClientstatusChange = async (clientId, newStage) => {
    setData(prev => ({
      ...prev,
      clients: prev.clients.map(l => (l.id === clientId ? { ...l, stage: newStage, status: newStage } : l)),
    }));
    try {
      await updateClientApi(clientId, { stage: newStage, status: newStage });
      showNotification(`Status updated to "${newStage}".`);
    } catch (err) {
      showNotification('Failed to update status.');
    }
  };

  const handleQuickAssign = (client) => {
    const agentId = quickAssignAgentId || null;
    let officeId = null;
    let teamId = null;
    if (agentId) {
      const agent = data.users.find(u => u.id === agentId);
      if (agent) { officeId = agent.officeId || null; teamId = agent.teamId || null; }
    }
    setClientAssignment({ clientId: client.id, officeId, teamId, agentId });
    showNotification(`${client.firstName} ${client.lastName} assigned.`);
    setQuickAssignClientId(null);
    setQuickAssignAgentId('');
  };

  // Enter client's own account (admin direct access - no password required)
  const enterClientAccount = async (client) => {
    if (!client?.id) return showNotification('Invalid client.');
    try {
      await enterClientPortal(client.id);
    } catch (err) {
      console.error('Failed to enter client account:', err);
      showNotification(err?.message || 'Could not enter client account.');
    }
  };

  // Bulk assign all selected clients to one specific office/team/agent
  const handleBulkAssign = async () => {
    if (selected.length === 0) { showNotification('Select at least one client first.'); return; }
    if (!bulkOfficeId && !bulkTeamId && !bulkTeamLeaderId && !bulkAgentId) {
      showNotification('Pick a destination (office, team, Team Leader, or agent).');
      return;
    }
    let officeId = bulkOfficeId || null;
    let teamId = bulkTeamId || null;
    const teamLeaderId = bulkTeamLeaderId || null;
    let agentId = bulkAgentId || null;
    const previousClients = data.clients;
    const previousSelection = [...selected];
    const previousBulkState = { mode: bulkMode, officeId: bulkOfficeId, teamId: bulkTeamId, teamLeaderId: bulkTeamLeaderId, agentId: bulkAgentId };
    if (agentId) {
      const agent = data.users.find(u => u.id === agentId);
      if (agent) { teamId = teamId || agent.teamId; officeId = officeId || agent.officeId; }
    }
    if (teamLeaderId) {
      const leader = data.users.find(u => u.id === teamLeaderId);
      if (leader) {
        teamId = teamId || leader.teamId || null;
        officeId = officeId || leader.officeId || null;
      }
      agentId = null;
    }
    if (teamId) {
      const team = data.teams.find(t => t.id === teamId);
      if (team) { officeId = officeId || team.officeId; }
    }
    // Optimistic update - all clients in one setData call
    setData(prev => ({
      ...prev,
      clients: prev.clients.map(l => selected.includes(l.id)
        ? { ...l, assignedToOffice: officeId, assignedToTeam: teamId, assignedToTeamLeader: teamLeaderId, assignedToAgent: agentId }
        : l
      ),
    }));
    setSelected([]);
    setBulkOfficeId(''); setBulkTeamId(''); setBulkTeamLeaderId(''); setBulkAgentId('');
    setBulkMode(null);
    try {
      const result = await bulkAssignClientsApi(selected, { officeId, teamId, teamLeaderId, agentId });
      if (result.clients?.length) {
        const updatedIds = new Set(result.clients.map((client) => client.id));
        setData((prev) => ({
          ...prev,
          clients: [...prev.clients.filter((client) => !updatedIds.has(client.id)), ...result.clients],
        }));
      }
      showNotification(`${selected.length} client(s) reassigned.`);
    } catch (err) {
      setData((prev) => ({ ...prev, clients: previousClients }));
      setSelected(previousSelection);
      setBulkOfficeId(previousBulkState.officeId);
      setBulkTeamId(previousBulkState.teamId);
      setBulkTeamLeaderId(previousBulkState.teamLeaderId);
      setBulkAgentId(previousBulkState.agentId);
      setBulkMode(previousBulkState.mode || 'assign');
      showNotification(err.message || 'Bulk assign failed; no changes were saved.');
    }
  };

  // Bulk soft-delete selected clients → deletedClients bin
  const handleBulkDelete = async () => {
    if (selected.length === 0) { showNotification('Select at least one client first.'); return; }
    const count = selected.length;
    const ok = await confirm({
      title: `Move ${count} client${count > 1 ? 's' : ''} to bin?`,
      message: `Move ${count} selected client${count > 1 ? 's' : ''} to the recycle bin? You can restore them later.`,
      confirmLabel: 'Move to bin',
      tone: 'warning',
    });
    if (!ok) return;
    const now = new Date().toISOString();
    const toDelete = data.clients.filter(l => selected.includes(l.id));
    setData(prev => ({
      ...prev,
      clients: prev.clients.filter(l => !selected.includes(l.id)),
      deletedClients: [...(prev.deletedClients || []), ...toDelete.map(l => ({ ...l, deletedAt: now }))],
    }));
    showNotification(`${count} client${count > 1 ? 's' : ''} moved to bin.`);
    setSelected([]);
    setBulkMode(null);
    Promise.allSettled(toDelete.map(l => deleteClientApi(l.id))).then(results => {
      const failedResults = results.filter(r => r.status === 'rejected');
      if (failedResults.length > 0) {
        showNotification(`${failedResults.length} client(s) could not be moved to the bin - reverting.`);
        const failedIds = new Set(
          toDelete
            .filter((_, i) => results[i].status === 'rejected')
            .map(l => l.id)
        );
        setData(prev => ({
          ...prev,
          clients: [
            ...prev.clients,
            ...toDelete.filter(l => failedIds.has(l.id)),
          ],
          deletedClients: (prev.deletedClients || []).filter(l => !failedIds.has(l.id)),
        }));
      }
    });
  };

  // Bulk permanent-delete directly from the active list (force=1 bypasses soft-delete requirement)
  const handleBulkPermanentDelete = async () => {
    if (selected.length === 0) { showNotification('Select at least one client first.'); return; }
    const count = selected.length;
    const ok = await confirm({
      title: `Permanently delete ${count} client${count > 1 ? 's' : ''}?`,
      message: `Permanently delete ${count} selected client${count > 1 ? 's' : ''}? This cannot be undone - all account data will be erased.`,
      confirmLabel: 'Delete forever',
      tone: 'danger',
    });
    if (!ok) return;
    const toDelete = data.clients.filter(l => selected.includes(l.id));
    setData(prev => ({
      ...prev,
      clients: prev.clients.filter(l => !selected.includes(l.id)),
    }));
    showNotification(`${count} client${count > 1 ? 's' : ''} permanently deleted.`);
    setSelected([]);
    setBulkMode(null);
    Promise.allSettled(toDelete.map(l => deleteClientApi(l.id, { permanent: true, force: true }))).then(results => {
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) showNotification(`${failed.length} client(s) could not be permanently deleted.`);
    });
  };

  // Bulk restore from bin
  const handleBinBulkRestore = () => {
    if (binSelected.length === 0) return;
    const ids = new Set(binSelected);
    const toRestore = (data.deletedClients || []).filter(l => ids.has(l.id));
    const count = toRestore.length;
    setData(prev => {
      const restored = (prev.deletedClients || [])
        .filter(l => ids.has(l.id))
        .map(({ deletedAt: _d, ...r }) => r);
      return {
        ...prev,
        deletedClients: (prev.deletedClients || []).filter(l => !ids.has(l.id)),
        clients: [...prev.clients, ...restored],
      };
    });
    showNotification(`${count} client${count > 1 ? 's' : ''} restored.`);
    setBinSelected([]);
    Promise.allSettled(toRestore.map(l => restoreClientApi(l.id))).then(results => {
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) showNotification(`${failed.length} client(s) could not be restored on the server.`);
    });
  };

  // Bulk permanent-delete from bin
  const handleBinBulkPermanentDelete = async () => {
    if (binSelected.length === 0) return;
    const count = binSelected.length;
    const ok = await confirm({
      title: `Permanently delete ${count} client${count > 1 ? 's' : ''}?`,
      message: `Permanently delete ${count} selected client${count > 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: 'Delete forever',
      tone: 'danger',
    });
    if (!ok) return;
    const ids = new Set(binSelected);
    const toDelete = (data.deletedClients || []).filter(l => ids.has(l.id));
    setData(prev => ({
      ...prev,
      deletedClients: (prev.deletedClients || []).filter(l => !ids.has(l.id)),
    }));
    showNotification(`${count} client${count > 1 ? 's' : ''} permanently deleted.`);
    setBinSelected([]);
    Promise.allSettled(toDelete.map(l => deleteClientApi(l.id, { permanent: true, force: true }))).then(results => {
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) showNotification(`${failed.length} client(s) could not be permanently deleted.`);
    });
  };

  // Bulk suspend clients
  const handleBulkSuspend = async () => {
    if (selected.length === 0) return;
    const count = selected.length;
    const ok = await confirm({
      title: `Suspend ${count} client${count > 1 ? 's' : ''}?`,
      message: `This will lock their accounts. They can be re-activated at any time.`,
      confirmLabel: 'Suspend',
      tone: 'danger',
    });
    if (!ok) return;
    setData(prev => ({
      ...prev,
      clients: prev.clients.map(l => selected.includes(l.id) ? { ...l, status: 'Suspended' } : l),
    }));
    showNotification(`${count} client${count > 1 ? 's' : ''} suspended.`);
    setSelected([]);
    bulkUpdateClientstatusApi(selected, 'Suspended').catch(() => {
      showNotification('Server error - some clients may not have been suspended.');
    });
  };

  // Bulk re-activate clients
  const handleBulkActivate = async () => {
    if (selected.length === 0) return;
    const count = selected.length;
    setData(prev => ({
      ...prev,
      clients: prev.clients.map(l => selected.includes(l.id) ? { ...l, status: 'Active' } : l),
    }));
    showNotification(`${count} client${count > 1 ? 's' : ''} re-activated.`);
    setSelected([]);
    bulkUpdateClientstatusApi(selected, 'Active').catch(() => {
      showNotification('Server error - some clients may not have been re-activated.');
    });
  };

  // CSV import state
  const [csvImportOpen,    setCsvImportOpen]    = useState(false);
  const [csvRawText,       setCsvRawText]       = useState('');
  const [csvFile,          setCsvFile]          = useState(null);
  const [csvParsed,        setCsvParsed]        = useState([]);
  const [csvParseError,    setCsvParseError]    = useState('');
  const [csvImporting,     setCsvImporting]     = useState(false);

  const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const handleExportAllClientsCsv = () => {
    const headers = [
      'Client ID', 'Name', 'First Name', 'Last Name', 'Email', 'Phone',
      'Country', 'Status', 'Stage', 'Funnel',
      'Office', 'Team', 'Agent', 'Team Leader', 'assigned_team_leader_id',
      'Registered Date', 'Created At', 'Updated At',
    ];
    const rows = (data.clients || []).map(client => {
      const office = (data.offices || []).find(item => item.id === client.assignedToOffice);
      const team = (data.teams || []).find(item => item.id === client.assignedToTeam);
      const agent = (data.users || []).find(item => item.id === client.assignedToAgent);
      const teamLeader = (data.users || []).find(item => item.id === client.assignedToTeamLeader);
      const name = client.name || `${client.firstName || ''} ${client.lastName || ''}`.trim();
      return [
        client.id, name, client.firstName, client.lastName, client.email, client.phone,
        client.country, client.status, client.stage, client.funnel,
        office?.name, team?.name, agent?.name, teamLeader?.name, client.assignedToTeamLeader,
        client.registeredDate, client.createdAt, client.updatedAt,
      ].map(csvCell).join(',');
    });
    const csv = `\uFEFF${[headers.map(csvCell).join(','), ...rows].join('\r\n')}\r\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `all-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showNotification(`Downloaded ${data.clients.length} client${data.clients.length === 1 ? '' : 's'} as CSV.`);
  };

  const parseCsvClients = (text) => {
    const table = parseCsvRows(text);
    if (table.length < 2) return { rows: [], error: 'CSV must have a header row and at least one data row.' };
    const header = table[0].map(normalizeCsvHeader);
    const required = ['first_name', 'last_name', 'email'];
    const missing = required.filter(r => !header.includes(r));
    if (missing.length) return { rows: [], error: `Missing required columns: ${missing.join(', ')}` };
    const rows = [];
    const errors = [];
    table.slice(1).forEach((cols, i) => {
      const obj = {};
      header.forEach((h, idx) => { obj[h] = String(cols[idx] ?? '').trim(); });
      if (!obj.email || !obj.email.includes('@')) {
        errors.push(`Row ${i + 2}: invalid email`);
      } else {
        rows.push(obj);
      }
    });
    if (errors.length > 0) return { rows, error: errors.slice(0, 5).join('\n') };
    return { rows, error: '' };
  };

  const handleCsvFilePick = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = ev => setCsvRawText(ev.target.result || '');
    reader.readAsText(file);
  };

  const handleCsvParse = () => {
    setCsvParseError('');
    setCsvParsed([]);
    const { rows, error } = parseCsvClients(csvRawText);
    if (error && rows.length === 0) { setCsvParseError(error); return; }
    if (error) setCsvParseError(error);
    setCsvParsed(rows);
  };

  const handleCsvImport = async () => {
    if (csvParsed.length === 0) return;
    setCsvImporting(true);
    try {
      const result = await importClientsApi(csvParsed);
      const imported = result?.imported ?? csvParsed.length;
      const newClients = result?.clients || [];
      if (newClients.length > 0) {
        setData(prev => ({ ...prev, clients: [...newClients, ...prev.clients] }));
      }
      setCsvImportOpen(false);
      setCsvRawText(''); setCsvFile(null); setCsvParsed([]); setCsvParseError('');
      showNotification(`${imported} client${imported !== 1 ? 's' : ''} imported successfully.`);
    } catch (err) {
      setCsvParseError(err?.message || 'Import failed.');
    } finally {
      setCsvImporting(false);
    }
  };

  // Bin auto-cleanup state
  const [binCleanupDays, setBinCleanupDays] = useState(30);
  const [binCleanupBusy, setBinCleanupBusy] = useState(false);

  const handleBinCleanup = async () => {
    const ok = await confirm({
      title: `Auto-clean bin?`,
      message: `Permanently delete all bin entries older than ${binCleanupDays} day${binCleanupDays !== 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: 'Clean up',
      tone: 'danger',
    });
    if (!ok) return;
    setBinCleanupBusy(true);
    try {
      const { deleted } = await cleanupBinApi(binCleanupDays);
      const cutoff = Date.now() - (binCleanupDays * 86400 * 1000);
      setData(prev => ({
        ...prev,
        deletedClients: (prev.deletedClients || []).filter(l =>
          !l.deletedAt || new Date(l.deletedAt).getTime() > cutoff
        ),
      }));
      showNotification(`${deleted} client${deleted !== 1 ? 's' : ''} permanently removed from bin.`);
    } catch (err) {
      showNotification(`Cleanup failed: ${err?.message || 'server error'}`);
    } finally {
      setBinCleanupBusy(false);
    }
  };

  // Shuffle (round-robin) selected clients among chosen targets
  const handleShuffle = async () => {
    if (shuffleTargets.length === 0) { showNotification('Pick at least one target to shuffle into.'); return; }
    let pool = selected.length > 0 ? data.clients.filter(l => selected.includes(l.id)) : data.clients.filter(l => !l.assignedToAgent);
    if (shuffleStatus) pool = pool.filter(l => normalizeStage(l.stage) === shuffleStatus);
    if (pool.length === 0) { showNotification('No clients match the shuffle pool.'); return; }

    // Build per-target groups (round-robin) - one bulk call per group instead of one call per client
    const groups = new Map(); // targetId → { clientIds, officeId, teamId, teamLeaderId, agentId }
    pool.forEach((client, idx) => {
      const targetId = shuffleTargets[idx % shuffleTargets.length];
      if (!groups.has(targetId)) {
        let officeId = null, teamId = null, teamLeaderId = null, agentId = null;
        if (shuffleScope === 'offices') {
          officeId = targetId;
        } else if (shuffleScope === 'teams') {
          const team = data.teams.find(t => t.id === targetId);
          teamId = targetId;
          officeId = team ? team.officeId : null;
        } else if (shuffleScope === 'agents') {
          const agent = data.users.find(u => u.id === targetId);
          agentId = targetId;
          teamId = agent ? agent.teamId : null;
          officeId = agent ? agent.officeId : null;
        } else if (shuffleScope === 'team-leaders') {
          const leader = data.users.find(u => u.id === targetId);
          teamLeaderId = targetId;
          teamId = leader ? leader.teamId : null;
          officeId = leader ? leader.officeId : null;
        }
        groups.set(targetId, { clientIds: [], officeId, teamId, teamLeaderId, agentId });
      }
      groups.get(targetId).clientIds.push(client.id);
    });

    // Capture current client state for rollback if the API calls fail
    const prevClients = data.clients.slice();

    // Optimistic update - single setData call covering all affected clients
    setData(prev => {
      const assignMap = new Map();
      groups.forEach(({ clientIds, officeId, teamId, teamLeaderId, agentId }) => {
        clientIds.forEach(id => assignMap.set(id, { officeId, teamId, teamLeaderId, agentId }));
      });
      return {
        ...prev,
        clients: prev.clients.map(l => {
          const a = assignMap.get(l.id);
          return a ? { ...l, assignedToOffice: a.officeId, assignedToTeam: a.teamId, assignedToTeamLeader: a.teamLeaderId, assignedToAgent: a.agentId } : l;
        }),
      };
    });

    setSelected([]);
    setShuffleTargets([]);
    setShuffleStatus('');
    setBulkMode(null);

    // Send every shuffled destination in one transaction so a partial network
    // failure cannot leave only some groups assigned.
    try {
      const assignments = [...groups.values()].flatMap(({ clientIds, officeId, teamId, teamLeaderId, agentId }) =>
        clientIds.map((clientId) => ({ clientId, officeId, teamId, teamLeaderId, agentId }))
      );
      const result = await bulkAssignClientAssignmentsApi(assignments);
      if (result.clients?.length) {
        const savedById = new Map(result.clients.map((client) => [client.id, client]));
        setData((prev) => ({
          ...prev,
          clients: prev.clients.map((client) => savedById.get(client.id) || client),
        }));
      }
      showNotification(`Shuffled ${pool.length} client(s) across ${shuffleTargets.length} ${shuffleScope}.`);
    } catch (err) {
      // Roll back the optimistic update so the UI reflects actual server state
      setData(prev => ({ ...prev, clients: prevClients }));
      showNotification('Shuffle failed - changes reverted. Please try again.');
    }
  };

  const toggleShuffleTarget = (id) => {
    setShuffleTargets(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  const openProfile = (client) => {
    if (onOpenProfile) {
      onOpenProfile(client);
      return;
    }
    setProfileClient(client);
    setProfileStage(client.stage || '');
    setProfileComment(client.comment || '');
    setReassignOfficeId(client.assignedToOffice || '');
    setReassignTeamId(client.assignedToTeam || '');
    setReassignAgentId(client.assignedToAgent || '');
    // Fetch profile change history for this client
    setProfileHistory([]);
    setProfileHistoryError('');
    setProfileHistoryLoading(true);
    getUserProfileHistoryApi(client.id)
      .then(({ entries }) => { setProfileHistory(entries); })
      .catch((err) => { setProfileHistoryError(err?.message || 'Failed to load change history.'); })
      .finally(() => { setProfileHistoryLoading(false); });
  };

  const closeProfile = () => {
    setProfileClient(null);
    setProfileHistory([]);
    setProfileHistoryError('');
  };

  const saveProfile = async () => {
    if (!profileClient) return;
    // Assignment changes go through setClientAssignment which calls the assign API.
    setClientAssignment({ clientId: profileClient.id, officeId: reassignOfficeId || null, teamId: reassignTeamId || null, agentId: reassignAgentId || null });

    // Stage and comment must be sent to the backend separately via updateClientApi.
    const apiUpdates = {};
    if (profileStage !== profileClient.stage) apiUpdates.stage = profileStage;
    if (profileComment.trim()) apiUpdates.comment = profileComment.trim();

    if (Object.keys(apiUpdates).length > 0) {
      // Optimistic local update so the list reflects changes immediately.
      const now = new Date().toISOString();
      const optimisticHistory = [...(profileClient.commentHistory || [])];
      if (apiUpdates.comment) {
        optimisticHistory.push({ text: apiUpdates.comment, by: 'You', date: now.slice(0, 10), createdAt: now });
      }
      setData(prev => ({
        ...prev,
        clients: prev.clients.map(l => l.id === profileClient.id
          ? { ...l, stage: profileStage, commentHistory: optimisticHistory }
          : l
        ),
      }));
      updateClientApi(profileClient.id, apiUpdates).then((serverClient) => {
        if (!serverClient || !serverClient.id) return;
        setData(prev => ({
          ...prev,
          clients: prev.clients.map(l => l.id === serverClient.id ? { ...l, ...serverClient } : l),
        }));
      }).catch((err) => {
        console.error('[saveProfile] updateClientApi failed', err);
        showNotification('Could not save stage/comment to the server.');
      });
    }

    showNotification(`${profileClient.firstName} ${profileClient.lastName} updated.`);
    closeProfile();
  };

  const unassignClient = () => {
    if (!profileClient) return;
    setClientAssignment({ clientId: profileClient.id, officeId: null, teamId: null, agentId: null });
    showNotification(`${profileClient.firstName} ${profileClient.lastName} returned to pool.`);
    closeProfile();
  };

  const resetClientstatus = async () => {
    if (!profileClient) return;
    const ok = await confirm({
      title: 'Reset Status Workflow?',
      message: `This will reset "${profileClient.firstName} ${profileClient.lastName}" back to New and permanently erase the entire status history. This cannot be undone.`,
      confirmLabel: 'Reset & Erase',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const updated = await resetClientstatusApi(profileClient.id);
      setProfileClient(updated);
      setProfileStage('New');
      setData(prev => ({ ...prev, clients: prev.clients.map(l => l.id === updated.id ? updated : l) }));
      showNotification(`Status reset to New for ${updated.firstName} ${updated.lastName}.`);
    } catch (err) {
      console.error('[SuperAdminPanel] resetClientstatus failed', err);
      showNotification('Could not reset status - please try again.');
    }
  };

  const clearClientComments = async () => {
    if (!profileClient) return;
    const ok = await confirm({
      title: 'Delete All Comments?',
      message: `This will permanently delete every comment on "${profileClient.firstName} ${profileClient.lastName}"'s profile. This cannot be undone.`,
      confirmLabel: 'Delete All Comments',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const updated = await clearClientCommentsApi(profileClient.id);
      setProfileClient(updated);
      setData(prev => ({ ...prev, clients: prev.clients.map(l => l.id === updated.id ? updated : l) }));
      showNotification(`All comments deleted for ${updated.firstName} ${updated.lastName}.`);
    } catch (err) {
      console.error('[SuperAdminPanel] clearClientComments failed', err);
      showNotification('Could not delete comments - please try again.');
    }
  };

  // Soft-delete: move from clients → deletedClients optimistically, then call
  // the backend. On failure we roll back so the bin doesn't show ghosts.
  const deleteClient = async (client) => {
    const ok = await confirm({
      title: 'Move client to bin?',
      message: `Move "${client.firstName} ${client.lastName}" to the recycle bin? You can restore it later from the bin.`,
      confirmLabel: 'Move to bin',
      tone: 'warning',
    });
    if (!ok) return;
    const now = new Date().toISOString();
    setData(prev => ({
      ...prev,
      clients: prev.clients.filter(l => l.id !== client.id),
      deletedClients: [...(prev.deletedClients || []), { ...client, deletedAt: now }],
    }));
    showNotification(`${client.firstName} ${client.lastName} moved to bin.`);
    if (profileClient?.id === client.id) closeProfile();
    deleteClientApi(client.id).catch((error) => {
      console.error('[SuperAdminPanel] deleteClient failed', error);
      showNotification('Could not delete client on the server.');
      setData(prev => ({
        ...prev,
        clients: [...prev.clients, client],
        deletedClients: (prev.deletedClients || []).filter(l => l.id !== client.id),
      }));
    });
  };

  const restoreClient = (client) => {
    const { deletedAt: _drop, ...restoredClient } = client;
    setData(prev => ({
      ...prev,
      deletedClients: (prev.deletedClients || []).filter(l => l.id !== client.id),
      clients: [...prev.clients, restoredClient],
    }));
    showNotification(`${client.firstName} ${client.lastName} restored.`);
    restoreClientApi(client.id).catch((error) => {
      console.error('[SuperAdminPanel] restoreClient failed', error);
      showNotification('Could not restore client on the server.');
      // Roll back: put it back in the bin and remove from live.
      setData(prev => ({
        ...prev,
        clients: prev.clients.filter(l => l.id !== client.id),
        deletedClients: [...(prev.deletedClients || []), client],
      }));
    });
  };

  const permanentDelete = async (client) => {
    const ok = await confirm({
      title: 'Permanently delete client?',
      message: `Permanently delete "${client.firstName} ${client.lastName}"? This cannot be undone.`,
      confirmLabel: 'Delete forever',
      tone: 'danger',
    });
    if (!ok) return;
    setData(prev => ({ ...prev, deletedClients: (prev.deletedClients || []).filter(l => l.id !== client.id) }));
    showNotification(`${client.firstName} ${client.lastName} permanently deleted.`);
    deleteClientApi(client.id, { permanent: true, force: true }).catch((error) => {
      console.error('[SuperAdminPanel] permanentDelete failed', error);
      showNotification('Could not permanently delete client on the server.');
      setData(prev => ({ ...prev, deletedClients: [...(prev.deletedClients || []), client] }));
    });
  };

  const idLookupResults = useMemo(() => {
    const q = idLookupQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const allClients = [...data.clients, ...(data.deletedClients || [])];
    return allClients.filter(l => l.id && String(l.id).toLowerCase().includes(q)).slice(0, 10);
  }, [idLookupQuery, data.clients, data.deletedClients]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.clients.filter(client => {
      if (showUnassignedOnly && !matchesClientOwnershipFilter(client, 'unassigned')) return false;
      if (filterOffice && client.assignedToOffice !== filterOffice) return false;
      if (filterTeam && client.assignedToTeam !== filterTeam) return false;
      if (filterAgent && client.assignedToAgent !== filterAgent) return false;
      if (filterTeamLeader && client.assignedToTeamLeader !== filterTeamLeader) return false;
      if (filterOwnership && !matchesClientOwnershipFilter(client, filterOwnership)) return false;
      if (filterStatus && normalizeStage(client.stage) !== filterStatus) return false;
      if (q && !(
        (client.firstName || '').toLowerCase().includes(q) ||
        (client.lastName || '').toLowerCase().includes(q) ||
        (client.email || '').toLowerCase().includes(q) ||
        (client.phone || '').toLowerCase().includes(q) ||
        (client.country || '').toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [data.clients, search, filterOffice, filterTeam, filterAgent, filterTeamLeader, filterOwnership, filterStatus, showUnassignedOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const deletedClients = data.deletedClients || [];
  const binTotalPages = Math.max(1, Math.ceil(deletedClients.length / pageSize));
  const pagedBin = deletedClients.slice((binPage - 1) * pageSize, binPage * pageSize);
  const allBinPageSelected = pagedBin.length > 0 && pagedBin.every(l => binSelected.includes(l.id));

  const teamsForFilter = filterOffice ? data.teams.filter(t => t.officeId === filterOffice) : data.teams;
  const agentsForFilter = filterTeam ? data.users.filter(u => u.role === ROLE.AGENT && u.teamId === filterTeam) : data.users.filter(u => u.role === ROLE.AGENT);

  const unassignedCount = data.clients.filter(l => !l.assignedToOffice).length;
  const poolCount = data.clients.filter(l => l.assignedToOffice && !l.assignedToTeam).length;
  const pendingAgentCount = data.clients.filter(l => l.assignedToTeam && !l.assignedToAgent).length;
  const assignedCount = data.clients.filter(l => l.assignedToAgent).length;

  const profileOffice = profileClient ? data.offices.find(o => o.id === profileClient.assignedToOffice) : null;
  const profileTeam = profileClient ? data.teams.find(t => t.id === profileClient.assignedToTeam) : null;
  const profileAgent = profileClient ? data.users.find(u => u.id === profileClient.assignedToAgent) : null;

  return (
    <>
    {confirmDialog}

    {/* CSV Import Modal */}
    {csvImportOpen && (
      <div className="crm-inline-bc43333c94"
        onClick={() => !csvImporting && setCsvImportOpen(false)}>
        <div className="crm-inline-452cb8ef29"
          onClick={e => e.stopPropagation()}>
          <div className="crm-inline-29145742ca">
            <h3 className="crm-inline-19e4676824">[upload] Import Clients from CSV</h3>
            <button onClick={() => setCsvImportOpen(false)} className="crm-inline-1955c3a0b0">✕</button>
          </div>
          <div className="crm-inline-f635e3db5c">
            Required columns: <code className="crm-inline-47f1c3c9f1">first_name</code>, <code className="crm-inline-47f1c3c9f1">last_name</code>, <code className="crm-inline-47f1c3c9f1">email</code>. Optional: <code>phone</code>, <code>country</code>, <code>password</code>, <code>assigned_team_leader_id</code>
          </div>
          <div className="crm-inline-45cc5675eb">
            <label className="crm-inline-46c1611b90">
              [file] Upload .csv file
              <input type="file" accept=".csv,text/plain" onChange={handleCsvFilePick} className="crm-inline-f2892a2e8a" />
            </label>
            {csvFile && <span className="crm-inline-3152fef1aa">OK {csvFile.name}</span>}
          </div>
          <div className="crm-inline-2d98adf5c6">
            <label className="crm-inline-a756887d09">Or paste CSV text</label>
            <textarea
              rows={6}
              value={csvRawText}
              onChange={e => setCsvRawText(e.target.value)}
              placeholder="first_name,last_name,email,phone,country&#10;John,Smith,john@example.com,+1234567890,US"
              className="crm-inline-807dc54187"
            />
          </div>
          <button
            type="button"
            onClick={handleCsvParse}
            disabled={!csvRawText.trim()}
            className="crm-inline-647f9e7037"
          >[search] Parse &amp; Preview</button>
          {csvParseError && (
            <div className="crm-inline-dfcd03793e">
              {csvParseError}
            </div>
          )}
          {csvParsed.length > 0 && (
            <>
              <div className="crm-inline-6ece9cbd06">
                OK {csvParsed.length} client{csvParsed.length !== 1 ? 's' : ''} ready to import
              </div>
              <div className="crm-inline-155440e9b7">
                <table className="crm-inline-20e84e1952">
                  <thead>
                    <tr className="crm-inline-45bfd12add">
                      {['First', 'Last', 'Email', 'Phone', 'Country'].map(h => (
                        <th key={h} className="crm-inline-8347767041">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvParsed.slice(0, 20).map((row, i) => (
                      <tr key={i} className="crm-inline-4752acff01">
                        <td className="crm-inline-cc525a3d5b">{row.first_name}</td>
                        <td className="crm-inline-cc525a3d5b">{row.last_name}</td>
                        <td className="crm-inline-fb562a6fc6">{row.email}</td>
                        <td className="crm-inline-fb562a6fc6">{row.phone || '-'}</td>
                        <td className="crm-inline-fb562a6fc6">{row.country || '-'}</td>
                      </tr>
                    ))}
                    {csvParsed.length > 20 && (
                      <tr><td colSpan={5} className="crm-inline-099fb73d59">...and {csvParsed.length - 20} more</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={handleCsvImport}
                disabled={csvImporting}
                className="crm-inline-5d72d9cae2" style={{background: csvImporting ? 'var(--crm-border)' : 'var(--crm-accent)', color: csvImporting ? 'var(--crm-text-secondary)' : '#1A1D23', cursor: csvImporting ? 'not-allowed' : 'pointer'}}
              >
                {csvImporting ? 'Importing...' : `⬆ Import ${csvParsed.length} Client${csvParsed.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    )}

    <div>
      <div className="crm-inline-1f128912c6">
        <button
          className="crm-super-admin-btn"
          onClick={handleExportAllClientsCsv}
          disabled={data.clients.length === 0}
          title="Download every active client, not just the current page"
        >
          Export All Clients CSV
        </button>
      </div>

      {/* View toggle: Active | Bin */}
      <div className="crm-inline-dbe2af6058">
        <button
          className={`crm-super-admin-btn crm-super-admin-btn-small${view === 'active' ? '' : ' crm-super-admin-btn-secondary'}`}
          onClick={() => setView('active')}
          style={view === 'active' ? { background: 'var(--crm-accent, #0A84FF)', color: '#fff', borderColor: 'transparent' } : {}}
        >
          Active Clients ({data.clients.length})
        </button>
        <button
          className={`crm-super-admin-btn crm-super-admin-btn-small${view === 'bin' ? '' : ' crm-super-admin-btn-secondary'}`}
          onClick={() => setView('bin')}
          style={view === 'bin' ? { background: '#F6465D', color: '#fff', borderColor: 'transparent' } : {}}
        >
          Recycle Bin ({deletedClients.length})
        </button>
      </div>

      {/* ── Client ID Lookup Bar ── */}
      <div className="crm-inline-045aac899d">
        <div className="crm-inline-f1cffc9ea2" style={{border: '1px solid ' + (idLookupQuery.trim().length >= 3 ? 'var(--crm-accent, #0A84FF)' : 'var(--crm-border, rgba(255, 255, 255, 0.08))')}}>
          <i className="fas fa-fingerprint crm-inline-321987c8fc"  style={{color: idLookupQuery.trim().length >= 3 ? 'var(--crm-accent, #0A84FF)' : 'var(--crm-text-secondary, #8E8E93)'}} />
          <input
            className="crm-super-admin-input crm-inline-e4ac236e65"

            placeholder="Find client by ID - paste or type any part of the ID..."
            value={idLookupQuery}
            onChange={e => setIdLookupQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {idLookupQuery && (
            <button
              onClick={() => setIdLookupQuery('')}
              className="crm-inline-bd766ec69a"
              aria-label="Clear client ID search"
              title="Clear"
            >✕</button>
          )}
          <span className="crm-inline-bbe61493bc">
            {idLookupQuery.trim().length >= 2
              ? idLookupResults.length > 0 ? `${idLookupResults.length} match${idLookupResults.length !== 1 ? 'es' : ''}` : 'No matches'
              : 'type 2+ chars'}
          </span>
        </div>

        {idLookupQuery.trim().length >= 2 && idLookupResults.length > 0 && (
          <div className="crm-inline-edcac8ffc0">
            {idLookupResults.map((client, idx) => {
              const isDeleted = !!(client.deletedAt);
              const office = data.offices.find(o => o.id === client.assignedToOffice);
              const team = data.teams.find(t => t.id === client.assignedToTeam);
              const agent = data.users.find(u => u.id === client.assignedToAgent);
              const q = idLookupQuery.trim();
              const idStr = client.id || '';
              const matchStart = idStr.toLowerCase().indexOf(q.toLowerCase());
              const highlightedId = matchStart >= 0
                ? <span className="crm-inline-2a8054848a">
                    {idStr.slice(0, matchStart)}
                    <mark className="crm-inline-5a26742a5a">{idStr.slice(matchStart, matchStart + q.length)}</mark>
                    {idStr.slice(matchStart + q.length)}
                  </span>
                : <span className="crm-inline-2a8054848a">{idStr}</span>;
              return (
                <div
                  key={client.id}
                  className="crm-inline-50bb1da920" style={{borderTop: idx > 0 ? '1px solid var(--crm-border, rgba(255, 255, 255, 0.06))' : 'none', background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.02)'}}
                >
                  <div className="crm-inline-cbb88a9394">
                    <div className="crm-inline-1d17149d73">
                      <span className="crm-inline-ee06c8540c">{client.firstName} {client.lastName}</span>
                      {isDeleted && <span className="crm-inline-0a35eeea68">DELETED</span>}
                      <span className="crm-inline-bbd0232262">{normalizeStage(client.stage) || '-'}</span>
                    </div>
                    <div className="crm-inline-19a7f6f1e3">
                      <span className="crm-inline-4a91c1bc1e">{highlightedId}</span>
                      {client.email && <span className="crm-inline-4a91c1bc1e">{client.email}</span>}
                      {office && <span className="crm-inline-4a91c1bc1e">Office: {office.name}</span>}
                      {team && <span className="crm-inline-4a91c1bc1e">Team: {team.name}</span>}
                      {agent && <span className="crm-inline-512fcb3d9a">Agent: {agent.name}</span>}
                    </div>
                  </div>
                  <div className="crm-inline-8d493a6c01">
                    <button
                      className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-05e82f8fb6"

                      onClick={() => { openProfile(client); setIdLookupQuery(''); }}
                    >Quick View</button>
                    {!isDeleted && (
                      <button
                        className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-554a8453da"

                        onClick={() => navigate(getClientProfilePath(ROLE.SUPER_ADMIN, currentUser.id, client.id))}
                      >Open Profile</button>
                    )}
                    <button
                      className="crm-inline-0c8d082a99"
                      title="Copy full ID"
                      onClick={() => { navigator.clipboard.writeText(client.id); showNotification('Client ID copied!'); }}
                    ><i className="fas fa-copy"></i></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {view === 'bin' ? (
        /* ── BIN VIEW ── */
        <div>
          <div className="crm-inline-d9e59406ce">
            <span className="crm-inline-7bb942da4f">Deleted clients can be restored or permanently removed.</span>
            <div className="crm-inline-04adbb630e">
              <span className="crm-inline-37d0b7ce9d">Auto-clean entries older than</span>
              <select
                value={binCleanupDays}
                onChange={e => setBinCleanupDays(Number(e.target.value))}
                className="crm-inline-add2874536"
              >
                {[7, 14, 30, 60, 90].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
              <button
                className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-da28825b86"

                onClick={handleBinCleanup}
                disabled={binCleanupBusy}
              >
                {binCleanupBusy ? 'Cleaning...' : '🧹 Clean Up Bin'}
              </button>
            </div>
          </div>
          {binSelected.length > 0 && (
            <div className="crm-inline-b699e35cef">
              <span className="crm-inline-6dac942975">{binSelected.length} selected</span>
              <button className="crm-super-admin-btn crm-super-admin-btn-small" onClick={handleBinBulkRestore}>Restore Selected</button>
              <button className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-fd8ae4de3b"  onClick={handleBinBulkPermanentDelete}>✕ Delete Selected Forever</button>
              <button onClick={() => setBinSelected([])} className="crm-inline-9600724779">Clear</button>
            </div>
          )}
          {pagedBin.length === 0 ? (
            <div className="crm-inline-4f1c9842a8">The bin is empty.</div>
          ) : (
            <div className="crm-admin-table-container">
              <table className="crm-admin-table">
                <thead>
                  <tr>
                    <th className="crm-inline-3666be5c05">
                      <input type="checkbox"
                        checked={allBinPageSelected}
                        onChange={e => {
                          if (e.target.checked) setBinSelected(prev => [...new Set([...prev, ...pagedBin.map(l => l.id)])]);
                          else setBinSelected(prev => prev.filter(id => !pagedBin.find(l => l.id === id)));
                        }}
                      />
                    </th>
                    <th>Client ID</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Country</th>
                    <th>Last Assignment</th>
                    <th>Deleted</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedBin.map(client => (
                    <tr key={client.id} style={{ background: binSelected.includes(client.id) ? 'var(--crm-card)' : undefined }}>
                      <td>
                        <input type="checkbox"
                          checked={binSelected.includes(client.id)}
                          onChange={e => setBinSelected(e.target.checked ? [...binSelected, client.id] : binSelected.filter(id => id !== client.id))}
                        />
                      </td>
                      <td className="crm-inline-93c6e1d4bb">
                        <div className="crm-inline-9023e926fd">
                          <span className="crm-inline-fc24c65864">
                            {client.id ? client.id.slice(0, 6) : '-'}
                          </span>
                          {client.id && (
                            <button
                              title={client.id}
                              onClick={() => navigator.clipboard.writeText(client.id)}
                              className="crm-inline-ccd1cf626f"
                            >
                              <i className="fas fa-copy crm-inline-e9e0e4af65" ></i>
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="crm-inline-5c05f4afaf">{client.firstName} {client.lastName}</td>
                      <td className="crm-inline-37d0b7ce9d">{client.email}</td>
                      <td>{getCountryFlag(client.countryCode, client.country)} {client.country}</td>
                      <td className="crm-inline-37d0b7ce9d">
                        {client.assignedToAgent ? getUserName(client.assignedToAgent, data.users) :
                          client.assignedToTeam ? getTeamName(client.assignedToTeam, data.teams) :
                          client.assignedToOffice ? getOfficeName(client.assignedToOffice, data.offices) : 'Pool'}
                      </td>
                      <td className="crm-inline-a81558e644">{client.deletedAt ? new Date(client.deletedAt).toLocaleDateString() : '-'}</td>
                      <td className="crm-inline-7b9e780fca">
                        <button className="crm-super-admin-btn crm-super-admin-btn-small" onClick={() => restoreClient(client)}>Restore</button>
                        <button className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-fd8ae4de3b"  onClick={() => permanentDelete(client)}>✕ Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {binTotalPages > 1 && (
            <div className="crm-inline-cabecec358">
              <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={binPage === 1} onClick={() => setBinPage(1)}>«</button>
              <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={binPage === 1} onClick={() => setBinPage(p => p - 1)}>‹ Prev</button>
              <span className="crm-inline-2d73a8a9dc">Page {binPage} of {binTotalPages}</span>
              <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={binPage >= binTotalPages} onClick={() => setBinPage(p => p + 1)}>Next ›</button>
              <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={binPage >= binTotalPages} onClick={() => setBinPage(binTotalPages)}>»</button>
            </div>
          )}
        </div>
      ) : (
        /* ── ACTIVE CLIENTS VIEW ── */
        <div>
          <div className="crm-inline-c8e1d2b87e">
            {[
              { label: 'Unassigned Pool', value: unassignedCount, color: '#FF9F0A' },
              { label: 'Pending Team', value: poolCount, color: '#86868B' },
              { label: 'Pending Agent', value: pendingAgentCount, color: '#0A84FF' },
              { label: 'With Agents', value: assignedCount, color: '#30D158' },
              { label: 'Total Clients', value: data.clients.length, color: 'var(--crm-text-primary, #F5F5F7)' },
            ].map(s => (
              <div
                key={s.label}
                title={s.title}
                onClick={s.onClick}
                className="crm-inline-5d7955a72a" style={{cursor: s.onClick ? 'pointer' : 'default'}}
              >
                <div className="crm-inline-b811c0e8fe">
                  <span className="crm-inline-64d7ced97c" style={{ background: s.color }} />
                  <span>{s.label}</span>
                </div>
                <div className="crm-inline-cd9e905a54" style={{color: s.color}}>{s.value}</div>
              </div>
            ))}
          </div>

          <div className="crm-inline-5fc00d5b95">
            <SearchAutocomplete
              className="crm-super-admin-input crm-inline-dd0dba8867"
              placeholder="Search name, email, phone, country..."
              value={search}
              onChange={(v) => { setSearch(v); setPage(1); }}
              fetchSuggestions={searchAdminClients}

              buildSuggestions={(q) => {
                const ql = q.toLowerCase();
                return data.clients
                  .filter(l => {
                    const full = `${l.firstName || ''} ${l.lastName || ''}`.toLowerCase();
                    return (
                      full.includes(ql) ||
                      (l.email || '').toLowerCase().includes(ql) ||
                      (l.phone || '').toLowerCase().includes(ql) ||
                      (l.country || '').toLowerCase().includes(ql)
                    );
                  })
                  .slice(0, 8)
                  .map(l => ({
                    key: l.id,
                    value: `${l.firstName || ''} ${l.lastName || ''}`.trim() || l.email || l.phone || '',
                    label: `${l.firstName || ''} ${l.lastName || ''}`.trim() || '(no name)',
                    meta: [l.email, l.country].filter(Boolean).join('  /  '),
                  }));
              }}
            />
            <select className="crm-super-admin-select crm-inline-97ce5d2089" value={filterOffice} onChange={e => { setFilterOffice(e.target.value); setFilterTeam(''); setFilterAgent(''); setPage(1); }} >
              <option value="">All Offices</option>
              {data.offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select className="crm-super-admin-select crm-inline-97ce5d2089" value={filterTeam} onChange={e => { setFilterTeam(e.target.value); setFilterAgent(''); setPage(1); }} >
              <option value="">All Teams</option>
              {teamsForFilter.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select className="crm-super-admin-select crm-inline-97ce5d2089" value={filterAgent} onChange={e => { setFilterAgent(e.target.value); setPage(1); }} >
              <option value="">All Agents</option>
              {agentsForFilter.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select className="crm-super-admin-select crm-inline-8023707f43" value={filterTeamLeader} onChange={e => { setFilterTeamLeader(e.target.value); setPage(1); }} >
              <option value="">All Team Leaders</option>
              {data.users.filter(u => u.role === ROLE.TEAM_LEAD).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select className="crm-super-admin-select crm-inline-8023707f43" value={filterOwnership} onChange={e => { setFilterOwnership(e.target.value); setPage(1); }} >
              <option value="">All Ownership Types</option>
              <option value="team-leader-owned">Direct Team Leader</option>
              <option value="office-only">Direct Office (no team, leader, or agent)</option>
              <option value="team-no-agent">Team, no agent</option>
              <option value="agent-assigned">Agent assigned</option>
              <option value="unassigned">Completely unassigned</option>
            </select>
            <select className="crm-super-admin-select crm-inline-97ce5d2089" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} >
              <option value="">All Statuses</option>
              {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {(search || filterOffice || filterTeam || filterAgent || filterTeamLeader || filterOwnership || filterStatus) && (
              <button className="crm-super-admin-btn crm-super-admin-btn-small" onClick={() => { setSearch(''); setFilterOffice(''); setFilterTeam(''); setFilterAgent(''); setFilterTeamLeader(''); setFilterOwnership(''); setFilterStatus(''); setPage(1); }}>Clear</button>
            )}
          </div>

          {/* Quick action toolbar: Unassigned filter + bulk / shuffle entry */}
          <div className="crm-inline-4a5ce9080c">
            <button
              className={`crm-super-admin-btn crm-super-admin-btn-small${showUnassignedOnly ? '' : ' crm-super-admin-btn-secondary'}`}
              onClick={() => { setShowUnassignedOnly(v => !v); setPage(1); }}
              style={showUnassignedOnly ? { background: 'var(--crm-accent, #0A84FF)', color: '#fff', borderColor: 'transparent' } : {}}
            >
              {showUnassignedOnly ? '✓ Showing Completely Unassigned' : 'Show Completely Unassigned'}
            </button>
            <button
              className={`crm-super-admin-btn crm-super-admin-btn-small${bulkMode === 'assign' ? '' : ' crm-super-admin-btn-secondary'}`}
              onClick={() => setBulkMode(bulkMode === 'assign' ? null : 'assign')}
            >
              Bulk Assign
            </button>
            <button
              className={`crm-super-admin-btn crm-super-admin-btn-small${bulkMode === 'shuffle' ? '' : ' crm-super-admin-btn-secondary'}`}
              onClick={() => setBulkMode(bulkMode === 'shuffle' ? null : 'shuffle')}
            >
              Shuffle / Distribute
            </button>
            <button
              className="crm-super-admin-btn crm-super-admin-btn-small crm-super-admin-btn-secondary"
              onClick={() => { setCsvImportOpen(true); setCsvRawText(''); setCsvFile(null); setCsvParsed([]); setCsvParseError(''); }}
            >
              Import CSV
            </button>
            {selected.length > 0 && (
              <>
                <span className="crm-inline-6dac942975">
                  {selected.length} selected
                  <button onClick={() => setSelected([])} className="crm-inline-451638d2b7">clear</button>
                </span>
                <span className="crm-inline-c9d36189e0" />
                <button
                  className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-da28825b86"

                  onClick={handleBulkDelete}
                  title={`Move ${selected.length} client(s) to bin`}
                >
                  🗑 Move to Bin
                </button>
                <button
                  className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-fd8ae4de3b"

                  onClick={handleBulkPermanentDelete}
                  title={`Permanently delete ${selected.length} client(s) - cannot be undone`}
                >
                  ✕ Delete Forever
                </button>
                <span className="crm-inline-c9d36189e0" />
                <button
                  className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-da28825b86"

                  onClick={handleBulkSuspend}
                  title={`Suspend ${selected.length} client(s)`}
                >
                  🔒 Suspend
                </button>
                <button
                  className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-2859d9c3fb"

                  onClick={handleBulkActivate}
                  title={`Re-activate ${selected.length} client(s)`}
                >
                  OK Activate
                </button>
              </>
            )}
          </div>

          {/* Bulk Assign / Reassign panel */}
          {bulkMode === 'assign' && (
            <div className="crm-inline-0c81de38b1">
              <div className="crm-inline-f467c411ca">
                Bulk Assign / Reassign - {selected.length} client(s) selected
              </div>

              {/* Quick agent pick */}
              <div className="crm-inline-72d6c38e5f">
                <div className="crm-inline-c9050f438a">Quick assign to Agent (auto-fills office & team)</div>
                <div className="crm-inline-0e35dfc9e8">
                  <select
                    className="crm-super-admin-select crm-inline-ee3d55bf99"

                    value={bulkAgentId}
                    onChange={e => {
                      const agId = e.target.value;
                      setBulkAgentId(agId);
                      setBulkTeamLeaderId('');
                      if (agId) {
                        const agent = data.users.find(u => u.id === agId);
                        if (agent) { setBulkOfficeId(agent.officeId || ''); setBulkTeamId(agent.teamId || ''); }
                      } else {
                        setBulkAgentId('');
                      }
                    }}
                  >
                    <option value="">- No agent -</option>
                    {data.offices.map(office => {
                      const officeAgents = data.users.filter(u => u.role === ROLE.AGENT && u.officeId === office.id);
                      if (!officeAgents.length) return null;
                      return (
                        <optgroup key={office.id} label={`[office] ${office.name}`}>
                          {officeAgents.map(agent => {
                            const team = data.teams.find(t => t.id === agent.teamId);
                            return <option key={agent.id} value={agent.id}>{agent.name}{team ? ` (${team.name})` : ''}</option>;
                          })}
                        </optgroup>
                      );
                    })}
                    {data.users.filter(u => u.role === ROLE.AGENT && !u.officeId).map(agent => (
                      <option key={agent.id} value={agent.id}>{agent.name} (unassigned)</option>
                    ))}
                  </select>
                  <button className="crm-super-admin-btn" onClick={handleBulkAssign} disabled={selected.length === 0}>Apply</button>
                </div>
              </div>

              <div className="crm-inline-72d6c38e5f">
                <div className="crm-inline-c9050f438a">Or assign directly to a Team Leader</div>
                <select
                  className="crm-super-admin-select crm-inline-69d66e5b2e"

                  value={bulkTeamLeaderId}
                  onChange={e => {
                    const leaderId = e.target.value;
                    const leader = data.users.find(u => u.id === leaderId);
                    setBulkTeamLeaderId(leaderId);
                    setBulkAgentId('');
                    setBulkOfficeId(leader?.officeId || '');
                    setBulkTeamId(leader?.teamId || '');
                  }}
                >
                  <option value="">- No direct Team Leader -</option>
                  {data.offices.map(office => {
                    const leaders = data.users.filter(u => u.role === ROLE.TEAM_LEAD && u.officeId === office.id);
                    if (!leaders.length) return null;
                    return (
                      <optgroup key={office.id} label={`${office.name} - Team Leaders`}>
                        {leaders.map(leader => <option key={leader.id} value={leader.id}>{leader.name}{leader.teamId ? ` (${getTeamName(leader.teamId, data.teams)})` : ' (standalone)'}</option>)}
                      </optgroup>
                    );
                  })}
                  {data.users.filter(u => u.role === ROLE.TEAM_LEAD && !u.officeId).map(leader => (
                    <option key={leader.id} value={leader.id}>{leader.name} (standalone)</option>
                  ))}
                </select>
              </div>

              {/* Or office/team only */}
              <div className="crm-inline-d864aefc58">
                <div className="crm-inline-c3e59f1885">Assign to an Office or Team</div>
                <div className="crm-inline-1761803268">
                  Leave Team blank to assign clients directly to the selected office. This clears any direct Team Leader or Agent assignment.
                </div>
                <div className="crm-inline-b16eddf00f">
                  <div className="crm-inline-7291e534ce">
                    <div className="crm-inline-c9050f438a">Office</div>
                    <select className="crm-super-admin-select crm-inline-69d66e5b2e"  value={bulkOfficeId} onChange={e => { setBulkOfficeId(e.target.value); setBulkTeamId(''); setBulkTeamLeaderId(''); setBulkAgentId(''); }}>
                      <option value="">- None (Pool) -</option>
                      {data.offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  <div className="crm-inline-7291e534ce">
                    <div className="crm-inline-c9050f438a">Team</div>
                    <select className="crm-super-admin-select crm-inline-69d66e5b2e"  value={bulkTeamId} onChange={e => { const team = data.teams.find(t => t.id === e.target.value); setBulkTeamId(e.target.value); if (team?.officeId) setBulkOfficeId(team.officeId); setBulkTeamLeaderId(''); setBulkAgentId(''); }}>
                      <option value="">- None -</option>
                      {data.teams.filter(t => !bulkOfficeId || t.officeId === bulkOfficeId || !t.officeId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <button className="crm-super-admin-btn" onClick={handleBulkAssign} disabled={selected.length === 0}>Apply</button>
                </div>
              </div>
            </div>
          )}

          {/* Shuffle / Distribute panel */}
          {bulkMode === 'shuffle' && (
            <div className="crm-inline-a69793461e">
              <div className="crm-inline-db78df92ac">
                Shuffle / Distribute - {selected.length > 0 ? `${selected.length} selected client(s)` : 'all clients with no agent'}
              </div>
              <div className="crm-inline-020cf57ca8">
                <div>
                  <div className="crm-inline-c9050f438a">Distribute among</div>
                  <select className="crm-super-admin-select" value={shuffleScope} onChange={e => { setShuffleScope(e.target.value); setShuffleTargets([]); }}>
                    <option value="offices">Offices</option>
                    <option value="teams">Teams</option>
                    <option value="agents">Agents</option>
                    <option value="team-leaders">Team Leaders (direct)</option>
                  </select>
                </div>
                <div>
                  <div className="crm-inline-c9050f438a">Filter by status (optional)</div>
                  <select className="crm-super-admin-select" value={shuffleStatus} onChange={e => setShuffleStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="crm-inline-6108e8ea52">
                Pick targets ({shuffleTargets.length} selected):
              </div>
              <div className="crm-inline-2e9379db2c">
                {(shuffleScope === 'offices' ? data.offices.map(o => ({ id: o.id, label: o.name })) :
                  shuffleScope === 'teams' ? data.teams.map(t => ({ id: t.id, label: `${t.name} (${getOfficeName(t.officeId, data.offices)})` })) :
                  shuffleScope === 'team-leaders' ? data.users.filter(u => u.role === ROLE.TEAM_LEAD).map(u => ({
                    id: u.id,
                    label: `${u.name}  /  ${u.teamId ? getTeamName(u.teamId, data.teams) : 'standalone'}`,
                  })) :
                  data.users.filter(u => u.role === ROLE.AGENT).map(u => ({ id: u.id, label: `${u.name}  /  ${getTeamName(u.teamId, data.teams)}` }))
                ).map(t => (
                  <button
                    key={t.id}
                    onClick={() => toggleShuffleTarget(t.id)}
                    className="crm-inline-671b1fef69" style={{background: shuffleTargets.includes(t.id) ? '#0A84FF' : 'var(--crm-card)', color: shuffleTargets.includes(t.id) ? 'var(--crm-bg)' : 'var(--crm-text-primary)', fontWeight: shuffleTargets.includes(t.id) ? 600 : 400}}
                  >{t.label}</button>
                ))}
              </div>
              <div className="crm-inline-b41dbad860">
                <button className="crm-super-admin-btn crm-inline-43acb23a2c"  onClick={handleShuffle} disabled={shuffleTargets.length === 0}>🔀 Shuffle Now</button>
                <button className="crm-super-admin-btn crm-super-admin-btn-small crm-super-admin-btn-secondary" onClick={() => setShuffleTargets([])}>Clear targets</button>
              </div>
            </div>
          )}

          <div className="crm-inline-2b759092af">
            Click any row to open the client profile. Showing {paged.length} of {filtered.length} clients (page {page}/{totalPages})
          </div>

          <div className="crm-admin-table-container">
            <table className="crm-admin-table">
              <thead>
                <tr>
                  <th className="crm-inline-3666be5c05">
                    <input
                      type="checkbox"
                      checked={paged.length > 0 && paged.every(l => selected.includes(l.id))}
                      onChange={e => {
                        if (e.target.checked) setSelected([...new Set([...selected, ...paged.map(l => l.id)])]);
                        else setSelected(selected.filter(id => !paged.find(l => l.id === id)));
                      }}
                    />
                  </th>
                  <th>Client ID</th>
                  <th>Name</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Registered</th>
                  <th>Last Activity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 ? (
                  <tr><td colSpan={8} className="crm-inline-69d13600ed">No clients match your filters.</td></tr>
                ) : paged.map(client => (
                  <React.Fragment key={client.id}>
                  <tr className="crm-inline-8410c989c9" style={{background: selected.includes(client.id) ? 'var(--crm-card)' : undefined}} onClick={() => openProfile(client)}>
                    <td onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.includes(client.id)}
                        onChange={e => setSelected(e.target.checked ? [...selected, client.id] : selected.filter(id => id !== client.id))}
                      />
                    </td>
                    <td className="crm-inline-93c6e1d4bb">
                      <div className="crm-inline-9023e926fd">
                        <span className="crm-inline-fc24c65864">
                          {client.id ? client.id.slice(0, 6) : '-'}
                        </span>
                        {client.id && (
                          <button
                            title={client.id}
                            onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(client.id); }}
                            className="crm-inline-ccd1cf626f"
                          >
                            <i className="fas fa-copy crm-inline-e9e0e4af65" ></i>
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="crm-inline-2a907996ec">
                        <div className="crm-inline-87c98a4272">
                          {((client.firstName?.[0] || '') + (client.lastName?.[0] || '')).toUpperCase() || 'L'}
                        </div>
                        <div>
                          <div className="crm-inline-22d6a321ff">{client.firstName} {client.lastName}</div>
                          <div className="crm-inline-b4bc3c00c9">{client.email || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td>{getCountryFlag(client.countryCode, client.country)} {client.country}</td>
                    <td onClick={e => e.stopPropagation()} className="crm-inline-93c6e1d4bb">
                      <StatusDropdown
                        value={normalizeStage(client.stage)}
                        options={CLIENT_STATUSES}
                        onChange={(newStage) => handleClientstatusChange(client.id, newStage)}
                      />
                    </td>
                    <td className="crm-inline-a81558e644">{client.registeredDate || (client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '-')}</td>
                    <td className="crm-inline-93c6e1d4bb">
                      {(() => {
                        const raw = client.lastCommentDate;
                        if (!raw) return <span className="crm-inline-d2b86264af">Never</span>;
                        const diffMs = Date.now() - new Date(raw).getTime();
                        const days = Math.floor(diffMs / 86400000);
                        const label = days === 0 ? 'Today' : days === 1 ? '1d ago' : `${days}d ago`;
                        const color = days === 0 ? '#0ECB81' : days <= 3 ? '#0ECB81' : days <= 7 ? 'var(--crm-accent)' : days <= 30 ? '#FF9F0A' : '#F6465D';
                        return (
                          <span className="crm-inline-5b305d031c" style={{background: `${color}18`, color, border: `1px solid ${color}33`}}>
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                    <td onClick={e => e.stopPropagation()} className="crm-inline-93c6e1d4bb">
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        <button
                          className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-2b76d0882a"
                          onClick={() => enterClientAccount(client)}
                          title="Enter client portal directly (no password needed)"
                        >🚀 Enter Portal</button>
                        <button
                          className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-a9a778b759"
                          onClick={() => { setEditingClient(client); }}
                          title="Edit client profile fields"
                        >Edit</button>
                        <button
                          className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-7106182ce9"
                          onClick={() => deleteClient(client)}
                          title="Move to Recycle Bin"
                        >🗑 Bin</button>
                      </div>
                    </td>
                  </tr>
                  {quickAssignClientId === client.id && (
                    <tr className="crm-inline-0c90dd5535">
                      <td colSpan={8} className="crm-inline-8ebf6e213b" onClick={e => e.stopPropagation()}>
                        <div className="crm-inline-a92a09d3d7">
                          <span className="crm-inline-a0086506f6">Assign "{client.firstName} {client.lastName}" to:</span>
                          <select
                            className="crm-super-admin-select crm-inline-8fb290329b"

                            value={quickAssignAgentId}
                            onChange={e => setQuickAssignAgentId(e.target.value)}
                            autoFocus
                          >
                            <option value="">- Unassign (return to pool) -</option>
                            {data.offices.map(office => {
                              const officeAgents = data.users.filter(u => u.role === ROLE.AGENT && u.officeId === office.id);
                              if (!officeAgents.length) return null;
                              return (
                                <optgroup key={office.id} label={`[office] ${office.name}`}>
                                  {officeAgents.map(agent => {
                                    const team = data.teams.find(t => t.id === agent.teamId);
                                    return (
                                      <option key={agent.id} value={agent.id}>
                                        {agent.name}{team ? `  /  ${team.name}` : ''}
                                      </option>
                                    );
                                  })}
                                </optgroup>
                              );
                            })}
                            {data.users.filter(u => u.role === ROLE.AGENT && !u.officeId).map(agent => (
                              <option key={agent.id} value={agent.id}>{agent.name} (no office)</option>
                            ))}
                          </select>
                          <button
                            className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-7235bfdd8f"

                            onClick={() => handleQuickAssign(client)}
                          >✓ Apply</button>
                          <button
                            className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-7c51cb61d4"

                            onClick={() => { setQuickAssignClientId(null); setQuickAssignAgentId(''); }}
                          >✕ Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="crm-inline-cabecec358">
              <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={page === 1} onClick={() => setPage(1)}>«</button>
              <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
              <span className="crm-inline-2d73a8a9dc">Page {page} of {totalPages}</span>
              <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next ›</button>
              <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</button>
            </div>
          )}
        </div>
      )}

      {/* ── CLIENT PROFILE MODAL ── */}
      {profileClient && (
        <div className="crm-inline-26ed0b614e" onClick={closeProfile}>
          <div className="crm-inline-9fd176dc91" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="crm-inline-34c6f8dd5c">
              <div className="crm-inline-6b94054e0a">
                <div className="crm-inline-af625f0d28">
                  <span className="crm-inline-37e853796e" style={{background: profileClient.isOnline ? '#0ECB81' : 'var(--crm-text-secondary)'}} />
                  <span className="crm-inline-f92d9147b8" style={{color: profileClient.isOnline ? '#0ECB81' : 'var(--crm-text-secondary)'}}>
                    {profileClient.isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
                <h2 className="crm-inline-a6bfdadf64">{profileClient.firstName} {profileClient.lastName}</h2>
                <div className="crm-inline-37d0b7ce9d">{profileClient.email}  /  {profileClient.phone}</div>
              </div>
              <div className="crm-inline-e33c19a99a">
                <button
                  className="crm-inline-8e0d6367ea"
                  onClick={() => navigate(getClientProfilePath(ROLE.SUPER_ADMIN, currentUser.id, profileClient.id))}
                  title="Open the full client profile page"
                >
                  Open Profile
                </button>
                <button
                  className="crm-inline-f36d736200"
                  onClick={() => enterClientAccount(profileClient)}
                  title="Log in to this client's own account"
                >
                  Enter Account
                </button>
                <button
                  className="crm-inline-7bf44199c7"
                  onClick={() => {
                    closeProfile();
                    const el = document.getElementById('bulk-assign-section');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                  title="Reassign this client to an agent"
                >
                  ⇄ Reassign
                </button>
                <button
                  onClick={closeProfile}
                  className="crm-inline-dc5163c973"
                  aria-label="Close"
                >✕</button>
              </div>
            </div>

            {/* Quick Reach Action Bar */}
            <div className="crm-inline-a7d12e2e9b">
              {profileClient.email && (
                <a
                  href={`mailto:${profileClient.email}`}
                  className="crm-inline-f427bbe513"
                  title="Send email"
                >
                  <i className="fas fa-envelope"></i>
                  <span>Email: {profileClient.email}</span>
                </a>
              )}
              {profileClient.phone && (
                <a
                  href={`tel:${profileClient.phone}`}
                  className="crm-inline-7ae5c9168f"
                  title="Call client"
                >
                  <i className="fas fa-phone"></i>
                  <span>Call: {profileClient.phone}</span>
                </a>
              )}
              {profileClient.phone && (
                <a
                  href={`https://wa.me/${String(profileClient.phone).replace(/[^\d+]/g, '').replace(/^\+/, '')}?text=${encodeURIComponent(`Hi ${profileClient.firstName || profileClient.name}, thank you for contacting Codex Dynamics.`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="crm-inline-90b1bb8b63"
                  title="WhatsApp chat"
                >
                  <i className="fab fa-whatsapp"></i>
                  <span>WhatsApp Direct</span>
                </a>
              )}
            </div>

            {/* Client Info Grid - 3 Columns */}
            <div className="crm-inline-0452a3cdcb">
              <div className="crm-inline-1b703a2b29">
                <div className="crm-inline-a9cc2801b4">Client Details</div>
                {[
                  ['Country', profileClient.country || '-'],
                  ['Funnel', profileClient.funnel || '-'],
                  ['Affiliate', profileClient.affiliate || '-'],
                  ['Registered', profileClient.registeredDate || (profileClient.createdAt ? new Date(profileClient.createdAt).toLocaleDateString() : '-')],
                  ['Last Comment', profileClient.lastCommentDate || '-'],
                ].map(([label, val]) => (
                  <div key={label} className="crm-inline-457779bcb4">
                    <span className="crm-inline-54aeff80c9">{label}</span>
                    <span className="crm-inline-3414b99eb6">
                      {label === 'Country' && getCountryFlag(profileClient.countryCode, profileClient.country)}
                      {val}
                    </span>
                  </div>
                ))}
              </div>

              <div className="crm-inline-1b703a2b29">
                <div className="crm-inline-d19c3fe863">Customer Intake & Scope</div>
                {[
                  ['Company / Org', profileClient.company || 'Individual / None'],
                  ['Service Selected', profileClient.service || profileClient.funnel || 'General Inquiry'],
                  ['Estimated Budget', profileClient.budget || '-'],
                  ['Target Timeline', profileClient.timeline || 'Flexible'],
                  ['Entry Origin', profileClient.source === 'website_contact_modal' ? 'Website Modal' : profileClient.source === 'website_contact_form' ? 'Website Form' : (profileClient.source || 'Direct')],
                ].map(([label, val]) => (
                  <div key={label} className="crm-inline-457779bcb4">
                    <span className="crm-inline-54aeff80c9">{label}</span>
                    <span style={{ color: label === 'Estimated Budget' ? '#34C759' : label === 'Service Selected' ? '#0A84FF' : 'var(--crm-text-primary)', fontWeight: label === 'Estimated Budget' || label === 'Service Selected' ? 600 : 400 }}>
                      {val}
                    </span>
                  </div>
                ))}
              </div>

              <div className="crm-inline-1b703a2b29">
                <div className="crm-inline-a9cc2801b4">Assignment Chain</div>
                {[
                  ['Office', profileOffice?.name || 'Unassigned (Pool)', !!profileClient.assignedToOffice],
                  ['Team', profileTeam?.name || '-', !!profileClient.assignedToTeam],
                  ['Agent', profileAgent?.name || '-', !!profileClient.assignedToAgent],
                  ['Assigned By', profileClient.assignedBy || '-', false],
                ].map(([label, val, active]) => (
                  <div key={label} className="crm-inline-457779bcb4">
                    <span className="crm-inline-54aeff80c9">{label}</span>
                    <span style={{ color: active ? 'var(--crm-accent)' : 'var(--crm-text-primary)' }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Customer Submission Message */}
            {profileClient.message && (
              <div className="crm-inline-98c77e7d67">
                <div className="crm-inline-069c8d3c4a">
                  <i className="fas fa-comment-dots crm-inline-17b97a833c" ></i>
                  <span>Customer Submission Message</span>
                </div>
                <div className="crm-inline-b90f8e50e9">
                  "{profileClient.message}"
                </div>
              </div>
            )}

            {/* Internal Staff Notes */}
            {profileClient.notes && (
              <div className="crm-inline-98c77e7d67">
                <div className="crm-inline-40913ddd76">
                  <i className="fas fa-sticky-note"></i>
                  <span>Internal Staff Follow-Up Notes</span>
                </div>
                <div className="crm-inline-9c6d4701ce">
                  {profileClient.notes}
                </div>
              </div>
            )}

            {/* Stage & Comment */}
            <div className="crm-inline-fd79b3f646">
              <div>
                <label className="crm-inline-55ee1f0eec">Select Status</label>
                <select className="crm-super-admin-select crm-inline-69d66e5b2e"  value={profileStage} onChange={e => setProfileStage(e.target.value)}>
                  {CLIENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="crm-inline-55ee1f0eec">Comment</label>
                <textarea
                  value={profileComment}
                  onChange={e => setProfileComment(e.target.value)}
                  rows={3}
                  className="crm-inline-bdba52e523"
                />
              </div>
            </div>

            {/* Reassign Controls */}
            <div className="crm-inline-9723e5c182">
              <div className="crm-inline-85b310266c">Reassign</div>
              <div className="crm-inline-1761803268">
                Pick an agent directly - office and team are filled automatically. Or assign to just an office or team.
              </div>

              {/* Quick assign: agent picker (all agents, grouped by team/office) */}
              <div className="crm-inline-72d6c38e5f">
                <div className="crm-inline-5a62cb576a">Quick Assign to Agent</div>
                <select
                  className="crm-super-admin-select crm-inline-69d66e5b2e"

                  value={reassignAgentId}
                  onChange={e => {
                    const agentId = e.target.value;
                    setReassignAgentId(agentId);
                    if (agentId) {
                      const agent = data.users.find(u => u.id === agentId);
                      if (agent) {
                        setReassignTeamId(agent.teamId || '');
                        setReassignOfficeId(agent.officeId || '');
                      }
                    } else {
                      setReassignAgentId('');
                    }
                  }}
                >
                  <option value="">- No agent (assign to office/team only) -</option>
                  {data.offices.map(office => {
                    const officeAgents = data.users.filter(u => u.role === ROLE.AGENT && u.officeId === office.id);
                    if (officeAgents.length === 0) return null;
                    return (
                      <optgroup key={office.id} label={`[office] ${office.name}`}>
                        {officeAgents.map(agent => {
                          const team = data.teams.find(t => t.id === agent.teamId);
                          return (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}{team ? ` (${team.name})` : ''}
                            </option>
                          );
                        })}
                      </optgroup>
                    );
                  })}
                  {data.users.filter(u => u.role === ROLE.AGENT && !u.officeId).map(agent => (
                    <option key={agent.id} value={agent.id}>{agent.name} (unassigned office)</option>
                  ))}
                </select>
              </div>

              {/* Manual office/team override */}
              <div className="crm-inline-24bc94dc38">
                <div className="crm-inline-5c486f2428">Or assign to Office / Team only</div>
                <div className="crm-inline-cbafd4541f">
                  <div className="crm-inline-7291e534ce">
                    <div className="crm-inline-c9050f438a">Office</div>
                    <select className="crm-super-admin-select crm-inline-69d66e5b2e"  value={reassignOfficeId} onChange={e => { setReassignOfficeId(e.target.value); setReassignTeamId(''); setReassignAgentId(''); }}>
                      <option value="">None (Pool)</option>
                      {data.offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                  <div className="crm-inline-7291e534ce">
                    <div className="crm-inline-c9050f438a">Team</div>
                    <select className="crm-super-admin-select crm-inline-69d66e5b2e"  value={reassignTeamId} onChange={e => { const team = data.teams.find(t => t.id === e.target.value); setReassignTeamId(e.target.value); if (team?.officeId) setReassignOfficeId(team.officeId); setReassignAgentId(''); }}>
                      <option value="">None</option>
                      {data.teams.filter(t => !reassignOfficeId || t.officeId === reassignOfficeId || !t.officeId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Comment History */}
            {profileClient.commentHistory && profileClient.commentHistory.length > 0 && (
              <div className="crm-inline-96993e039c">
                <div className="crm-inline-8ca294ed9c">Comment History</div>
                {[...profileClient.commentHistory].reverse().map((entry, i) => (
                  <div key={i} className="crm-inline-4456df10b5">
                    <div className="crm-inline-b700c47a7c">
                      <span className="crm-inline-42de2265bb">{entry.by}</span>
                      <span className="crm-inline-54aeff80c9">{entry.date}</span>
                    </div>
                    <div className="crm-inline-3414b99eb6">{entry.text}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Profile Change History */}
            <div className="crm-inline-9723e5c182">
              <div className="crm-inline-e938e318f7">
                <div className="crm-inline-9484aff0bd">
                  <span>Profile Change History</span>
                  {profileHistoryLoading && (
                    <span className="crm-inline-f49e92df56">Loading...</span>
                  )}
                </div>
                {profileHistory.length > 0 && (
                  <button
                    onClick={async () => {
                      if (!window.confirm('Clear all profile history for this user?')) return;
                      try {
                        await clearProfileHistoryApi(profileClient.id);
                        setProfileHistory([]);
                      } catch (err) {
                        showNotification('Could not clear profile history: ' + (err.message || 'error'));
                      }
                    }}
                    className="crm-inline-3f4b9cc554"
                  >
                    🗑 Clear All
                  </button>
                )}
              </div>
              {profileHistoryError && (
                <div className="crm-inline-bae26d4855">{profileHistoryError}</div>
              )}
              {!profileHistoryLoading && !profileHistoryError && profileHistory.length === 0 && (
                <div className="crm-inline-2d73a8a9dc">No profile changes recorded yet.</div>
              )}
              {profileHistory.length > 0 && (
                <div className="crm-inline-783fc28f8d">
                  {profileHistory.map((entry) => {
                    const isClientAction = !entry.actorAdminId;
                    const changedFields = entry.after ? Object.keys(entry.after) : [];
                    const date = entry.createdAt
                      ? new Date(entry.createdAt.endsWith('Z') ? entry.createdAt : entry.createdAt + 'Z').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                      : '-';
                    return (
                      <div key={entry.id} className="crm-inline-4065a0f727">
                        <div className="crm-inline-9acaf13c6a">
                          <div className="crm-inline-88c173ee88">
                            <span className="crm-inline-7913752a4d" style={{background: isClientAction ? '#1E3A5F' : '#2D3B22', color: isClientAction ? '#3B82F6' : '#0ECB81'}}>
                              {isClientAction ? 'SELF' : 'ADMIN'}
                            </span>
                            <span className="crm-inline-4305aada87">{entry.actionLabel}</span>
                          </div>
                          <div className="crm-inline-88c173ee88">
                            <span className="crm-inline-6ac0e6b4ea">{date}</span>
                            <button
                              title="Delete this entry"
                              onClick={async () => {
                                try {
                                  await deleteProfileHistoryEntryApi(profileClient.id, entry.id);
                                  setProfileHistory(prev => prev.filter(e => e.id !== entry.id));
                                } catch (err) {
                                  showNotification('Could not delete entry: ' + (err.message || 'error'));
                                }
                              }}
                              className="crm-inline-d302f5a029"
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                        <div className="crm-inline-1584a8a1b4">
                          By: <span style={{ color: isClientAction ? 'var(--crm-text-primary)' : 'var(--crm-accent)' }}>{entry.actorName}</span>
                          {entry.ip && <span className="crm-inline-cfa5ddfa12"> /  IP: {entry.ip}</span>}
                        </div>
                        {changedFields.length > 0 && changedFields.filter(k => k !== 'avatar_url').map((field) => {
                          const before = entry.before?.[field];
                          const after  = entry.after?.[field];
                          const fieldLabel = {
                            name: 'Name', email: 'Email', phone: 'Phone',
                            status: 'Status',
                          }[field] || field;
                          if (field === 'password') return (
                            <div key={field} className="crm-inline-223bace234">Password changed</div>
                          );
                          if (before === undefined && after !== undefined) return (
                            <div key={field} className="crm-inline-ba0de114c0">
                              <span className="crm-inline-54aeff80c9">{fieldLabel}:</span>
                              <span className="crm-inline-4a2d65d353">{String(after)}</span>
                            </div>
                          );
                          return (
                            <div key={field} className="crm-inline-f42c405d43">
                              <span className="crm-inline-54aeff80c9">{fieldLabel}:</span>
                              <span className="crm-inline-0cf506d124">{before !== undefined && before !== null ? String(before) : '-'}</span>
                              <span className="crm-inline-54aeff80c9">→</span>
                              <span className="crm-inline-4a2d65d353">{after !== undefined && after !== null ? String(after) : '-'}</span>
                            </div>
                          );
                        })}
                        {changedFields.includes('avatar_url') && (
                          <div className="crm-inline-223bace234">Profile photo updated</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="crm-inline-e262f6096d">
              <div className="crm-inline-f36152c67e">
                <button className="crm-super-admin-btn crm-super-admin-btn-small" onClick={saveProfile}>💾 Save Changes</button>
                <button className="crm-super-admin-btn crm-super-admin-btn-small crm-super-admin-btn-secondary" onClick={unassignClient}>Return to Pool</button>
              </div>
              <div className="crm-inline-f36152c67e">
                <button
                  className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-a6cfd0a49f"

                  onClick={resetClientstatus}
                  title="Reset stage to New and erase all status history"
                >
                  🔄 Reset Status
                </button>
                <button
                  className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-b9279831c8"

                  onClick={clearClientComments}
                  title="Permanently delete all comments on this client"
                >
                  🗨 Clear Comments
                </button>
                <button className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-fd8ae4de3b"  onClick={() => deleteClient(profileClient)}>🗑 Move to Bin</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingClient && (
        <EditClientModal
          client={editingClient}
          onClose={() => setEditingClient(null)}
          onSave={(updates) => {
            const targetId = editingClient.id;
            setData(prev => ({
              ...prev,
              clients: prev.clients.map(l => l.id === targetId ? { ...l, ...updates } : l),
            }));
            setProfileClient(prev => prev?.id === targetId ? { ...prev, ...updates } : prev);
            showNotification(`Profile updated for ${updates.firstName} ${updates.lastName}.`);
            setEditingClient(null);
            updateClientApi(targetId, updates).catch((err) => {
              console.error('[SuperAdminPanel] EditClientModal save failed', err);
              showNotification('Could not save profile changes to the server.');
            });
          }}
        />
      )}

    </div>
    </>
  );
}

function RecycleBin({ data, setData, showNotification }) {
  const [confirmDialog, confirm] = useConfirmDialog();
  const deletedClients = data.deletedClients || [];
  const recycleBin = data.recycleBin || [];

  // RecycleBin tab - same backend wiring as the AllClientsTable bin actions.
  const restoreClient = (client) => {
    setData(prev => ({
      ...prev,
      clients: [...(prev.clients || []), client],
      deletedClients: (prev.deletedClients || []).filter(l => l.id !== client.id),
    }));
    showNotification(`Restored client "${client.firstName} ${client.lastName}".`);
    restoreClientApi(client.id).catch((error) => {
      console.error('[RecycleBin] restoreClient failed', error);
      showNotification('Could not restore client on the server.');
      setData(prev => ({
        ...prev,
        clients: (prev.clients || []).filter(l => l.id !== client.id),
        deletedClients: [...(prev.deletedClients || []), client],
      }));
    });
  };
  const purgeClient = async (client) => {
    const ok = await confirm({
      title: 'Permanently delete client?',
      message: `Permanently delete "${client.firstName} ${client.lastName}"? This cannot be undone.`,
      confirmLabel: 'Delete forever',
      tone: 'danger',
    });
    if (!ok) return;
    setData(prev => ({ ...prev, deletedClients: (prev.deletedClients || []).filter(l => l.id !== client.id) }));
    showNotification('Client permanently removed.');
    deleteClientApi(client.id, { permanent: true, force: true }).catch((error) => {
      console.error('[RecycleBin] purgeClient failed', error);
      showNotification('Could not permanently delete client on the server.');
      setData(prev => ({ ...prev, deletedClients: [...(prev.deletedClients || []), client] }));
    });
  };
  const restoreItem = async (entry) => {
    try {
      let restored;
      if (entry.type === 'office') restored = await restoreOfficeApi(entry.id);
      else if (entry.type === 'team') restored = await restoreTeamApi(entry.id);
      else if (entry.type === 'agent' || entry.type === 'user') restored = await restoreStaffApi(entry.id);
      else return;
      setData((prev) => {
        const mergeById = (current, additions) => {
          const rows = new Map((current || []).map((row) => [row.id, row]));
          (additions || []).forEach((row) => rows.set(row.id, row));
          return [...rows.values()];
        };
        const clients = restored.clients || [];
        const restoredClientIds = new Set(clients.map((client) => client.id));
        const restoredStaff = Array.isArray(restored.staff)
          ? restored.staff
          : restored.staff ? [restored.staff] : [];
        return {
          ...prev,
          recycleBin: (prev.recycleBin || []).filter((item) => item.id !== entry.id),
          offices: restored.office ? mergeById(prev.offices, [restored.office]) : prev.offices,
          teams: mergeById(prev.teams, restored.teams || (restored.team ? [restored.team] : [])),
          users: mergeById(prev.users, restoredStaff),
          clients: clients.length
            ? [...(prev.clients || []).filter((client) => !restoredClientIds.has(client.id)), ...clients]
            : prev.clients,
        };
      });
      showNotification(`Restored ${entry.type}.`);
    } catch (err) {
      console.error('[RecycleBin] restoreItem failed', err);
      showNotification(`Could not restore ${entry.type} on the server.`);
    }
  };
  const purgeItem = async (entry) => {
    const ok = await confirm({
      title: `Permanently delete ${entry.type}?`,
      message: `Permanently delete this ${entry.type}? This cannot be undone.`,
      confirmLabel: 'Delete forever',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      if (entry.type === 'office') await deleteOfficePermanent(entry.id);
      else if (entry.type === 'team') await deleteTeamPermanent(entry.id);
      else if (entry.type === 'agent' || entry.type === 'user') await deleteStaffApi(entry.id, { permanent: true });
      setData(prev => ({ ...prev, recycleBin: (prev.recycleBin || []).filter(e => e.id !== entry.id) }));
      showNotification(`${entry.type} permanently removed.`);
    } catch (err) {
      console.error('[RecycleBin] purgeItem backend failed', err);
      showNotification(`Could not permanently delete ${entry.type} on the server.`);
    }
  };
  const emptyAll = async () => {
    const ok = await confirm({
      title: 'Empty the recycle bin?',
      message: 'Permanently delete ALL items in the bin? This cannot be undone.',
      confirmLabel: 'Empty bin',
      tone: 'danger',
    });
    if (!ok) return;
    const toPurgeClients = (data.deletedClients || []).map((l) => l.id);
    const toPurgeBin   = [...(data.recycleBin  || [])];
    const clientPurge = toPurgeClients.length > 0 ? purgeBinClients(toPurgeClients) : Promise.resolve();
    const binDeletes = toPurgeBin.map((entry) => {
      if (entry.type === 'office') return deleteOfficePermanent(entry.id);
      if (entry.type === 'team') return deleteTeamPermanent(entry.id);
      if (entry.type === 'agent' || entry.type === 'user') return deleteStaffApi(entry.id, { permanent: true });
      return Promise.resolve();
    });
    const [clientResult, ...binResults] = await Promise.allSettled([clientPurge, ...binDeletes]);
    const failedEntries = toPurgeBin.filter((_, index) => binResults[index]?.status === 'rejected');
    setData((prev) => ({
      ...prev,
      deletedClients: clientResult.status === 'rejected' ? (prev.deletedClients || []) : [],
      recycleBin: failedEntries,
    }));
    const failedCount = failedEntries.length + (clientResult.status === 'rejected' ? 1 : 0);
    if (failedCount) {
      console.error('[RecycleBin] emptyAll: some items failed to purge');
      showNotification(`Failed to permanently delete ${failedCount} item${failedCount > 1 ? 's' : ''}.`);
    } else {
      showNotification('Recycle bin emptied.');
    }
  };
  const totalCount = deletedClients.length + recycleBin.length;

  return (
    <>
    {confirmDialog}
    <div>
      <div className="crm-inline-f0ff082301">
        <div>
          <h2 className="crm-inline-8e9edcb57d">🗑 Recycle Bin</h2>
          <div className="crm-inline-50f28179a6">{totalCount} item{totalCount !== 1 ? 's' : ''} pending permanent deletion.</div>
        </div>
        {totalCount > 0 && (
          <button className="crm-super-admin-btn crm-inline-fd8ae4de3b"  onClick={emptyAll}>Empty Bin</button>
        )}
      </div>

      <div className="crm-super-admin-card crm-inline-b75fad0009" >
        <h3 className="crm-inline-7e6d1b1ae4">Deleted Clients ({deletedClients.length})</h3>
        {deletedClients.length === 0 ? (
          <div className="crm-inline-74fdf58fd1">No deleted clients.</div>
        ) : (
          <div className="crm-super-admin-table-wrapper">
            <table className="crm-super-admin-table">
              <thead><tr><th>Name</th><th>Email</th><th>Country</th><th>Status</th><th>Deleted</th><th>Actions</th></tr></thead>
              <tbody>
                {deletedClients.map(client => (
                  <tr key={client.id}>
                    <td className="crm-inline-5c05f4afaf">{client.firstName} {client.lastName}</td>
                    <td className="crm-inline-37d0b7ce9d">{client.email}</td>
                    <td>{client.country}</td>
                    <td><span className={`crm-status-badge ${statusClass(client.stage)}`}>{normalizeStage(client.stage)}</span></td>
                    <td className="crm-inline-a81558e644">{client.deletedAt ? new Date(client.deletedAt).toLocaleString() : '-'}</td>
                    <td className="crm-inline-93c6e1d4bb">
                      <div className="crm-recycle-bin-actions">
                        <button className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-75a891accc" onClick={() => restoreClient(client)}>↻ Restore</button>
                        <button className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-0ac416c121" onClick={() => purgeClient(client)}>✕ Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="crm-super-admin-card">
        <h3 className="crm-inline-7e6d1b1ae4">Deleted Offices  /  Teams  /  Agents ({recycleBin.length})</h3>
        {recycleBin.length === 0 ? (
          <div className="crm-inline-74fdf58fd1">No deleted offices, teams, or agents.</div>
        ) : (
          <div className="crm-super-admin-table-wrapper">
            <table className="crm-super-admin-table">
              <thead><tr><th>Type</th><th>Name</th><th>Deleted</th><th>Actions</th></tr></thead>
              <tbody>
                {recycleBin.map(entry => (
                  <tr key={entry.id}>
                    <td><span className="crm-inline-c9ca5329f4">{entry.type}</span></td>
                    <td className="crm-inline-5c05f4afaf">{entry.item?.name || entry.item?.firstName || entry.id}</td>
                    <td className="crm-inline-a81558e644">{entry.deletedAt ? new Date(entry.deletedAt).toLocaleString() : '-'}</td>
                    <td className="crm-inline-93c6e1d4bb">
                      <div className="crm-recycle-bin-actions">
                        <button className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-75a891accc" onClick={() => restoreItem(entry)}>↻ Restore</button>
                        <button className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-0ac416c121" onClick={() => purgeItem(entry)}>✕ Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

function SuperAdminPanel({ data, currentUser, setData, assignOfficeManager, createOfficeWithManager, createStandaloneOfficeManager, createTeamLeader, createStandaloneTeamLeader, createAgent, toggleStaffBlocked, setClientAssignment, setUserLoginState, createClient, showNotification }) {
  const navigate = useNavigate();
  const [activeProfileClient, setActiveProfileClient] = useState(null);
  const openClientProfile = (client) => {
    setActiveProfileClient(client);
  };
  const closeClientProfile = () => {
    setActiveProfileClient(null);
  };
  const [activeProfileStaff, setActiveProfileStaff] = useState(null);
  const openStaffProfile = (staffMember) => {
    setActiveProfileStaff(staffMember);
  };
  const closeStaffProfile = () => {
    setActiveProfileStaff(null);
  };
  const [officeId, setOfficeId] = useState('');
  const [officeName, setOfficeName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerPassword, setManagerPassword] = useState('');
  const [newManager, setNewManager] = useState(null);
  const [omStandalone, setOmStandalone] = useState(false);
  // Team Leader creation states
  const [tlOfficeId, setTlOfficeId] = useState('');
  const [tlStandaloneleader, setTlStandaloneleader] = useState(false);
  const [tlTeamName, setTlTeamName] = useState('');
  const [tlleaderName, setTlleaderName] = useState('');
  const [tlleaderEmail, setTlleaderEmail] = useState('');
  const [tlleaderPassword, setTlleaderPassword] = useState('');
  const [tlTeamSize, setTlTeamSize] = useState('');
  const [newTeamLeader, setNewTeamLeader] = useState(null);
  // Agent creation states
  const [agTeamId, setAgTeamId] = useState('');
  const [agOfficeId, setAgOfficeId] = useState('');
  const [agAgentName, setAgAgentName] = useState('');
  const [agAgentPassword, setAgAgentPassword] = useState('');
  const [newAgent, setNewAgent] = useState(null);
  // Hierarchy expansion states (used for inline create-form toggles)
  const [expandedOffices, setExpandedOffices] = useState(new Set());
  const [expandedTeams, setExpandedTeams] = useState(new Set());

  // Search state for Offices / Teams / Agents tabs
  const [officeSearch, setOfficeSearch] = useState('');
  const [teamSearch, setTeamSearch] = useState('');
  const [agentSearch, setAgentSearch] = useState('');

  // Unified staff search (Staff tab)
  const [staffSearch, setStaffSearch] = useState('');
  const [staffRoleFilter, setStaffRoleFilter] = useState(''); // '' | 'Office Manager' | 'Team Leader' | 'Agent'
  const [staffStructureFilter, setStaffStructureFilter] = useState('all');
  const [showCreateSuperAdmin, setShowCreateSuperAdmin] = useState(false);
  const [newSuperAdmin, setNewSuperAdmin] = useState({ name: '', email: '', password: '' });
  const [creatingSuperAdmin, setCreatingSuperAdmin] = useState(false);

  // Staff blocking
  // Derived from data.users so the badge always reflects backend truth
  // (status === 'Suspended' or 'Disabled'). The legacy local-state map has
  // been removed - block/unblock now persists through toggleStaffBlocked.
  const staffBlockedStatus = useMemo(
    () => Object.fromEntries(
      (data.users || []).map((u) => [
        u.id,
        u.status === 'Suspended' || u.status === 'Disabled',
      ])
    ),
    [data.users]
  );

  const handleCreateSuperAdmin = async (event) => {
    event.preventDefault();
    if (creatingSuperAdmin) return;
    setCreatingSuperAdmin(true);
    try {
      const staff = await createStaffApi({
        role: ROLE.SUPER_ADMIN,
        name: newSuperAdmin.name.trim(),
        email: newSuperAdmin.email.trim(),
        password: newSuperAdmin.password,
      });
      setData((prev) => ({ ...prev, users: [...prev.users.filter((user) => user.id !== staff.id), staff] }));
      setNewSuperAdmin({ name: '', email: '', password: '' });
      setShowCreateSuperAdmin(false);
      showNotification('Super Admin account created.');
    } catch (error) {
      showNotification(error?.message || 'Could not create the Super Admin account.');
    } finally {
      setCreatingSuperAdmin(false);
    }
  };
  // Info modal: { type: 'office' | 'team', id }
  const [infoModal, setInfoModal] = useState(null);

  // Edit modal state for renaming staff or changing their password
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState(null);
  const [editModalType, setEditModalType] = useState('name'); // 'name' | 'password'
  const [editModalTitle, setEditModalTitle] = useState('');
  const [editingValue, setEditingValue] = useState('');
  const [staffMemberName, setStaffMemberName] = useState('');
  const [editPasswordShown, setEditPasswordShown] = useState(false);

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditingStaffId(null);
    setEditingValue('');
    setStaffMemberName('');
    setEditModalTitle('');
    setEditPasswordShown(false);
  };

  const generateStrongPassword = () => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*';
    const pool = upper + lower + digits + symbols;
    const pick = (s) => s[Math.floor(Math.random() * s.length)];
    let pwd = pick(upper) + pick(lower) + pick(digits) + pick(symbols);
    for (let i = 0; i < 10; i += 1) pwd += pick(pool);
    pwd = pwd.split('').sort(() => Math.random() - 0.5).join('');
    setEditingValue(pwd);
    setEditPasswordShown(true);
  };

  const passwordStrength = (pw) => {
    if (!pw) return { level: 0, label: 'Empty' };
    let score = 0;
    if (pw.length >= 8) score += 1;
    if (pw.length >= 12) score += 1;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
    if (/\d/.test(pw)) score += 1;
    if (/[^A-Za-z0-9]/.test(pw)) score += 1;
    const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
    return { level: score, label: labels[score] };
  };

  const saveStaffEdit = async () => {
    if (!editingStaffId) return;
    const value = (editingValue || '').trim();
    if (!value) {
      showNotification(editModalType === 'password' ? 'Password cannot be empty.' : 'Name cannot be empty.');
      return;
    }
    const staff = data.users.find(u => u.id === editingStaffId);
    if (!staff) return;
    const updates = editModalType === 'password'
      ? { password: value }
      : { name: value };
    setData(prev => ({
      ...prev,
      users: prev.users.map(u => (u.id === editingStaffId ? { ...u, ...updates } : u)),
    }));
    closeEditModal();
    showNotification(
      editModalType === 'password'
        ? `Password updated for ${staffMemberName}.`
        : `Renamed to "${value}".`
    );
    try {
      const updated = await updateStaffApi(editingStaffId, updates);
      setData(prev => ({
        ...prev,
        users: prev.users.map(u => (
          u.id === editingStaffId
            ? { ...u, ...updated, password: updated.password || updates.password || u.password }
            : u
        )),
      }));
    } catch (err) {
      console.error('[SuperAdminPanel] saveStaffEdit failed', err);
      showNotification('Could not save staff changes on the server.');
      setData(prev => ({
        ...prev,
        users: prev.users.map(u => (u.id === editingStaffId ? staff : u)),
      }));
    }
  };

  /**
   * Block / unblock a staff member through the real backend. The data.users
   * array is updated by the parent App.jsx via toggleStaffBlocked, which
   * means the badge re-derives automatically on the next render.
   *
   * Falls back to a no-op + notification if the parent didn't wire the prop
   * (e.g. when the panel is mounted in a non-real-auth test harness).
   */
  const blockUnblockStaff = async (staffId) => {
    const staffMember = data.users.find(u => u.id === staffId);
    if (!staffMember) return;
    if (typeof toggleStaffBlocked !== 'function') {
      showNotification('Block/unblock is unavailable in this view.');
      return;
    }
    const currentlyBlocked = staffBlockedStatus[staffId];
    const updated = await toggleStaffBlocked(staffId, currentlyBlocked);
    if (updated) {
      const isBlocked = updated.status === 'Suspended' || updated.status === 'Disabled';
      showNotification(`${staffMember.name} has been ${isBlocked ? 'blocked' : 'unblocked'}`);
    }
  };

  const [panelActivityLog, setPanelActivityLog] = useState([]);
  const [panelAuditLog, setPanelAuditLog] = useState([]);

  useEffect(() => {
    let cancelled = false;
    listRecentAuditLog({ limit: 30 }).then((entries) => {
      if (cancelled || !entries.length) return;
      const mapped = entries.map((e) => {
        const actor = e.actor_admin_name ? `by ${e.actor_admin_name}` : '';
        const target = e.target_user_name
          ? `on ${e.target_user_name}`
          : e.target_admin_name
          ? `on ${e.target_admin_name}`
          : '';
        const details = `${e.action.replace(/_/g, ' ')} ${actor} ${target}`.trim();
        const action = e.action || '';
        const type = action.includes('login') ? 'login'
          : action.includes('password') ? 'password-change'
          : action.includes('appointment') ? 'appointment'
          : 'admin-action';
        return {
          userId: e.target_user_id || e.target_admin_id || '',
          type,
          details,
          timestamp: new Date(e.created_at),
        };
      });
      setPanelActivityLog((prev) => (prev.length === 0 ? mapped : prev));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const notificationRef = useRef(null);
  const showPanelNotification = (message, type) => {
    notificationRef.current.show(message, type);
  };
  const logAdminAction = createLogAdminAction(setPanelAuditLog);
  const logActivity = createLogActivity(setPanelActivityLog);
  const clientAccounts = data.clients.map(client => ({
    ...client,
    name: client.name || `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Unknown',
    officeId: client.assignedToOffice,
    teamId: client.assignedToTeam,
    agentId: client.assignedToAgent,
    clientstatus: client.stage,
    accountStatus: client.accountStatus || 'active',
  }));

  const setClientAccounts = (updater) => {
    setData(prev => {
      const mapped = prev.clients.map(l => ({
        ...l,
        name: l.name || `${l.firstName || ''} ${l.lastName || ''}`.trim() || 'Unknown',
        officeId: l.assignedToOffice,
        teamId: l.assignedToTeam,
        agentId: l.assignedToAgent,
        clientstatus: l.stage,
        accountStatus: l.accountStatus || 'active',
      }));
      const updated = typeof updater === 'function' ? updater(mapped) : updater;
      const changedClientUpdates = [];
      const updatedById = Object.fromEntries(updated.map(u => [u.id, u]));
      const nextState = {
        ...prev,
        clients: prev.clients.map(l => {
          const u = updatedById[l.id];
          if (!u) return l;
          const nextClient = {
            ...l,
            name: u.name ?? l.name,
            email: u.email ?? l.email,
            phone: u.phone ?? l.phone,
            country: u.country ?? l.country,
            funnel: u.funnel ?? l.funnel,
            affiliate: u.affiliate ?? l.affiliate,
            registeredDate: u.registeredDate ?? l.registeredDate,
            lastCommentDate: u.lastContactedAt ?? u.lastCommentDate ?? l.lastCommentDate,
            assignedToOffice: u.assignedToOffice ?? u.officeId ?? null,
            assignedToTeam: u.assignedToTeam ?? u.teamId ?? null,
            assignedToAgent: u.assignedToAgent ?? u.agentId ?? null,
            stage: u.stage ?? u.clientstatus ?? l.stage,
            status: u.status ?? l.status,
            accountStatus: u.accountStatus || 'active',
          };
          if (
            l.name !== nextClient.name ||
            l.email !== nextClient.email ||
            l.phone !== nextClient.phone ||
            l.country !== nextClient.country ||
            l.funnel !== nextClient.funnel ||
            l.affiliate !== nextClient.affiliate ||
            l.stage !== nextClient.stage
          ) {
            changedClientUpdates.push({
              id: l.id,
              updates: {
                name: nextClient.name,
                email: nextClient.email,
                phone: nextClient.phone,
                country: nextClient.country,
                funnel: nextClient.funnel,
                affiliate: nextClient.affiliate,
                stage: nextClient.stage,
              },
            });
          }
          return nextClient;
        }),
      };
      changedClientUpdates.forEach(({ id, updates }) => {
        updateClientApi(id, updates).catch((error) => {
          console.error('[SuperAdminPanel] failed to persist client account fields', error);
          showNotification('Could not persist client account update.');
        });
      });
      return nextState;
    });
  };

  useEffect(() => {
    fetchAdminSettings(getAdminToken()).catch((error) => {
      console.error('[SuperAdminPanel] Failed to load saved platform settings:', error);
      showNotification(error?.message || 'Could not load saved platform settings.');
    });
  }, []);

  const dataContextValue = {
    clients: clientAccounts, setClients: setClientAccounts,
    users: clientAccounts, setUsers: setClientAccounts,
    activityLog: panelActivityLog, setActivityLog: setPanelActivityLog,
    auditLog: panelAuditLog, setAuditLog: setPanelAuditLog,
    logAdminAction,
    logActivity,
  };
  const [activeTab, setActiveTab] = useState(() => {
    const saved = sessionStorage.getItem('sa_activeTab');
    return saved === 'Settings' ? 'Site Settings' : (saved || 'Dashboard');
  });
  const [clientProjects, setClientProjects] = useState([]);
  const [clientProjectClients, setClientProjectClients] = useState([]);
  const [clientProjectsLoading, setClientProjectsLoading] = useState(false);
  const [clientProjectsError, setClientProjectsError] = useState('');
  const [identityReviews, setIdentityReviews] = useState([]);
  const [identityReviewsLoading, setIdentityReviewsLoading] = useState(false);
  const [identityReviewsError, setIdentityReviewsError] = useState('');
  const reloadClientProjects = async () => {
    setClientProjectsLoading(true);
    setClientProjectsError('');
    try {
      const [projects, clients] = await Promise.all([
        getAdminClientProjects(),
        listAdminClients({ limit: 500 }),
      ]);
      setClientProjects(projects);
      setClientProjectClients(clients.clients || []);
    } catch (error) {
      setClientProjectsError(error.message || 'Client projects could not be loaded.');
    } finally {
      setClientProjectsLoading(false);
    }
  };
  const reloadIdentityReviews = async () => {
    setIdentityReviewsLoading(true);
    setIdentityReviewsError('');
    try {
      setIdentityReviews(await getAdminClientIdentityReviews('pending'));
    } catch (error) {
      setIdentityReviewsError(error.message || 'Client identity reviews could not be loaded.');
    } finally {
      setIdentityReviewsLoading(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'Client Projects') void reloadClientProjects();
    if (activeTab === 'Identity Reviews') void reloadIdentityReviews();
  }, [activeTab]);
  const [staffSubTab, setStaffSubTab] = useState('Staff');
  const [activeSubTab, setActiveSubTab] = useState(() => {
    const saved = sessionStorage.getItem('sa_activeSubTab');
    const allowed = ['Client Management', 'Client Management', 'Client Upload', 'Notifications'];
    return allowed.includes(saved) ? (saved === 'Client Management' ? 'Client Management' : saved) : 'Client Management';
  });
  const tabsScrollRef = useRef(null);
  const scrollTabs = (dir) => {
    const el = tabsScrollRef.current;
    if (el) el.scrollBy({ left: dir * 200, behavior: 'smooth' });
  };
  useEffect(() => { sessionStorage.setItem('sa_activeTab', activeTab); }, [activeTab]);
  useEffect(() => { sessionStorage.setItem('sa_activeSubTab', activeSubTab); }, [activeSubTab]);
  useEffect(() => {
    const handler = (e) => setActiveTab(e.detail.tab);
    window.addEventListener('admin:goto-tab', handler);
    return () => window.removeEventListener('admin:goto-tab', handler);
  }, []);

  const [pendingCounts, setPendingCounts] = useState({ password_resets: 0, signups: 0 });
  useEffect(() => {
    let alive = true;
    const fetch = async () => {
      try {
        const counts = await getAdminPendingCounts();
        if (alive) setPendingCounts(counts);
      } catch (_) {}
    };
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  // Heartbeat - keeps this admin's session marked as "online".
  useEffect(() => {
    const token = getAdminToken();
    if (!token) return;
    sendHeartbeat(token);
    const id = setInterval(() => sendHeartbeat(token), 30000);
    return () => clearInterval(id);
  }, []);

  const tabs = [
    { name: 'Dashboard', icon: faTachometerAlt },
    { name: 'Client Management', icon: faUsers },
    { name: 'Client Projects', icon: faBriefcase },
    { name: 'Identity Reviews', icon: faIdCard },
    { name: 'Sessions', icon: faUsers },
    { name: 'Staff', icon: faUsers },
    { name: 'Agent Access', icon: faKey },
    { name: 'Accounting', icon: faFileInvoiceDollar },
    { name: 'Mail', icon: faComments },
    { name: 'Security & System', icon: faKey },
    { name: 'SEO & Search', icon: faGlobe },
    { name: 'Site Settings', icon: faCog },
    { name: 'CRM Settings', icon: faPalette },
    { name: 'Projects', icon: faBriefcase },
    { name: 'Audit Log', icon: faHistory },
    { name: 'Recycle Bin', icon: faTrash },
  ];

  const [uploadOfficeId, setUploadOfficeId] = useState('');
  const [uploadTeamId, setUploadTeamId] = useState('');
  const [uploadTeamLeaderId, setUploadTeamLeaderId] = useState('');
  const [uploadAgentId, setUploadAgentId] = useState('');
  const [manualClient, setManualClient] = useState({ firstName: '', lastName: '', email: '', funnel: '', affiliate: '' });
  const [manualCountry, setManualCountry] = useState(null);
  const [manualPhoneCountryCode, setManualPhoneCountryCode] = useState('');
  const [manualPhoneNumber, setManualPhoneNumber] = useState('');
  const [csvPreview, setCsvPreview] = useState([]);
  const [uploadDragOver, setUploadDragOver] = useState(false);
  const [importResults, setImportResults] = useState(null);

  const [saConfirmDialog, saConfirm] = useConfirmDialog();

  // Edit modals for Office / Team / Agent
  const [editingOffice, setEditingOffice] = useState(null);
  const [editingTeam, setEditingTeam] = useState(null);
  const [editingAgent, setEditingAgent] = useState(null);

  const saveOfficeEdit = async ({ officeName, managerName, managerEmail, managerPassword }) => {
    const office = editingOffice;
    const mgr = office._mgr || null;
    setEditingOffice(null);

    // Optimistic update
    setData(prev => ({
      ...prev,
      offices: prev.offices.map(o => o.id === office.id ? { ...o, name: officeName } : o),
      users: mgr
        ? prev.users.map(u => {
            if (u.id !== mgr.id) return u;
            return { ...u, ...(managerName ? { name: managerName } : {}), ...(managerEmail ? { email: managerEmail } : {}) };
          })
        : prev.users,
    }));
    showNotification(`Office "${officeName}" updated.`);

    // Backend: office name
    updateOffice(office.id, { name: officeName }).catch(err => {
      console.error('[SuperAdminPanel] saveOfficeEdit (office) failed', err);
      showNotification('Could not save office name on the server.');
      setData(prev => ({ ...prev, offices: prev.offices.map(o => o.id === office.id ? { id: office.id, name: office.name, managerId: office.managerId } : o) }));
    });

    // Backend: manager name / email / password
    if (mgr && (managerName || managerEmail || managerPassword)) {
      const mgrUpdates = {};
      if (managerName) mgrUpdates.name = managerName;
      if (managerEmail) mgrUpdates.email = managerEmail;
      if (managerPassword) mgrUpdates.password = managerPassword;
      updateStaffApi(mgr.id, mgrUpdates)
        .then(updated => {
          setData(prev => ({
            ...prev,
            users: prev.users.map(u => u.id === mgr.id ? { ...u, ...updated, password: updated.password || managerPassword } : u),
          }));
        })
        .catch(err => {
          console.error('[SuperAdminPanel] saveOfficeEdit (manager) failed', err);
          showNotification('Could not save manager details on the server.');
          setData(prev => ({ ...prev, users: prev.users.map(u => u.id === mgr.id ? mgr : u) }));
        });
    }
  };

  const saveTeamEdit = async ({ leaderName, leaderEmail, leaderPassword, ...teamUpdates }) => {
    const team = editingTeam;
    const leader = team._ldr || null;
    setEditingTeam(null);

    setData(prev => ({
      ...prev,
      teams: prev.teams.map(t => t.id === team.id ? { ...t, ...teamUpdates } : t),
      users: leader
        ? prev.users.map(u => {
            if (u.id !== leader.id) return u;
            return { ...u, ...(leaderName ? { name: leaderName } : {}), ...(leaderEmail ? { email: leaderEmail } : {}) };
          })
        : prev.users,
    }));
    showNotification(`Team "${teamUpdates.name}" updated.`);

    updateTeam(team.id, teamUpdates).catch(err => {
      console.error('[SuperAdminPanel] saveTeamEdit failed', err);
      showNotification('Could not save team changes on the server.');
      setData(prev => ({ ...prev, teams: prev.teams.map(t => t.id === team.id ? { id: team.id, name: team.name, officeId: team.officeId, leaderId: team.leaderId, maxSize: team.maxSize } : t) }));
    });

    if (leader && (leaderName || leaderEmail || leaderPassword)) {
      const ldrUpdates = {};
      if (leaderName) ldrUpdates.name = leaderName;
      if (leaderEmail) ldrUpdates.email = leaderEmail;
      if (leaderPassword) ldrUpdates.password = leaderPassword;
      updateStaffApi(leader.id, ldrUpdates)
        .then(updated => {
          setData(prev => ({
            ...prev,
            users: prev.users.map(u => u.id === leader.id ? { ...u, ...updated, password: updated.password || leaderPassword } : u),
          }));
        })
        .catch(err => {
          console.error('[SuperAdminPanel] saveTeamEdit (leader) failed', err);
          showNotification('Could not save leader details on the server.');
          setData(prev => ({ ...prev, users: prev.users.map(u => u.id === leader.id ? leader : u) }));
        });
    }
  };

  const saveAgentEdit = async (updates) => {
    const agent = editingAgent;
    setEditingAgent(null);
    setData(prev => ({
      ...prev,
      users: prev.users.map(u => u.id === agent.id ? { ...u, ...updates } : u),
    }));
    showNotification(`Agent "${updates.name}" updated.`);
    updateStaffApi(agent.id, updates).catch(err => {
      console.error('[SuperAdminPanel] saveAgentEdit failed', err);
      showNotification('Could not save agent changes on the server.');
      setData(prev => ({ ...prev, users: prev.users.map(u => u.id === agent.id ? agent : u) }));
    });
  };

  const softDeleteOffice = async (office) => {
    const ok = await saConfirm({
      title: 'Move office to the recycle bin?',
      message: `Move "${office.name}" and its teams and staff to the recycle bin? Their clients will be unassigned and can be restored with the office.`,
      confirmLabel: 'Move to bin',
      tone: 'warning',
    });
    if (!ok) return;
    try {
      const result = await deleteOffice(office.id);
      const staffIds = new Set(result.staff_ids || []);
      const teamIds = new Set(result.team_ids || []);
      const clientIds = new Set(result.client_ids || []);
      setData(prev => ({
        ...prev,
        offices: prev.offices.filter(item => item.id !== office.id),
        teams: prev.teams.filter(item => !teamIds.has(item.id)),
        users: prev.users.filter(item => !staffIds.has(item.id)),
        clients: prev.clients.map(client => clientIds.has(client.id) ? {
          ...client,
          assignedToAgent: null,
          assignedToTeam: null,
          assignedToTeamLeader: null,
          assignedToOffice: null,
          assignedAgentName: null,
          assignedTeamName: null,
          assignedOfficeName: null,
        } : client),
        recycleBin: [...(prev.recycleBin || []).filter(item => item.id !== office.id), {
          id: office.id,
          type: 'office',
          item: office,
          deletedAt: result.deleted_at,
        }],
      }));
      showNotification(`Office "${office.name}" moved to the recycle bin.`);
    } catch (err) {
      console.error('[SuperAdminPanel] softDeleteOffice failed', err);
      showNotification(err.message || 'Could not delete office on the server.');
    }
  };

  const softDeleteTeam = async (team) => {
    const ok = await saConfirm({
      title: 'Move team to the recycle bin?',
      message: `Move "${team.name}" and its staff to the recycle bin? Their clients will be unassigned and can be restored with the team.`,
      confirmLabel: 'Move to bin',
      tone: 'warning',
    });
    if (!ok) return;
    try {
      const result = await deleteTeam(team.id);
      const staffIds = new Set(result.staff_ids || []);
      const clientIds = new Set(result.client_ids || []);
      setData(prev => ({
        ...prev,
        teams: prev.teams.filter(item => item.id !== team.id),
        users: prev.users.filter(item => !staffIds.has(item.id)),
        clients: prev.clients.map(client => clientIds.has(client.id) ? {
          ...client,
          assignedToAgent: null,
          assignedToTeam: null,
          assignedToTeamLeader: null,
          assignedToOffice: null,
          assignedAgentName: null,
          assignedTeamName: null,
          assignedOfficeName: null,
        } : client),
        recycleBin: [...(prev.recycleBin || []).filter(item => item.id !== team.id), {
          id: team.id,
          type: 'team',
          item: team,
          deletedAt: result.deleted_at,
        }],
      }));
      showNotification(`Team "${team.name}" moved to the recycle bin.`);
    } catch (err) {
      console.error('[SuperAdminPanel] softDeleteTeam failed', err);
      showNotification(err.message || 'Could not delete team on the server.');
    }
  };

  const softDeleteAgent = async (agent) => {
    const ok = await saConfirm({
      title: 'Move staff member to the recycle bin?',
      message: `Move "${agent.name}" to the recycle bin? Their clients will be unassigned and can be restored with this account.`,
      confirmLabel: 'Move to bin',
      tone: 'warning',
    });
    if (!ok) return;
    try {
      const result = await deleteStaffApi(agent.id);
      const clientIds = new Set(result.client_ids || []);
      setData(prev => ({
        ...prev,
        users: prev.users.filter(user => user.id !== agent.id),
        clients: prev.clients.map(client => clientIds.has(client.id) ? {
          ...client,
          assignedToAgent: null,
          assignedToTeam: null,
          assignedToTeamLeader: null,
          assignedToOffice: null,
          assignedAgentName: null,
          assignedTeamName: null,
          assignedOfficeName: null,
        } : client),
        recycleBin: [...(prev.recycleBin || []).filter(item => item.id !== agent.id), {
          id: agent.id,
          type: 'user',
          item: agent,
          deletedAt: result.deleted_at,
        }],
      }));
      showNotification(`${agent.name} moved to the recycle bin.`);
    } catch (err) {
      console.error('[SuperAdminPanel] softDeleteAgent failed', err);
      showNotification(err.message || 'Could not delete staff on the server.');
    }
  };

  const copyToClipboard = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      showNotification('Login link copied to clipboard');
    } catch {
      showNotification('Copy failed, please copy manually');
    }
  };

  // Staff tab - computed before JSX return so they're available in the ternary
  const staffRows = data.users.filter(u => {
    const isStaff = u.role === ROLE.OFFICE_MANAGER || u.role === ROLE.TEAM_LEAD || u.role === ROLE.AGENT;
    if (!isStaff) return false;
    if (u.status === 'Disabled') return false;
    if (staffRoleFilter && u.role !== staffRoleFilter) return false;
    if (!matchesStaffStructureFilter(u, staffStructureFilter)) return false;
    if (!staffSearch.trim()) return true;
    const q = staffSearch.toLowerCase();
    const office = data.offices.find(o => o.id === u.officeId);
    const team = data.teams.find(t => t.id === u.teamId);
    return (
      u.name.toLowerCase().includes(q) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      u.role.toLowerCase().includes(q) ||
      (office && office.name.toLowerCase().includes(q)) ||
      (team && team.name.toLowerCase().includes(q))
    );
  });
  const staffRoleLabel = { [ROLE.OFFICE_MANAGER]: 'Office Manager', [ROLE.TEAM_LEAD]: 'Team Leader', [ROLE.AGENT]: 'Agent' };
  const staffRoleBadgeStyle = {
    [ROLE.OFFICE_MANAGER]: { background: 'color-mix(in srgb, var(--crm-accent) 15%, transparent)', color: 'var(--crm-accent)', border: '1px solid color-mix(in srgb, var(--crm-accent) 25%, transparent)' },
    [ROLE.TEAM_LEAD]:    { background: 'rgba(69,210,160,0.15)', color: '#45d2a0', border: '1px solid #45d2a040' },
    [ROLE.AGENT]:          { background: 'rgba(52,152,219,0.15)', color: '#3498db', border: '1px solid #3498db40' },
  };
  const renderClientWorkspaceTabs = () => (
    <div className="crm-tab-row">
      <button className={"crm-tab-btn " + ((activeTab === 'Client Management' || activeTab === 'Clients') && (activeSubTab === 'Client Management' || activeSubTab === 'Client Management') ? 'crm-active' : '')} onClick={() => { setActiveTab('Client Management'); setActiveSubTab('Client Management'); }}>
        Client Management
      </button>
      <button className={"crm-tab-btn " + ((activeTab === 'Client Management' || activeTab === 'Clients') && activeSubTab === 'Client Upload' ? 'crm-active' : '')} onClick={() => { setActiveTab('Client Management'); setActiveSubTab('Client Upload'); }}>
        Client Import
      </button>
      <button className={"crm-tab-btn " + ((activeTab === 'Client Management' || activeTab === 'Clients') && activeSubTab === 'Notifications' ? 'crm-active' : '')} onClick={() => { setActiveTab('Client Management'); setActiveSubTab('Notifications'); }}>
        Notifications
      </button>
      <button className={"crm-tab-btn " + (activeTab === 'Enquiries' ? 'crm-active' : '')} onClick={() => setActiveTab('Enquiries')}>
        Enquiries
      </button>
      <button className={"crm-tab-btn " + (activeTab === 'Content' ? 'crm-active' : '')} onClick={() => setActiveTab('Content')}>
        Content
      </button>
      <button className={"crm-tab-btn " + (activeTab === 'Chat' ? 'crm-active' : '')} onClick={() => setActiveTab('Chat')}>
        Chat
      </button>
    </div>
  );

  return (
    <NotificationContext.Provider value={showPanelNotification}>
      <DataContext.Provider value={dataContextValue}>
        <div className="crm-super-admin-container">
          {saConfirmDialog}
          {editingOffice && (() => {
            const _mgr = editingOffice._mgr || null;
            return <EditOfficeModal office={editingOffice} officeManager={_mgr} isManagerBlocked={_mgr ? !!staffBlockedStatus[_mgr.id] : false} onBlock={_mgr ? () => blockUnblockStaff(_mgr.id, ROLE.OFFICE_MANAGER) : undefined} onClose={() => setEditingOffice(null)} onSave={saveOfficeEdit} />;
          })()}
          {editingTeam && (() => {
            const _ldr = editingTeam._ldr || null;
            return <EditTeamModal team={editingTeam} offices={data.offices} teamLeader={_ldr} isLeaderBlocked={_ldr ? !!staffBlockedStatus[_ldr.id] : false} onBlock={_ldr ? () => blockUnblockStaff(_ldr.id, ROLE.TEAM_LEAD) : undefined} onClose={() => setEditingTeam(null)} onSave={saveTeamEdit} />;
          })()}
          {editingAgent && <EditAgentModal agent={editingAgent} teams={data.teams} isBlocked={!!staffBlockedStatus[editingAgent.id]} onBlock={() => blockUnblockStaff(editingAgent.id, ROLE.AGENT)} onClose={() => setEditingAgent(null)} onSave={saveAgentEdit} />}
          <div className="crm-super-admin-header crm-role-panel-header">
            <div className="crm-super-admin-header-top">
              <h3 className="crm-super-admin-title">⚙ Super Admin Panel</h3>
              <HealthIndicator token={getAdminToken()} />
            </div>
            <div
              ref={tabsScrollRef}
              className="crm-super-admin-tabs"
            >
              {tabs.map(tab => {
                const badge = tab.name === 'Identity Reviews' ? identityReviews.length : 0;
                return (
                  <button
                    key={tab.name}
                    onClick={() => setActiveTab(tab.name)}
                    className={`crm-super-admin-tab-btn ${activeTab === tab.name ? 'crm-active' : ''}`}
                  >
                    <FontAwesomeIcon icon={tab.icon} />
                    {tab.name}
                    {badge > 0 && (
                      <span className="crm-tab-pending-badge" aria-label={`${badge} pending`}>
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="crm-super-admin-content">
            {activeTab === 'Sessions' ? (
              <div className="crm-super-admin-card">
                <h2 className="crm-inline-4feedf8e61">🟢 Live Sessions</h2>
                <p className="crm-inline-7fcc53a98e">
                  Real-time view of who is online across all offices, teams, and the client portal. Track individuals to get notified when they come online.
                </p>
                <Sessions token={getAdminToken()} />
              </div>
            ) : (activeTab === 'Client Management' || activeTab === 'Clients') ? (
              <div className="clients-content">
                {renderClientWorkspaceTabs()}
                {activeSubTab === 'Client Management' || activeSubTab === 'Client Management' ? (
                  <div>
                    <div className="crm-super-admin-card">
                      <h2 className="crm-inline-4feedf8e61">👥 Client Management</h2>
                      <p className="crm-inline-7fcc53a98e">
                        Clients and clients are the central account source visible to agents, teams, and offices - filtered by their scope. Here you see every record system-wide.
                      </p>
                      <AllClientsTable data={data} currentUser={currentUser} setData={setData} setClientAssignment={setClientAssignment} showNotification={showNotification} onOpenProfile={openClientProfile} />
                    </div>
                  </div>
                ) : activeSubTab === 'Client Upload' ? (
                  <div className="crm-inline-0acd0995e2">
                    <div className="crm-super-admin-card crm-inline-b75fad0009" >
                      <div className="crm-inline-29145742ca">
                        <div>
                          <h2 className="crm-inline-a238d6d218">[upload] Client Import</h2>
                          <p className="crm-inline-74481d3399">Import clients via CSV or add them one at a time. Optionally assign an office, team, team leader, or agent on import.</p>
                        </div>
                        <a href="data:text/csv;charset=utf-8,firstName,lastName,email,phone,country,funnel,affiliate,assigned_team_leader_id" download="clients-template.csv" className="crm-inline-0df2146dfb">⬇ Template</a>
                      </div>
                      <div className="crm-super-admin-form-row crm-inline-648149cea2" >
                        <div className="crm-super-admin-form-group">
                          <label>Assign to Office</label>
                          <select className="crm-super-admin-select" value={uploadOfficeId} onChange={e => { setUploadOfficeId(e.target.value); setUploadTeamId(''); setUploadAgentId(''); }}>
                            <option value="">- Any Office -</option>
                            {data.offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                        </div>
                        <div className="crm-super-admin-form-group">
                          <label>Assign to Team</label>
                          <select className="crm-super-admin-select" value={uploadTeamId} onChange={e => { setUploadTeamId(e.target.value); setUploadAgentId(''); }}>
                            <option value="">- Any Team -</option>
                            {data.teams.filter(t => !uploadOfficeId || t.officeId === uploadOfficeId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                        <div className="crm-super-admin-form-group">
                          <label>Assign to Team Leader</label>
                          <select className="crm-super-admin-select" value={uploadTeamLeaderId} onChange={e => setUploadTeamLeaderId(e.target.value)}>
                            <option value="">- No direct team leader -</option>
                            {data.users.filter(u => u.role === ROLE.TEAM_LEAD).map(u => (
                              <option key={u.id} value={u.id}>
                                {u.name}{u.teamId ? ` (${getTeamName(u.teamId, data.teams)})` : ' (standalone)'}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="crm-super-admin-form-group">
                          <label>Assign to Agent</label>
                          <select className="crm-super-admin-select" value={uploadAgentId} onChange={e => setUploadAgentId(e.target.value)}>
                            <option value="">- Any Agent -</option>
                            {data.users.filter(u => u.role === ROLE.AGENT && (!uploadTeamId || u.teamId === uploadTeamId)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="crm-inline-e535d61f79">
                      <div className="crm-super-admin-card">
                        <h3 className="crm-inline-31ff094545">CSV File Import</h3>
                        <div
                          onDragOver={e => { e.preventDefault(); setUploadDragOver(true); }}
                          onDragLeave={() => setUploadDragOver(false)}
                          onDrop={e => {
                            e.preventDefault(); setUploadDragOver(false);
                            const file = e.dataTransfer.files[0];
                            if (file && file.name.endsWith('.csv')) {
                              const reader = new FileReader();
                              reader.onload = ev => {
                                const rows = ev.target.result.split('\n').filter(l => l.trim());
                                const headers = rows[0].split(',').map(h => h.trim());
                                setCsvPreview(rows.slice(1).map(line => { const v = line.split(','); return headers.reduce((o,h,i) => { o[h] = (v[i]||'').trim(); return o; }, {}); }));
                                setImportResults(null);
                              };
                              reader.readAsText(file);
                            } else { showNotification('Please drop a valid .csv file'); }
                          }}
                          onClick={() => document.getElementById('csvUploadInput').click()}
                          className="crm-inline-d4408311f8" style={{border: '2px dashed ' + (uploadDragOver ? 'var(--crm-accent)' : 'var(--crm-border)'), background: uploadDragOver ? 'color-mix(in srgb, var(--crm-accent) 4%, transparent)' : 'transparent'}}
                        >
                          <div className="crm-inline-5558406ddd">📂</div>
                          <div className="crm-inline-1f7f71640a">Drag &amp; drop a CSV file</div>
                          <div className="crm-inline-2d73a8a9dc">or click to browse &nbsp;&middot;&nbsp; columns: firstName, lastName, email, phone, country, funnel, affiliate</div>
                          <input id="csvUploadInput" type="file" accept=".csv" className="crm-inline-f2892a2e8a" onChange={e => {
                            const file = e.target.files[0]; if (!file) return;
                            const reader = new FileReader();
                            reader.onload = ev => {
                              const rows = ev.target.result.split('\n').filter(l => l.trim());
                              const headers = rows[0].split(',').map(h => h.trim());
                              setCsvPreview(rows.slice(1).map(line => { const v = line.split(','); return headers.reduce((o,h,i) => { o[h] = (v[i]||'').trim(); return o; }, {}); }));
                              setImportResults(null);
                            };
                            reader.readAsText(file); e.target.value = '';
                          }} />
                        </div>
                        {csvPreview.length > 0 && (
                          <>
                            <div className="crm-inline-845cb621b4">
                              <span className="crm-inline-47c22073b5">{csvPreview.length} rows detected</span>
                              <button onClick={() => { setCsvPreview([]); setImportResults(null); }} className="crm-inline-b8fc5f8b40">✕ Clear</button>
                            </div>
                            <div className="crm-super-admin-table-wrapper crm-inline-3f46e8fef5" >
                              <table className="crm-super-admin-table">
                                <thead><tr>{csvPreview[0] && Object.keys(csvPreview[0]).map(h => <th key={h}>{h}</th>)}</tr></thead>
                                <tbody>{csvPreview.slice(0,10).map((row,i) => <tr key={i}>{Object.values(row).map((v,j) => <td key={j}>{v||'-'}</td>)}</tr>)}</tbody>
                              </table>
                            </div>
                            {csvPreview.length > 10 && <p className="crm-inline-315460a4c1">Showing first 10 of {csvPreview.length} rows</p>}
                            <button className="crm-super-admin-btn crm-inline-492dac157e"  onClick={async () => {
                              let successCount = 0;
                              let failCount = 0;
                              for (const row of csvPreview) {
                                const result = await createClient({
                                  firstName: row.firstName || row.first_name || '',
                                  lastName: row.lastName || row.last_name || '',
                                  email: row.email || '',
                                  phone: row.phone || '',
                                  country: row.country || '',
                                  funnel: row.funnel || '',
                                  affiliate: row.affiliate || '',
                                  assignedToOffice: uploadOfficeId || null,
                                  assignedToTeam: uploadTeamId || null,
                                  assignedToTeamLeader: uploadTeamLeaderId || null,
                                  assignedToAgent: uploadAgentId || null,
                                });
                                if (result) successCount++; else failCount++;
                              }
                              setImportResults({ count: successCount, failed: failCount });
                              setCsvPreview([]);
                              showNotification(`${successCount} clients imported${failCount ? `, ${failCount} failed` : ''}`);
                            }}>✓ Import {csvPreview.length} Clients</button>
                          </>
                        )}
                        {importResults && (
                          <div className="crm-inline-b435b0e129">
                            <div className="crm-inline-e1fad10ef5">OK {importResults.count} clients imported</div>
                            <div className="crm-inline-d10a370397">They now appear in Client Management</div>
                          </div>
                        )}
                      </div>
                      <div className="crm-super-admin-card">
                        <h3 className="crm-inline-31ff094545">Manual Entry</h3>
                        <div className="crm-inline-7c464eccac">
                          <div className="crm-inline-89dbd8ea8c">
                            <div><div className="crm-inline-1aabd903d6">First Name *</div><input className="crm-super-admin-input" placeholder="First name..." value={manualClient.firstName} onChange={e => setManualClient(p => ({ ...p, firstName: e.target.value }))} autoComplete="off" /></div>
                            <div><div className="crm-inline-1aabd903d6">Last Name</div><input className="crm-super-admin-input" placeholder="Last name..." value={manualClient.lastName} onChange={e => setManualClient(p => ({ ...p, lastName: e.target.value }))} autoComplete="off" /></div>
                          </div>
                          <div><div className="crm-inline-1aabd903d6">Email *</div><input className="crm-super-admin-input" placeholder="email@example.com" type="email" value={manualClient.email} onChange={e => setManualClient(p => ({ ...p, email: e.target.value }))} autoComplete="off" /></div>
                          <div>
                            <div className="crm-inline-1aabd903d6">Country</div>
                            <CountrySelect
                              value={manualCountry?.code || ''}
                              onChange={(c) => {
                                setManualCountry(c);
                                if (c && !manualPhoneCountryCode) setManualPhoneCountryCode(c.code);
                              }}
                            />
                          </div>
                          <div>
                            <div className="crm-inline-1aabd903d6">Phone</div>
                            <PhoneInput
                              countryCode={manualPhoneCountryCode}
                              onCountryCodeChange={(code) => {
                                setManualPhoneCountryCode(code);
                                if (!manualCountry) {
                                  const found = COUNTRY_LIST.find(x => x.code === code);
                                  if (found) setManualCountry(found);
                                }
                              }}
                              number={manualPhoneNumber}
                              onNumberChange={setManualPhoneNumber}
                            />
                          </div>
                          <div className="crm-inline-89dbd8ea8c">
                            <div><div className="crm-inline-1aabd903d6">Funnel</div><input className="crm-super-admin-input" placeholder="Funnel name..." value={manualClient.funnel} onChange={e => setManualClient(p => ({ ...p, funnel: e.target.value }))} autoComplete="off" /></div>
                            <div><div className="crm-inline-1aabd903d6">Affiliate</div><input className="crm-super-admin-input" placeholder="Affiliate code..." value={manualClient.affiliate} onChange={e => setManualClient(p => ({ ...p, affiliate: e.target.value }))} autoComplete="off" /></div>
                          </div>
                          <button className="crm-super-admin-btn crm-inline-b87959d0ff"  disabled={!manualClient.firstName || !manualClient.email} onClick={async () => {
                            const emailVal = (manualClient.email || '').trim();
                            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailVal)) {
                              alert('Please enter a valid email address.');
                              return;
                            }
                            const fullPhone = buildStoredPhone(manualPhoneCountryCode, manualPhoneNumber);
                            const result = await createClient({
                              ...manualClient,
                              phone: fullPhone,
                              country: manualCountry?.name || '',
                              countryCode: manualCountry?.code || '',
                              assignedToOffice: uploadOfficeId || null,
                              assignedToTeam: uploadTeamId || null,
                              assignedToTeamLeader: uploadTeamLeaderId || null,
                              assignedToAgent: uploadAgentId || null,
                            });
                            if (result) {
                              setManualClient({ firstName: '', lastName: '', email: '', funnel: '', affiliate: '' });
                              setManualCountry(null);
                              setManualPhoneCountryCode('');
                              setManualPhoneNumber('');
                            }
                          }}>✓ Add Client</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : activeSubTab === 'Notifications' ? (
                  <Notifications data={data} setData={setData} clients={data.clients} currentUserId={data.users.find(u => u.role === ROLE.SUPER_ADMIN)?.id} isSuperAdmin />
                ) : null}
              </div>
            ) : activeTab === 'Enquiries' ? (
              <div className="clients-content">
                {renderClientWorkspaceTabs()}
                <div className="crm-super-admin-card crm-inline-5e87dff19b" >
                  <h2 className="crm-inline-4feedf8e61">📬 Customer Enquiries</h2>
                  <p className="crm-inline-7fcc53a98e">
                    Inbound customer enquiries submitted through public website contact forms, booking modals, and CRM intake.
                  </p>
                  <SiteCrmWorkspace
                    defaultTab="enquiries"
                    standalone
                    showNotification={showNotification}
                    onOpenClientProfile={openClientProfile}
                    clients={data.clients}
                  />
                </div>
              </div>
            ) : activeTab === 'Content' ? (
              <div className="clients-content">
                {renderClientWorkspaceTabs()}
                <SiteCrmWorkspace
                  defaultTab="content"
                  standalone
                  showNotification={showNotification}
                />
              </div>
            ) : activeTab === 'Chat' ? (
              <div className="clients-content">
                {renderClientWorkspaceTabs()}
                <SiteCrmWorkspace
                  defaultTab="chat"
                  standalone
                  showNotification={showNotification}
                />
              </div>
            ) : activeTab === 'Accounting' ? (
              <AccountingWorkspace showNotification={showPanelNotification} />
            ) : activeTab === 'Mail' ? (
              <SiteSettingsTab key="mail" showNotification={showNotification} initialSubTab="hostinger-mail" standaloneSection />
            ) : activeTab === 'Security & System' ? (
              <SiteSettingsTab key="security" showNotification={showNotification} initialSubTab="security" standaloneSection />
            ) : activeTab === 'SEO & Search' ? (
              <SiteSettingsTab key="seo" showNotification={showNotification} initialSubTab="seo" standaloneSection />
            ) : activeTab === 'Staff' ? (
              <div className="crm-inline-0acd0995e2">
                <div className="crm-tab-row crm-inline-eb7e8501e1" >
                  <button className={"crm-tab-btn " + (staffSubTab === 'Staff' ? 'crm-active' : '')} onClick={() => setStaffSubTab('Staff')}>
                    Staff
                  </button>
                  <button className={"crm-tab-btn " + (staffSubTab === 'Offices' ? 'crm-active' : '')} onClick={() => setStaffSubTab('Offices')}>
                    Offices
                  </button>
                  <button className={"crm-tab-btn " + (staffSubTab === 'Teams' ? 'crm-active' : '')} onClick={() => setStaffSubTab('Teams')}>
                    Teams
                  </button>
                  <button className={"crm-tab-btn " + (staffSubTab === 'Agents' ? 'crm-active' : '')} onClick={() => setStaffSubTab('Agents')}>
                    Agents
                  </button>
                </div>

                {staffSubTab === 'Offices' ? (
                  <div>
                    <div className="crm-super-admin-card crm-inline-b75fad0009" >
                      <div className="crm-inline-13efe9dc7b">
                        <div>
                          <h2 className="crm-inline-a238d6d218">[office] Offices</h2>
                          <p className="crm-inline-74481d3399">{data.offices.length} offices &mdash; manage offices and their managers</p>
                        </div>
                        <button className="crm-super-admin-btn" onClick={() => setExpandedOffices(prev => { const s = new Set(prev); s.has('__create') ? s.delete('__create') : s.add('__create'); return s; })}>
                          {expandedOffices.has('__create') ? '✕ Cancel' : '+ New Office'}
                        </button>
                      </div>
                    </div>
                    {expandedOffices.has('__create') && (
                      <div className="crm-super-admin-card crm-inline-d7be7d9e85" >
                        <h3 className="crm-inline-06b681cbfb">New Office or Standalone Office Manager</h3>
                        <label className="crm-inline-8bdcf46589">
                          <input type="checkbox" checked={omStandalone} onChange={e => setOmStandalone(e.target.checked)} />
                          Create an office manager without creating or assigning an office
                        </label>
                        <div className="crm-super-admin-form-row">
                          {!omStandalone && (
                            <div className="crm-super-admin-form-group">
                              <label>Office Name</label>
                              <input className="crm-super-admin-input" autoComplete="off" placeholder="Office name..." value={officeName} onChange={e => setOfficeName(e.target.value)} />
                            </div>
                          )}
                          <div className="crm-super-admin-form-group">
                            <label>{omStandalone ? 'Manager Name' : 'Manager Name (optional)'}</label>
                            <input className="crm-super-admin-input" autoComplete="off" placeholder="Manager name..." value={managerName} onChange={e => setManagerName(e.target.value)} />
                          </div>
                          {omStandalone && (
                            <div className="crm-super-admin-form-group">
                              <label>Manager Email</label>
                              <input className="crm-super-admin-input" autoComplete="email" placeholder="manager@example.com" type="email" value={managerEmail} onChange={e => setManagerEmail(e.target.value)} />
                            </div>
                          )}
                          <div className="crm-super-admin-form-group">
                            <label>{omStandalone ? 'Password' : 'Password (optional)'}</label>
                            <input className="crm-super-admin-input" autoComplete="new-password" placeholder="Password..." type="password" value={managerPassword} onChange={e => setManagerPassword(e.target.value)} />
                          </div>
                          <div className="crm-super-admin-form-group crm-inline-5b71234e2c" >
                            <label className="crm-inline-8a461919d2">_</label>
                            <button className="crm-super-admin-btn" disabled={omStandalone ? (!managerName.trim() || !managerEmail.trim() || !managerPassword) : (!officeName.trim() || Boolean(managerName.trim()) !== Boolean(managerPassword))} onClick={async () => {
                              const newMgr = omStandalone
                                ? await createStandaloneOfficeManager(managerName, managerEmail, managerPassword)
                                : await createOfficeWithManager(officeName, managerName, managerPassword);
                              if (newMgr === undefined || (omStandalone && !newMgr)) return;
                              if (newMgr) setNewManager(newMgr);
                              else showNotification(`Office "${officeName}" created.`);
                              setOfficeName(''); setManagerName(''); setManagerEmail(''); setManagerPassword(''); setOmStandalone(false);
                              setExpandedOffices(prev => { const s = new Set(prev); s.delete('__create'); return s; });
                            }}>✓ Create</button>
                          </div>
                        </div>
                        {newManager && (
                          <div className="crm-credentials-output-container crm-inline-b26aecebd1" >
                            <h4 className="crm-inline-9dd0c440ca">Created: {newManager.name}</h4>
                            <div className="crm-credential-item"><span>Login Link</span><code>{newManager.loginLink}</code><button className="crm-link-copy-btn" onClick={() => copyToClipboard(newManager.loginLink)}>[list] Copy</button></div>
                            <div className="crm-credential-item"><span>Email</span><code>{newManager.email}</code></div>
                            <div className="crm-credential-item"><span>Password</span><code>{newManager.password}</code><button className="crm-link-copy-btn" onClick={() => copyToClipboard(newManager.password)}>[list] Copy</button></div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="crm-super-admin-card">
                      <div className="crm-inline-72d6c38e5f">
                        <SearchAutocomplete
                          className="crm-super-admin-input crm-inline-bdcd0434f4"
                          placeholder="[search]  Search offices or managers..."
                          value={officeSearch}
                          onChange={setOfficeSearch}
                          buildSuggestions={(query) => data.offices.filter((office) => [
                            office.name, office.officeName, office.managerName, office.email,
                          ].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
                            .slice(0, 8).map((office) => ({
                              key: office.id,
                              value: office.name || office.officeName || '',
                              label: office.name || office.officeName || 'Office',
                              meta: office.managerName || office.email || '',
                            }))}
                        />
                      </div>
                      <div className="crm-inline-2b759092af">
                        Click any office / manager row to open their summary modal and access their full profile.
                      </div>
                      <div className="crm-super-admin-table-wrapper">
                        <table className="crm-super-admin-table">
                          <thead>
                            <tr>
                              <th>ID</th>
                              <th>Office</th>
                              <th>Manager</th>
                              <th className="crm-inline-72a68ac344">Teams</th>
                              <th className="crm-inline-72a68ac344">Agents</th>
                              <th className="crm-inline-72a68ac344">Clients</th>
                              <th className="crm-inline-72a68ac344">Deposits</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.offices.filter(office => {
                              if (!officeSearch.trim()) return true;
                              const q = officeSearch.toLowerCase();
                              const manager = data.users.find(u => u.role === ROLE.OFFICE_MANAGER && u.officeId === office.id);
                              return office.name.toLowerCase().includes(q) || (manager && manager.name.toLowerCase().includes(q));
                            }).map(office => {
                              const officeManager = data.users.find(u => u.role === ROLE.OFFICE_MANAGER && u.officeId === office.id);
                              const officeTeams = data.teams.filter(t => t.officeId === office.id);
                              const officeClients = data.clients.filter(l => l.assignedToOffice === office.id);
                              const officeAgents = data.users.filter(u => u.role === ROLE.AGENT && u.officeId === office.id);
                              const officeDeposits = officeClients.filter(l => l.stage === 'Deposit').length;
                              return (
                                <tr
                                  key={office.id}
                                  className="crm-inline-8410c989c9"
                                  onClick={() =>
                                    openStaffProfile(
                                      officeManager || {
                                        id: `office_${office.id}`,
                                        isOfficeOnly: true,
                                        officeId: office.id,
                                        role: ROLE.OFFICE_MANAGER,
                                        name: `${office.name} (Unassigned Manager)`,
                                        status: 'Active',
                                      }
                                    )
                                  }
                                  title={`Open summary for ${officeManager ? officeManager.name : office.name}`}
                                >
                                  <td className="crm-inline-93c6e1d4bb" onClick={e => e.stopPropagation()}>
                                    <div className="crm-inline-9023e926fd">
                                      <span className="crm-inline-6c559c15fe">{office.id ? office.id.slice(0, 6) : '-'}</span>
                                      {office.id && <button title={office.id} onClick={() => navigator.clipboard.writeText(office.id)} className="crm-inline-ccd1cf626f"><i className="fas fa-copy crm-inline-cdc34a99ce" ></i></button>}
                                    </div>
                                  </td>
                                  <td className="crm-inline-5c05f4afaf">{office.name}</td>
                                  <td>
                                    {officeManager ? (
                                      <div className="crm-inline-9484aff0bd">
                                        <span className={'status-indicator ' + (officeManager.isLoggedIn ? 'crm-online' : 'crm-offline')}></span>
                                        <span className="crm-inline-73aacda4f4">{officeManager.name}</span>
                                      </div>
                                    ) : (
                                      <div className="crm-inline-88c173ee88" onClick={e => e.stopPropagation()}>
                                        <select className="crm-super-admin-select crm-inline-21b8695e4e"  value={officeId} onChange={e => setOfficeId(e.target.value)}>
                                          <option value="">Assign manager...</option>
                                          {data.users.filter(u => u.role === ROLE.OFFICE_MANAGER && !u.officeId).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                        <button className="crm-super-admin-btn crm-super-admin-btn-small" disabled={!officeId} onClick={() => { assignOfficeManager(office.id, officeId); showNotification('Manager assigned!'); setOfficeId(''); }}>✓</button>
                                      </div>
                                    )}
                                  </td>
                                  <td className="crm-inline-72a68ac344">{officeTeams.length}</td>
                                  <td className="crm-inline-72a68ac344">{officeAgents.length}</td>
                                  <td className="crm-inline-72a68ac344">{officeClients.length}</td>
                                  <td className="crm-inline-2a9af5616f">{officeDeposits}</td>
                                  <td>
                                    {officeManager ? (
                                      <span className={'crm-badge ' + (staffBlockedStatus[officeManager.id] ? 'crm-badge-danger' : 'crm-badge-success')}>{staffBlockedStatus[officeManager.id] ? 'Blocked' : 'Active'}</span>
                                    ) : <span className="crm-badge crm-badge-warning">No Manager</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : staffSubTab === 'Teams' ? (
                  <div className="crm-inline-0acd0995e2">
                    <div className="crm-super-admin-card crm-inline-b75fad0009" >
                      <div className="crm-inline-13efe9dc7b">
                        <div>
                          <h2 className="crm-inline-a238d6d218">[users] Teams</h2>
                          <p className="crm-inline-74481d3399">{data.teams.length} teams &mdash; manage teams and their leaders</p>
                        </div>
                        <button className="crm-super-admin-btn" onClick={() => setExpandedTeams(prev => { const s = new Set(prev); s.has('__create') ? s.delete('__create') : s.add('__create'); return s; })}>
                          {expandedTeams.has('__create') ? '✕ Cancel' : '+ New Team'}
                        </button>
                      </div>
                    </div>
                    {expandedTeams.has('__create') && (
                      <div className="crm-super-admin-card crm-inline-1254ad4803" >
                        <h3 className="crm-inline-06b681cbfb">New Team or Standalone Team Leader</h3>
                        <label className="crm-inline-8bdcf46589">
                          <input type="checkbox" checked={tlStandaloneleader} onChange={e => setTlStandaloneleader(e.target.checked)} />
                          Create a team leader without creating or assigning a team
                        </label>
                        <div className="crm-super-admin-form-row">
                          <div className="crm-super-admin-form-group">
                            <label>Office</label>
                            <select className="crm-super-admin-select" value={tlOfficeId} onChange={e => setTlOfficeId(e.target.value)}>
                              <option value="">No office (independent)</option>
                              {data.offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                            </select>
                          </div>
                          {!tlStandaloneleader && <>
                            <div className="crm-super-admin-form-group">
                              <label>Team Name</label>
                              <input className="crm-super-admin-input" autoComplete="off" placeholder="Team name..." value={tlTeamName} onChange={e => setTlTeamName(e.target.value)} />
                            </div>
                            <div className="crm-super-admin-form-group">
                              <label>Max Size (optional)</label>
                              <input className="crm-super-admin-input" autoComplete="off" placeholder="e.g. 10" type="number" value={tlTeamSize} onChange={e => setTlTeamSize(e.target.value)} />
                            </div>
                          </>}
                          <div className="crm-super-admin-form-group">
                            <label>{tlStandaloneleader ? 'leader Name' : 'leader Name (optional)'}</label>
                            <input className="crm-super-admin-input" autoComplete="off" placeholder="leader name..." value={tlleaderName} onChange={e => setTlleaderName(e.target.value)} />
                          </div>
                          {tlStandaloneleader && (
                            <div className="crm-super-admin-form-group">
                              <label>Leader Email</label>
                              <input className="crm-super-admin-input" autoComplete="email" placeholder="leader@example.com" type="email" value={tlleaderEmail} onChange={e => setTlleaderEmail(e.target.value)} />
                            </div>
                          )}
                          <div className="crm-super-admin-form-group">
                            <label>{tlStandaloneleader ? 'Password' : 'Password (optional)'}</label>
                            <input className="crm-super-admin-input" autoComplete="new-password" placeholder="Password..." type="password" value={tlleaderPassword} onChange={e => setTlleaderPassword(e.target.value)} />
                          </div>
                          <div className="crm-super-admin-form-group crm-inline-5b71234e2c" >
                            <label className="crm-inline-8a461919d2">_</label>
                            <button className="crm-super-admin-btn" disabled={tlStandaloneleader ? (!tlleaderName.trim() || !tlleaderEmail.trim() || !tlleaderPassword) : (!tlTeamName.trim() || Boolean(tlleaderName.trim()) !== Boolean(tlleaderPassword))} onClick={async () => {
                              const newTl = tlStandaloneleader
                                ? await createStandaloneTeamLeader(tlOfficeId || null, tlleaderName, tlleaderEmail, tlleaderPassword)
                                : await createTeamLeader(tlOfficeId || null, tlTeamName, tlleaderName, tlleaderPassword, tlTeamSize);
                              if (newTl === undefined || (tlStandaloneleader && !newTl)) return;
                              if (newTl) setNewTeamLeader(newTl);
                              else showNotification(`Team "${tlTeamName}" created.`);
                              setTlOfficeId(''); setTlTeamName(''); setTlleaderName(''); setTlleaderEmail(''); setTlleaderPassword(''); setTlTeamSize(''); setTlStandaloneleader(false);
                              setExpandedTeams(prev => { const s = new Set(prev); s.delete('__create'); return s; });
                            }}>✓ Create</button>
                          </div>
                        </div>
                        {newTeamLeader && (
                          <div className="crm-credentials-output-container crm-inline-b26aecebd1" >
                            <h4 className="crm-inline-9dd0c440ca">Created: {newTeamLeader.name}</h4>
                            <div className="crm-credential-item"><span>Login Link</span><code>{newTeamLeader.loginLink}</code><button className="crm-link-copy-btn" onClick={() => copyToClipboard(newTeamLeader.loginLink)}>[list] Copy</button></div>
                            <div className="crm-credential-item"><span>Email</span><code>{newTeamLeader.email}</code></div>
                            <div className="crm-credential-item"><span>Password</span><code>{newTeamLeader.password}</code><button className="crm-link-copy-btn" onClick={() => copyToClipboard(newTeamLeader.password)}>[list] Copy</button></div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="crm-super-admin-card">
                      <div className="crm-inline-72d6c38e5f">
                        <SearchAutocomplete
                          className="crm-super-admin-input crm-inline-bdcd0434f4"
                          placeholder="[search]  Search teams, offices, or leaders..."
                          value={teamSearch}
                          onChange={setTeamSearch}
                          buildSuggestions={(query) => data.teams.filter((team) => [
                            team.name, team.teamName, team.leaderName, getOfficeName(team.officeId, data.offices),
                          ].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
                            .slice(0, 8).map((team) => ({
                              key: team.id,
                              value: team.name || team.teamName || '',
                              label: team.name || team.teamName || 'Team',
                              meta: [team.leaderName, getOfficeName(team.officeId, data.offices)].filter(Boolean).join(' · '),
                            }))}
                        />
                      </div>
                      <div className="crm-inline-2b759092af">
                        Click any team / team leader row to open their summary modal and access their full profile.
                      </div>
                      <div className="crm-super-admin-table-wrapper">
                        <table className="crm-super-admin-table">
                          <thead>
                            <tr>
                              <th>ID</th>
                              <th>Team</th>
                              <th>Office</th>
                              <th>leader</th>
                              <th className="crm-inline-72a68ac344">Agents</th>
                              <th className="crm-inline-72a68ac344">Clients</th>
                              <th className="crm-inline-72a68ac344">Deposits</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.teams.filter(team => {
                              if (!teamSearch.trim()) return true;
                              const q = teamSearch.toLowerCase();
                              const leader = data.users.find(u => u.role === ROLE.TEAM_LEAD && u.teamId === team.id);
                              const office = data.offices.find(o => o.id === team.officeId);
                              return (
                                team.name.toLowerCase().includes(q) ||
                                (leader && leader.name.toLowerCase().includes(q)) ||
                                (office && office.name.toLowerCase().includes(q))
                              );
                            }).map(team => {
                              const teamLeader = data.users.find(u => u.role === ROLE.TEAM_LEAD && u.teamId === team.id);
                              const teamAgents = data.users.filter(u => u.role === ROLE.AGENT && u.teamId === team.id);
                              const teamClients = data.clients.filter(l => l.assignedToTeam === team.id);
                              const teamDeposits = teamClients.filter(l => l.stage === 'Deposit').length;
                              const office = data.offices.find(o => o.id === team.officeId);
                              return (
                                <tr
                                  key={team.id}
                                  className="crm-inline-8410c989c9"
                                  onClick={() =>
                                    openStaffProfile(
                                      teamLeader || {
                                        id: `team_${team.id}`,
                                        isTeamOnly: true,
                                        teamId: team.id,
                                        officeId: team.officeId,
                                        role: ROLE.TEAM_LEAD,
                                        name: `${team.name} (Unassigned leader)`,
                                        status: 'Active',
                                      }
                                    )
                                  }
                                  title={`Open summary for ${teamLeader ? teamLeader.name : team.name}`}
                                >
                                  <td className="crm-inline-93c6e1d4bb" onClick={e => e.stopPropagation()}>
                                    <div className="crm-inline-9023e926fd">
                                      <span className="crm-inline-6c559c15fe">{team.id ? team.id.slice(0, 6) : '-'}</span>
                                      {team.id && <button title={team.id} onClick={() => navigator.clipboard.writeText(team.id)} className="crm-inline-ccd1cf626f"><i className="fas fa-copy crm-inline-cdc34a99ce" ></i></button>}
                                    </div>
                                  </td>
                                  <td className="crm-inline-5c05f4afaf">{team.name}</td>
                                  <td className="crm-inline-54aeff80c9">{office ? office.name : '-'}</td>
                                  <td>
                                    {teamLeader ? (
                                      <div className="crm-inline-9484aff0bd">
                                        <span className={'status-indicator ' + (teamLeader.isLoggedIn ? 'crm-online' : 'crm-offline')}></span>
                                        <span className="crm-inline-73aacda4f4">{teamLeader.name}</span>
                                      </div>
                                    ) : <span className="crm-inline-2d73a8a9dc">Unassigned</span>}
                                  </td>
                                  <td className="crm-inline-72a68ac344">{teamAgents.length}</td>
                                  <td className="crm-inline-72a68ac344">{teamClients.length}</td>
                                  <td className="crm-inline-2a9af5616f">{teamDeposits}</td>
                                  <td>
                                    {teamLeader ? (
                                      <span className={'crm-badge ' + (staffBlockedStatus[teamLeader.id] ? 'crm-badge-danger' : 'crm-badge-success')}>{staffBlockedStatus[teamLeader.id] ? 'Blocked' : 'Active'}</span>
                                    ) : <span className="crm-badge crm-badge-warning">No leader</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : staffSubTab === 'Agents' ? (
                  <div className="crm-inline-0acd0995e2">
                    <div className="crm-super-admin-card">
                      <h2>Agents Management</h2>
                      <p className="crm-inline-7fcc53a98e">Manage agents, assign to teams, and oversee agent performance.</p>
                      <div className="crm-super-admin-card crm-inline-b67acce2bb" >
                        <h3>Create Agent</h3>
                        <div className="crm-super-admin-form-row">
                          <div className="crm-super-admin-form-group">
                            <label>Team (optional)</label>
                            <select className="crm-super-admin-select" value={agTeamId} onChange={(e) => {
                              const nextTeamId = e.target.value;
                              setAgTeamId(nextTeamId);
                              if (nextTeamId) {
                                const selectedTeam = data.teams.find((team) => team.id === nextTeamId);
                                setAgOfficeId(selectedTeam?.officeId || '');
                              }
                            }}>
                              <option value="">No team (direct agent)</option>
                              {data.teams.map((team) => <option key={team.id} value={team.id}>{team.name} ({team.officeId ? getOfficeName(team.officeId, data.offices) : 'No office'})</option>)}
                            </select>
                          </div>
                          <div className="crm-super-admin-form-group">
                            <label>Office (optional)</label>
                            <select className="crm-super-admin-select" value={agOfficeId} disabled={Boolean(agTeamId)} onChange={(e) => setAgOfficeId(e.target.value)}>
                              <option value="">No office (direct agent)</option>
                              {data.offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
                            </select>
                          </div>
                          <div className="crm-super-admin-form-group">
                            <label>Agent Name</label>
                            <input className="crm-super-admin-input" autoComplete="off" placeholder="Enter agent name..." value={agAgentName} onChange={(e) => setAgAgentName(e.target.value)} />
                          </div>
                          <div className="crm-super-admin-form-group">
                            <label>Agent Password</label>
                            <input className="crm-super-admin-input" autoComplete="new-password" placeholder="Enter password..." value={agAgentPassword} onChange={(e) => setAgAgentPassword(e.target.value)} type="password" />
                          </div>
                          <div className="crm-super-admin-form-group">
                            <button className="crm-super-admin-btn crm-super-admin-btn-small" disabled={!agAgentName || !agAgentPassword} onClick={async () => {
                              const newAg = await createAgent(agTeamId || null, agAgentName, agAgentPassword, agTeamId ? null : (agOfficeId || null));
                              if (newAg) setNewAgent(newAg);
                              setAgTeamId(''); setAgOfficeId(''); setAgAgentName(''); setAgAgentPassword('');
                            }}>✓ Create</button>
                          </div>
                        </div>
                        {newAgent && (
                          <div className="crm-credentials-output-container">
                            <h4>New Agent Created</h4>
                            <div className="crm-credential-item"><span>Name:</span><code>{newAgent.name}</code></div>
                            <div className="crm-credential-item"><span>Login Link:</span><code>{newAgent.loginLink}</code><button className="crm-link-copy-btn" onClick={() => copyToClipboard(newAgent.loginLink)} title="Copy login link">[list] Copy Link</button></div>
                            <div className="crm-credential-item"><span>Password:</span><code>{newAgent.password}</code><button className="crm-link-copy-btn" onClick={() => copyToClipboard(newAgent.password)} title="Copy password">[list] Copy Password</button></div>
                          </div>
                        )}
                      </div>
                      <div className="crm-inline-72d6c38e5f">
                        <SearchAutocomplete
                          className="crm-super-admin-input crm-inline-bdcd0434f4"
                          placeholder="[search]  Search agents, teams, or offices..."
                          value={agentSearch}
                          onChange={setAgentSearch}
                          buildSuggestions={(query) => data.users.filter((user) => user.role === ROLE.AGENT && [
                            user.name, user.email, getTeamName(user.teamId, data.teams), getOfficeName(user.officeId, data.offices),
                          ].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
                            .slice(0, 8).map((user) => ({
                              key: user.id,
                              value: user.name || user.email || '',
                              label: user.name || user.email || 'Agent',
                              meta: [user.email, getTeamName(user.teamId, data.teams), getOfficeName(user.officeId, data.offices)].filter(Boolean).join(' · '),
                            }))}
                        />
                      </div>
                      <div className="crm-inline-2b759092af">
                        Click any agent row to open their staff profile modal and manage their account.
                      </div>
                      <div className="crm-super-admin-table-wrapper">
                        <table className="crm-super-admin-table">
                          <thead>
                            <tr>
                              <th>ID</th>
                              <th>Agent Name</th>
                              <th>Team</th>
                              <th>Office</th>
                              <th>Clients</th>
                              <th>Deposits</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.users.filter(u => {
                              if (u.role !== ROLE.AGENT) return false;
                              if (!agentSearch.trim()) return true;
                              const q = agentSearch.toLowerCase();
                              const team = data.teams.find(t => t.id === u.teamId);
                              const office = data.offices.find(o => o.id === u.officeId);
                              return (
                                u.name.toLowerCase().includes(q) ||
                                (team && team.name.toLowerCase().includes(q)) ||
                                (office && office.name.toLowerCase().includes(q))
                              );
                            }).map((agent) => {
                              const agentTeam = data.teams.find(t => t.id === agent.teamId);
                              const agentOffice = data.offices.find(o => o.id === agent.officeId);
                              const agentClients = data.clients.filter(l => l.assignedToAgent === agent.id);
                              const agentDeposits = agentClients.filter(l => l.stage === 'Deposit').length;
                              return (
                                <tr
                                  key={agent.id}
                                  className="crm-inline-8410c989c9"
                                  onClick={() => openStaffProfile(agent)}
                                  title={`Open profile for ${agent.name}`}
                                >
                                  <td className="crm-inline-93c6e1d4bb" onClick={e => e.stopPropagation()}>
                                    <div className="crm-inline-9023e926fd">
                                      <span className="crm-inline-6c559c15fe">{agent.id ? agent.id.slice(0, 6) : '-'}</span>
                                      {agent.id && <button title={agent.id} onClick={() => navigator.clipboard.writeText(agent.id)} className="crm-inline-ccd1cf626f"><i className="fas fa-copy crm-inline-cdc34a99ce" ></i></button>}
                                    </div>
                                  </td>
                                  <td>
                                    <div className="crm-inline-9484aff0bd">
                                      <span className={`status-indicator ${agent.isLoggedIn ? 'crm-online' : 'crm-offline'}`}></span>
                                      <span className="crm-inline-73aacda4f4">{agent.name}</span>
                                    </div>
                                    {agent.email && <div className="crm-inline-61e17ed5a8">{agent.email}</div>}
                                  </td>
                                  <td>{agentTeam?.name || 'Unassigned'}</td>
                                  <td>{agentOffice?.name || 'Unknown'}</td>
                                  <td>{agentClients.length}</td>
                                  <td>{agentDeposits}</td>
                                  <td>
                                    <span className={`crm-badge ${staffBlockedStatus[agent.id] ? 'crm-badge-danger' : 'crm-badge-success'}`}>
                                      {staffBlockedStatus[agent.id] ? 'Blocked' : 'Active'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="crm-inline-0acd0995e2">
                    {showCreateSuperAdmin && (
                      <div className="crm-super-admin-modal-overlay" onClick={() => setShowCreateSuperAdmin(false)}>
                        <form
                          className="crm-super-admin-modal-card crm-inline-ffa089e03c"

                          onSubmit={handleCreateSuperAdmin}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="crm-super-admin-modal-header">
                            <span>Create Super Admin</span>
                            <button type="button" className="crm-super-admin-btn crm-super-admin-btn-small" onClick={() => setShowCreateSuperAdmin(false)}>Close</button>
                          </div>
                          <div className="crm-inline-d3f4f223e7">
                            <label className="crm-super-admin-form-group">
                              <span>Name</span>
                              <input className="crm-super-admin-input" required autoComplete="name" value={newSuperAdmin.name} onChange={(event) => setNewSuperAdmin((current) => ({ ...current, name: event.target.value }))} />
                            </label>
                            <label className="crm-super-admin-form-group">
                              <span>Email</span>
                              <input className="crm-super-admin-input" type="email" required autoComplete="email" value={newSuperAdmin.email} onChange={(event) => setNewSuperAdmin((current) => ({ ...current, email: event.target.value }))} />
                            </label>
                            <label className="crm-super-admin-form-group">
                              <span>Temporary password (8 characters minimum)</span>
                              <input className="crm-super-admin-input" type="password" required minLength={8} autoComplete="new-password" value={newSuperAdmin.password} onChange={(event) => setNewSuperAdmin((current) => ({ ...current, password: event.target.value }))} />
                            </label>
                          </div>
                          <div className="crm-super-admin-modal-actions">
                            <button type="button" className="crm-super-admin-btn crm-super-admin-btn-secondary" onClick={() => setShowCreateSuperAdmin(false)}>Cancel</button>
                            <button type="submit" className="crm-super-admin-btn" disabled={creatingSuperAdmin}>{creatingSuperAdmin ? 'Creating…' : 'Create account'}</button>
                          </div>
                        </form>
                      </div>
                    )}
                    <div className="crm-super-admin-card crm-inline-b75fad0009" >
                      <div className="crm-inline-28cd96f324">
                        <div>
                          <h2 className="crm-inline-a238d6d218">All Staff Directory</h2>
                          <p className="crm-inline-74481d3399">{staffRows.length} staff member{staffRows.length !== 1 ? 's' : ''} - administrators, managers, team leaders, and agents</p>
                        </div>
                        <button className="crm-super-admin-btn" onClick={() => setShowCreateSuperAdmin(true)}>+ Create Super Admin</button>
                      </div>
                    </div>
                    <div className="crm-super-admin-card">
                      <div className="crm-inline-2a0867d0c8">
                        <SearchAutocomplete
                          className="crm-super-admin-input crm-inline-9df709b9d7"
                          placeholder="Search by name, email, office, or team..."
                          value={staffSearch}
                          onChange={setStaffSearch}
                          buildSuggestions={(query) => staffRows.filter((staff) => [
                            staff.name, staff.email, staff.role, getOfficeName(staff.officeId, data.offices), getTeamName(staff.teamId, data.teams),
                          ].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
                            .slice(0, 8).map((staff) => ({
                              key: staff.id,
                              value: staff.name || staff.email || '',
                              label: staff.name || staff.email || 'Staff member',
                              meta: [staff.email, staff.role, getOfficeName(staff.officeId, data.offices), getTeamName(staff.teamId, data.teams)].filter(Boolean).join(' · '),
                            }))}
                        />
                        <select className="crm-super-admin-select crm-inline-83405ebc07"  value={staffRoleFilter} onChange={e => setStaffRoleFilter(e.target.value)}>
                          <option value="">All roles</option>
                          <option value={ROLE.OFFICE_MANAGER}>Office Managers</option>
                          <option value={ROLE.TEAM_LEAD}>Team Leaders</option>
                          <option value={ROLE.AGENT}>Agents</option>
                          <option value={ROLE.SUPER_ADMIN}>Super Admins</option>
                        </select>
                        <select className="crm-super-admin-select crm-inline-b6f9684ea2"  value={staffStructureFilter} onChange={e => setStaffStructureFilter(e.target.value)}>
                          <option value="all">All structures</option>
                          <option value="independent">No office or team</option>
                          <option value="office-no-team">Office, no team</option>
                          <option value="team-assigned">Team assigned</option>
                        </select>
                        {(staffSearch || staffRoleFilter || staffStructureFilter !== 'all') && (
                          <button className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-7c51cb61d4"  onClick={() => { setStaffSearch(''); setStaffRoleFilter(''); setStaffStructureFilter('all'); }}>✕ Clear</button>
                        )}
                      </div>
                      <div className="crm-inline-2b759092af">
                        Click any staff member on a row to open their staff profile modal and manage their account.
                      </div>
                      <div className="crm-super-admin-table-wrapper">
                        <table className="crm-super-admin-table">
                          <thead>
                            <tr>
                              <th>ID</th>
                              <th>Name</th>
                              <th>Role</th>
                              <th>Office</th>
                              <th>Team</th>
                              <th>Clients</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {staffRows.length === 0 ? (
                              <tr><td colSpan={7} className="crm-inline-044db91064">No staff members match your search.</td></tr>
                            ) : staffRows.map(u => {
                              const office = data.offices.find(o => o.id === u.officeId);
                              const team = data.teams.find(t => t.id === u.teamId);
                              const clients =
                                u.role === ROLE.OFFICE_MANAGER
                                  ? data.clients.filter(l => l.assignedToOffice === u.officeId).length
                                  : u.role === ROLE.TEAM_LEAD
                                  ? data.clients.filter(l => l.assignedToTeam === u.teamId).length
                                  : data.clients.filter(l => l.assignedToAgent === u.id).length;
                              const isBlocked = staffBlockedStatus[u.id];
                              return (
                                <tr
                                  key={u.id}
                                  className="crm-inline-8410c989c9"
                                  onClick={() => openStaffProfile(u)}
                                  title={`Click to open ${u.name}'s staff profile`}
                                >
                                  <td className="crm-inline-93c6e1d4bb" onClick={e => e.stopPropagation()}>
                                    <div className="crm-inline-9023e926fd">
                                      <span className="crm-inline-6c559c15fe">{u.id ? u.id.slice(0, 6) : '-'}</span>
                                      {u.id && <button title={u.id} onClick={() => navigator.clipboard.writeText(u.id)} className="crm-inline-ccd1cf626f"><i className="fas fa-copy crm-inline-cdc34a99ce" ></i></button>}
                                    </div>
                                  </td>
                                  <td>
                                    <div className="crm-inline-9484aff0bd">
                                      <span className={`status-indicator ${u.isLoggedIn ? 'crm-online' : 'crm-offline'}`} />
                                      <span className="crm-inline-73aacda4f4">{u.name}</span>
                                    </div>
                                    {u.email && <div className="crm-inline-61e17ed5a8">{u.email}</div>}
                                  </td>
                                  <td>
                                    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4, ...staffRoleBadgeStyle[u.role] }}>
                                      {staffRoleLabel[u.role] || u.role}
                                    </span>
                                  </td>
                                  <td className="crm-inline-7a459431c4" style={{color: office ? 'var(--crm-text-primary)' : 'var(--crm-text-secondary)'}}>{office ? office.name : '-'}</td>
                                  <td className="crm-inline-7a459431c4" style={{color: team ? 'var(--crm-text-primary)' : 'var(--crm-text-secondary)'}}>{team ? team.name : '-'}</td>
                                  <td className="crm-inline-5f283adff7">{clients}</td>
                                  <td>
                                    <span className={`crm-badge ${isBlocked ? 'crm-badge-danger' : 'crm-badge-success'}`}>
                                      {isBlocked ? 'Blocked' : 'Active'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : activeTab === 'Client Projects' ? (
              <ClientProjectsWorkspace
                clients={clientProjectClients}
                projects={clientProjects}
                loading={clientProjectsLoading}
                error={clientProjectsError}
                onReload={reloadClientProjects}
                onCreate={async (payload) => {
                  await createAdminClientProject(payload);
                  await reloadClientProjects();
                  showNotification('Client project created.');
                }}
                onUpdate={async (projectId, payload) => {
                  await updateAdminClientProject(projectId, payload);
                  await reloadClientProjects();
                  showNotification('Client project updated.');
                }}
                onDelete={async (projectId) => {
                  await archiveAdminClientProject(projectId);
                  await reloadClientProjects();
                  showNotification('Client project archived.');
                }}
              />
            ) : activeTab === 'Identity Reviews' ? (
              <IdentityReviewsWorkspace
                reviews={identityReviews}
                loading={identityReviewsLoading}
                error={identityReviewsError}
                onReload={reloadIdentityReviews}
                onResolve={({ review, decision, primaryClientId }) =>
                  resolveAdminClientIdentityReview(review, decision, primaryClientId)}
              />
            ) : activeTab === 'Dashboard' ? (
              <Dashboard offices={data.offices} teams={data.teams} staffUsers={data.users} />
            ) : activeTab === 'Site Settings' ? (
              <SiteSettingsTab showNotification={showNotification} />
            ) : activeTab === 'CRM Settings' ? (
              <CrmSettingsTab showNotification={showNotification} />
            ) : activeTab === 'Projects' ? (
              <ProjectsTab showNotification={showNotification} />
            ) : activeTab === 'Audit Log' ? (
              <AuditLog />
            ) : activeTab === 'Recycle Bin' ? (
              <RecycleBin data={data} setData={setData} showNotification={showNotification} />
            ) : activeTab === 'Agent Access' ? (
              <AgentAccess showNotification={showNotification} />
            ) : null}
            <NotificationToast ref={notificationRef} />
          </div>
        </div>

        {/* Office / Team info modal */}
        {infoModal && (() => {
          const isOffice = infoModal.type === 'office';
          const office = isOffice ? data.offices.find(o => o.id === infoModal.id) : null;
          const team = !isOffice ? data.teams.find(t => t.id === infoModal.id) : null;
          if (!office && !team) return null;
          const officeForTeam = team ? data.offices.find(o => o.id === team.officeId) : null;
          const manager = isOffice ? data.users.find(u => u.role === ROLE.OFFICE_MANAGER && u.officeId === office.id) : null;
          const leader = team ? data.users.find(u => u.role === ROLE.TEAM_LEAD && u.teamId === team.id) : null;
          const teamsList = isOffice ? data.teams.filter(t => t.officeId === office.id) : [];
          const agentsList = isOffice
            ? data.users.filter(u => u.role === ROLE.AGENT && u.officeId === office.id)
            : data.users.filter(u => u.role === ROLE.AGENT && u.teamId === team.id);
          const clientsList = isOffice
            ? data.clients.filter(l => l.assignedToOffice === office.id)
            : data.clients.filter(l => l.assignedToTeam === team.id);
          const deposits = clientsList.filter(l => l.stage === 'Deposit').length;
          const title = isOffice ? `[office] ${office.name}` : `[users] ${team.name}`;
          const head = isOffice ? 'Office Details' : `Team Details - ${officeForTeam?.name || ''}`;
          return (
            <div className="crm-inline-26ed0b614e" onClick={() => setInfoModal(null)}>
              <div className="crm-inline-281c17af44" onClick={e => e.stopPropagation()}>
                <div className="crm-inline-29145742ca">
                  <div>
                    <h2 className="crm-inline-6ef33a0d72">{title}</h2>
                    <div className="crm-inline-50f28179a6">{head}</div>
                  </div>
                  <button onClick={() => setInfoModal(null)} className="crm-inline-dc5163c973">✕</button>
                </div>

                <div className="crm-inline-797c9bf811">
                  {[
                    isOffice && { label: 'Teams', value: teamsList.length, color: '#0A84FF' },
                    { label: 'Agents', value: agentsList.length, color: 'var(--crm-accent)' },
                    { label: 'Clients', value: clientsList.length, color: 'var(--crm-text-primary)' },
                    { label: 'Deposits', value: deposits, color: '#0ECB81' },
                  ].filter(Boolean).map(s => (
                    <div key={s.label} className="crm-inline-485a7b737e">
                      <div className="crm-inline-c9050f438a">{s.label}</div>
                      <div className="crm-inline-6f5fa4761a" style={{color: s.color}}>{s.value}</div>
                    </div>
                  ))}
                </div>

                <div className="crm-inline-275054462f">
                  <div className="crm-inline-8ca294ed9c">{isOffice ? 'Office Manager' : 'Team Leader'}</div>
                  {(manager || leader) ? (
                    <div className="crm-inline-331babc719">
                      <div><strong>Name:</strong> {(manager || leader).name}</div>
                      <div><strong>Status:</strong> {staffBlockedStatus[(manager || leader).id] ? 'Blocked' : 'Active'}  /  {(manager || leader).isLoggedIn ? 'Online' : 'Offline'}</div>
                      <div className="crm-inline-37d0b7ce9d"><strong>ID:</strong> {(manager || leader).id}</div>
                    </div>
                  ) : <div className="crm-inline-47c22073b5">No {isOffice ? 'manager' : 'leader'} assigned.</div>}
                </div>

                {isOffice && teamsList.length > 0 && (
                  <div className="crm-inline-275054462f">
                    <div className="crm-inline-8ca294ed9c">Teams ({teamsList.length})</div>
                    <div className="crm-inline-f793c25fd6">
                      {teamsList.map(t => {
                        const tl = data.users.find(u => u.role === ROLE.TEAM_LEAD && u.teamId === t.id);
                        const tAgents = data.users.filter(u => u.role === ROLE.AGENT && u.teamId === t.id).length;
                        const tClients = data.clients.filter(l => l.assignedToTeam === t.id).length;
                        return (
                          <div key={t.id} className="crm-inline-b1cb78cc42">
                            <span>{t.name} {tl && <span className="crm-inline-54aeff80c9"> /  {tl.name}</span>}</span>
                            <span className="crm-inline-54aeff80c9">{tAgents} agents  /  {tClients} clients</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {agentsList.length > 0 && (
                  <div className="crm-inline-275054462f">
                    <div className="crm-inline-8ca294ed9c">Agents ({agentsList.length})</div>
                    <div className="crm-inline-f793c25fd6">
                      {agentsList.map(a => {
                        const aClients = data.clients.filter(l => l.assignedToAgent === a.id).length;
                        return (
                          <div key={a.id} className="crm-inline-b1cb78cc42">
                            <span>{a.name} <span className="crm-inline-54aeff80c9"> /  {getTeamName(a.teamId, data.teams)}</span></span>
                            <span style={{ color: a.isLoggedIn ? '#0ECB81' : 'var(--crm-text-secondary)' }}>{a.isLoggedIn ? 'Online' : 'Offline'}  /  {aClients} clients</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="crm-inline-f3ecc27eca">
                  {isOffice && manager && (
                    <button className="crm-super-admin-btn crm-super-admin-btn-small" onClick={() => { navigate(`/admin/office-manager/${manager.id}`); setInfoModal(null); }}>View Open Manager Panel</button>
                  )}
                  {!isOffice && leader && (
                    <button className="crm-super-admin-btn crm-super-admin-btn-small" onClick={() => { navigate(`/admin/team-leader/${leader.id}`); setInfoModal(null); }}>View Open Team Leader Panel</button>
                  )}
                  <button className="crm-super-admin-btn crm-super-admin-btn-small crm-super-admin-btn-secondary" onClick={() => setInfoModal(null)}>Close</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Edit staff name / password modal */}
        {isEditModalOpen && (
          <div
            className="crm-inline-500fd7f70d"
            onClick={closeEditModal}
          >
            <div
              className="crm-inline-97b47de748"
              onClick={e => e.stopPropagation()}
            >
              <div className="crm-inline-29145742ca">
                <h2 className="crm-inline-9510e73c81">{editModalTitle}</h2>
                <button
                  onClick={closeEditModal}
                  className="crm-inline-dc5163c973"
                >✕</button>
              </div>
              {editModalType === 'password' ? (
                <div className="crm-pw-field">
                  <div className="crm-pw-field-head">
                    <label className="crm-pw-field-label" htmlFor="crm-pw-edit-input">
                      Account password
                    </label>
                    <button
                      type="button"
                      className="crm-pw-generate"
                      onClick={generateStrongPassword}
                      title="Generate a strong password"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="23 4 23 10 17 10" />
                        <polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                      Generate
                    </button>
                  </div>
                  <div className="crm-pw-input-wrap">
                    <input
                      id="crm-pw-edit-input"
                      className="crm-pw-input"
                      autoFocus
                      type={editPasswordShown ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Enter a strong password"
                      value={editingValue}
                      onChange={e => setEditingValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveStaffEdit(); if (e.key === 'Escape') closeEditModal(); }}
                    />
                    <button
                      type="button"
                      className="crm-pw-toggle"
                      onClick={() => setEditPasswordShown(v => !v)}
                      title={editPasswordShown ? 'Hide password' : 'Show password'}
                      aria-label={editPasswordShown ? 'Hide password' : 'Show password'}
                    >
                      {editPasswordShown ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.77 19.77 0 0 1 4.22-5.22" />
                          <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a19.86 19.86 0 0 1-3.17 4.19" />
                          <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <div className="crm-pw-meta">
                    <div className="crm-pw-strength" data-level={passwordStrength(editingValue).level}>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <span
                          key={i}
                          className={'crm-pw-bar' + (i < passwordStrength(editingValue).level ? ' is-on' : '')}
                        />
                      ))}
                    </div>
                    <span className="crm-pw-hint">
                      {editingValue
                        ? `${passwordStrength(editingValue).label}  /  ${editingValue.length} chars`
                        : 'Use 12+ chars with letters, numbers, and a symbol'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="crm-inline-045aac899d">
                  <label className="crm-inline-b47c82a633">
                    New Name
                  </label>
                  <input
                    className="crm-super-admin-input crm-inline-69d66e5b2e"
                    autoFocus
                    type="text"
                    autoComplete="off"
                    placeholder="Enter new name..."
                    value={editingValue}
                    onChange={e => setEditingValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveStaffEdit(); if (e.key === 'Escape') closeEditModal(); }}

                  />
                </div>
              )}
              <div className="crm-inline-f3ecc27eca">
                <button
                  className="crm-super-admin-btn crm-super-admin-btn-small crm-super-admin-btn-secondary"
                  onClick={closeEditModal}
                >Cancel</button>
                <button
                  className="crm-super-admin-btn crm-super-admin-btn-small"
                  disabled={!editingValue.trim()}
                  onClick={saveStaffEdit}
                >✓ Save</button>
              </div>
            </div>
          </div>
        )}
        {activeProfileClient && (
          <ClientProfileModal
            client={activeProfileClient}
            onClose={closeClientProfile}
            data={data}
            currentUser={currentUser}
            setData={setData}
            setClientAssignment={setClientAssignment}
            showNotification={showNotification}
          />
        )}
        {activeProfileStaff && (
          <StaffProfileModal
            staff={activeProfileStaff}
            onClose={closeStaffProfile}
            data={data}
            currentUser={currentUser}
            setData={setData}
            toggleStaffBlocked={toggleStaffBlocked}
            setUserLoginState={setUserLoginState}
            showNotification={showNotification}
          />
        )}
      </DataContext.Provider>
    </NotificationContext.Provider>
  );
}

export default SuperAdminPanel;
