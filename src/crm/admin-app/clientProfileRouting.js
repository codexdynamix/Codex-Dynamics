const ROLE_TO_PATH = {
  'Super Admin': 'super-admin',
  'Office Manager': 'office-manager',
  'Team Leader': 'team-leader',
  'Agent': 'agent',
  'super-admin': 'super-admin',
  'office-manager': 'office-manager',
  'team-leader': 'team-leader',
  'agent': 'agent',
};

export function getRoleWorkspacePath(role, userId) {
  const segment = ROLE_TO_PATH[role] || 'agent';
  return `/admin/${segment}/${userId || ''}`;
}

export function getClientProfilePath(role, userId, clientId) {
  const base = getRoleWorkspacePath(role, userId);
  return `${base}/client/${clientId}`;
}

export function getStaffProfilePath(role, userId, staffId) {
  const base = getRoleWorkspacePath(role, userId);
  return `${base}/staff/${staffId}`;
}

export function getRoleScopedStaff(data, role, currentUser) {
  const visibleStaff = (data?.users || []).filter((u) => u.status !== 'Disabled');
  const allStaff = visibleStaff.filter(
    (u) => u.role === 'Office Manager' || u.role === 'Team Leader' || u.role === 'Agent'
  );
  if (!currentUser) return allStaff;

  const roleName = role || currentUser.role;

  if (roleName === 'Super Admin' || roleName === 'super-admin') {
    return visibleStaff;
  }
  if (roleName === 'Office Manager' || roleName === 'office-manager') {
    return currentUser.officeId
      ? allStaff.filter((u) => u.officeId === currentUser.officeId)
      : allStaff;
  }
  if (roleName === 'Team Leader' || roleName === 'team-leader') {
    return currentUser.teamId
      ? allStaff.filter((u) => u.teamId === currentUser.teamId && u.role === 'Agent')
      : allStaff;
  }

  return allStaff;
}

export function getRoleScopedClients(data, role, currentUser) {
  const allClients = data?.clients || [];
  if (!currentUser) return allClients;

  const roleName = role || currentUser.role;

  if (roleName === 'Super Admin' || roleName === 'super-admin') {
    return allClients;
  }
  if (roleName === 'Office Manager' || roleName === 'office-manager') {
    return currentUser.officeId
      ? allClients.filter((l) => (l.assignedToOffice || l.officeId) === currentUser.officeId)
      : allClients;
  }
  if (roleName === 'Team Leader' || roleName === 'team-leader') {
    return allClients.filter((client) => {
      const belongsToTeam = currentUser.teamId
        && (client.assignedToTeam || client.teamId) === currentUser.teamId;
      const assignedDirectly = currentUser.id
        && (client.assignedToTeamLeader || client.assigned_team_leader_id) === currentUser.id;
      return Boolean(belongsToTeam || assignedDirectly);
    });
  }
  if (roleName === 'Agent' || roleName === 'agent') {
    return currentUser.id
      ? allClients.filter((l) => (l.assignedToAgent || l.agentId) === currentUser.id)
      : allClients;
  }

  return allClients;
}
