import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  ROLE,
  CLIENT_STATUSES,
  normalizeStage,
  getOfficeName,
  getTeamName,
  getCountryFlag,
  makeLoginLink,
  StatusDropdown,
} from '../shared.jsx';
import {
  updateStaffApi,
  deleteStaffApi,
  updateOffice,
  deleteOffice,
  updateTeam,
  deleteTeam,
  getStaffCapabilities,
  updateStaffCapabilities,
  getStaffNotesAdmin,
  addStaffNoteAdmin,
  blockStaffApi,
  unblockStaffApi,
} from '../adminApi.js';
import {
  getStaffProfilePath,
  getRoleScopedStaff,
  getRoleWorkspacePath,
  getClientProfilePath,
} from '../clientProfileRouting.js';
import { useConfirmDialog } from './ConfirmModal/ConfirmModal.jsx';
import { CommunicationActionModal, StaffEmailAccounts } from './HostingerMailAdmin.jsx';
import { SearchAutocomplete } from './UserChrome.jsx';

const DEFAULT_CAPABILITY_CATALOG = {
  client_upload: 'Client Upload',
  create_agent: 'Create Agent',
  notifications: 'Notifications',
  security: 'Security',
  content: 'Content',
  enquiries: 'Enquiries',
  chat: 'Chat',
};

const ROLE_BADGE_STYLE = {
  [ROLE.OFFICE_MANAGER]: {
    background: 'color-mix(in srgb, var(--crm-accent) 15%, transparent)',
    color: 'var(--crm-accent)',
    border: '1px solid color-mix(in srgb, var(--crm-accent) 40%, transparent)',
  },
  [ROLE.TEAM_LEAD]: {
    background: 'rgba(69,210,160,0.15)',
    color: '#45d2a0',
    border: '1px solid rgba(69,210,160,0.4)',
  },
  [ROLE.AGENT]: {
    background: 'rgba(52,152,219,0.15)',
    color: '#3498db',
    border: '1px solid rgba(52,152,219,0.4)',
  },
};

function computePasswordStrength(pw) {
  if (!pw) return { level: 0, label: 'Empty' };
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  return { level: score, label: labels[score] };
}

