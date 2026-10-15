const CANONICAL_ADMIN_ROLES = {
  superadmin: 'Super Admin',
  officemanager: 'Office Manager',
  teamleader: 'Team Leader',
  agent: 'Agent',
  salesagent: 'Agent',
};

export function normalizeAdminRole(role) {
  const normalized = String(role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  return CANONICAL_ADMIN_ROLES[normalized] || role;
}
