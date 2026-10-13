export function matchesClientOwnershipFilter(client, filter) {
  if (!filter || filter === 'all') return true;

  const officeId = client?.assignedToOffice ?? client?.assigned_office_id ?? null;
  const teamId = client?.assignedToTeam ?? client?.assigned_team_id ?? null;
  const teamLeaderId = client?.assignedToTeamLeader ?? client?.assigned_team_leader_id ?? null;
  const agentId = client?.assignedToAgent ?? client?.assigned_agent_id ?? null;

  switch (filter) {
    case 'team-leader-owned':
      return Boolean(teamLeaderId);
    case 'office-only':
      return Boolean(officeId && !teamId && !teamLeaderId && !agentId);
    case 'team-no-agent':
      return Boolean(teamId && !agentId);
    case 'agent-assigned':
      return Boolean(agentId);
    case 'unassigned':
      return Boolean(!officeId && !teamId && !teamLeaderId && !agentId);
    default:
      return true;
  }
}

export function matchesStaffStructureFilter(staff, filter) {
  if (!filter || filter === 'all') return true;

  const officeId = staff?.officeId ?? staff?.office_id ?? null;
  const teamId = staff?.teamId ?? staff?.team_id ?? null;

  switch (filter) {
    case 'independent':
      return Boolean(!officeId && !teamId);
    case 'office-no-team':
      return Boolean(officeId && !teamId);
    case 'team-assigned':
      return Boolean(teamId);
    default:
      return true;
  }
}