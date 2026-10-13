import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ROLE, CLIENT_STATUSES, normalizeStage,
  getOfficeName, getTeamName, getUserName, getCountryFlag,
  getTeamAgentCount, statusClass,
  CreateClientModal, AddCommentModal,
  stageColor,
  assignableAgents, assignableAgentLabel,
  StatusDropdown,
} from '../shared';
import { SearchAutocomplete } from '../components/UserChrome.jsx';
import ReactCapabilityWorkspace from '../components/ReactCapabilityWorkspace.jsx';
import StaffProfileModal from '../components/StaffProfileModal.jsx';
import { searchAdminClients } from '../adminApi';

function OfficeManagerPanel({ data, setData, currentUser, assignTeamLeader, createTeamLeader, createAgent, canCreateAgent, canUploadClient, toggleStaffBlocked, setClientAssignment, updateClient, createClient, setUserLoginState, showNotification }) {
  const navigate = useNavigate();
  const [activeProfileStaff, setActiveProfileStaff] = useState(null);
  const [teamId, setTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newLeaderName, setNewLeaderName] = useState('');
  const [newLeaderPassword, setNewLeaderPassword] = useState('');
  const [newTeamSize, setNewTeamSize] = useState('');
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentPassword, setNewAgentPassword] = useState('');
  const [newLeaderLink, setNewLeaderLink] = useState('');
  const [newAgentLink, setNewAgentLink] = useState('');
  const teamsForOffice = data.teams.filter((t) => t.officeId === currentUser.officeId);
  const onlineTeamLeaders = data.users.filter((u) => u.role === ROLE.TEAM_LEAD && u.isLoggedIn && u.officeId === currentUser.officeId).length;

  const copyToClipboard = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      showNotification('Login link copied to clipboard');
    } catch {
      showNotification('Copy failed, please copy manually');
    }
  };

  // Calculate useful metrics and analytics
  const officeClients = data.clients.filter((client) => client.assignedToOffice === currentUser.officeId);
  const teamLeaders = data.users.filter((u) => u.role === ROLE.TEAM_LEAD && u.officeId === currentUser.officeId);
  const agents = assignableAgents(data.users, currentUser, { officeId: currentUser.officeId });
  
  // Client status distribution
  const clientsByStatus = {};
  CLIENT_STATUSES.forEach(status => {
    clientsByStatus[status] = officeClients.filter((client) => client.stage === status).length;
  });
  
  // Team performance metrics
  const teamMetrics = teamsForOffice.map((team) => {
    const teamClients = officeClients.filter((client) => client.assignedToTeam === team.id);
    const teamAgents = agents.filter((u) => u.teamId === team.id);
    const leaderInfo = teamLeaders.find((l) => l.teamId === team.id);
    const depositsCount = teamClients.filter((l) => l.stage === 'Deposit').length;
    return {
      id: team.id,
      name: team.name,
      clientCount: teamClients.length,
      agentCount: teamAgents.length,
      leaderName: leaderInfo?.name || 'Unassigned',
      leaderOnline: leaderInfo?.isLoggedIn || false,
      capacity: (teamAgents.length / team.maxSize) * 100,
      depositsCount: depositsCount,
      conversionRate: teamClients.length > 0 ? ((depositsCount / teamClients.length) * 100).toFixed(1) : 0
    };
  });

  // Agent activity metrics
  const agentMetrics = agents.map((agent) => {
    const agentClients = officeClients.filter((client) => client.assignedToAgent === agent.id);
    return {
      id: agent.id,
      name: agent.name,
      clientCount: agentClients.length,
      isOnline: agent.isLoggedIn,
      team: getTeamName(agent.teamId, data.teams)
    };
  });

  // Overall office metrics
  const totalClients = officeClients.length;
  const totalDeposits = officeClients.filter((l) => l.stage === 'Deposit').length;
  const officeConversionRate = totalClients > 0 ? ((totalDeposits / totalClients) * 100).toFixed(1) : 0;

  // Identify teams needing attention
  const teamsNeedingAttention = teamMetrics.filter((t) => t.agentCount === 0 || !t.leaderOnline).sort((a, b) => b.clientCount - a.clientCount);

  const nativeTabs = ['overview', 'teams', 'agents', 'clients', 'create'];
  const tabStorageKey = `om_activeTab:${currentUser?.id || 'unknown'}`;
  const [omTab, setOmTab] = useState(() => {
    const saved = sessionStorage.getItem(tabStorageKey);
    return nativeTabs.includes(saved) ? saved : 'overview';
  });
  useEffect(() => { sessionStorage.setItem(tabStorageKey, omTab); }, [omTab, tabStorageKey]);

  return (
    <div className="crm-inline-e90cf56729">
      <div className="crm-super-admin-card crm-inline-b75fad0009" >
        <div className="crm-inline-1c13d2fcc4">
          <div>
            <h2 className="crm-inline-e4ab5a45df">{getOfficeName(currentUser.officeId, data.offices)}</h2>
            <p className="crm-inline-74481d3399">Office Manager Dashboard</p>
          </div>
        </div>
        <div className="crm-inline-f61bc3d688">
          {[
            { label: 'Teams', value: teamsForOffice.length },
            { label: 'leaders', value: teamLeaders.length, sub: onlineTeamLeaders + ' online', subColor: '#45d2a0' },
            { label: 'Agents', value: agents.length },
            { label: 'Total Clients', value: totalClients },
            { label: 'Deposits', value: totalDeposits, valColor: '#45d2a0' },
            { label: 'Conversion', value: officeConversionRate + '%', valColor: '#45d2a0' },
          ].map(stat => (
            <div key={stat.label} className="crm-inline-ee771e3ab6">
              <div className="crm-inline-5c47a21ad4">{stat.label}</div>
              <div className="crm-inline-4aa94ccdd2" style={{color: stat.valColor || 'var(--crm-accent)'}}>{stat.value}</div>
              {stat.sub && <div className="crm-inline-e0e7cb5dde" style={{color: stat.subColor || 'var(--crm-text-secondary)'}}>{stat.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="crm-super-admin-header crm-role-panel-header crm-inline-b75fad0009" >
        <div className="crm-super-admin-tabs">
          {[['overview', 'Dashboard'], ['teams', 'Teams'], ['agents', 'Agents'], ['clients', 'Client Management'], ['create', 'Create']].map(([key, label]) => (
            <button key={key} className={`crm-super-admin-tab-btn ${omTab === key ? 'crm-active' : ''}`} onClick={() => setOmTab(key)}>{label}</button>
          ))}
        </div>
      </div>
      <ReactCapabilityWorkspace
        data={data}
        currentUser={currentUser}
        showNotification={showNotification}
        activeTab={omTab}
        onActiveChange={setOmTab}
        nativeTabKeys={nativeTabs}
        fallbackTab="overview"
      />

      {omTab === 'overview' && (
        <>
          {teamsNeedingAttention.length > 0 && (
            <div className="crm-super-admin-card crm-inline-90c2b7d959" >
              <h3 className="crm-inline-5c76b5b784">⚠ Teams Needing Attention</h3>
              <div className="crm-super-admin-table-wrapper">
                <table className="crm-super-admin-table">
                  <thead><tr><th>Team</th><th>leader</th><th className="crm-inline-72a68ac344">Agents</th><th className="crm-inline-72a68ac344">Clients</th><th>Issue</th></tr></thead>
                  <tbody>
                    {teamsNeedingAttention.map(t => {
                      const leader = teamLeaders.find(l => l.teamId === t.id);
                      return (
                        <tr
                          key={t.id}
                          className="crm-inline-8410c989c9"
                          onClick={() =>
                            setActiveProfileStaff(
                              leader || {
                                id: `team_${t.id}`,
                                isTeamOnly: true,
                                teamId: t.id,
                                officeId: currentUser.officeId,
                                role: ROLE.TEAM_LEAD,
                                name: `${t.name} (Unassigned leader)`,
                                status: 'Active',
                              }
                            )
                          }
                          title={`Open summary for ${leader ? leader.name : t.name}`}
                        >
                          <td className="crm-inline-5c05f4afaf">{t.name}</td>
                          <td>{t.leaderName}</td>
                          <td className="crm-inline-72a68ac344">{t.agentCount}</td>
                          <td className="crm-inline-72a68ac344">{t.clientCount}</td>
                          <td className="crm-inline-f2c1be6ec8">{!t.leaderOnline && 'leader offline'}{!t.leaderOnline && t.agentCount === 0 && '  /  '}{t.agentCount === 0 && 'No agents'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="crm-super-admin-card crm-inline-b75fad0009" >
            <h3 className="crm-inline-7413805ccd">Client Status Distribution</h3>
            <div className="crm-inline-379493005a">
              {Object.entries(clientsByStatus).filter(([, count]) => count > 0).map(([status, count]) => {
                const color = stageColor(status);
                return (
                  <div key={status} className="crm-inline-f22ce644d3" style={{border: '1px solid var(--crm-border)', borderTop: '2px solid ' + color}}>
                    <div className="crm-inline-a3ebac388e">{status}</div>
                    <div className="crm-inline-58afaef217" style={{color}}>{count}</div>
                    <div className="crm-inline-8f32aa6743">{totalClients > 0 ? ((count / totalClients) * 100).toFixed(0) : 0}%</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="crm-super-admin-card">
            <h3 className="crm-inline-7413805ccd">Team Performance</h3>
            <div className="crm-super-admin-table-wrapper">
              <table className="crm-super-admin-table">
                <thead><tr><th>#</th><th>Team</th><th>leader</th><th className="crm-inline-72a68ac344">Clients</th><th className="crm-inline-72a68ac344">Deposits</th><th className="crm-inline-72a68ac344">Conversion</th><th className="crm-inline-72a68ac344">Agents</th></tr></thead>
                <tbody>
                  {teamMetrics.sort((a, b) => parseFloat(b.conversionRate) - parseFloat(a.conversionRate)).map((team, idx) => {
                    const leader = teamLeaders.find(l => l.teamId === team.id);
                    return (
                      <tr
                        key={team.id}
                        className="crm-inline-8410c989c9"
                        onClick={() =>
                          setActiveProfileStaff(
                            leader || {
                              id: `team_${team.id}`,
                              isTeamOnly: true,
                              teamId: team.id,
                              officeId: currentUser.officeId,
                              role: ROLE.TEAM_LEAD,
                              name: `${team.name} (Unassigned leader)`,
                              status: 'Active',
                            }
                          )
                        }
                        title={`Open summary for ${leader ? leader.name : team.name}`}
                      >
                        <td className="crm-inline-71658e5a4a" style={{color: ['#ffd700','#c0c0c0','#cd7f32'][idx] || 'var(--crm-text-secondary)'}}>{idx + 1}</td>
                        <td className="crm-inline-5c05f4afaf">{team.name}</td>
                        <td><div className="crm-inline-88c173ee88"><span className="crm-inline-65d4a43fdc" style={{background: team.leaderOnline ? '#45d2a0' : 'var(--crm-text-secondary)'}}></span>{team.leaderName}</div></td>
                        <td className="crm-inline-72a68ac344">{team.clientCount}</td>
                        <td className="crm-inline-2a9af5616f">{team.depositsCount}</td>
                        <td className="crm-inline-a067fc1963">{team.conversionRate}%</td>
                        <td className="crm-inline-72a68ac344">{team.agentCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {omTab === 'teams' && (
        <div className="crm-super-admin-card">
          <div className="crm-inline-2b759092af">
            Click any team / leader row to open their summary modal and access their full profile.
          </div>
          <div className="crm-super-admin-table-wrapper">
            <table className="crm-super-admin-table">
              <thead><tr><th>ID</th><th>Team</th><th>leader</th><th className="crm-inline-72a68ac344">Agents</th><th className="crm-inline-72a68ac344">Cap.</th><th className="crm-inline-72a68ac344">Clients</th><th className="crm-inline-72a68ac344">Deposits</th><th className="crm-inline-72a68ac344">Conv.</th></tr></thead>
              <tbody>
                {teamsForOffice.length === 0 ? (
                  <tr><td colSpan={8} className="crm-inline-c19eef71bc">No teams yet - create one in the Create tab.</td></tr>
                ) : teamsForOffice.map(team => {
                  const used = getTeamAgentCount(team.id, data.users);
                  const pct = Math.round((used / (team.maxSize || 1)) * 100);
                  const metric = teamMetrics.find(m => m.id === team.id);
                  const leader = data.users.find(u => (u.id === team.leaderId) || (u.role === ROLE.TEAM_LEAD && u.teamId === team.id));
                  return (
                    <tr
                      key={team.id}
                      className="crm-inline-8410c989c9"
                      onClick={() =>
                        setActiveProfileStaff(
                          leader || {
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
                      title={`Open summary for ${leader ? leader.name : team.name}`}
                    >
                      <td className="crm-inline-93c6e1d4bb" onClick={e => e.stopPropagation()}>
                        <div className="crm-inline-9023e926fd">
                          <span className="crm-inline-6c559c15fe">{team.id ? team.id.slice(0, 6) : '-'}</span>
                          {team.id && <button title={team.id} onClick={() => navigator.clipboard.writeText(team.id)} className="crm-inline-ccd1cf626f"><i className="fas fa-copy crm-inline-cdc34a99ce" ></i></button>}
                        </div>
                      </td>
                      <td className="crm-inline-5c05f4afaf">{team.name}</td>
                      <td>{leader ? (<div className="crm-inline-88c173ee88"><span className="crm-inline-65d4a43fdc" style={{background: leader.isLoggedIn ? '#45d2a0' : 'var(--crm-text-secondary)'}}></span><span className="crm-inline-73aacda4f4">{leader.name}</span></div>) : <span className="crm-inline-2d73a8a9dc">Unassigned</span>}</td>
                      <td className="crm-inline-72a68ac344">{used}</td>
                      <td className="crm-inline-72a68ac344">
                        <div className="crm-inline-88c173ee88">
                          <div className="crm-inline-1cda4e9e24">
                            <div className="crm-inline-5e11b481ea" style={{width: pct + '%', background: pct >= 90 ? '#ff6464' : pct >= 70 ? 'var(--crm-accent)' : '#45d2a0'}} />
                          </div>
                          <span className="crm-inline-9fb728af75">{pct}%</span>
                        </div>
                      </td>
                      <td className="crm-inline-72a68ac344">{metric?.clientCount || 0}</td>
                      <td className="crm-inline-2a9af5616f">{metric?.depositsCount || 0}</td>
                      <td className="crm-inline-4ad9bf092c">{metric?.conversionRate || 0}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {omTab === 'agents' && (
        <div className="crm-super-admin-card">
          <div className="crm-inline-2b759092af">
            Click any agent on a row to open their staff profile modal and manage their account.
          </div>
          <div className="crm-super-admin-table-wrapper">
            <table className="crm-super-admin-table">
              <thead><tr><th>ID</th><th>Agent</th><th>Team</th><th className="crm-inline-72a68ac344">Clients</th><th>Status</th><th>Last Login</th></tr></thead>
              <tbody>
                {agentMetrics.length === 0 ? (
                  <tr><td colSpan={6} className="crm-inline-c19eef71bc">No agents yet.</td></tr>
                ) : agentMetrics.sort((a, b) => b.clientCount - a.clientCount).map(agent => {
                  const fullAgent = data.users.find(u => u.id === agent.id);
                  return (
                    <tr
                      key={agent.id}
                      className="crm-inline-8410c989c9"
                      onClick={() => fullAgent && setActiveProfileStaff(fullAgent)}
                      title={`Click to open ${agent.name}'s staff profile`}
                    >
                      <td className="crm-inline-93c6e1d4bb" onClick={e => e.stopPropagation()}>
                        <div className="crm-inline-9023e926fd">
                          <span className="crm-inline-6c559c15fe">{agent.id ? agent.id.slice(0, 6) : '-'}</span>
                          {agent.id && <button title={agent.id} onClick={() => navigator.clipboard.writeText(agent.id)} className="crm-inline-ccd1cf626f"><i className="fas fa-copy crm-inline-cdc34a99ce" ></i></button>}
                        </div>
                      </td>
                      <td className="crm-inline-5c05f4afaf">{agent.name}</td>
                      <td className="crm-inline-54aeff80c9">{agent.team}</td>
                      <td className="crm-inline-a067fc1963">{agent.clientCount}</td>
                      <td><span className="crm-inline-4f1ec4a994" style={{background: agent.isOnline ? 'rgba(69,210,160,0.12)' : 'var(--crm-card)', color: agent.isOnline ? '#45d2a0' : 'var(--crm-text-secondary)', border: '1px solid ' + (agent.isOnline ? '#45d2a030' : 'var(--crm-border)')}}>{agent.isOnline ? ' Online' : '○ Offline'}</span></td>
                      <td className="crm-inline-2d73a8a9dc">{fullAgent?.lastLoginAt ? new Date(fullAgent.lastLoginAt).toLocaleString() : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {omTab === 'clients' && (
        <OfficeClientsTable data={data} currentUser={currentUser} teamsForOffice={teamsForOffice} agents={agents} setClientAssignment={setClientAssignment} updateClient={updateClient} createClient={createClient} canUploadClient={canUploadClient} showNotification={showNotification} />
      )}

      {omTab === 'create' && (
        <div className="crm-inline-e535d61f79">
          <div className="crm-super-admin-card">
            <h3 className="crm-inline-49b430ea95">New Team</h3>
            <div className="crm-inline-7c464eccac">
              <div><div className="crm-inline-1aabd903d6">Team Name</div><input value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="Team name..." autoComplete="off" className="crm-super-admin-input" /></div>
              <div><div className="crm-inline-1aabd903d6">Max Size (optional)</div><input value={newTeamSize} onChange={e => setNewTeamSize(e.target.value)} placeholder="e.g. 10" type="number" autoComplete="off" className="crm-super-admin-input" /></div>
              <div><div className="crm-inline-1aabd903d6">Leader Name (optional)</div><input value={newLeaderName} onChange={e => setNewLeaderName(e.target.value)} placeholder="Leader name..." autoComplete="off" className="crm-super-admin-input" /></div>
              <div><div className="crm-inline-1aabd903d6">Leader Password (optional)</div><input value={newLeaderPassword} onChange={e => setNewLeaderPassword(e.target.value)} placeholder="Password..." type="password" autoComplete="new-password" className="crm-super-admin-input" /></div>
              <button className="crm-super-admin-btn crm-inline-b87959d0ff"  disabled={!newTeamName.trim() || Boolean(newLeaderName.trim()) !== Boolean(newLeaderPassword)} onClick={async () => {
                const r = await createTeamLeader(currentUser.officeId, newTeamName, newLeaderName, newLeaderPassword, newTeamSize);
                if (r === undefined) return;
                if (r?.loginLink) setNewLeaderLink(r.loginLink);
                setNewTeamName(''); setNewTeamSize(''); setNewLeaderName(''); setNewLeaderPassword('');
                showNotification(r ? 'Team and leader created!' : 'Team created!');
              }}>✓ Create Team</button>
              {newLeaderLink && (
                <div className="crm-inline-678fd9a82b">
                  <div className="crm-inline-6108e8ea52">Leader Login Link</div>
                  <div className="crm-inline-b41dbad860"><input value={newLeaderLink} readOnly className="crm-super-admin-input crm-inline-fe5cffff98"  /><button className="crm-link-copy-btn" onClick={() => copyToClipboard(newLeaderLink)}>[list]</button></div>
                </div>
              )}
            </div>
          </div>
          {canCreateAgent && <div className="crm-super-admin-card">
            <h3 className="crm-inline-49b430ea95">New Agent</h3>
            <div className="crm-inline-7c464eccac">
              <div>
                <div className="crm-inline-1aabd903d6">Assign to Team</div>
                <select value={teamId} onChange={e => setTeamId(e.target.value)} className="crm-super-admin-select">
                  <option value="">No team (direct to this office)</option>
                  {teamsForOffice.map(t => <option key={t.id} value={t.id}>{t.name} ({getTeamAgentCount(t.id, data.users)}/{t.maxSize ?? "∞"})</option>)}
                </select>
              </div>
              <div><div className="crm-inline-1aabd903d6">Agent Name</div><input value={newAgentName} onChange={e => setNewAgentName(e.target.value)} placeholder="Agent name..." autoComplete="off" className="crm-super-admin-input" /></div>
              <div><div className="crm-inline-1aabd903d6">Agent Password</div><input value={newAgentPassword} onChange={e => setNewAgentPassword(e.target.value)} placeholder="Password..." type="password" autoComplete="new-password" className="crm-super-admin-input" /></div>
              <button className="crm-super-admin-btn crm-inline-b87959d0ff"  disabled={!newAgentName || !newAgentPassword} onClick={async () => {
                const r = await createAgent(teamId || null, newAgentName, newAgentPassword, currentUser.officeId);
                if (!r) return;
                if (r.loginLink) setNewAgentLink(r.loginLink);
                setNewAgentName(''); setNewAgentPassword('');
                showNotification('Agent created!');
              }}>✓ Create Agent</button>
              {newAgentLink && (
                <div className="crm-inline-678fd9a82b">
                  <div className="crm-inline-6108e8ea52">Agent Login Link</div>
                  <div className="crm-inline-b41dbad860"><input value={newAgentLink} readOnly className="crm-super-admin-input crm-inline-fe5cffff98"  /><button className="crm-link-copy-btn" onClick={() => copyToClipboard(newAgentLink)}>[list]</button></div>
                </div>
              )}
            </div>
          </div>}
        </div>
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

function OfficeClientsTable({ data, currentUser, teamsForOffice, agents, setClientAssignment, updateClient, createClient, canUploadClient, showNotification }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filterTeam, setFilterTeam] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [page, setPage] = useState(1);
  const [bulkTeamId, setBulkTeamId] = useState('');
  const [bulkAgentId, setBulkAgentId] = useState('');
  const [selected, setSelected] = useState([]);
  const [showShuffle, setShowShuffle] = useState(false);
  const [shuffleScope, setShuffleScope] = useState('teams'); // 'teams' | 'agents'
  const [shuffleTargets, setShuffleTargets] = useState([]);
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [commentClient, setCommentClient] = useState(null);
  const pageSize = 25;

  const officeClients = useMemo(() => data.clients.filter(l => l.assignedToOffice === currentUser.officeId), [data.clients, currentUser.officeId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return officeClients.filter(client => {
      if (filterTeam && client.assignedToTeam !== filterTeam) return false;
      if (filterAgent === '__unassigned__' && client.assignedToAgent) return false;
      if (filterAgent && filterAgent !== '__unassigned__' && client.assignedToAgent !== filterAgent) return false;

      if (q && !(
        (client.firstName || '').toLowerCase().includes(q) ||
        (client.lastName || '').toLowerCase().includes(q) ||
        (client.email || '').toLowerCase().includes(q) ||
        (client.phone || '').toLowerCase().includes(q) ||
        (client.country || '').toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [officeClients, search, filterTeam, filterAgent]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const unassigned = officeClients.filter(l => !l.assignedToTeam).length;
  const pendingAgent = officeClients.filter(l => l.assignedToTeam && !l.assignedToAgent).length;
  const fullyAssigned = officeClients.filter(l => l.assignedToAgent).length;

  const allPageSelected = paged.length > 0 && paged.every(l => selected.includes(l.id));
  const toggleAll = () => setSelected(allPageSelected ? selected.filter(id => !paged.find(l => l.id === id)) : [...new Set([...selected, ...paged.map(l => l.id)])]);

  const handleBulkAssignTeam = () => {
    if (!bulkTeamId || selected.length === 0) { showNotification('Select clients and a team first.'); return; }
    selected.forEach(lid => setClientAssignment({ clientId: lid, officeId: currentUser.officeId, teamId: bulkTeamId, agentId: null }));
    showNotification(`${selected.length} clients assigned to team.`);
    setSelected([]); setBulkTeamId('');
  };

  const handleBulkAssignAgent = () => {
    if (!bulkAgentId || selected.length === 0) { showNotification('Select clients and an agent first.'); return; }
    const agent = agents.find(a => a.id === bulkAgentId);
    if (!agent) return;
    selected.forEach(lid => setClientAssignment({ clientId: lid, officeId: currentUser.officeId, teamId: agent.teamId, agentId: bulkAgentId }));
    showNotification(`${selected.length} clients assigned to agent.`);
    setSelected([]); setBulkAgentId('');
  };

  const toggleShuffleTarget = (id) => setShuffleTargets(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  const handleShuffleOffice = () => {
    if (shuffleTargets.length === 0) { showNotification('Pick at least one target.'); return; }
    // Pool = selected clients or all unassigned-to-agent clients in the office
    const pool = selected.length > 0
      ? officeClients.filter(l => selected.includes(l.id))
      : officeClients.filter(l => !l.assignedToAgent);
    if (pool.length === 0) { showNotification('No clients to distribute.'); return; }
    pool.forEach((client, idx) => {
      const targetId = shuffleTargets[idx % shuffleTargets.length];
      if (shuffleScope === 'teams') {
        setClientAssignment({ clientId: client.id, officeId: currentUser.officeId, teamId: targetId, agentId: null });
      } else {
        const agent = agents.find(a => a.id === targetId);
        if (agent) setClientAssignment({ clientId: client.id, officeId: currentUser.officeId, teamId: agent.teamId, agentId: agent.id });
      }
    });
    showNotification(`Shuffled ${pool.length} clients across ${shuffleTargets.length} ${shuffleScope}.`);
    setSelected([]); setShuffleTargets([]); setShowShuffle(false);
  };

  return (
    <div>
      <div className="crm-inline-a3f832d34c">
        {[
          { label: 'Pending Team', value: unassigned, color: 'var(--crm-accent)' },
          { label: 'Pending Agent', value: pendingAgent, color: '#0A84FF' },
          { label: 'Fully Assigned', value: fullyAssigned, color: '#0ECB81' },
          {
            label: 'Active Clients',
            value: officeClients.filter(l => (l.stage || l.status || '').toLowerCase() === 'active').length,
            color: '#0ECB81',
            title: 'Active agency clients',
          },
          {
            label: 'New Clients',
            value: officeClients.filter(l => (l.stage || l.status || '').toLowerCase() === 'new').length,
            color: '#F59E0B',
            title: 'New incoming clients',
          },
          { label: 'Total Office', value: officeClients.length, color: 'var(--crm-text-primary)' },
        ].map(s => (
          <div
            key={s.label}
            title={s.title}
            onClick={s.onClick}
            className="crm-inline-485a7b737e" style={{cursor: s.onClick ? 'pointer' : 'default'}}
          >
            <div className="crm-inline-b1a5dd9d71">{s.label}</div>
            <div className="crm-inline-e658b338ea" style={{color: s.color}}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="crm-inline-3195c75bb2">
        <SearchAutocomplete
          className="crm-super-admin-input crm-inline-e1033046e2"
          placeholder="Search by name, email, phone..."
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          fetchSuggestions={searchAdminClients}

          buildSuggestions={(q) => {
            const ql = q.toLowerCase();
            return officeClients
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
        <select className="crm-inline-ea2bdd3f7f" value={filterTeam} onChange={e => { setFilterTeam(e.target.value); setPage(1); }}>
          <option value="">All Teams</option>
          {teamsForOffice.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="crm-inline-ea2bdd3f7f" value={filterAgent} onChange={e => { setFilterAgent(e.target.value); setPage(1); }}>
          <option value="">All (incl. assigned)</option>
          <option value="__unassigned__">Unassigned to Agent</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {(search || filterTeam || filterAgent) && (
          <button onClick={() => { setSearch(''); setFilterTeam(''); setFilterAgent(''); setPage(1); }} className="crm-inline-cfb695b57b">Clear</button>
        )}
        <button
          onClick={() => setShowShuffle(v => !v)}
          className="crm-inline-33deb0c40a" style={{background: showShuffle ? '#0A84FF' : 'var(--crm-border)', color: showShuffle ? 'var(--crm-bg)' : '#0A84FF'}}
        >
          🔀 Shuffle / Distribute
        </button>
        {canUploadClient && <button
          onClick={() => setShowCreateClient(true)}
          className="crm-inline-206f403bde"
        >
          + New Client
        </button>}
      </div>

      {showShuffle && (
        <div className="crm-inline-4b912ae2e3">
          <div className="crm-inline-3f04f28a4f">
            Shuffle / Distribute - {selected.length > 0 ? `${selected.length} selected client(s)` : `all clients with no agent (${officeClients.filter(l => !l.assignedToAgent).length})`}
          </div>
          <div className="crm-inline-0bcfc2abe0">
            <div>
              <div className="crm-inline-b1a5dd9d71">Distribute among</div>
              <select value={shuffleScope} onChange={e => { setShuffleScope(e.target.value); setShuffleTargets([]); }} className="crm-inline-edd967ee41">
                <option value="teams">Teams in this office</option>
                <option value="agents">Agents in this office</option>
              </select>
            </div>
          </div>
          <div className="crm-inline-8c974ba29a">Pick targets ({shuffleTargets.length} selected):</div>
          <div className="crm-inline-51281588d1">
            {(shuffleScope === 'teams' ? teamsForOffice.map(t => ({ id: t.id, label: t.name })) : agents.map(a => ({ id: a.id, label: `${a.name}  /  ${getTeamName(a.teamId, data.teams)}` }))).map(t => (
              <button
                key={t.id}
                onClick={() => toggleShuffleTarget(t.id)}
                className="crm-inline-1bfe2657ce" style={{background: shuffleTargets.includes(t.id) ? '#0A84FF' : 'var(--crm-border)', color: shuffleTargets.includes(t.id) ? 'var(--crm-bg)' : '#f5f6fb', fontWeight: shuffleTargets.includes(t.id) ? 600 : 400}}
              >{t.label}</button>
            ))}
          </div>
          <div className="crm-inline-54a4986ffc">
            <button onClick={handleShuffleOffice} disabled={shuffleTargets.length === 0} className="crm-inline-e0e57eaf23" style={{opacity: shuffleTargets.length === 0 ? 0.5 : 1}}>🔀 Shuffle Now</button>
            <button onClick={() => setShuffleTargets([])} className="crm-inline-b23375a6dd">Clear</button>
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <div className="crm-inline-6f480ad36d">
          <span className="crm-inline-eab8e42147">{selected.length} selected</span>
          <select className="crm-inline-85276d76f3" value={bulkTeamId} onChange={e => setBulkTeamId(e.target.value)}>
            <option value="">Assign to Team...</option>
            {teamsForOffice.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={handleBulkAssignTeam} className="crm-inline-68b264ab0c">Assign Team</button>
          <select className="crm-inline-85276d76f3" value={bulkAgentId} onChange={e => setBulkAgentId(e.target.value)}>
            <option value="">Assign to Agent...</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({getTeamName(a.teamId, data.teams)})</option>)}
          </select>
          <button onClick={handleBulkAssignAgent} className="crm-inline-80b4760b6d">Assign Agent</button>
          <button onClick={() => setSelected([])} className="crm-inline-2dc86a09a3">Clear selection</button>
        </div>
      )}

      <div className="crm-inline-2b759092af">
        {filtered.length} clients  /  page {page}/{totalPages}
      </div>

      <div className="crm-admin-table-container">
        <table className="crm-admin-table">
          <thead>
            <tr>
              <th><input type="checkbox" checked={allPageSelected} onChange={toggleAll} /></th>
              <th>Client ID</th>
              <th>Name</th>
              <th>Country</th>
              <th>Status</th>
              <th>Team</th>
              <th>Agent</th>
              <th>Registered</th>
              <th className="crm-inline-485e4c289b">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={9} className="crm-inline-69d13600ed">No clients match your filters.</td></tr>
            ) : paged.map(client => (
              <tr
                key={client.id}
                className="crm-inline-8410c989c9" style={{background: selected.includes(client.id) ? 'var(--crm-card)' : undefined}}
                onClick={() => navigate(`/admin/office-manager/${currentUser.id}/client/${client.id}`, { state: { returnTo: `/admin/office-manager/${currentUser.id}`, returnLabel: 'Back to Office' } })}
              >
                <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.includes(client.id)} onChange={e => setSelected(e.target.checked ? [...selected, client.id] : selected.filter(id => id !== client.id))} /></td>
                <td className="crm-inline-93c6e1d4bb">
                  <div className="crm-inline-9023e926fd">
                    <span className="crm-inline-6c559c15fe">{client.id ? client.id.slice(0, 6) : '-'}</span>
                    {client.id && <button title={client.id} onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(client.id); }} className="crm-inline-ccd1cf626f"><i className="fas fa-copy crm-inline-cdc34a99ce" ></i></button>}
                  </div>
                </td>
                <td>
                  <div className="crm-inline-c73fce4343">{client.firstName} {client.lastName}</div>
                  <div className="crm-inline-a81558e644">{client.phone}</div>
                </td>
                <td className="crm-inline-7a459431c4">{getCountryFlag(client.countryCode, client.country)} {client.country}</td>
                <td onClick={e => e.stopPropagation()} className="crm-inline-93c6e1d4bb">
                  <StatusDropdown
                    value={normalizeStage(client.stage)}
                    options={CLIENT_STATUSES}
                    onChange={async (newStage) => {
                      if (updateClient) {
                        await updateClient(client.id, { stage: newStage, status: newStage });
                        showNotification?.(`Status updated to "${newStage}".`);
                      }
                    }}
                  />
                </td>
                <td className="crm-inline-7a459431c4" style={{color: client.assignedToTeam ? 'var(--crm-text-primary)' : 'var(--crm-accent)'}}>
                  {client.assignedToTeam ? getTeamName(client.assignedToTeam, data.teams) : 'Unassigned'}
                </td>
                <td className="crm-inline-7a459431c4" style={{color: client.assignedToAgent ? '#0ECB81' : 'var(--crm-text-secondary)'}}>
                  {client.assignedToAgent ? getUserName(client.assignedToAgent, data.users) : '-'}
                </td>
                <td className="crm-inline-a81558e644">{client.registeredDate || (client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '-')}</td>
                <td className="crm-inline-2755767ba3">
                  <button
                    title="Add comment"
                    onClick={e => { e.stopPropagation(); setCommentClient(client); }}
                    className="crm-inline-dff00c99e3"
                  >💬</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canUploadClient && showCreateClient && (
        <CreateClientModal
          scope={{ officeId: currentUser.officeId }}
          teamsForOffice={teamsForOffice}
          agents={agents}
          onClose={() => setShowCreateClient(false)}
          onCreate={async (payload) => {
            const created = await createClient(payload);
            if (created) setShowCreateClient(false);
          }}
        />
      )}

      {commentClient && (
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
          <button onClick={() => setPage(1)} disabled={page === 1} className="crm-inline-8d8e6ab3de">«</button>
          <button onClick={() => setPage(p => p - 1)} disabled={page === 1} className="crm-inline-8d8e6ab3de">‹</button>
          <span className="crm-inline-9162bd92ff">Page {page} / {totalPages}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} className="crm-inline-8d8e6ab3de">›</button>
          <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="crm-inline-8d8e6ab3de">»</button>
        </div>
      )}
    </div>
  );
}

export default OfficeManagerPanel;
