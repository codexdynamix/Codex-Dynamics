import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE, CLIENT_STATUSES, normalizeStage, getTeamName, getUserName, getCountryFlag, EditClientModal, CreateAgentModal, CreateClientModal, AddCommentModal, stageColor, assignableAgents, assignableAgentLabel, StatusDropdown } from '../shared';
import { SearchAutocomplete } from '../components/UserChrome.jsx';
import { searchAdminClients } from '../adminApi';
import { bulkAssignClientsApi } from '../adminApi';
import ReactCapabilityWorkspace from '../components/ReactCapabilityWorkspace.jsx';
import StaffProfileModal from '../components/StaffProfileModal.jsx';

function AssignTab({ teamClients, teamAgents, agentStats, showNotification, onBulkReassign, data }) {
  const [fromAgent, setFromAgent] = useState('');
  const [toAgent, setToAgent] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);

  const fromAgentClients = fromAgent
    ? teamClients.filter(l => fromAgent === '__unassigned__' ? !l.assignedToAgent : l.assignedToAgent === fromAgent)
    : [];

  const toggleClient = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleAll = (checked) => setSelectedIds(checked ? fromAgentClients.map(l => l.id) : []);

  const handleReassign = async () => {
    if (!toAgent || selectedIds.length === 0) {
      showNotification('Select clients and a destination agent.');
      return;
    }
    const destAgent = teamAgents.find(a => a.id === toAgent);
    const count = selectedIds.length;
    const idsToAssign = [...selectedIds];
    try {
      await onBulkReassign(idsToAssign, destAgent);
      setSelectedIds([]);
      if (toAgent === fromAgent) setFromAgent('');
      showNotification(`${count} client(s) reassigned to ${destAgent?.name || 'agent'}.`);
    } catch {
      showNotification('Reassign failed - please try again.');
    }
  };

  const stageColor = (s) => ({ Deposit: '#45d2a0', New: '#0A84FF', 'In Line': 'var(--crm-accent)', 'Failed Deposit': '#ff6464', 'No Answer': 'var(--crm-text-secondary)', 'Not Interested': 'var(--crm-text-secondary)' }[s] || 'var(--crm-text-secondary)');

  return (
    <div className="crm-inline-cb65451aef">
      <div className="crm-inline-2a5d2b33c4">
        <div className="crm-super-admin-card">
          <h3 className="crm-inline-7413805ccd">Agent Workload</h3>
          <div className="crm-super-admin-table-wrapper">
            <table className="crm-super-admin-table">
              <thead><tr><th>Agent</th><th className="crm-inline-72a68ac344">Clients</th><th className="crm-inline-72a68ac344">Load</th><th className="crm-inline-13cbe03b9a">Action</th></tr></thead>
              <tbody>
                {agentStats.map(a => (
                  <tr key={a.id}>
                    <td className="crm-inline-5c05f4afaf">{a.name}</td>
                    <td className="crm-inline-72a68ac344">{a.totalClients}</td>
                    <td className="crm-inline-72a68ac344">
                      <span className="crm-inline-a6d6d683c1" style={{background: a.workloadLevel === 'high' ? 'rgba(255,100,100,0.1)' : a.workloadLevel === 'medium' ? 'color-mix(in srgb, var(--crm-accent) 10%, transparent)' : 'rgba(69,210,160,0.1)', color: a.workloadLevel === 'high' ? '#ff6464' : a.workloadLevel === 'medium' ? 'var(--crm-accent)' : '#45d2a0', border: '1px solid ' + (a.workloadLevel === 'high' ? '#ff646440' : a.workloadLevel === 'medium' ? 'color-mix(in srgb, var(--crm-accent) 25%, transparent)' : '#45d2a040')}}>{a.workloadLevel}</span>
                    </td>
                    <td className="crm-inline-13cbe03b9a">
                      <button
                        onClick={() => { setFromAgent(a.id); setSelectedIds([]); }}
                        className="crm-inline-75d52dd895" style={{background: fromAgent === a.id ? 'var(--crm-accent)' : 'transparent', color: fromAgent === a.id ? 'var(--crm-card)' : 'var(--crm-accent)'}}
                      >{fromAgent === a.id ? '✓ Selected' : 'Reassign'}</button>
                    </td>
                  </tr>
                ))}
                {agentStats.length === 0 && <tr><td colSpan={4} className="crm-inline-43700bc317">No agents.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="crm-inline-b0c4a702cd">
            <select value={fromAgent} onChange={e => { setFromAgent(e.target.value); setSelectedIds([]); }} className="crm-super-admin-select crm-inline-ee3d55bf99" >
              <option value="">- Pick source agent -</option>
              <option value="__unassigned__">Unassigned clients</option>
              {teamAgents.map(a => {
                const s = agentStats.find(x => x.id === a.id);
                return <option key={a.id} value={a.id}>{a.name} ({s ? s.totalClients : 0} clients)</option>;
              })}
            </select>
          </div>
        </div>

        <div className="crm-super-admin-card">
          <h3 className="crm-inline-7413805ccd">Reassign Clients</h3>
          {!fromAgent ? (
            <div className="crm-inline-de968d74a8">
              Select a source agent from the left to see their clients and reassign them.
            </div>
          ) : (
            <div className="crm-inline-7c464eccac">
              <div className="crm-inline-b41dbad860">
                <div className="crm-inline-37d0b7ce9d">Reassign {selectedIds.length > 0 ? selectedIds.length : fromAgentClients.length} client(s) to:</div>
                <select value={toAgent} onChange={e => setToAgent(e.target.value)} className="crm-super-admin-select crm-inline-ee3d55bf99" >
                  <option value="">- Pick destination agent -</option>
                  {teamAgents.filter(a => fromAgent === '__unassigned__' || a.id !== fromAgent).map(a => {
                    const s = agentStats.find(x => x.id === a.id);
                    return <option key={a.id} value={a.id}>{a.name} ({s ? s.totalClients : 0})</option>;
                  })}
                </select>
                <button
                  className="crm-super-admin-btn crm-inline-51d77d7d83"
                   style={{background: toAgent && selectedIds.length > 0 ? '#45d2a0' : 'var(--crm-border)', color: toAgent && selectedIds.length > 0 ? 'var(--crm-bg)' : 'var(--crm-text-secondary)'}}
                  disabled={!toAgent || selectedIds.length === 0}
                  onClick={handleReassign}
                >↗ Reassign {selectedIds.length || fromAgentClients.length}</button>
              </div>
              <div className="crm-inline-4a087de929">
                {fromAgent === '__unassigned__' ? 'Unassigned clients' : (teamAgents.find(a => a.id === fromAgent)?.name || 'Agent')} - {fromAgentClients.length} client(s)
              </div>
              <div className="crm-inline-eebd5eb69c">
                <table className="crm-super-admin-table crm-inline-ff227d0632" >
                  <thead>
                    <tr>
                      <th className="crm-inline-97711f5c3e"><input type="checkbox" checked={selectedIds.length === fromAgentClients.length && fromAgentClients.length > 0} onChange={e => toggleAll(e.target.checked)} /></th>
                      <th>Name</th><th>Status</th><th>Country</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fromAgentClients.length === 0 && <tr><td colSpan={4} className="crm-inline-43700bc317">No clients.</td></tr>}
                    {fromAgentClients.map(l => {
                      const stage = normalizeStage(l.stage);
                      const sc = stageColor(stage);
                      return (
                        <tr key={l.id} className="crm-inline-8410c989c9" onClick={() => toggleClient(l.id)}>
                          <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(l.id)} onChange={() => toggleClient(l.id)} /></td>
                          <td><div className="crm-inline-b1588f659d">{l.firstName} {l.lastName}</div><div className="crm-inline-ecfbc88caf">{l.email}</div></td>
                          <td><span className="crm-inline-51b203ed3d" style={{background: sc + '18', color: sc, border: '1px solid ' + sc + '40'}}>{stage}</span></td>
                          <td className="crm-inline-37d0b7ce9d">{getCountryFlag(l.countryCode, l.country)} {l.country || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamLeaderPanel({ data, setData, currentUser, createAgent, canCreateAgent, canUploadClient, toggleStaffBlocked, setClientAssignment, updateClient, createClient, setUserLoginState, showNotification }) {
  const navigate = useNavigate();
  const [activeProfileStaff, setActiveProfileStaff] = useState(null);
  const [agentId, setAgentId] = useState('');
  const [clientId, setClientId] = useState('');
  const [bulkAgentId, setBulkAgentId] = useState('');
  const [bulkSelectedClients, setBulkSelectedClients] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterFunnel, setFilterFunnel] = useState('');
  const [filterAffiliate, setFilterAffiliate] = useState('');
  const [filterLastComment, setFilterLastComment] = useState('');
  const [filterRegistered, setFilterRegistered] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const nativeTabs = ['overview', 'agents', 'clients', 'assign'];
  const tabStorageKey = `tl_activeTab:${currentUser?.id || 'unknown'}`;
  const [activeTab, setActiveTab] = useState(() => {
    const saved = sessionStorage.getItem(tabStorageKey);
    return nativeTabs.includes(saved) ? saved : 'agents';
  });
  useEffect(() => { sessionStorage.setItem(tabStorageKey, activeTab); }, [activeTab, tabStorageKey]);
  // Agent activity analysis filters
  const [activityDateFrom, setActivityDateFrom] = useState('');
  const [activityDateTo, setActivityDateTo] = useState('');
  const [minComments, setMinComments] = useState('');
  const [maxComments, setMaxComments] = useState('');
  const [contactStatusFilter, setContactStatusFilter] = useState('all'); // all, contacted, not-contacted
  const [compactTable, setCompactTable] = useState(false);
  // Enhanced agent management state
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [agentSortBy, setAgentSortBy] = useState('name');
  const [agentSortDirection, setAgentSortDirection] = useState('asc');
  const [agentFilterStatus, setAgentFilterStatus] = useState('all'); // all, online, offline
  const [agentFilterWorkload, setAgentFilterWorkload] = useState('all'); // all, low, medium, high
  const [agentFilterPerformance, setAgentFilterPerformance] = useState('all'); // all, high, medium, low
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [showAgentDetails, setShowAgentDetails] = useState(null);
  const [agentGoals, setAgentGoals] = useState({});
  const [agentNotes, setAgentNotes] = useState({});
  const [reassignModal, setReassignModal] = useState({ show: false, agentId: null, clients: [] });
  const [reassignSelectedClientIds, setReassignSelectedClientIds] = useState([]);
  const [reassignFromAgent, setReassignFromAgent] = useState('');
  const [reassignToAgent, setReassignToAgent] = useState('');
  const [communicationModal, setCommunicationModal] = useState({ show: false, agentId: null, type: 'message' });
  const [performanceReviewModal, setPerformanceReviewModal] = useState({ show: false, agentId: null });
  const [scheduleModal, setScheduleModal] = useState({ show: false, agentId: null });
  // View mode and UI state
  const [agentViewMode, setAgentViewMode] = useState('compact'); // compact, detailed, list
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const [openActionMenu, setOpenActionMenu] = useState(null);
  // Global search functionality
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState([]);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  // Client-management modals (create / edit / add-comment).
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [commentClient, setCommentClient] = useState(null);
  const teamAgents = useMemo(
    () => currentUser.teamId ? assignableAgents(data.users, currentUser, { teamId: currentUser.teamId }) : [],
    [data.users, currentUser.teamId]
  );

  // Enhanced modal effects
  useEffect(() => {
    if (communicationModal.show) {
      // Character counter and preview for communication modal
      const handleMessageInput = () => {
        const textarea = document.getElementById('messageContent');
        const charCount = document.getElementById('charCount');
        const preview = document.getElementById('messagePreview');
        const messageType = document.getElementById('messageType');

        if (textarea && charCount) {
          const count = textarea.value.length;
          charCount.textContent = count;
          charCount.dataset.level = count > 900 ? 'danger' : count > 800 ? 'warning' : 'normal';
        }

        if (textarea && preview && messageType) {
          const typeIcons = {
            'message': '💬',
            'announcement': '📢',
            'reminder': '',
            'performance': '[chart]',
            'training': '🎓'
          };

          const typeText = messageType.options[messageType.selectedIndex]?.text || 'Message';
          const content = textarea.value.trim();

          if (content) {
            const heading = document.createElement('div');
            heading.className = 'crm-communication-preview-heading';
            heading.textContent = `${typeIcons[messageType.value] || '💬'} ${typeText}`;

            const body = document.createElement('div');
            body.className = 'crm-communication-preview-content';
            content.split('\n').forEach((line, index) => {
              if (index > 0) body.appendChild(document.createElement('br'));
              body.appendChild(document.createTextNode(line));
            });

            preview.replaceChildren(heading, body);
            preview.classList.remove('crm-communication-preview-empty');
          } else {
            preview.textContent = 'Preview will appear here as you type...';
            preview.classList.add('crm-communication-preview-empty');
          }
        }
      };

      // Add event listeners with a small delay to ensure DOM is ready
      setTimeout(() => {
        document.getElementById('messageContent')?.addEventListener('input', handleMessageInput);
        document.getElementById('messageType')?.addEventListener('change', handleMessageInput);
        handleMessageInput(); // Initial call
      }, 100);

      // Cleanup
      return () => {
        document.getElementById('messageContent')?.removeEventListener('input', handleMessageInput);
        document.getElementById('messageType')?.removeEventListener('change', handleMessageInput);
      };
    }
  }, [communicationModal.show]);
  const onlineAgents = teamAgents.filter((a) => a.isLoggedIn).length;
  const teamClients = useMemo(
    () => data.clients.filter((client) =>
      (currentUser.teamId && client.assignedToTeam === currentUser.teamId) ||
      client.assignedToTeamLeader === currentUser.id
    ),
    [data.clients, currentUser.teamId, currentUser.id]
  );

  // Global search function
  const performGlobalSearch = (query) => {
    if (!query.trim()) {
      setGlobalSearchResults([]);
      return;
    }

    const lowerQuery = query.toLowerCase().trim();
    const results = teamClients.filter((client) => {
      return (
        client.id.toString().toLowerCase().includes(lowerQuery) ||
        client.firstName.toLowerCase().includes(lowerQuery) ||
        client.lastName.toLowerCase().includes(lowerQuery) ||
        `${client.firstName} ${client.lastName}`.toLowerCase().includes(lowerQuery) ||
        client.email.toLowerCase().includes(lowerQuery) ||
        client.phone.toLowerCase().includes(lowerQuery)
      );
    }).map((client) => ({
      ...client,
      agentName: getUserName(client.assignedToAgent, data.users),
      fullName: `${client.firstName} ${client.lastName}`
    }));

    setGlobalSearchResults(results);
  };

  // Effect to perform search when query changes
  useEffect(() => {
    performGlobalSearch(globalSearchQuery);
  }, [globalSearchQuery, teamClients]);

  // Compute agent stats with enhanced analytics
  const agentStats = teamAgents.map((agent) => {
    const agentClients = teamClients.filter((client) => client.assignedToAgent === agent.id);
    const deposits = agentClients.filter((client) => ['Deposit', 'Failed Deposit'].includes(client.stage));
    const successfulDeposits = deposits.filter((client) => client.stage === 'Deposit');
    const contactedClients = agentClients.filter((client) => client.commentHistory && client.commentHistory.length > 0);
    const allComments = agentClients.flatMap((client) => client.commentHistory || []);
    const agentComments = allComments.filter((comment) => comment.by === agent.name);

    // Calculate activity metrics
    const today = new Date().toISOString().split('T')[0];
    const todaysComments = agentComments.filter((comment) => comment.date === today);
    const recentComments = agentComments.filter((comment) => {
      const commentDate = new Date(comment.date);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return commentDate >= weekAgo;
    });

    // Client stage distribution
    const stageStats = {
      new: agentClients.filter(l => normalizeStage(l.stage) === 'New').length,
      contacted: agentClients.filter(l => normalizeStage(l.stage) === 'In Line').length,
      qualified: agentClients.filter(l => ['Qualified', 'Deposit', 'Failed Deposit'].includes(l.stage)).length,
      closed: agentClients.filter(l => ['Deposit', 'Failed Deposit'].includes(l.stage)).length,
    };

    // Performance trends (mock data for now)
    const performanceTrend = successfulDeposits.length > (agentClients.length * 0.2) ? 'up'
      : deposits.filter(l => l.stage === 'Failed Deposit').length > successfulDeposits.length ? 'down'
      : 'stable';

    return {
      ...agent,
      totalClients: agentClients.length,
      deposits: deposits.length,
      successfulDeposits: successfulDeposits.length,
      conversionRate: agentClients.length > 0 ? ((successfulDeposits.length / agentClients.length) * 100).toFixed(1) : 0,
      contactedClients: contactedClients.length,
      contactRate: agentClients.length > 0 ? ((contactedClients.length / agentClients.length) * 100).toFixed(1) : 0,
      totalComments: agentComments.length,
      todaysComments: todaysComments.length,
      recentComments: recentComments.length,
      avgCommentsPerClient: contactedClients.length > 0 ? (agentComments.length / contactedClients.length).toFixed(1) : 0,
      stageStats,
      performanceTrend,
      lastActivity: agentComments.length > 0 ? agentComments[agentComments.length - 1].date : 'Never',
      workloadLevel: agentClients.length > 20 ? 'high' : agentClients.length > 10 ? 'medium' : 'low',
    };
  });

  // Compute agent activity analysis
  const agentActivityStats = teamAgents.map((agent) => {
    const agentClients = teamClients.filter((client) => client.assignedToAgent === agent.id);
    const contactedClients = agentClients.filter((client) => client.commentHistory && client.commentHistory.length > 0);
    const allComments = agentClients.flatMap((client) => client.commentHistory || []);
    const agentComments = allComments.filter((comment) => comment.by === agent.name);

    // Comments by date range
    const commentsInRange = agentComments.filter((comment) => {
      if (!activityDateFrom && !activityDateTo) return true;
      const commentDate = new Date(comment.date);
      const fromDate = activityDateFrom ? new Date(activityDateFrom) : new Date('1900-01-01');
      const toDate = activityDateTo ? new Date(activityDateTo) : new Date('2100-01-01');
      return commentDate >= fromDate && commentDate <= toDate;
    });

    // Today's comments
    const today = new Date().toISOString().split('T')[0];
    const todaysComments = agentComments.filter((comment) => comment.date === today);

    return {
      ...agent,
      totalClients: agentClients.length,
      contactedClients: contactedClients.length,
      contactRate: agentClients.length > 0 ? ((contactedClients.length / agentClients.length) * 100).toFixed(1) : 0,
      totalComments: agentComments.length,
      commentsInRange: commentsInRange.length,
      todaysComments: todaysComments.length,
      avgCommentsPerClient: contactedClients.length > 0 ? (agentComments.length / contactedClients.length).toFixed(1) : 0,
    };
  });
  const filteredTeamClients = teamClients.filter((client) => {
    const stage = normalizeStage(client.stage);
    const lowerQuery = searchQuery.toLowerCase();
    if (filterStatus && stage !== filterStatus) return false;
    if (filterCountry && client.country !== filterCountry) return false;
    if (filterAgent === '__unassigned__' && client.assignedToAgent) return false;
    if (filterAgent && filterAgent !== '__unassigned__' && client.assignedToAgent !== filterAgent) return false;
    if (filterFunnel && (client.funnel || '') !== filterFunnel) return false;
    if (filterAffiliate && (client.affiliate || '') !== filterAffiliate) return false;
    if (filterLastComment && (client.lastCommentDate || '') !== filterLastComment) return false;
    if (filterRegistered && (client.registeredDate || '') !== filterRegistered) return false;
    if (searchQuery && !(
      client.firstName.toLowerCase().includes(lowerQuery) ||
      client.lastName.toLowerCase().includes(lowerQuery) ||
      client.phone.toLowerCase().includes(lowerQuery) ||
      client.email.toLowerCase().includes(lowerQuery)
    )) return false;

    // Agent activity filters
    const clientComments = client.commentHistory || [];
    const commentCount = clientComments.length;
    if (contactStatusFilter === 'contacted' && commentCount === 0) return false;
    if (contactStatusFilter === 'not-contacted' && commentCount > 0) return false;
    if (minComments && commentCount < parseInt(minComments)) return false;
    if (maxComments && commentCount > parseInt(maxComments)) return false;

    // Date range filter for comments
    if (activityDateFrom || activityDateTo) {
      const hasCommentsInRange = clientComments.some((comment) => {
        const commentDate = new Date(comment.date);
        const fromDate = activityDateFrom ? new Date(activityDateFrom) : new Date('1900-01-01');
        const toDate = activityDateTo ? new Date(activityDateTo) : new Date('2100-01-01');
        return commentDate >= fromDate && commentDate <= toDate;
      });
      if (!hasCommentsInRange) return false;
    }

    return true;
  }).sort((a, b) => {
    let aVal, bVal;
    switch (sortColumn) {
      case 'name': aVal = `${a.firstName} ${a.lastName}`; bVal = `${b.firstName} ${b.lastName}`; break;
      case 'agent': aVal = getUserName(a.assignedToAgent, data.users) || ''; bVal = getUserName(b.assignedToAgent, data.users) || ''; break;
      case 'stage': aVal = normalizeStage(a.stage); bVal = normalizeStage(b.stage); break;
      case 'country': aVal = a.country; bVal = b.country; break;
      case 'funnel': aVal = a.funnel || ''; bVal = b.funnel || ''; break;
      case 'lastComment': aVal = a.lastCommentDate || ''; bVal = b.lastCommentDate || ''; break;
      case 'registered': aVal = a.registeredDate || ''; bVal = b.registeredDate || ''; break;
      case 'comments': aVal = a.commentHistory ? a.commentHistory.length : 0; bVal = b.commentHistory ? b.commentHistory.length : 0; break;
      default: return 0;
    }
    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
  const totalFiltered = filteredTeamClients.length;
  const paginatedClients = filteredTeamClients.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.ceil(totalFiltered / pageSize);
  const filteredClientIds = filteredTeamClients.map((client) => client.id);

  const toggleClientselection = (clientIdToToggle) => {
    setBulkSelectedClients((prev) =>
      prev.includes(clientIdToToggle)
        ? prev.filter((id) => id !== clientIdToToggle)
        : [...prev, clientIdToToggle]
    );
  };

  const handleSelectAllClients = (checked) => {
    setBulkSelectedClients(checked ? filteredClientIds : []);
  };

  const handleBulkAssign = () => {
    if (!bulkAgentId) {
      showNotification('Please choose an agent for bulk assignment.');
      return;
    }
    if (bulkSelectedClients.length === 0) {
      showNotification('Please select at least one client to assign.');
      return;
    }
    bulkSelectedClients.forEach((selectedClientId) => {
      setClientAssignment({ clientId: selectedClientId, officeId: currentUser.officeId, teamId: currentUser.teamId, agentId: bulkAgentId });
    });
    showNotification(`Assigned ${bulkSelectedClients.length} clients to agent.`);
    setBulkSelectedClients([]);
    setBulkAgentId('');
  };

  const handleShuffleClients = () => {
    if (teamAgents.length === 0) {
      showNotification('No team agents available to shuffle clients.');
      return;
    }
    const agentIds = teamAgents.map((agent) => agent.id);
    teamClients.forEach((client, index) => {
      const assignedAgentId = agentIds[index % agentIds.length];
      setClientAssignment({ clientId: client.id, officeId: currentUser.officeId, teamId: currentUser.teamId, agentId: assignedAgentId });
    });
    showNotification('Clients shuffled across team agents.');
  };

  const handleBulkSetAgentsOnline = (_online) => {
    showNotification('Login status is now automatic - agents log in themselves.');
  };

  // Enhanced Agent Management Functions
  const handleAgentSearch = (query) => {
    setAgentSearchQuery(query);
  };

  const handleAgentSort = (column) => {
    if (agentSortBy === column) {
      setAgentSortDirection(agentSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setAgentSortBy(column);
      setAgentSortDirection('asc');
    }
  };

  const handleAgentFilter = (type, value) => {
    switch (type) {
      case 'status':
        setAgentFilterStatus(value);
        break;
      case 'workload':
        setAgentFilterWorkload(value);
        break;
      case 'performance':
        setAgentFilterPerformance(value);
        break;
    }
  };

  const handleAgentSelection = (agentId, selected) => {
    if (selected) {
      setSelectedAgents([...selectedAgents, agentId]);
    } else {
      setSelectedAgents(selectedAgents.filter(id => id !== agentId));
    }
  };

  const handleBulkAgentAction = (action) => {
    if (selectedAgents.length === 0) {
      showNotification('Please select at least one agent.');
      return;
    }

    switch (action) {
      case 'sendMessage':
        setCommunicationModal({ show: true, agentId: null, type: 'bulk' });
        break;
    }
    setSelectedAgents([]);
  };

  const handleReassignClients = async (fromAgentId, toAgentId, clientIds) => {
    if (!fromAgentId || !toAgentId) {
      showNotification('Choose source and target agents.');
      return;
    }
    if (fromAgentId === toAgentId) {
      showNotification('Source and target cannot be the same agent.');
      return;
    }
    const uniqueIds = [...new Set(clientIds)];
    const validatedClientIds = uniqueIds.filter((id) => {
      const client = teamClients.find((l) => l.id === id);
      return client && client.assignedToAgent === fromAgentId;
    });

    if (validatedClientIds.length === 0) {
      showNotification('No clients selected from the source agent to reassign.');
      return;
    }

    const destAgent = data.users.find(u => u.id === toAgentId);
    const targetOffice = destAgent?.officeId || currentUser.officeId || null;
    const targetTeam   = destAgent?.teamId  || currentUser.teamId  || null;

    try {
      await bulkAssignClientsApi(validatedClientIds, { officeId: targetOffice, teamId: targetTeam, agentId: toAgentId });
      setData(prev => ({
        ...prev,
        clients: prev.clients.map(l =>
          validatedClientIds.includes(l.id)
            ? { ...l, assignedToOffice: targetOffice, assignedToTeam: targetTeam, assignedToAgent: toAgentId }
            : l
        ),
      }));
      setReassignModal({ show: false, agentId: null, clients: [] });
      setReassignSelectedClientIds([]);
      setReassignFromAgent('');
      setReassignToAgent('');
      showNotification(`${validatedClientIds.length} clients reassigned to ${getUserName(toAgentId, data.users)}.`);
    } catch {
      showNotification('Could not persist reassignment - please reload and retry.');
    }
  };

  const handleBulkReassign = async (selectedIds, destAgent) => {
    if (!destAgent || selectedIds.length === 0) return;
    const targetOffice = destAgent.officeId || currentUser.officeId || null;
    const targetTeam   = destAgent.teamId  || currentUser.teamId  || null;

    await bulkAssignClientsApi(selectedIds, { officeId: targetOffice, teamId: targetTeam, agentId: destAgent.id });
    setData(prev => ({
      ...prev,
      clients: prev.clients.map(l =>
        selectedIds.includes(l.id)
          ? { ...l, assignedToOffice: targetOffice, assignedToTeam: targetTeam, assignedToAgent: destAgent.id }
          : l
      ),
    }));
  };

  const handleSetAgentGoal = (agentId, goalType, target) => {
    setAgentGoals({
      ...agentGoals,
      [agentId]: {
        ...agentGoals[agentId],
        [goalType]: target
      }
    });
    showNotification(`Goal set for agent.`);
  };

  const handclientdAgentNote = (agentId, note) => {
    const currentNotes = agentNotes[agentId] || [];
    setAgentNotes({
      ...agentNotes,
      [agentId]: [...currentNotes, { text: note, date: new Date().toISOString().split('T')[0], by: currentUser.name }]
    });
    showNotification('Note added to agent profile.');
  };

  const handleSendMessage = (agentId, message, type = 'message') => {
    showNotification(`${type === 'message' ? 'Message' : 'Announcement'} sent to agent.`);
    setCommunicationModal({ show: false, agentId: null, type: 'message' });
  };

  const handleScheduleReview = (agentId, reviewDate, reviewType) => {
    showNotification(`Performance review scheduled for ${reviewDate}.`);
    setPerformanceReviewModal({ show: false, agentId: null });
  };

  const handleUpdateSchedule = (agentId, schedule) => {
    showNotification('Agent schedule updated.');
    setScheduleModal({ show: false, agentId: null });
  };

  const getFilteredAgents = () => {
    const filtered = agentStats.filter(agent => {
      // Search filter
      if (agentSearchQuery) {
        const query = agentSearchQuery.toLowerCase();
        if (!agent.name.toLowerCase().includes(query) && !agent.email.toLowerCase().includes(query)) {
          return false;
        }
      }

      // Status filter
      if (agentFilterStatus !== 'all') {
        if (agentFilterStatus === 'online' && !agent.isLoggedIn) return false;
        if (agentFilterStatus === 'offline' && agent.isLoggedIn) return false;
      }

      // Workload filter
      if (agentFilterWorkload !== 'all' && agent.workloadLevel !== agentFilterWorkload) {
        return false;
      }

      // Performance filter
      if (agentFilterPerformance !== 'all') {
        const rate = parseFloat(agent.conversionRate);
        if (agentFilterPerformance === 'high' && rate < 20) return false;
        if (agentFilterPerformance === 'medium' && (rate < 10 || rate >= 20)) return false;
        if (agentFilterPerformance === 'low' && rate >= 10) return false;
      }

      return true;
    });

    // Sort agents
    filtered.sort((a, b) => {
      let aVal, bVal;
      switch (agentSortBy) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'clients':
          aVal = a.totalClients;
          bVal = b.totalClients;
          break;
        case 'conversion':
          aVal = parseFloat(a.conversionRate);
          bVal = parseFloat(b.conversionRate);
          break;
        case 'activity':
          aVal = a.recentComments;
          bVal = b.recentComments;
          break;
        default:
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
      }

      if (agentSortDirection === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });

    return filtered;
  };

  const handleSingleAssign = (clientId, agentId) => {
    if (!clientId || !agentId) return;
    setClientAssignment({ clientId, officeId: currentUser.officeId, teamId: currentUser.teamId, agentId });
    showNotification('Client assigned to agent.');
    setClientId('');
    setAgentId('');
  };

  const viewAgentAsTeamLeader = (targetAgentId) => {
    navigate(`/admin/agent/${targetAgentId}`, {
      state: {
        returnTo: `/admin/team-leader/${currentUser.id}`,
        returnLabel: `Back to ${getTeamName(currentUser.teamId, data.teams)}`,
        impersonatedFrom: currentUser.id,
      },
    });
  };

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
    setPage(1); // Reset to first page on sort
  };

  return (
    <div className="crm-inline-a87a4730ee">
      <div className="crm-inline-afa0c9318a">
        <div>
          <h2 className="crm-inline-21be2f7e29">Team Portfolio</h2>
          <div className="crm-inline-c4f8226fa0">{getTeamName(currentUser.teamId, data.teams)}</div>
        </div>
        <div className="crm-inline-b41dbad860">
          {canCreateAgent && (
            <button
              className="crm-super-admin-btn crm-inline-c906ae432c"

              onClick={() => setShowCreateAgent(true)}
            >
              + Add Agent
            </button>
          )}
          <span className="crm-badge crm-inline-bfc749af76" >{onlineAgents} Online</span>
          <span className="crm-badge crm-inline-410c810177" >{teamAgents.length} Agents</span>
        </div>
      </div>

      <div className="crm-super-admin-header crm-role-panel-header crm-inline-b75fad0009" >
        <div className="crm-super-admin-tabs">
          {[['overview', 'Overview'], ['agents', 'Agents'], ['clients', 'Client Management'], ['assign', 'Assign']].map(([key, label]) => (
            <button key={key} className={`crm-super-admin-tab-btn ${activeTab === key ? 'crm-active' : ''}`} onClick={() => setActiveTab(key)}>{label}</button>
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
        fallbackTab="agents"
      />

      {activeTab === 'overview' && (
        <>
          <div className="crm-inline-34fbd1c4f3">
            {[
              { label: 'Total Clients', value: teamClients.length, color: 'var(--crm-text-primary)' },
              { label: 'Deposits', value: agentStats.reduce((s, a) => s + a.successfulDeposits, 0), color: '#45d2a0' },
              { label: 'Conversion', value: teamClients.length > 0 ? ((agentStats.reduce((s, a) => s + a.successfulDeposits, 0) / teamClients.length) * 100).toFixed(1) + '%' : '0%', color: 'var(--crm-accent)' },
              { label: 'Unassigned', value: teamClients.filter(l => !l.assignedToAgent).length, color: '#0A84FF' },
              {
                label: 'Active Clients',
                value: teamClients.filter(l => (l.stage || l.status || '').toLowerCase() === 'active').length,
                color: '#0ECB81',
                title: 'Active agency clients',
              },
              {
                label: 'New Clients',
                value: teamClients.filter(l => (l.stage || l.status || '').toLowerCase() === 'new').length,
                color: '#F59E0B',
                title: 'New incoming clients',
              },
              { label: 'Online / Total', value: onlineAgents + ' / ' + teamAgents.length, color: '#45d2a0' },
            ].map(s => (
              <div
                key={s.label}
                title={s.title}
                onClick={s.onClick}
                className="crm-inline-f22ce644d3" style={{border: '1px solid var(--crm-border)', borderTop: '2px solid ' + s.color, cursor: s.onClick ? 'pointer' : 'default'}}
              >
                <div className="crm-inline-a3ebac388e">{s.label}</div>
                <div className="crm-inline-58afaef217" style={{color: s.color}}>{s.value}</div>
              </div>
            ))}
          </div>
          <div className="crm-super-admin-card">
            <h3 className="crm-inline-7413805ccd">Agent Performance</h3>
            <div className="crm-super-admin-table-wrapper">
              <table className="crm-super-admin-table">
                <thead>
                  <tr><th>#</th><th>Agent</th><th className="crm-inline-72a68ac344">Clients</th><th className="crm-inline-72a68ac344">Deposits</th><th className="crm-inline-72a68ac344">Conv.</th><th className="crm-inline-72a68ac344">Comments</th><th className="crm-inline-72a68ac344">Status</th></tr>
                </thead>
                <tbody>
                  {agentStats.sort((a, b) => parseFloat(b.conversionRate) - parseFloat(a.conversionRate)).map((agent, idx) => {
                    const fullAgent = data.users.find(u => u.id === agent.id);
                    return (
                    <tr
                      key={agent.id}
                      className="crm-inline-8410c989c9"
                      onClick={() => fullAgent && setActiveProfileStaff(fullAgent)}
                      title={`Click to open ${agent.name}'s staff summary`}
                    >
                      <td className="crm-inline-71658e5a4a" style={{color: ['#ffd700', '#c0c0c0', '#cd7f32'][idx] || 'var(--crm-text-secondary)'}}>{idx + 1}</td>
                      <td>
                        <div className="crm-inline-5c05f4afaf">{agent.name}</div>
                        <div className="crm-inline-a81558e644">{agent.email || ''}</div>
                      </td>
                      <td className="crm-inline-72a68ac344">{agent.totalClients}</td>
                      <td className="crm-inline-2a9af5616f">{agent.successfulDeposits}</td>
                      <td className="crm-inline-a067fc1963">{agent.conversionRate}%</td>
                      <td className="crm-inline-72a68ac344">{agent.totalComments}</td>
                      <td className="crm-inline-72a68ac344"><span className="crm-inline-37e853796e" style={{background: agent.isLoggedIn ? '#45d2a0' : 'var(--crm-text-secondary)'}}></span></td>
                    </tr>
                    );
                  })}
                  {agentStats.length === 0 && <tr><td colSpan={7} className="crm-inline-43700bc317">No agents in this team.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === 'agents' && (
        <div className="crm-super-admin-card">
          <div className="crm-inline-2b759092af">
            Click any agent on a row to open their staff profile modal and manage their account.
          </div>
          <div className="crm-super-admin-table-wrapper">
            <table className="crm-super-admin-table">
              <thead>
                <tr><th>Agent</th><th className="crm-inline-72a68ac344">Status</th><th>Last Login</th><th className="crm-inline-72a68ac344">Clients</th><th className="crm-inline-72a68ac344">Deposits</th><th className="crm-inline-72a68ac344">Conv.</th><th className="crm-inline-72a68ac344">Today</th></tr>
              </thead>
              <tbody>
                {agentStats.map(agent => {
                  const fullAgent = data.users.find(u => u.id === agent.id);
                  return (
                  <tr
                    key={agent.id}
                    className="crm-inline-8410c989c9"
                    onClick={() => fullAgent && setActiveProfileStaff(fullAgent)}
                    title={`Click to open ${agent.name}'s staff profile`}
                  >
                    <td>
                      <div className="crm-inline-5c05f4afaf">{agent.name}</div>
                      <div className="crm-inline-a81558e644">{agent.email || agent.id}</div>
                    </td>
                    <td className="crm-inline-72a68ac344">
                      <span className="crm-inline-a6d6d683c1" style={{background: agent.isLoggedIn ? 'rgba(69,210,160,0.1)' : 'rgba(107,114,128,0.1)', color: agent.isLoggedIn ? '#45d2a0' : 'var(--crm-text-secondary)', border: '1px solid ' + (agent.isLoggedIn ? '#45d2a040' : 'color-mix(in srgb, var(--crm-text-secondary) 25%, transparent)')}}>{agent.isLoggedIn ? 'Online' : 'Offline'}</span>
                    </td>
                    <td className="crm-inline-4a91c1bc1e">{fullAgent?.lastLoginAt ? new Date(fullAgent.lastLoginAt).toLocaleString() : '-'}</td>
                    <td className="crm-inline-72a68ac344">{agent.totalClients}</td>
                    <td className="crm-inline-2a9af5616f">{agent.successfulDeposits}</td>
                    <td className="crm-inline-a067fc1963">{agent.conversionRate}%</td>
                    <td className="crm-inline-ac0d7e8cbb">{agent.todaysComments}</td>
                  </tr>
                  );
                })}
                {agentStats.length === 0 && <tr><td colSpan={7} className="crm-inline-43700bc317">No agents in this team.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'clients' && (
        <div>
          <div className="crm-inline-e8aa10981e">
            <SearchAutocomplete
              className="crm-super-admin-input crm-inline-6f192b292f"
              placeholder="Search name, email, phone..."
              value={searchQuery}
              onChange={(v) => { setSearchQuery(v); setPage(1); }}
              fetchSuggestions={searchAdminClients}

              buildSuggestions={(q) => {
                const ql = q.toLowerCase();
                return teamClients
                  .filter(l => {
                    const full = `${l.firstName || ''} ${l.lastName || ''}`.toLowerCase();
                    return (
                      full.includes(ql) ||
                      (l.email || '').toLowerCase().includes(ql) ||
                      (l.phone || '').toLowerCase().includes(ql)
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
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} className="crm-super-admin-select crm-inline-6f192b292f" >
              <option value="">All Statuses</option>
              {['New', 'In Line', 'Deposit', 'Failed Deposit', 'No Answer', 'Not Interested'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterCountry} onChange={e => { setFilterCountry(e.target.value); setPage(1); }} className="crm-super-admin-select crm-inline-6f192b292f" >
              <option value="">All Countries</option>
              {[...new Set(teamClients.map(l => l.country))].sort().map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterAgent} onChange={e => { setFilterAgent(e.target.value); setPage(1); }} className="crm-super-admin-select crm-inline-6f192b292f" >
              <option value="">All Agents</option>
              <option value="__unassigned__">Unassigned</option>
              {teamAgents.map(a => {
                const stats = agentStats.find(s => s.id === a.id);
                return <option key={a.id} value={a.id}>{a.name} ({stats ? stats.totalClients : 0})</option>;
              })}
            </select>
            {(searchQuery || filterStatus || filterCountry || filterAgent) && (
              <button className="crm-super-admin-btn crm-inline-8d805cd3c3"  onClick={() => { setSearchQuery(''); setFilterStatus(''); setFilterCountry(''); setFilterAgent(''); setPage(1); }}>&#x2715; Clear</button>
            )}
            {canUploadClient && <button
              className="crm-super-admin-btn crm-inline-182fd671d9"

              onClick={() => setShowCreateClient(true)}
            >
              + New Client
            </button>}
          </div>
          {bulkSelectedClients.length > 0 && (
            <div className="crm-inline-aa8e040619">
              <span className="crm-inline-6038226768">{bulkSelectedClients.length} selected</span>
              <select value={bulkAgentId} onChange={e => setBulkAgentId(e.target.value)} className="crm-super-admin-select crm-inline-804f67ed75" >
                <option value="">Assign to agent...</option>
                {teamAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button className="crm-super-admin-btn crm-inline-fbee28eab4"  onClick={handleBulkAssign}>Assign</button>
              <button className="crm-super-admin-btn crm-inline-aacf8dedb9"  onClick={() => setBulkSelectedClients([])}>Clear</button>
            </div>
          )}
          <div className="crm-inline-2b759092af">Showing {paginatedClients.length} of {totalFiltered} clients (page {page}/{Math.max(1, totalPages)})</div>
          <div className="crm-super-admin-card crm-inline-bcb0a0d8bd" >
            <div className="crm-super-admin-table-wrapper">
              <table className="crm-super-admin-table">
                <thead>
                  <tr>
                    <th className="crm-inline-97711f5c3e"><input type="checkbox" checked={bulkSelectedClients.length === filteredClientIds.length && filteredClientIds.length > 0} onChange={e => handleSelectAllClients(e.target.checked)} /></th>
                    <th>Client ID</th><th>Name</th><th>Country</th><th>Status</th><th>Agent</th><th className="crm-inline-72a68ac344">Comments</th><th>Registered</th>
                    <th className="crm-inline-485e4c289b">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedClients.map(client => {
                    const stage = normalizeStage(client.stage);
                    const stagePillColor = stageColor(stage);
                    return (
                      <tr key={client.id} className="crm-inline-8410c989c9" onClick={() => navigate(`/admin/team-leader/${currentUser.id}/client/${client.id}`, { state: { returnTo: `/admin/team-leader/${currentUser.id}`, returnLabel: 'Back to Team', impersonatedFrom: currentUser.id } })}>
                        <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={bulkSelectedClients.includes(client.id)} onChange={() => toggleClientselection(client.id)} /></td>
                        <td className="crm-inline-93c6e1d4bb" onClick={e => e.stopPropagation()}>
                          <div className="crm-inline-9023e926fd">
                            <span className="crm-inline-6c559c15fe">{client.id ? client.id.slice(0, 6) : '-'}</span>
                            {client.id && <button title={client.id} onClick={() => navigator.clipboard.writeText(client.id)} className="crm-inline-ccd1cf626f"><i className="fas fa-copy crm-inline-cdc34a99ce" ></i></button>}
                          </div>
                        </td>
                        <td><div className="crm-inline-5c05f4afaf">{client.firstName} {client.lastName}</div><div className="crm-inline-a81558e644">{client.email}</div></td>
                        <td>{getCountryFlag(client.countryCode, client.country)} {client.country || '-'}</td>
                        <td onClick={e => e.stopPropagation()} className="crm-inline-93c6e1d4bb">
                          <StatusDropdown
                            value={stage}
                            options={CLIENT_STATUSES}
                            onChange={async (newStage) => {
                              if (updateClient) {
                                await updateClient(client.id, { stage: newStage, status: newStage });
                                showNotification?.(`Status updated to "${newStage}".`);
                              }
                            }}
                          />
                        </td>
                        <td className="crm-inline-7a459431c4">{getUserName(client.assignedToAgent, data.users) || <span className="crm-inline-54aeff80c9">Unassigned</span>}</td>
                        <td className="crm-inline-04ec004fb7">{(client.commentHistory || []).length}</td>
                        <td className="crm-inline-a81558e644">{client.registeredDate || (client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '-')}</td>
                        <td className="crm-inline-2755767ba3" onClick={e => e.stopPropagation()}>
                          <button
                            title="Edit client profile"
                            onClick={(e) => { e.stopPropagation(); setEditClient(client); }}
                            className="crm-inline-d1ce73c560"
                          >Edit</button>
                          <button
                            title="Add comment"
                            onClick={(e) => { e.stopPropagation(); setCommentClient(client); }}
                            className="crm-inline-dff00c99e3"
                          >💬</button>
                        </td>
                      </tr>
                    );
                  })}
                  {paginatedClients.length === 0 && <tr><td colSpan={8} className="crm-inline-c19eef71bc">No clients match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {canUploadClient && showCreateClient && createClient && (
            <CreateClientModal
              scope={{ officeId: currentUser.officeId, teamId: currentUser.teamId, teamLeaderId: currentUser.id }}
              teamsForOffice={[]}
              agents={teamAgents}
              onClose={() => setShowCreateClient(false)}
              onCreate={async (payload) => {
                const created = await createClient(payload);
                if (created) setShowCreateClient(false);
              }}
            />
          )}

          {editClient && updateClient && (
            <EditClientModal
              client={editClient}
              onClose={() => setEditClient(null)}
              onSave={(updates) => {
                updateClient(editClient.id, { ...updates, _actorName: currentUser.name, _actorId: currentUser.id });
                setEditClient(null);
              }}
            />
          )}

          {commentClient && updateClient && (
            <AddCommentModal
              clientName={`${commentClient.firstName || ''} ${commentClient.lastName || ''}`.trim()}
              onClose={() => setCommentClient(null)}
              onSubmit={(text) => {
                updateClient(commentClient.id, {
                  comment: text,
                  lastCommentDate: new Date().toISOString().slice(0, 10),
                  _actorName: currentUser.name,
                  _actorId: currentUser.id,
                });
                setCommentClient(null);
              }}
            />
          )}
          {totalPages > 1 && (
            <div className="crm-inline-57345e4c7e">
              <button onClick={() => setPage(1)} disabled={page === 1} className="crm-super-admin-btn crm-inline-0911a86b16" >«</button>
              <button onClick={() => setPage(p => p - 1)} disabled={page === 1} className="crm-super-admin-btn crm-inline-0911a86b16" >‹</button>
              <span className="crm-inline-2d73a8a9dc">Page {page} / {totalPages}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} className="crm-super-admin-btn crm-inline-0911a86b16" >›</button>
              <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="crm-super-admin-btn crm-inline-0911a86b16" >»</button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'assign' && (
        <AssignTab
          teamClients={teamClients}
          teamAgents={teamAgents}
          agentStats={agentStats}
          showNotification={showNotification}
          onBulkReassign={handleBulkReassign}
          data={data}
        />
      )}

      {canCreateAgent && showCreateAgent && (
        <CreateAgentModal
          team={data.teams.find((team) => team.id === currentUser.teamId)}
          onClose={() => setShowCreateAgent(false)}
          onCreate={async (name, password) => {
            const created = await createAgent(currentUser.teamId, name, password);
            if (created) showNotification('Agent created.');
            return created;
          }}
        />
      )}

      {activeProfileStaff && (
        <StaffProfileModal
          staff={activeProfileStaff}
          onClose={() => setActiveProfileStaff(null)}
          data={data}
          currentUser={currentUser}
          setData={setData}
          toggleStaffBlocked={toggleStaffBlocked}
          setUserLoginState={setUserLoginState}
          showNotification={showNotification}
        />
      )}
    </div>
  );
}

export default TeamLeaderPanel;