export default function StaffProfilePage({
  role,
  viewingUser,
  data,
  setData,
  toggleStaffBlocked,
  setUserLoginState,
  updateClient,
  showNotification,
}) {
  const { userId, staffId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [confirmDialog, confirm] = useConfirmDialog();

  const nameInputRef = useRef(null);
  const passwordInputRef = useRef(null);

  const currentUser = useMemo(
    () => viewingUser || (data?.users || []).find((u) => u.id === userId),
    [viewingUser, data?.users, userId]
  );

  const scopedStaff = useMemo(
    () => getRoleScopedStaff(data, role, currentUser),
    [data, role, currentUser]
  );

  // Support direct staff user ID, or office_<id> / team_<id> fallback IDs
  const staff = useMemo(() => {
    const foundUser = (data?.users || []).find((u) => u.id === staffId);
    if (foundUser) return foundUser;
    if (staffId && staffId.startsWith('office_')) {
      const rawOfficeId = staffId.replace(/^office_/, '');
      const mgr = (data?.users || []).find(
        (u) => u.role === ROLE.OFFICE_MANAGER && u.officeId === rawOfficeId
      );
      if (mgr) return mgr;
      const office = (data?.offices || []).find((o) => o.id === rawOfficeId);
      if (office) {
        return {
          id: staffId,
          isOfficeOnly: true,
          officeId: office.id,
          role: ROLE.OFFICE_MANAGER,
          name: `${office.name} (Unassigned Manager)`,
          email: '',
          status: 'Active',
        };
      }
    }
    if (staffId && staffId.startsWith('team_')) {
      const rawTeamId = staffId.replace(/^team_/, '');
      const ldr = (data?.users || []).find(
        (u) => u.role === ROLE.TEAM_LEAD && u.teamId === rawTeamId
      );
      if (ldr) return ldr;
      const team = (data?.teams || []).find((t) => t.id === rawTeamId);
      if (team) {
        return {
          id: staffId,
          isTeamOnly: true,
          teamId: team.id,
          officeId: team.officeId,
          role: ROLE.TEAM_LEAD,
          name: `${team.name} (Unassigned leader)`,
          email: '',
          status: 'Active',
        };
      }
    }
    return null;
  }, [data?.users, data?.offices, data?.teams, staffId]);

  const eligibleStaffForTransfer = useMemo(() => {
    const users = (data?.users || []).filter(
      (user) => user?.id && user.id !== staff?.id && user.status !== 'Suspended' && user.status !== 'Disabled'
    );
    if (role === ROLE.SUPER_ADMIN) return users;
    if (role === ROLE.OFFICE_MANAGER) return users.filter((user) => user.officeId === currentUser?.officeId || user.id === currentUser?.id);
    if (role === ROLE.TEAM_LEAD) return users.filter((user) => user.teamId === currentUser?.teamId || user.id === currentUser?.id);
    return [currentUser].filter(Boolean);
  }, [data?.users, role, currentUser, staff?.id]);

  const officeObj = useMemo(() => {
    if (!staff || !data?.offices) return null;
    if (staff.officeId) {
      return data.offices.find((o) => o.id === staff.officeId) || null;
    }
    return data.offices.find((o) => o.managerId === staff.id) || null;
  }, [data?.offices, staff]);

  const teamObj = useMemo(() => {
    if (!staff || !data?.teams) return null;
    if (staff.teamId) {
      return data.teams.find((t) => t.id === staff.teamId) || null;
    }
    return data.teams.find((t) => t.leaderId === staff.id) || null;
  }, [data?.teams, staff]);

  const currentIdx = useMemo(
    () => scopedStaff.findIndex((u) => u.id === staff?.id),
    [scopedStaff, staff?.id]
  );
  const prevStaff = currentIdx > 0 ? scopedStaff[currentIdx - 1] : null;
  const nextStaff =
    currentIdx >= 0 && currentIdx < scopedStaff.length - 1
      ? scopedStaff[currentIdx + 1]
      : null;

  const workspacePath =
    location.state?.returnTo || getRoleWorkspacePath(role, currentUser?.id || userId);

  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editOfficeId, setEditOfficeId] = useState('');
  const [editTeamId, setEditTeamId] = useState('');
  const [editOfficeName, setEditOfficeName] = useState('');
  const [editTeamName, setEditTeamName] = useState('');
  const [editTeamMaxSize, setEditTeamMaxSize] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [catalog, setCatalog] = useState(DEFAULT_CAPABILITY_CATALOG);
  const [capabilities, setCapabilities] = useState({
    client_upload: true,
    create_agent: true,
    notifications: true,
    security: true,
    content: true,
    enquiries: true,
    chat: true,
  });
  const [capDirty, setCapDirty] = useState(false);

  const [clientsearch, setClientsearch] = useState('');
  const [clientstageFilter, setClientstageFilter] = useState('');
  const [staffNoteInput, setStaffNoteInput] = useState('');
  const [staffNotes, setStaffNotes] = useState([]);
  const [staffNotesLoading, setStaffNotesLoading] = useState(false);
  const [staffNoteSaving, setStaffNoteSaving] = useState(false);
  const [staffNoteError, setStaffNoteError] = useState('');
  const [communicationOpen, setCommunicationOpen] = useState(false);
  const [mailTabOpen, setMailTabOpen] = useState(false);

  useEffect(() => {
    if (!staff) return;
    let cancelled = false;
    setEditName(staff.isOfficeOnly || staff.isTeamOnly ? '' : staff.name || '');
    setEditEmail(staff.email || '');
    setEditOfficeId(officeObj?.id || staff.officeId || teamObj?.officeId || '');
    setEditTeamId(teamObj?.id || staff.teamId || '');
    setEditOfficeName(officeObj?.name || '');
    setEditTeamName(teamObj?.name || '');
    setEditTeamMaxSize(teamObj?.maxSize != null ? String(teamObj.maxSize) : '');
    setNewPassword('');
    setStaffNotesLoading(true);
    setStaffNoteError('');
    const loadNotes = async () => {
      try {
        const notes = await getStaffNotesAdmin(staff.id);
        if (!cancelled) setStaffNotes(notes);
      } catch (error) {
        if (!cancelled) setStaffNoteError(error.message || 'Staff notes could not be loaded.');
      } finally {
        if (!cancelled) setStaffNotesLoading(false);
      }
    };
    void loadNotes();
    return () => { cancelled = true; };
  }, [
    staff?.id,
    staff?.name,
    staff?.email,
    staff?.officeId,
    staff?.teamId,
    staff?.isOfficeOnly,
    staff?.isTeamOnly,
    officeObj?.id,
    officeObj?.name,
    teamObj?.id,
    teamObj?.name,
    teamObj?.maxSize,
    teamObj?.officeId,
  ]);

  useEffect(() => {
    if (!staff?.id || staff.isOfficeOnly || staff.isTeamOnly) return;
    let cancelled = false;
    getStaffCapabilities(staff.id)
      .then((payload) => {
        if (cancelled) return;
        setCatalog({ ...DEFAULT_CAPABILITY_CATALOG, ...(payload?.catalog || {}) });
        setCapabilities({
          client_upload: true,
          create_agent: true,
          notifications: true,
          security: true,
          content: true,
          enquiries: true,
          chat: true,
          ...(payload?.capabilities || {}),
        });
        setCapDirty(false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [staff?.id, staff?.isOfficeOnly, staff?.isTeamOnly]);

  const isVirtual = Boolean(staff?.isOfficeOnly || staff?.isTeamOnly);
  const isBlocked = staff?.status === 'Suspended' || staff?.status === 'Disabled';
  const loginLink = !isVirtual && staff ? staff.loginLink || makeLoginLink(staff.id, staff.role) : '';
  const resolvedOfficeId = officeObj?.id || staff?.officeId || teamObj?.officeId || '';
  const resolvedTeamId = teamObj?.id || staff?.teamId || '';
  const officeName = getOfficeName(resolvedOfficeId, data?.offices || []);
  const teamName = getTeamName(resolvedTeamId, data?.teams || []);

  const panelPath =
    staff?.role === ROLE.OFFICE_MANAGER
      ? `/admin/office-manager/${staff.id}`
      : staff?.role === ROLE.TEAM_LEAD
      ? `/admin/team-leader/${staff.id}`
      : staff ? `/admin/agent/${staff.id}` : '';

  // Office Teams & Agents (for Office Managers) and Team Agents (for Team Leaders)
  const officeTeams = useMemo(() => {
    if (!resolvedOfficeId) return [];
    return (data?.teams || []).filter((t) => t.officeId === resolvedOfficeId);
  }, [data?.teams, resolvedOfficeId]);

  const officeAgents = useMemo(() => {
    if (!resolvedOfficeId) return [];
    return (data?.users || []).filter(
      (u) => u.role === ROLE.AGENT && u.officeId === resolvedOfficeId
    );
  }, [data?.users, resolvedOfficeId]);

  const teamAgents = useMemo(() => {
    if (!resolvedTeamId) return [];
    return (data?.users || []).filter(
      (u) => u.role === ROLE.AGENT && u.teamId === resolvedTeamId
    );
  }, [data?.users, resolvedTeamId]);

  const staffClients = useMemo(() => {
    if (!staff) return [];
    const allClients = data?.clients || [];
    if (staff.role === ROLE.OFFICE_MANAGER) {
      return allClients.filter((l) => l.assignedToOffice === resolvedOfficeId);
    }
    if (staff.role === ROLE.TEAM_LEAD) {
      return allClients.filter((l) => l.assignedToTeam === resolvedTeamId);
    }
    return allClients.filter((l) => l.assignedToAgent === staff.id);
  }, [data?.clients, staff, resolvedOfficeId, resolvedTeamId]);

  const filteredClients = useMemo(() => {
    return staffClients.filter((client) => {
      const stage = normalizeStage(client.stage);
      if (clientstageFilter && stage !== clientstageFilter) return false;
      if (!clientsearch.trim()) return true;
      const q = clientsearch.toLowerCase();
      return (
        `${client.firstName || ''} ${client.lastName || ''}`.toLowerCase().includes(q) ||
        (client.email || '').toLowerCase().includes(q) ||
        (client.phone || '').toLowerCase().includes(q) ||
        (client.country || '').toLowerCase().includes(q) ||
        stage.toLowerCase().includes(q)
      );
    });
  }, [staffClients, clientsearch, clientstageFilter]);

  const depositsCount = staffClients.filter((l) => l.stage === 'Deposit').length;
  const contactedCount = staffClients.filter(
    (l) => Array.isArray(l.commentHistory) && l.commentHistory.length > 0
  ).length;
  const conversionRate =
    staffClients.length > 0 ? ((depositsCount / staffClients.length) * 100).toFixed(1) : '0.0';

  const staffComments = useMemo(() => {
    if (!staff?.name) return [];
    const allClients = data?.clients || [];
    const list = [];
    allClients.forEach((client) => {
      (client.commentHistory || []).forEach((c) => {
        if (c && (c.by === staff.name || c.author === staff.name)) {
          list.push({
            ...c,
            clientId: client.id,
            clientName:
              `${client.firstName || ''} ${client.lastName || ''}`.trim() || client.name || 'Client',
          });
        }
      });
    });
    return list.slice(-40).reverse();
  }, [data?.clients, staff?.name]);

  if (!staff) {
    return (
      <div className="crm-card crm-agent-profile-full">
        <div className="crm-panel-header">
          <button className="crm-small-btn" onClick={() => navigate(workspacePath)}>
            ← Back to Staff
          </button>
        </div>
        <div className="crm-inline-ef0f5edcf4">
          Staff member not found or has been removed.
        </div>
      </div>
    );
  }

  const copyText = async (val, msg = 'Copied to clipboard') => {
    if (!val) return;
    try {
      await navigator.clipboard.writeText(val);
      showNotification?.(msg);
    } catch {
      showNotification?.('Copy failed, please copy manually.');
    }
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
    setNewPassword(pwd);
    setShowPassword(true);
  };

  const handleSaveDetails = async () => {
    const trimmedName = editName.trim();
    const trimmedEmail = editEmail.trim();
    const trimmedOfficeName = editOfficeName.trim();
    const trimmedTeamName = editTeamName.trim();

    if (!isVirtual && !trimmedName) {
      showNotification?.('Staff name cannot be empty.');
      return;
    }

    setSavingDetails(true);
    try {
      // 1. If Office Manager and office exists, save office name if changed
      if (staff.role === ROLE.OFFICE_MANAGER && officeObj && trimmedOfficeName) {
        if (setData) {
          setData((prev) => ({
            ...prev,
            offices: (prev.offices || []).map((o) =>
              o.id === officeObj.id ? { ...o, name: trimmedOfficeName } : o
            ),
          }));
        }
        updateOffice(officeObj.id, { name: trimmedOfficeName }).catch((err) => {
          console.error('[StaffProfilePage] updateOffice failed', err);
        });
      }

      // 2. If Team Leader and team exists, save team name, maxSize, officeId
      if (staff.role === ROLE.TEAM_LEAD && teamObj && trimmedTeamName) {
        const teamPayload = {
          name: trimmedTeamName,
          ...(editTeamMaxSize !== '' ? { maxSize: Number(editTeamMaxSize) } : {}),
          ...(editOfficeId ? { officeId: editOfficeId } : {}),
        };
        if (setData) {
          setData((prev) => ({
            ...prev,
            teams: (prev.teams || []).map((t) =>
              t.id === teamObj.id ? { ...t, ...teamPayload } : t
            ),
          }));
        }
        updateTeam(teamObj.id, teamPayload).catch((err) => {
          console.error('[StaffProfilePage] updateTeam failed', err);
        });
      }

      // 3. Save staff account details if not virtual
      if (!isVirtual) {
        let nextOfficeId = editOfficeId || null;
        const nextTeamId = editTeamId || null;
        if (nextTeamId) {
          const foundTeam = (data?.teams || []).find((t) => t.id === nextTeamId);
          if (foundTeam?.officeId) nextOfficeId = foundTeam.officeId;
        }
        const updates = {
          name: trimmedName,
          email: trimmedEmail,
          officeId: nextOfficeId,
          teamId: nextTeamId,
        };

        if (setData) {
          setData((prev) => ({
            ...prev,
            users: (prev.users || []).map((u) => (u.id === staff.id ? { ...u, ...updates } : u)),
          }));
        }
        const updated = await updateStaffApi(staff.id, updates);
        if (setData && updated) {
          setData((prev) => ({
            ...prev,
            users: (prev.users || []).map((u) =>
              u.id === staff.id ? { ...u, ...updates, ...updated } : u
            ),
          }));
        }
      }

      showNotification?.('Profile and organization settings updated.');
    } catch (err) {
      console.error('[StaffProfilePage] handleSaveDetails failed', err);
      showNotification?.('Profile saved locally.');
    } finally {
      setSavingDetails(false);
    }
  };

  const handleSavePassword = async () => {
    if (isVirtual) return;
    const pwd = newPassword.trim();
    if (!pwd) {
      showNotification?.('Enter or generate a password first.');
      return;
    }
    setSavingPassword(true);
    if (setData) {
      setData((prev) => ({
        ...prev,
        users: (prev.users || []).map((u) => (u.id === staff.id ? { ...u, password: pwd } : u)),
      }));
    }
    try {
      const updated = await updateStaffApi(staff.id, { password: pwd });
      if (setData && updated) {
        setData((prev) => ({
          ...prev,
          users: (prev.users || []).map((u) =>
            u.id === staff.id ? { ...u, ...updated, password: updated.password || pwd } : u
          ),
        }));
      }
      setNewPassword('');
      showNotification?.(`Password updated for ${staff.name}.`);
    } catch (err) {
      console.error('[StaffProfilePage] handleSavePassword failed', err);
      showNotification?.('Could not save password on the server.');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleToggleBlock = async () => {
    if (isVirtual) return;
    if (typeof toggleStaffBlocked === 'function') {
      const updated = await toggleStaffBlocked(staff.id, isBlocked);
      if (updated) {
        const nowBlocked = updated.status === 'Suspended' || updated.status === 'Disabled';
        showNotification?.(`${staff.name} has been ${nowBlocked ? 'blocked' : 'unblocked'}.`);
      }
      return;
    }
    try {
      const fn = isBlocked ? unblockStaffApi : blockStaffApi;
      const updated = await fn(staff.id);
      if (setData && updated) {
        setData((prev) => ({
          ...prev,
          users: (prev.users || []).map((u) =>
            u.id === staff.id ? { ...u, status: updated.status } : u
          ),
        }));
      }
      showNotification?.(`${staff.name} has been ${isBlocked ? 'unblocked' : 'blocked'}.`);
    } catch (err) {
      showNotification?.(err?.message || 'Could not update staff status.');
    }
  };

  const handleDeleteStaff = async () => {
    if (isVirtual) return;
    const ok = await confirm({
      title: 'Delete staff member permanently?',
      message: `Delete "${staff.name}" (${staff.role})? Their account will be permanently removed and their assigned clients will return to the pool.`,
      confirmLabel: 'Delete permanently',
      tone: 'danger',
    });
    if (!ok) return;
    if (setData) {
      setData((prev) => ({
        ...prev,
        users: (prev.users || []).filter((u) => u.id !== staff.id),
        clients: (prev.clients || []).map((l) =>
          l.assignedToAgent === staff.id
            ? {
                ...l,
                assignedToAgent: null,
                assignedAgentName: null,
              }
            : l
        ),
      }));
    }
    showNotification?.(`${staff.name} deleted. Returning to staff list.`);
    deleteStaffApi(staff.id).catch((err) => {
      console.error('[StaffProfilePage] deleteStaffApi failed', err);
    });
    navigate(workspacePath);
  };

  const handleDeleteOffice = async () => {
    if (!officeObj) return;
    const ok = await confirm({
      title: 'Delete office permanently?',
      message: `Delete "${officeObj.name}"? All staff in this office and their teams will be permanently deleted. Their clients will return to the unassigned pool.`,
      confirmLabel: 'Delete office',
      tone: 'danger',
    });
    if (!ok) return;
    const officeStaffIds = (data?.users || [])
      .filter((u) => u.officeId === officeObj.id)
      .map((u) => u.id);
    const officeTeamIds = (data?.teams || [])
      .filter((t) => t.officeId === officeObj.id)
      .map((t) => t.id);

    if (setData) {
      setData((prev) => ({
        ...prev,
        offices: (prev.offices || []).filter((o) => o.id !== officeObj.id),
        teams: (prev.teams || []).filter((t) => t.officeId !== officeObj.id),
        users: (prev.users || []).filter((u) => u.officeId !== officeObj.id),
        clients: (prev.clients || []).map((l) =>
          officeStaffIds.includes(l.assignedToAgent) ||
          officeTeamIds.includes(l.assignedToTeam) ||
          l.assignedToOffice === officeObj.id
            ? {
                ...l,
                assignedToAgent: null,
                assignedToTeam: null,
                assignedToOffice: null,
                assignedAgentName: null,
                assignedTeamName: null,
                assignedOfficeName: null,
              }
            : l
        ),
      }));
    }
    showNotification?.(`Office "${officeObj.name}" and its staff deleted.`);
    deleteOffice(officeObj.id).catch((err) => {
      console.error('[StaffProfilePage] deleteOffice failed', err);
    });
    navigate(workspacePath);
  };

  const handleDeleteTeam = async () => {
    if (!teamObj) return;
    const ok = await confirm({
      title: 'Delete team permanently?',
      message: `Delete "${teamObj.name}"? All staff in this team will be permanently deleted. Their clients will return to the unassigned pool.`,
      confirmLabel: 'Delete team',
      tone: 'danger',
    });
    if (!ok) return;
    const teamStaffIds = (data?.users || [])
      .filter((u) => u.teamId === teamObj.id)
      .map((u) => u.id);

    if (setData) {
      setData((prev) => ({
        ...prev,
        teams: (prev.teams || []).filter((t) => t.id !== teamObj.id),
        users: (prev.users || []).filter((u) => u.teamId !== teamObj.id),
        clients: (prev.clients || []).map((l) =>
          teamStaffIds.includes(l.assignedToAgent) || l.assignedToTeam === teamObj.id
            ? {
                ...l,
                assignedToAgent: null,
                assignedToTeam: null,
                assignedToOffice: null,
                assignedAgentName: null,
                assignedTeamName: null,
                assignedOfficeName: null,
              }
            : l
        ),
      }));
    }
    showNotification?.(`Team "${teamObj.name}" and its staff deleted.`);
    deleteTeam(teamObj.id).catch((err) => {
      console.error('[StaffProfilePage] deleteTeam failed', err);
    });
    navigate(workspacePath);
  };

  const handclientdStaffNote = async () => {
    const text = staffNoteInput.trim();
    if (!text || !staff?.id || staffNoteSaving) return;
    setStaffNoteSaving(true);
    setStaffNoteError('');
    try {
      const result = await addStaffNoteAdmin(staff.id, text);
      if (result?.note) setStaffNotes((previous) => [result.note, ...previous]);
      setStaffNoteInput('');
      showNotification?.('Staff note saved.');
    } catch (error) {
      setStaffNoteError(error.message || 'Staff note could not be saved.');
      showNotification?.(error.message || 'Staff note could not be saved.');
    } finally {
      setStaffNoteSaving(false);
    }
  };

  const pwStrength = computePasswordStrength(newPassword);

  return (
    <>
      {confirmDialog}
      <div className="crm-card crm-agent-profile-full">
        {/* Top Navigation Header */}
        <div className="crm-panel-header">
          <div className="crm-nav-left">
            <button
              className="crm-small-btn"
              onClick={() => {
                navigate(workspacePath);
              }}
            >
              ← Back to Staff
            </button>
          </div>
          <div className="crm-nav-right">
            <button
              className="crm-small-btn"
              onClick={() =>
                prevStaff &&
                navigate(getStaffProfilePath(role, currentUser?.id || userId, prevStaff.id), {
                  state: location.state,
                })
              }
              disabled={!prevStaff}
            >
              ◀ Prev Staff
            </button>
            <button
              className="crm-small-btn"
              onClick={() =>
                nextStaff &&
                navigate(getStaffProfilePath(role, currentUser?.id || userId, nextStaff.id), {
                  state: location.state,
                })
              }
              disabled={!nextStaff}
            >
              Next Staff ▶
            </button>
          </div>
        </div>

        {/* Hero Title & Action Bar */}
        <div
          className="crm-section-title crm-inline-91c912957d"

        >
          <div className="crm-inline-1116813922">
            <div className="crm-inline-560698d32c">
              {!isVirtual && (
                <>
                  <span
                    className="crm-inline-37e853796e" style={{background: staff.isLoggedIn ? '#0ECB81' : 'var(--crm-text-secondary)'}}
                  />
                  <span
                    className="crm-inline-f92d9147b8" style={{color: staff.isLoggedIn ? '#0ECB81' : 'var(--crm-text-secondary)'}}
                  >
                    {staff.isLoggedIn ? 'Online' : 'Offline'}
                  </span>
                </>
              )}
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 4,
                  ...(ROLE_BADGE_STYLE[staff.role] || ROLE_BADGE_STYLE[ROLE.AGENT]),
                }}
              >
                {staff.role}
              </span>
              <span className={`crm-badge ${isBlocked ? 'crm-badge-danger' : 'crm-badge-success'}`}>
                {isVirtual ? 'Unassigned Account' : isBlocked ? 'Blocked' : 'Active'}
              </span>
            </div>
            <h2 className="crm-inline-ff227d0632">
              {staff.role === ROLE.OFFICE_MANAGER
                ? `Office & Manager Profile: ${staff.name}`
                : staff.role === ROLE.TEAM_LEAD
                ? `Team & leader Profile: ${staff.name}`
                : `Staff Profile: ${staff.name}`}
            </h2>
            {(officeObj || teamObj) && (
              <div className="crm-inline-11a36a1624">
                {officeObj ? `Office: ${officeObj.name}` : ''}
                {officeObj && teamObj ? ' · ' : ''}
                {teamObj ? `Team: ${teamObj.name}` : ''}
              </div>
            )}
          </div>

          {!isVirtual && (
            <div className="crm-inline-d300a8a829">
              <button
                className="crm-small-btn crm-action-btn crm-login-btn crm-inline-93c6e1d4bb"

                onClick={() =>
                  navigate(panelPath, {
                    state: {
                      returnTo: getStaffProfilePath(role, currentUser?.id || userId, staff.id),
                      returnLabel: `Back to ${staff.name}'s Profile`,
                      impersonatedFrom: currentUser?.id,
                    },
                  })
                }
              >
                ↗ View {staff.role} Workspace Panel
              </button>
            </div>
          )}

          <div className="crm-profile-action-buttons">
            {!isVirtual && (
              <button
                type="button"
                className="crm-action-btn crm-activity-btn crm-inline-fe1f5a1141"
                onClick={() => setCommunicationOpen(true)}
                title="Email, WhatsApp or call this staff member"

              >
                ✦ Contact
              </button>
            )}
            {!isVirtual && (
              <button
                type="button"
                className="crm-action-btn crm-activity-btn"
                onClick={() => copyText(loginLink, 'Login link copied to clipboard')}
                title="Copy staff login link"
              >
                🔗 Copy Login Link
              </button>
            )}
            <button
              type="button"
              className="crm-action-btn crm-appointment-btn"
              onClick={() => nameInputRef.current?.focus()}
              title="Edit profile and organization details"
            >
              ✏️ Edit Profile
            </button>
            {!isVirtual && (
              <>
                <button
                  type="button"
                  className="crm-action-btn crm-security-btn"
                  onClick={() => passwordInputRef.current?.focus()}
                  title="Change staff password"
                >
                  🔑 Change Password
                </button>
                <button
                  type="button"
                  className="crm-action-btn crm-support-btn"
                  onClick={handleToggleBlock}
                  title={isBlocked ? 'Unblock staff account' : 'Block staff account'}
                >
                  {isBlocked ? '🔓 Unblock Staff' : '🔒 Block Staff'}
                </button>
              </>
            )}
            {!isVirtual && typeof setUserLoginState === 'function' && (
              <button
                type="button"
                className="crm-action-btn crm-inline-1299348af8"

                onClick={() => {
                  setUserLoginState(staff.id, !staff.isLoggedIn);
                  showNotification?.(
                    staff.isLoggedIn ? `${staff.name} set offline.` : `${staff.name} set online.`
                  );
                }}
              >
                {staff.isLoggedIn ? '○ Set Offline' : '● Set Online'}
              </button>
            )}
            {!isVirtual && (
              <button
                type="button"
                className="crm-action-btn crm-inline-3bac55ef62"

                onClick={handleDeleteStaff}
                title="Delete staff account"
              >
                🗑 Delete Staff Account
              </button>
            )}
            {staff.role === ROLE.OFFICE_MANAGER && officeObj && (
              <button
                type="button"
                className="crm-action-btn crm-inline-018fdb0025"

                onClick={handleDeleteOffice}
                title="Delete entire office and its teams/staff"
              >
                🏢 Delete Entire Office
              </button>
            )}
            {staff.role === ROLE.TEAM_LEAD && teamObj && (
              <button
                type="button"
                className="crm-action-btn crm-inline-018fdb0025"

                onClick={handleDeleteTeam}
                title="Delete entire team and its staff"
              >
                👥 Delete Entire Team
              </button>
            )}
          </div>
        </div>

        {/* Quick Direct Contact & Link Bar */}
        {!isVirtual && (
          <div className="crm-inline-aad9ec8e0d">
            <button type="button" onClick={() => setCommunicationOpen(true)} title="Email, WhatsApp or call this staff member" className="crm-inline-48c69ee053"><span className="crm-inline-919a0cc6ec">✦</span>Contact</button>
            {staff.email && (
              <a
                href={`mailto:${staff.email}`}
                className="crm-inline-f427bbe513"
              >
                <span>✉ Email: {staff.email}</span>
              </a>
            )}
            <button
              type="button"
              onClick={() => copyText(loginLink, 'Login link copied to clipboard')}
              className="crm-inline-16393abc1e"
            >
              <span>🔗 Login URL: {loginLink}</span>
            </button>
          </div>
        )}

        {/* 3-Column Detail Grid */}
        <div className="crm-detail-grid crm-detail-grid-three">
          <div className="crm-detail-column">
            <div className="crm-detail-row">
              <span className="crm-label">Staff ID</span>
              <span className="crm-value crm-inline-a9351770dd" >
                {staff.id}{' '}
                <button
                  type="button"
                  className="crm-copy-icon"
                  onClick={() => copyText(staff.id, 'Staff ID copied')}
                  aria-label="Copy staff ID"
                >
                  📋
                </button>
              </span>
            </div>
            <div className="crm-detail-row">
              <span className="crm-label">Name</span>
              <span className="crm-value">{staff.name}</span>
            </div>
            <div className="crm-detail-row">
              <span className="crm-label">Email</span>
              <span className="crm-value">
                {staff.email || '-'}{' '}
                {staff.email && (
                  <button
                    type="button"
                    className="crm-copy-icon"
                    onClick={() => copyText(staff.email, 'Email copied')}
                    aria-label="Copy email"
                  >
                    📋
                  </button>
                )}
              </span>
            </div>
            <div className="crm-detail-row">
              <span className="crm-label">Role</span>
              <span className="crm-value crm-inline-6227f2a3a1" >
                {staff.role}
              </span>
            </div>
            <div className="crm-detail-row">
              <span className="crm-label">Status</span>
              <span className="crm-value">
                <span className={`crm-badge ${isBlocked ? 'crm-badge-danger' : 'crm-badge-success'}`}>
                  {isVirtual ? 'Unassigned' : isBlocked ? 'Blocked' : 'Active'}
                </span>
              </span>
            </div>
          </div>

          <div className="crm-detail-column">
            <div className="crm-detail-row">
              <span className="crm-label">Office</span>
              <span className="crm-value">{officeName}</span>
            </div>
            {staff.role === ROLE.OFFICE_MANAGER ? (
              <>
                <div className="crm-detail-row">
                  <span className="crm-label">Teams in Office</span>
                  <span className="crm-value">{officeTeams.length}</span>
                </div>
                <div className="crm-detail-row">
                  <span className="crm-label">Agents in Office</span>
                  <span className="crm-value">{officeAgents.length}</span>
                </div>
              </>
            ) : (
              <>
                <div className="crm-detail-row">
                  <span className="crm-label">Team</span>
                  <span className="crm-value">{teamName}</span>
                </div>
                {staff.role === ROLE.TEAM_LEAD && (
                  <div className="crm-detail-row">
                    <span className="crm-label">Team Capacity</span>
                    <span className="crm-value">
                      {teamAgents.length} / {teamObj?.maxSize || '-'} Agents
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="crm-detail-row">
              <span className="crm-label">Presence</span>
              <span
                className="crm-value crm-inline-5c05f4afaf"
                 style={{color: staff.isLoggedIn ? '#0ECB81' : 'var(--crm-text-secondary)'}}
              >
                {staff.isLoggedIn ? '● Online' : '○ Offline'}
              </span>
            </div>
            <div className="crm-detail-row">
              <span className="crm-label">Last Login</span>
              <span className="crm-value">
                {staff.lastLoginAt ? new Date(staff.lastLoginAt).toLocaleString() : 'Never'}
              </span>
            </div>
          </div>

          <div className="crm-detail-column">
            <div className="crm-detail-row">
              <span className="crm-label">
                {staff.role === ROLE.OFFICE_MANAGER
                  ? 'Office Clients'
                  : staff.role === ROLE.TEAM_LEAD
                  ? 'Team Clients'
                  : 'Assigned Clients'}
              </span>
              <span className="crm-value crm-inline-b35d4ae3d1" >
                {staffClients.length}
              </span>
            </div>
            <div className="crm-detail-row">
              <span className="crm-label">Total Deposits</span>
              <span className="crm-value crm-inline-8b99a5d80d" >
                {depositsCount}
              </span>
            </div>
            <div className="crm-detail-row">
              <span className="crm-label">Conversion Rate</span>
              <span className="crm-value crm-inline-6227f2a3a1" >
                {conversionRate}%
              </span>
            </div>
            <div className="crm-detail-row">
              <span className="crm-label">Contacted Clients</span>
              <span className="crm-value">{contactedCount}</span>
            </div>
            <div className="crm-detail-row">
              <span className="crm-label">Comments Logged</span>
              <span className="crm-value">{staffComments.length}</span>
            </div>
          </div>
        </div>

        {/* Main Two-Column Profile Workspace */}
        <div className="crm-profile-grid crm-inline-5fa693f3d4" >
          {/* Left Column: Edit Profile & Office/Team, Password & Security, Capabilities, Supervision Notes */}
          <div className="crm-profile-column crm-comment-column">
            {/* Profile & Organization Editor */}
            <div className="crm-comment-card crm-inline-eb7e8501e1" >
              <h3>
                {staff.role === ROLE.OFFICE_MANAGER
                  ? '✏️ Edit Office & Manager Profile'
                  : staff.role === ROLE.TEAM_LEAD
                  ? '✏️ Edit Team & Team Leader Profile'
                  : '✏️ Edit Staff Profile & Assignment'}
              </h3>
              <div className="crm-inline-eb3ab37567">
                {staff.role === ROLE.OFFICE_MANAGER && officeObj && (
                  <div>
                    <label className="crm-inline-f759d16a31">
                      Office Name
                    </label>
                    <input
                      className="crm-super-admin-input"
                      type="text"
                      value={editOfficeName}
                      onChange={(e) => setEditOfficeName(e.target.value)}
                      placeholder="Office name..."
                    />
                  </div>
                )}

                {staff.role === ROLE.TEAM_LEAD && teamObj && (
                  <div className="crm-inline-8428e25c30">
                    <div>
                      <label className="crm-inline-bd465901b9">
                        Team Name
                      </label>
                      <input
                        className="crm-super-admin-input"
                        type="text"
                        value={editTeamName}
                        onChange={(e) => setEditTeamName(e.target.value)}
                        placeholder="Team name..."
                      />
                    </div>
                    <div>
                      <label className="crm-inline-bd465901b9">
                        Max Agents
                      </label>
                      <input
                        className="crm-super-admin-input"
                        type="number"
                        min="1"
                        value={editTeamMaxSize}
                        onChange={(e) => setEditTeamMaxSize(e.target.value)}
                        placeholder="e.g. 10"
                      />
                    </div>
                  </div>
                )}

                {!isVirtual && (
                  <>
                    <div>
                      <label className="crm-inline-a756887d09">
                        {staff.role === ROLE.OFFICE_MANAGER
                          ? 'Manager Full Name'
                          : staff.role === ROLE.TEAM_LEAD
                          ? 'Team Leader Full Name'
                          : 'Staff Full Name'}
                      </label>
                      <input
                        ref={nameInputRef}
                        className="crm-super-admin-input"
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Full name..."
                      />
                    </div>
                    <div>
                      <label className="crm-inline-a756887d09">
                        Email Address
                      </label>
                      <input
                        className="crm-super-admin-input"
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        placeholder="email@codexdynamics.com"
                      />
                    </div>
                  </>
                )}

                <div
                  className="crm-inline-3f73082e13" style={{gridTemplateColumns: staff.role === ROLE.OFFICE_MANAGER ? '1fr' : '1fr 1fr'}}
                >
                  <div>
                    <label className="crm-inline-a756887d09">
                      Assigned Office
                    </label>
                    <select
                      className="crm-super-admin-select"
                      value={editOfficeId}
                      onChange={(e) => {
                        setEditOfficeId(e.target.value);
                        if (staff.role === ROLE.AGENT) setEditTeamId('');
                      }}
                    >
                      <option value="">- Unassigned -</option>
                      {(data?.offices || []).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {staff.role !== ROLE.OFFICE_MANAGER && (
                    <div>
                      <label className="crm-inline-a756887d09">
                        Assigned Team
                      </label>
                      <select
                        className="crm-super-admin-select"
                        value={editTeamId}
                        onChange={(e) => {
                          const nextTeam = e.target.value;
                          setEditTeamId(nextTeam);
                          if (nextTeam) {
                            const t = (data?.teams || []).find((team) => team.id === nextTeam);
                            if (t?.officeId) setEditOfficeId(t.officeId);
                          }
                        }}
                      >
                        <option value="">- Unassigned -</option>
                        {(data?.teams || [])
                          .filter((t) => !editOfficeId || t.officeId === editOfficeId)
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({getOfficeName(t.officeId, data?.offices || [])})
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="crm-inline-9a325a2ee1">
                  <button
                    type="button"
                    className="crm-post-comment-btn"
                    disabled={savingDetails || (!isVirtual && !editName.trim())}
                    onClick={handleSaveDetails}
                  >
                    {savingDetails ? 'Saving...' : '✓ Save Profile Changes'}
                  </button>
                </div>
              </div>
            </div>

            {/* Security & Password Card */}
            {!isVirtual && (
              <div className="crm-comment-card crm-inline-eb7e8501e1" >
                <h3>🔑 Security, Password &amp; Account Access</h3>
                <div className="crm-inline-eb3ab37567">
                  <div className="crm-inline-13efe9dc7b">
                    <span className="crm-inline-37d0b7ce9d">Change Password</span>
                    <button
                      type="button"
                      className="crm-pw-generate crm-inline-721f715817"
                      onClick={generateStrongPassword}

                    >
                      ⚡ Generate Strong Password
                    </button>
                  </div>
                  <div className="crm-inline-54a4986ffc">
                    <input
                      ref={passwordInputRef}
                      className="crm-super-admin-input crm-inline-ee3d55bf99"
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter or generate new password..."
                      autoComplete="new-password"

                    />
                    <button
                      type="button"
                      className="crm-small-btn"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {newPassword && (
                    <div className="crm-inline-a81558e644">
                      Strength: <strong className="crm-inline-47f1c3c9f1">{pwStrength.label}</strong> (
                      {newPassword.length} chars)
                    </div>
                  )}
                  <div className="crm-inline-469958b769">
                    <button
                      type="button"
                      className={`crm-staff-action-btn ${isBlocked ? 'btn-unblock' : 'btn-block'}`}
                      onClick={handleToggleBlock}
                    >
                      {isBlocked ? '🔓 Unblock Account' : '🔒 Block Account'}
                    </button>
                    <button
                      type="button"
                      className="crm-post-comment-btn"
                      disabled={savingPassword || !newPassword.trim()}
                      onClick={handleSavePassword}
                    >
                      {savingPassword ? 'Updating...' : 'Update Password'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Capabilities Card */}
            {!isVirtual && (
              <div className="crm-comment-card crm-inline-eb7e8501e1" >
                <h3>🛡️ CRM Capabilities &amp; Permissions</h3>
                <div
                  className="crm-inline-8097ad963a"
                >
                  {Object.entries(catalog).map(([key, label]) => (
                    <label
                      key={key}
                      className="crm-inline-bc25a04314"
                    >
                      <input
                        type="checkbox"
                        checked={!!capabilities[key]}
                        onChange={(e) => {
                          setCapabilities((prev) => ({ ...prev, [key]: e.target.checked }));
                          setCapDirty(true);
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <div className="crm-inline-9a325a2ee1">
                  <button
                    type="button"
                    className="crm-post-comment-btn"
                    disabled={!capDirty}
                    onClick={async () => {
                      try {
                        await updateStaffCapabilities(staff.id, capabilities);
                        if (typeof window !== 'undefined') {
                          window.dispatchEvent(
                            new CustomEvent('codex-capabilities-updated', {
                              detail: { staffId: staff.id, capabilities },
                            })
                          );
                        }
                      } catch {}
                      setCapDirty(false);
                      showNotification?.(`Capabilities updated for ${staff.name}.`);
                    }}
                  >
                    Save Capabilities
                  </button>
                </div>
              </div>
            )}

            {/* Staff Supervision Notes */}
            <div className="crm-comment-card">
              <h3>📝 Staff Supervision Notes</h3>
              {staffNotesLoading && <p role="status">Loading saved notes…</p>}
              {staffNoteError && <p role="alert" className="crm-error-text">{staffNoteError}</p>}
              <div className="crm-comment-input-area">
                <textarea
                  rows={4}
                  value={staffNoteInput}
                  onChange={(e) => setStaffNoteInput(e.target.value)}
                  placeholder={`Add an internal note or performance review note for ${staff.name}...`}
                />
                <div className="crm-comment-input-actions">
                  <button
                    type="button"
                    className="crm-post-comment-btn"
                    onClick={handclientdStaffNote}
                    disabled={!staffNoteInput.trim() || staffNoteSaving}
                  >
                    {staffNoteSaving ? 'Saving…' : 'Save Note'}
                  </button>
                </div>
              </div>
              {staffNotes.length > 0 && (
                <ul className="crm-comment-history-list crm-inline-9c9cee2093" >
                  {staffNotes.map((n) => (
                    <li key={n.id} className="crm-comment-history-item">
                      <div className="crm-comment-meta">
                        <span className="crm-comment-author">{n.by}</span>
                        <span className="crm-comment-date">{n.date}</span>
                      </div>
                      <div className="crm-comment-text">{n.text}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Right Column: Office Teams / Team Agents Roster, Assigned Clients & Activity Timeline */}
          <div className="crm-status-workflow-column">
            {/* For Office Managers: Teams in this Office */}
            {staff.role === ROLE.OFFICE_MANAGER && (
              <div className="crm-status-workflow-card crm-inline-eb7e8501e1" >
                <h3 className="crm-inline-f31d78fc13">
                  🏢 Teams in {officeName} ({officeTeams.length})
                </h3>
                {officeTeams.length === 0 ? (
                  <div className="crm-status-timeline-empty">
                    No teams created in this office yet.
                  </div>
                ) : (
                  <div className="crm-super-admin-table-wrapper crm-inline-783fc28f8d" >
                    <table className="crm-super-admin-table">
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th>Team Leader</th>
                          <th className="crm-inline-72a68ac344">Agents</th>
                          <th className="crm-inline-72a68ac344">Clients</th>
                        </tr>
                      </thead>
                      <tbody>
                        {officeTeams.map((t) => {
                          const tl = (data?.users || []).find(
                            (u) => u.role === ROLE.TEAM_LEAD && u.teamId === t.id
                          );
                          const tAgentsCount = (data?.users || []).filter(
                            (u) => u.role === ROLE.AGENT && u.teamId === t.id
                          ).length;
                          const tClientsCount = (data?.clients || []).filter(
                            (l) => l.assignedToTeam === t.id
                          ).length;
                          const targetStaffId = tl ? tl.id : `team_${t.id}`;
                          return (
                            <tr
                              key={t.id}
                              className="crm-inline-8410c989c9"
                              onClick={() =>
                                navigate(
                                  getStaffProfilePath(role, currentUser?.id || userId, targetStaffId),
                                  { state: location.state }
                                )
                              }
                              title={`Open profile for ${tl ? tl.name : t.name}`}
                            >
                              <td className="crm-inline-5c05f4afaf">{t.name}</td>
                              <td>
                                {tl ? (
                                  <span className="crm-inline-df619690ef">{tl.name}</span>
                                ) : (
                                  <span className="crm-inline-54aeff80c9">Unassigned</span>
                                )}
                              </td>
                              <td className="crm-inline-72a68ac344">
                                {tAgentsCount} / {t.maxSize || '-'}
                              </td>
                              <td className="crm-inline-a067fc1963">
                                {tClientsCount}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {!isVirtual && (
              <div className="crm-inline-4658b9bda2">
                {[
                  { id: 'overview', label: 'Overview', color: '#0A84FF' },
                  { id: 'mailboxes', label: 'Email Accounts', color: '#557894' },
                ].map(tab => <button key={tab.id} type="button" onClick={() => setMailTabOpen(tab.id === 'mailboxes')} className="crm-inline-cacb9b345a" style={{border: '1px solid', borderColor: mailTabOpen ? tab.color : 'var(--crm-border)', background: mailTabOpen ? tab.color : 'rgba(255,255,255,0.05)', color: mailTabOpen ? '#fff' : 'var(--crm-text-secondary)'}}>{tab.label}</button>)}
              </div>
            )}

            {!isVirtual && mailTabOpen && <StaffEmailAccounts staff={staff} staffUsers={(data?.users || []).filter((user) => user.role !== ROLE.SUPER_ADMIN || user.id === currentUser?.id || role === ROLE.SUPER_ADMIN)} />}
            <CommunicationActionModal open={communicationOpen} title={`${staff.name} communication`} account={{ email: staff.email, phone: staff.phone || staff.mobilePhone || staff.phoneNumber }} onClose={() => setCommunicationOpen(false)} />

            {/* For Office Managers or Team Leaders: Agents Roster */}
            {(staff.role === ROLE.OFFICE_MANAGER || staff.role === ROLE.TEAM_LEAD) && (
              <div className="crm-status-workflow-card crm-inline-eb7e8501e1" >
                <h3 className="crm-inline-f31d78fc13">
                  👥 {staff.role === ROLE.OFFICE_MANAGER ? `Agents in ${officeName}` : `Agents in ${teamName}`} (
                  {staff.role === ROLE.OFFICE_MANAGER ? officeAgents.length : teamAgents.length})
                </h3>
                {(staff.role === ROLE.OFFICE_MANAGER ? officeAgents : teamAgents).length === 0 ? (
                  <div className="crm-status-timeline-empty">
                    No agents assigned yet.
                  </div>
                ) : (
                  <div className="crm-super-admin-table-wrapper crm-inline-783fc28f8d" >
                    <table className="crm-super-admin-table">
                      <thead>
                        <tr>
                          <th>Agent</th>
                          {staff.role === ROLE.OFFICE_MANAGER && <th>Team</th>}
                          <th>Status</th>
                          <th className="crm-inline-72a68ac344">Clients</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(staff.role === ROLE.OFFICE_MANAGER ? officeAgents : teamAgents).map((ag) => {
                          const agClients = (data?.clients || []).filter(
                            (l) => l.assignedToAgent === ag.id
                          ).length;
                          const agBlocked = ag.status === 'Suspended' || ag.status === 'Disabled';
                          return (
                            <tr
                              key={ag.id}
                              className="crm-inline-8410c989c9"
                              onClick={() =>
                                navigate(
                                  getStaffProfilePath(role, currentUser?.id || userId, ag.id),
                                  { state: location.state }
                                )
                              }
                              title={`Open profile for ${ag.name}`}
                            >
                              <td className="crm-inline-5c05f4afaf">{ag.name}</td>
                              {staff.role === ROLE.OFFICE_MANAGER && (
                                <td className="crm-inline-54aeff80c9">
                                  {getTeamName(ag.teamId, data?.teams || [])}
                                </td>
                              )}
                              <td>
                                <span
                                  className={`crm-badge ${
                                    agBlocked ? 'crm-badge-danger' : 'crm-badge-success'
                                  }`}
                                >
                                  {agBlocked ? 'Blocked' : ag.isLoggedIn ? 'Online' : 'Active'}
                                </span>
                              </td>
                              <td className="crm-inline-77a5bc2353">
                                {agClients}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Assigned Clients Portfolio */}
            <div className="crm-status-workflow-card crm-inline-eb7e8501e1" >
              <div
                className="crm-inline-a5536978f7"
              >
                <h3 className="crm-inline-ff227d0632">
                  📋{' '}
                  {staff.role === ROLE.OFFICE_MANAGER
                    ? `Office Clients (${filteredClients.length})`
                    : staff.role === ROLE.TEAM_LEAD
                    ? `Team Clients (${filteredClients.length})`
                    : `Assigned Clients (${filteredClients.length})`}
                </h3>
                <div className="crm-inline-f36152c67e">
                  <SearchAutocomplete
                    className="crm-super-admin-input crm-inline-e6129b8c6d"
                    placeholder="Search clients..."
                    value={clientsearch}
                    onChange={setClientsearch}
                    buildSuggestions={(query) => staffClients.filter((client) => [
                      `${client.firstName || ''} ${client.lastName || ''}`, client.email, client.phone, client.country, normalizeStage(client.stage),
                    ].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
                      .slice(0, 8).map((client) => ({
                        key: client.id,
                        value: `${client.firstName || ''} ${client.lastName || ''}`.trim() || client.email || '',
                        label: `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Unnamed client',
                        meta: [client.email, client.phone, client.country].filter(Boolean).join(' · '),
                      }))}
                  />
                  <select
                    className="crm-super-admin-select crm-inline-6d8af9da80"

                    value={clientstageFilter}
                    onChange={(e) => setClientstageFilter(e.target.value)}
                  >
                    <option value="">All Statuses</option>
                    {CLIENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {filteredClients.length === 0 ? (
                <div className="crm-status-timeline-empty">
                  No clients match the current filter for {staff.name}.
                </div>
              ) : (
                <div className="crm-super-admin-table-wrapper crm-inline-8874d40be9" >
                  <table className="crm-super-admin-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Country</th>
                        <th>Status</th>
                        <th>Registered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredClients.slice(0, 50).map((client) => (
                        <tr
                          key={client.id}
                          className="crm-inline-8410c989c9"
                          onClick={() =>
                            navigate(getClientProfilePath(role, currentUser?.id || userId, client.id))
                          }
                          title="Click to open client Client Profile"
                        >
                          <td>
                            <div className="crm-inline-5c05f4afaf">
                              {client.firstName} {client.lastName}
                            </div>
                            <div className="crm-inline-a81558e644">{client.email}</div>
                          </td>
                          <td className="crm-inline-7a459431c4">
                            {getCountryFlag(client.countryCode, client.country)} {client.country || '-'}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <StatusDropdown
                              value={normalizeStage(client.stage)}
                              options={CLIENT_STATUSES}
                              onChange={async (newStage) => {
                                if (updateClient) {
                                  await updateClient(client.id, {
                                    stage: newStage,
                                    status: newStage,
                                    _actorName: currentUser?.name,
                                    _actorId: currentUser?.id,
                                  });
                                  showNotification?.(`Status updated to "${newStage}".`);
                                }
                              }}
                            />
                          </td>
                          <td className="crm-inline-a81558e644">
                            {client.registeredDate || (client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '-')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Staff Activity & Comment History */}
            <div className="crm-status-workflow-card">
              <h3>💬 Client Interactions &amp; Comment History ({staffComments.length})</h3>
              <div className="crm-status-timeline">
                {staffComments.length === 0 ? (
                  <div className="crm-status-timeline-empty">
                    No client comments recorded by {staff.name} yet.
                  </div>
                ) : (
                  staffComments.map((entry, idx) => (
                    <div
                      key={idx}
                      className="crm-status-timeline-row crm-inline-8410c989c9"

                      onClick={() =>
                        entry.clientId &&
                        navigate(getClientProfilePath(role, currentUser?.id || userId, entry.clientId))
                      }
                    >
                      <div
                        className="crm-inline-632acfe46b"
                      >
                        <strong className="crm-inline-95c5939268">
                          Client: {entry.clientName}
                        </strong>
                        <span className="crm-inline-a81558e644">{entry.date || ''}</span>
                      </div>
                      <div className="crm-inline-6b234c5df6">{entry.text}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
