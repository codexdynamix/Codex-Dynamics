import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhoneCall, Send, Trash2 } from 'lucide-react';
import { getClientProfilePath } from '../clientProfileRouting.js';
import { ROLE, getCountryFlag, CLIENT_STATUSES } from '../shared.jsx';
import { portalDb } from '../../../services/portalDatabase';
import { enterClientPortal } from '../clientImpersonation.js';
import {
  getUserProfileHistoryApi,
  adminSetClientPassword,
  getClientPortalPasswordAdmin,
  updateClientApi,
  resetClientstatusApi,
  clearClientStatusHistoryApi,
  clearClientCommentsApi,
  clearProfileHistoryApi,
  deleteProfileHistoryEntryApi,
  deleteClientApi,
  getAdminMessages,
  sendAdminMessage,
  markAdminMessagesRead,
  getAdminChatPresence,
  postAdminPresence,
  deleteAdminClientMessage,
  clearAdminChat,
  getClientSupportTickets,
  replyToClientSupportTicket,
} from '../adminApi.js';
import { useConfirmDialog } from './ConfirmModal/ConfirmModal.jsx';
import { ClientEmailAccounts, CommunicationActionModal } from './HostingerMailAdmin.jsx';
import ClientProfileTabs from './ClientProfileTabs.jsx';
import ClientSupportTickets from './ClientSupportTickets.jsx';

function areSameChatMessages(current, next) {
  return current.length === next.length && current.every((message, index) => {
    const candidate = next[index];
    return message.id === candidate.id
      && message.text === candidate.text
      && message.sender === candidate.sender
      && message.senderName === candidate.senderName
      && message.editedAt === candidate.editedAt
      && message.readAt === candidate.readAt;
  });
}

function formatRelativeTime(dateString) {
  if (!dateString) return 'Just now';
  try {
    const timestamp = new Date(dateString).getTime();
    if (isNaN(timestamp)) return dateString;
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateString;
  }
}

export default function ClientProfileModal({
  client,
  onClose,
  data,
  currentUser,
  setData,
  setClientAssignment,
  showNotification,
}) {
  const navigate = useNavigate();
  const [confirmDialog, confirm] = useConfirmDialog();
  const [deleteMessageTarget, setDeleteMessageTarget] = useState(null);
  const [isDeletingMessage, setIsDeletingMessage] = useState(false);

  const [profileStage, setProfileStage] = useState('');
  const [profileComment, setProfileComment] = useState('');
  const [profileNotes, setProfileNotes] = useState('');
  const [reassignOfficeId, setReassignOfficeId] = useState('');
  const [reassignTeamId, setReassignTeamId] = useState('');
  const [reassignTeamLeaderId, setReassignTeamLeaderId] = useState('');
  const [reassignAgentId, setReassignAgentId] = useState('');

  const [profileViewTab, setProfileViewTab] = useState('overview');
  const [supportView, setSupportView] = useState('chat');
  const [liveClientPassword, setLiveClientPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordLoadError, setPasswordLoadError] = useState('');
  const [showClientPassword, setShowClientPassword] = useState(true);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [portalAccessEnabled, setPortalAccessEnabled] = useState(true);

  // Client Support chat state
  const [chatMessages, setChatMessages] = useState([]);
  const syncChatMessages = (nextMessages) => {
    setChatMessages((current) => areSameChatMessages(current, nextMessages) ? current : nextMessages);
  };
  const [chatInputText, setChatInputText] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatDeleting, setChatDeleting] = useState(false);
  const [chatPresence, setChatPresence] = useState({ clientTyping: false, clientOnline: false });
  const [chatSyncError, setChatSyncError] = useState('');
  const chatTypingTimeoutRef = useRef(null);
  const chatTypingHeartbeatRef = useRef(null);
  const chatTypingActiveRef = useRef(false);
  const chatMessagesEndRef = useRef(null);
  const [supportTickets, setSupportTickets] = useState([]);
  const [supportTicketsLoading, setSupportTicketsLoading] = useState(false);
  const [supportTicketsError, setSupportTicketsError] = useState('');
  const [ticketReplyDrafts, setTicketReplyDrafts] = useState({});
  const [ticketReplyingId, setTicketReplyingId] = useState('');

  // Client Activity state
  const [clientActivityData, setClientActivityData] = useState({ logs: [], stats: { pageViews: 0, sessions: 0, lastLogin: '' } });

  const [profileHistory, setProfileHistory] = useState([]);
  const [profileHistoryLoading, setProfileHistoryLoading] = useState(false);
  const [profileHistoryError, setProfileHistoryError] = useState('');
  const isSuperAdmin = currentUser?.role === ROLE.SUPER_ADMIN;
  const [communicationOpen, setCommunicationOpen] = useState(false);

  useEffect(() => {
    if (!client) return;
    setProfileViewTab('overview');
    setPortalAccessEnabled(client.portalEnabled !== false);
    setProfileStage(client.stage || client.status || 'New');
    setProfileComment(client.comment || '');
    setProfileNotes(client.notes || '');
    setReassignOfficeId(client.assignedToOffice || client.assigned_office_id || '');
    setReassignTeamId(client.assignedToTeam || client.assigned_team_id || '');
    setReassignTeamLeaderId(client.assignedToTeamLeader || client.assigned_team_leader_id || '');
    setReassignAgentId(client.assignedToAgent || client.assigned_agent_id || '');

    setLiveClientPassword('');
    setClientActivityData(portalDb.getClientActivity(client.id));
    setChatMessages([]);
    setSupportTickets([]);
    setSupportTicketsError('');
    setSupportTicketsLoading(true);
    getClientSupportTickets(client.id)
      .then(setSupportTickets)
      .catch((error) => setSupportTicketsError(error?.message || 'Could not load support requests.'))
      .finally(() => setSupportTicketsLoading(false));

    getAdminMessages(client.id, { limit: 200 })
      .then(async (res) => {
        setChatMessages(res?.messages || []);
        if (res?.messages?.some((message) => message.sender === 'client' && !message.readAt)) {
          await markAdminMessagesRead(client.id);
        }
      })
      .catch((error) => {
        showNotification(error?.message || 'Could not load client messages.');
      });

    setProfileHistory([]);
    setProfileHistoryError('');
    setProfileHistoryLoading(true);

    if (client.id) {
      getUserProfileHistoryApi(client.id)
        .then(({ entries }) => {
          setProfileHistory(entries || []);
        })
        .catch((err) => {
          setProfileHistoryError(err?.message || 'Failed to load change history.');
        })
        .finally(() => {
          setProfileHistoryLoading(false);
        });
    } else {
      setProfileHistoryLoading(false);
    }
  }, [client?.id]);

  useEffect(() => {
    if (!client?.id || profileViewTab !== 'chat') return undefined;
    let active = true;
    const syncChat = async () => {
      try {
        const [result, presence] = await Promise.all([
          getAdminMessages(client.id, { limit: 200 }),
          getAdminChatPresence(client.id),
        ]);
        if (!active) return;
        syncChatMessages(result.messages);
        setChatPresence({ clientTyping: presence.clientTyping, clientOnline: presence.clientOnline });
        setChatSyncError('');
        if (result.messages.some((message) => message.sender === 'client' && !message.readAt)) {
          await markAdminMessagesRead(client.id);
        }
      } catch (error) {
        if (active) setChatSyncError(error?.message || 'Chat synchronization is unavailable.');
      }
    };
    void syncChat();
    const timer = window.setInterval(() => void syncChat(), 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
      if (chatTypingTimeoutRef.current) window.clearTimeout(chatTypingTimeoutRef.current);
      if (chatTypingHeartbeatRef.current) window.clearInterval(chatTypingHeartbeatRef.current);
      if (chatTypingActiveRef.current) {
        chatTypingActiveRef.current = false;
        postAdminPresence(client.id, { isTyping: false }).catch((error) => {
          console.error('[ClientProfileModal] Could not clear staff typing presence.', error);
        });
      }
    };
  }, [client?.id, profileViewTab]);

  // Real-time synchronization for Support Chat and password changes
  useEffect(() => {
    if (!client?.id) return;
    const handleChatUpdate = () => {
      getAdminMessages(client.id, { limit: 200 })
        .then((result) => syncChatMessages(result.messages))
        .catch((error) => setChatSyncError(error?.message || 'Could not refresh the client chat.'));
      setClientActivityData(portalDb.getClientActivity(client.id));
    };
    const handlePwdUpdate = (e) => {
      if (e.detail?.clientId === client.id && profileViewTab === 'security') {
        getClientPortalPasswordAdmin(client.id)
          .then(setLiveClientPassword)
          .catch((error) => setPasswordLoadError(error?.message || 'Could not load the saved portal password.'));
      }
    };
    window.addEventListener('cdx_chat_message_received', handleChatUpdate);
    window.addEventListener('cdx_client_password_updated', handlePwdUpdate);
    return () => {
      window.removeEventListener('cdx_chat_message_received', handleChatUpdate);
      window.removeEventListener('cdx_client_password_updated', handlePwdUpdate);
    };
  }, [client?.id, profileViewTab]);

  useEffect(() => {
    if (!client?.id || profileViewTab !== 'security') {
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
  }, [client?.id, profileViewTab]);

  useEffect(() => {
    if (profileViewTab === 'chat' && chatMessagesEndRef.current) {
      chatMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, profileViewTab]);

  const handleSavePassword = async () => {
    const pwd = newPasswordInput.trim();
    if (!pwd || !client?.id) return;
    setIsUpdatingPassword(true);
    try {
      await adminSetClientPassword(client.id, pwd);
      setLiveClientPassword(pwd);
      setNewPasswordInput('');
      setClientActivityData(portalDb.getClientActivity(client.id));
      showNotification('Client portal password updated successfully.');
    } catch (error) {
      showNotification(`Failed to update client portal password: ${error?.message || 'Please try again.'}`);
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleLaunchClientPortal = async () => {
    try {
      await enterClientPortal(client.id);
    } catch (error) {
      showNotification(error?.message || 'Could not launch the client portal.');
    }
  };

  const handleTogglePortalAccess = () => {
    const nextState = !portalAccessEnabled;
    try {
      portalDb.adminTogglePortalAccess(client.id, nextState);
    } catch (_) {}
    setPortalAccessEnabled(nextState);
    fetch('/api/crm/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_portal_access', client_id: client.id, portal_enabled: nextState }),
    }).catch(() => {});
    showNotification(`Client portal access ${nextState ? 'enabled' : 'disabled'} for ${client.name}`);
  };

  const handleSendChatMessage = async (e) => {
    e?.preventDefault?.();
    const text = chatInputText.trim();
    if (!text || !client?.id) return;
    setChatSending(true);
    try {
      updateAdminTyping(false);
      const newMsg = await sendAdminMessage(
        client.id,
        text,
        currentUser?.name || currentUser?.fullName || 'Codex Dynamics Support'
      );
      setChatMessages((prev) => [...prev, newMsg]);
      setChatInputText('');
      showNotification('Message sent to client portal.');
    } catch (error) {
      showNotification(error?.message || 'Could not send the client message.');
    } finally {
      setChatSending(false);
    }
  };

  const updateAdminTyping = (isTyping) => {
    if (chatTypingTimeoutRef.current) window.clearTimeout(chatTypingTimeoutRef.current);
    if (isTyping) {
      if (!chatTypingActiveRef.current) {
        chatTypingActiveRef.current = true;
        postAdminPresence(client.id, { isTyping: true })
          .catch((error) => setChatSyncError(error?.message || 'Could not update chat presence.'));
        chatTypingHeartbeatRef.current = window.setInterval(() => {
          postAdminPresence(client.id, { isTyping: true })
            .catch((error) => setChatSyncError(error?.message || 'Could not update chat presence.'));
        }, 3000);
      }
      chatTypingTimeoutRef.current = window.setTimeout(() => updateAdminTyping(false), 8000);
      return;
    }
    if (chatTypingHeartbeatRef.current) window.clearInterval(chatTypingHeartbeatRef.current);
    chatTypingHeartbeatRef.current = null;
    if (!chatTypingActiveRef.current) return;
    chatTypingActiveRef.current = false;
    postAdminPresence(client.id, { isTyping: false })
      .catch((error) => setChatSyncError(error?.message || 'Could not update chat presence.'));
  };

  const handleDeleteChatMessage = async (message) => {
    setDeleteMessageTarget(message);
  };

  const deleteChatMessage = async (forMe) => {
    if (!deleteMessageTarget || isDeletingMessage) return;
    const message = deleteMessageTarget;
    setIsDeletingMessage(true);
    try {
      await deleteAdminClientMessage(client.id, message.id, { forMe });
      setChatMessages((messages) => messages.filter((item) => item.id !== message.id));
      setDeleteMessageTarget(null);
      showNotification(forMe ? 'Message deleted from your chat.' : 'Message deleted for everyone.');
    } catch (error) {
      showNotification(error?.message || 'Could not delete the chat message.');
    } finally {
      setIsDeletingMessage(false);
    }
  };

  const handleClearClientChat = async () => {
    if (!chatMessages.length || chatDeleting) return;
    const ok = await confirm({
      title: 'Clear this chat for everyone?',
      message: `This permanently deletes all ${chatMessages.length} messages in ${displayName}'s chat from both the CRM and the client portal.`,
      confirmLabel: 'Clear chat for everyone',
      tone: 'danger',
    });
    if (!ok) return;
    setChatDeleting(true);
    try {
      await clearAdminChat(client.id);
      setChatMessages([]);
      showNotification('Chat cleared for both sides.');
    } catch (error) {
      showNotification(error?.message || 'Could not clear the client chat.');
    } finally {
      setChatDeleting(false);
    }
  };

  const handleReplyToSupportTicket = async (ticket) => {
    const text = String(ticketReplyDrafts[ticket.id] || '').trim();
    if (!text || ticketReplyingId) return;
    setTicketReplyingId(ticket.id);
    setSupportTicketsError('');
    try {
      const result = await replyToClientSupportTicket(
        ticket.id,
        text,
        currentUser?.name || currentUser?.fullName || 'Codex Dynamics Support'
      );
      setSupportTickets((tickets) => tickets.map((item) => item.id === ticket.id ? result.ticket : item));
      setTicketReplyDrafts((drafts) => ({ ...drafts, [ticket.id]: '' }));
      showNotification('Reply sent to the client portal.');
    } catch (error) {
      setSupportTicketsError(error?.message || 'Could not send the support reply.');
    } finally {
      setTicketReplyingId('');
    }
  };

  if (!client) return null;

  const profileOffice = data?.offices?.find(
    (o) => o.id === (client.assignedToOffice || client.assigned_office_id)
  );
  const profileTeam = data?.teams?.find(
    (t) => t.id === (client.assignedToTeam || client.assigned_team_id)
  );
  const profileAgent = data?.users?.find(
    (u) => u.id === (client.assignedToAgent || client.assigned_agent_id)
  );
  const profileTeamLeader = data?.users?.find(
    (u) => u.id === (client.assignedToTeamLeader || client.assigned_team_leader_id)
  );
  const hasDirectOfficeAssignment = Boolean(
    (client.assignedToOffice || client.assigned_office_id)
    && !(client.assignedToTeam || client.assigned_team_id)
    && !(client.assignedToTeamLeader || client.assigned_team_leader_id)
    && !(client.assignedToAgent || client.assigned_agent_id)
  );

  const enterClientAccount = async () => {
    if (!client?.id) {
      showNotification('Invalid client.');
      return;
    }
    try {
      await enterClientPortal(client.id);
    } catch (err) {
      console.error('Failed to enter client account:', err);
      showNotification(err?.message || 'Could not enter client account.');
    }
  };

  const saveProfile = async () => {
    if (!client) return;

    if (setClientAssignment) {
      setClientAssignment({
        clientId: client.id,
        officeId: reassignOfficeId || null,
        teamId: reassignTeamId || null,
        teamLeaderId: reassignTeamLeaderId || null,
        agentId: reassignAgentId || null,
      });
    }

    const apiUpdates = {};
    if (profileStage !== (client.stage || client.status)) {
      apiUpdates.stage = profileStage;
    }
    if (profileComment.trim()) {
      apiUpdates.comment = profileComment.trim();
    }
    if (profileNotes !== (client.notes || '')) {
      apiUpdates.notes = profileNotes;
    }

    const now = new Date().toISOString();
    const optimisticHistory = [...(client.commentHistory || [])];
    if (apiUpdates.comment) {
      optimisticHistory.push({
        id: `c_${Date.now()}`,
        author: currentUser?.name || 'Admin',
        text: profileComment.trim(),
        timestamp: now,
      });
    }

    let savedClient = null;
    if (client.id && Object.keys(apiUpdates).length > 0) {
      try {
        savedClient = await updateClientApi(client.id, apiUpdates);
      } catch (err) {
        console.error('[ClientProfileModal] saveProfile failed', err);
        showNotification(err?.message || 'Could not save stage/comment to the server.');
        return;
      }
    }

    if (setData) {
      const updatedClient = {
        ...client,
        ...(savedClient || {}),
        stage: profileStage,
        status: profileStage,
        notes: profileNotes,
        commentHistory: optimisticHistory,
      };
      setData((prev) => ({
        ...prev,
        clients: (prev.clients || []).map((item) =>
          item.id === client.id ? { ...item, ...updatedClient } : item
        ),
      }));
    }

    showNotification(`${client.firstName || client.name || 'Client'} updated.`);
    onClose();
  };

  const unassignClient = () => {
    if (!client) return;
    if (setClientAssignment) {
      setClientAssignment({ clientId: client.id, officeId: null, teamId: null, teamLeaderId: null, agentId: null });
    }
    if (setData) {
      setData((prev) => ({
        ...prev,
        clients: (prev.clients || []).map((l) =>
          l.id === client.id
            ? { ...l, assignedToOffice: null, assignedToTeam: null, assignedToTeamLeader: null, assignedToAgent: null }
            : l
        ),
      }));
    }
    showNotification(`${client.firstName || client.name || 'Client'} returned to pool.`);
    onClose();
  };

  const resetClientstatus = async () => {
    if (!client) return;
    const ok = await confirm({
      title: 'Reset Status Workflow?',
      message: `This will reset "${client.firstName || client.name}" back to New and permanently erase the entire status history. This cannot be undone.`,
      confirmLabel: 'Reset & Erase',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const updated = await resetClientstatusApi(client.id);
      setProfileStage('New');
      if (setData) {
        setData((prev) => ({
          ...prev,
          clients: (prev.clients || []).map((l) => (l.id === updated.id ? { ...l, ...updated, status: 'New', stage: 'New' } : l)),
        }));
      }
      showNotification(`Status reset to New for ${client.firstName || client.name}.`);
    } catch (err) {
      console.error('[ClientProfileModal] resetClientstatus failed', err);
      showNotification('Could not reset status - please try again.');
    }
  };

  const clearClientComments = async () => {
    if (!client) return;
    const ok = await confirm({
      title: 'Delete All Comments?',
      message: `This will permanently delete every comment on "${client.firstName || client.name}"'s profile. This cannot be undone.`,
      confirmLabel: 'Delete All Comments',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const updated = await clearClientCommentsApi(client.id);
      if (setData) {
        setData((prev) => ({
          ...prev,
          clients: (prev.clients || []).map((l) => (l.id === updated.id ? { ...l, ...updated, commentHistory: [] } : l)),
        }));
      }
      showNotification(`All comments deleted for ${client.firstName || client.name}.`);
    } catch (err) {
      console.error('[ClientProfileModal] clearClientComments failed', err);
      showNotification('Could not delete comments - please try again.');
    }
  };

  const clearClientStatusHistory = async () => {
    if (!client) return;
    const ok = await confirm({
      title: 'Clear Status Workflow?',
      message: `Permanently clear the status history for "${client.firstName || client.name}" without changing its current status? This cannot be undone.`,
      confirmLabel: 'Clear Workflow',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const updated = await clearClientStatusHistoryApi(client.id);
      if (setData) {
        setData((prev) => ({
          ...prev,
          clients: (prev.clients || []).map((item) => item.id === updated.id ? { ...item, ...updated } : item),
        }));
      }
      showNotification(`Status workflow cleared for ${client.firstName || client.name}.`);
    } catch (err) {
      console.error('[ClientProfileModal] clearClientStatusHistory failed', err);
      showNotification('Could not clear status workflow - please try again.');
    }
  };

  const deleteClient = async () => {
    if (!client) return;
    const ok = await confirm({
      title: 'Move client to bin?',
      message: `Move "${client.firstName || client.name}" to the recycle bin? You can restore it later from the bin.`,
      confirmLabel: 'Move to bin',
      tone: 'warning',
    });
    if (!ok) return;
    try {
      if (setData) {
        setData((prev) => ({
          ...prev,
          clients: (prev.clients || []).filter((l) => l.id !== client.id),
          deletedClients: [...(prev.deletedClients || []), { ...client, deletedAt: new Date().toISOString() }],
        }));
      }
      await deleteClientApi(client.id);
      showNotification(`Moved "${client.firstName || client.name}" to the recycle bin.`);
      onClose();
    } catch (err) {
      console.error('[ClientProfileModal] deleteClient failed', err);
      showNotification('Could not move client to bin.');
    }
  };

  const displayName = client.name || `${client.firstName || ''} ${client.lastName || ''}`.trim() || 'Client Profile';
  const submissionTime = client.createdAt || client.registeredDate;

  return (
    <>
      <div
        className="crm-inline-26ed0b614e"
        onClick={onClose}
      >
        <div
          className="crm-inline-f0e9e113bb"
          onClick={(e) => e.stopPropagation()}
          style={profileViewTab === 'chat' && supportView === 'tickets'
            ? { maxHeight: 'calc(100dvh - 64px)', overflowY: 'auto' }
            : undefined}
        >
          {/* Header */}
          <div
            className="crm-inline-34c6f8dd5c"
          >
            <div className="crm-inline-6b94054e0a">
              <div className="crm-inline-af625f0d28">
                <span
                  className="crm-inline-37e853796e" style={{background: client.isOnline ? '#30D158' : '#8E8E93'}}
                />
                <span
                  className="crm-inline-f92d9147b8" style={{color: client.isOnline ? '#30D158' : '#8E8E93'}}
                >
                  {client.isOnline ? 'Online' : 'Offline'}
                </span>
                {submissionTime && (
                  <span className="crm-inline-79fb3bf21d">
                    · Customer submission {formatRelativeTime(submissionTime)}
                  </span>
                )}
              </div>
              <h2 className="crm-inline-8f767e5547">
                {displayName}
              </h2>
              <div className="crm-inline-249d39210e">
                {client.email || 'No email'} {client.phone ? ` · ${client.phone}` : ''}
              </div>
            </div>

            <div
              className="crm-inline-efb00f566d"
            >
              <button
                className="crm-button crm-button-primary crm-inline-b2fa82ebe2"
                onClick={() => {
                  onClose();
                  navigate(getClientProfilePath(ROLE.SUPER_ADMIN, currentUser?.id || 'adm_sa', client.id));
                }}
                title="Open the full client profile page"
              >
                Open Profile
              </button>
              <button
                className="crm-button crm-button-secondary crm-inline-ac55a4f70b"
                onClick={enterClientAccount}
                title="Log in directly to this client's portal account (bypassing password)"
              >
                Enter Client Account
              </button>
              <button
                onClick={onClose}
                className="crm-modal-close-btn"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {passwordLoading && <div className="crm-inline-aaa05ead50">Loading saved password…</div>}
            {passwordLoadError && <div role="alert" className="crm-inline-aaa05ead50">{passwordLoadError}</div>}
            {!passwordLoading && !passwordLoadError && !liveClientPassword && (
              <div className="crm-inline-aaa05ead50">No recoverable password is saved. Set a new password to enable viewing.</div>
            )}
          </div>

          {/* Quick Reach Action Bar */}
          <div className="crm-inline-a7d12e2e9b">
            <button type="button" onClick={() => setCommunicationOpen(true)} title="Email, WhatsApp or call this client" className="crm-button crm-button-secondary crm-inline-dc39cd3ee2"><span className="crm-inline-3fa4a03f07">✦</span>Contact</button>
            {client.email && (
              <button
                type="button"
                onClick={() => setCommunicationOpen(true)}
                className="crm-button crm-button-secondary crm-inline-f427bbe513"
                title="Send email"
              >
                <span>✉ Email Customer: {client.email}</span>
              </button>
            )}
            {client.phone && (
              <a
                href={`tel:${client.phone}`}
                className="crm-inline-7ae5c9168f"
                title="Call client"
              >
                <span>☎ Direct Call: {client.phone}</span>
              </a>
            )}
            {client.phone && (
              <a
                href={`sip:${String(client.phone).replace(/[^\d+*#]/g, '')}`}
                aria-label={`Call ${client.firstName || client.name || 'client'} with MicroSIP`}
                title="Open MicroSIP dialer"
                className="crm-inline-5b99afdf5c"
              >
                <PhoneCall size={16} aria-hidden="true" />
              </a>
            )}
            {client.phone && (
              <a
                href={`https://wa.me/${String(client.phone).replace(/[^\d+]/g, '').replace(/^\+/, '')}?text=${encodeURIComponent(`Hi ${client.firstName || client.name || 'there'}, thank you for contacting Codex Dynamics.`)}`}
                target="_blank"
                rel="noreferrer"
                className="crm-inline-90b1bb8b63"
                title="WhatsApp chat"
              >
                <span>💬 WhatsApp Direct</span>
              </a>
            )}
          </div>

          <CommunicationActionModal open={communicationOpen} title={`${client.firstName || client.name || 'Client'} communication`} account={{ email: client.email, phone: client.phone }} clientId={client.id} onClose={() => setCommunicationOpen(false)} />

          {/* Tab Navigation: Profile / Client Security / Client Support / Activity */}
          <ClientProfileTabs
            activeTab={profileViewTab}
            onChange={setProfileViewTab}
            chatCount={chatMessages.length}
            isSuperAdmin={isSuperAdmin}
          />

          {isSuperAdmin && profileViewTab === 'mailboxes' && (
            <ClientEmailAccounts client={client} clients={data?.clients || []} />
          )}

          {/* TAB 1: CLIENT SECURITY */}
          {profileViewTab === 'security' && (
            <div className="crm-inline-c1514e7501">
              <div className="crm-inline-29145742ca">
                <div>
                  <h3 className="crm-inline-ea6402deab">
                    🔒 Client Account Security &amp; Credentials
                  </h3>
                  <p className="crm-inline-a172100265">
                    Administrators can view current client portal passwords and set new passwords when clients experience login issues.
                  </p>
                </div>
                <div className="crm-inline-2a907996ec">
                  <button
                    type="button"
                    onClick={handleTogglePortalAccess}
                    className={`crm-button ${portalAccessEnabled ? 'crm-button-success' : 'crm-button-danger'} crm-inline-500966de65`}
                  >
                    {portalAccessEnabled ? '● Portal Enabled' : '○ Portal Suspended'}
                  </button>
                  <button
                    type="button"
                    onClick={handleLaunchClientPortal}
                    className="crm-button crm-button-primary crm-inline-f1e2227876"
                  >
                    <span>🚀 Launch Portal As Client</span>
                  </button>
                </div>
              </div>

              <div className="crm-inline-5e3f1399c2">
                {/* Account Details */}
                <div className="crm-inline-0607761b0b">
                  <div className="crm-inline-082a0a014b">
                    Portal Username / Login Email
                  </div>
                  <div className="crm-inline-8b8fad54a4">
                    <span>{client.email || 'No email assigned'}</span>
                    {client.email && (
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(client.email); showNotification('Email copied to clipboard'); }}
                        className="crm-button crm-button-quiet crm-inline-51d8320d08"
                      >
                        Copy
                      </button>
                    )}
                  </div>
                </div>

                {/* Current Password with Show/Hide & Copy */}
                <div className="crm-inline-0607761b0b">
                  <div className="crm-inline-aaa05ead50">
                    Current Portal Password
                  </div>
                  <div className="crm-inline-9484aff0bd">
                    <input
                      type={showClientPassword ? 'text' : 'password'}
                      readOnly
                      value={liveClientPassword || ''}
                      placeholder="No password set"
                      className="crm-inline-dcce350b6b"
                    />
                    <button
                      type="button"
                      onClick={() => setShowClientPassword(!showClientPassword)}
                      className="crm-button crm-button-quiet crm-inline-6951103dc5"
                    >
                      {showClientPassword ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(liveClientPassword || '');
                        setPasswordCopied(true);
                        setTimeout(() => setPasswordCopied(false), 2000);
                        showNotification('Password copied to clipboard');
                      }}
                      className="crm-button crm-button-quiet crm-inline-f4e20b9f15"
                    >
                      {passwordCopied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Set New Password Form */}
              <div className="crm-inline-c379d3e305">
                <label className="crm-inline-b525a58c08">
                  Set New Password For Client Account
                </label>
                <div className="crm-inline-a92a09d3d7">
                  <input
                    type="text"
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    placeholder="Enter new password (e.g. client2026!)..."
                    className="crm-inline-2570eaea0e"
                  />
                  <button
                    type="button"
                    onClick={handleSavePassword}
                    disabled={isUpdatingPassword || !newPasswordInput.trim()}
                    className="crm-button crm-button-primary crm-inline-e7cd8534b4"
                  >
                    {isUpdatingPassword ? 'Updating...' : 'Save & Update Password'}
                  </button>
                </div>
                <div className="crm-inline-f07a3e9f86">
                  Updating the password here immediately unlocks the client's login at <code className="crm-inline-17b97a833c">/portal/login</code>.
                </div>
              </div>

              {/* Direct Portal Launch Banner */}
              <div className="crm-inline-39701ccee2">
                <div>
                  <div className="crm-inline-0d415a1130">
                    🚀 Direct Client Portal Session
                  </div>
                  <div className="crm-inline-b7f5b380cf">
                    Open the live workspace for <strong>{client.name}</strong> to inspect their websites, project progress, invoices, and file vault.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleLaunchClientPortal}
                  className="crm-button crm-button-secondary crm-inline-161b0fd3c2"
                >
                  Open /portal/dashboard &rarr;
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: CLIENT SUPPORT CHAT */}
          {profileViewTab === 'chat' && (
            <div
              className="crm-inline-c1514e7501"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                ...(supportView === 'tickets' ? { background: 'transparent', border: 0, borderRadius: 0, padding: 0, marginBottom: 0 } : {}),
              }}
            >
              <div role="tablist" aria-label="Client support views" style={{ display: 'flex', gap: 8, padding: 5, borderRadius: 12, background: 'var(--crm-card-hover, rgba(255,255,255,.04))', width: 'fit-content', maxWidth: '100%' }}>
                {[
                  { id: 'chat', label: 'Direct Chat' },
                  { id: 'tickets', label: `Support Tickets${supportTickets.length ? ` (${supportTickets.length})` : ''}` },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={supportView === item.id}
                    onClick={() => setSupportView(item.id)}
                    className={supportView === item.id ? 'crm-modal-btn-primary' : 'crm-modal-btn-secondary'}
                    style={{ padding: '8px 14px', borderRadius: 9, whiteSpace: 'nowrap' }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {supportView === 'tickets' && (
                <ClientSupportTickets
                  client={client}
                  tickets={supportTickets}
                  loading={supportTicketsLoading}
                  error={supportTicketsError}
                  drafts={ticketReplyDrafts}
                  replyingId={ticketReplyingId}
                  onDraftChange={(ticketId, value) => {
                    setTicketReplyDrafts((drafts) => ({ ...drafts, [ticketId]: value }));
                  }}
                  onRefresh={() => {
                    setSupportTicketsLoading(true);
                    getClientSupportTickets(client.id)
                      .then(setSupportTickets)
                      .catch((error) => setSupportTicketsError(error?.message || 'Could not refresh support requests.'))
                      .finally(() => setSupportTicketsLoading(false));
                  }}
                  onReply={handleReplyToSupportTicket}
                />
              )}
              {supportView === 'chat' && (
              <>
              <div className="crm-inline-89f1352d55" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <h3 className="crm-inline-ea6402deab">
                    💬 Client Support Channel: {displayName}
                  </h3>
                  <p className="crm-inline-a172100265">
                    Direct communication thread with the client. Messages sent here are instantly visible in the Client Portal Support section.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 12, flex: '0 1 auto' }}>
                  <span className="crm-inline-b9bca5b742" role="status">
                    {chatPresence.clientTyping ? 'Client is typing…' : chatPresence.clientOnline ? 'Client online' : chatSyncError || 'Waiting for client'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleClearClientChat()}
                    disabled={!chatMessages.length || chatDeleting}
                    className="crm-button crm-button-danger crm-inline-ff72acff12"
                    style={{ background: '#FF453A', color: '#FFFFFF', opacity: !chatMessages.length || chatDeleting ? 0.5 : 1 }}
                  >
                    {chatDeleting ? 'Clearing…' : 'Clear chat for everyone'}
                  </button>
                </div>
              </div>

              {/* Chat Message Stream */}
              <div
                className="crm-inline-9cd769dc23"
              >
                {chatMessages.length === 0 ? (
                  <div className="crm-inline-9680f97eae">
                    No messages in this support channel yet. Type a message below to start communicating with the client.
                  </div>
                ) : (
                  chatMessages.map((msg) => {
                    const isStaff = msg.sender === 'staff' || msg.sender === 'agent';
                    return (
                      <div
                        key={msg.id}
                        className="crm-inline-faca856376" style={{alignItems: isStaff ? 'flex-end' : 'flex-start'}}
                      >
                        <div className="crm-inline-886787d03d">
                          <span className="crm-inline-5c05f4afaf" style={{color: isStaff ? '#0A84FF' : '#30D158'}}>
                            {isStaff ? (msg.senderName || 'Support Agent') : (client.name || client.firstName || 'Client')}
                          </span>
                          <span>·</span>
                          <span>{msg.createdAt || msg.timestamp ? new Date(msg.createdAt || msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}</span>
                        </div>
                        <div
                          className="crm-inline-ed6e2b90f1" style={{background: isStaff ? '#0071E3' : '#2A2A2E', border: isStaff ? 'none' : '1px solid rgba(255, 255, 255, 0.08)'}}
                        >
                          {msg.text || msg.body}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDeleteChatMessage(msg)}
                          className="crm-inline-ff72acff12"
                          style={{ marginTop: 4, padding: 5, background: 'transparent', color: '#FF453A', border: '1px solid rgba(255,69,58,.35)', display: 'inline-flex', alignItems: 'center' }}
                          title="Delete message"
                          aria-label="Delete message"
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })
                )}
                <div ref={chatMessagesEndRef} />
              </div>

              {/* Chat Input Bar */}
              <form
                onSubmit={handleSendChatMessage}
                className="crm-inline-0e35dfc9e8"
                style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' }}
              >
                <input
                  type="text"
                  value={chatInputText}
                  onChange={(e) => {
                    setChatInputText(e.target.value);
                    updateAdminTyping(Boolean(e.target.value.trim()));
                  }}
                  placeholder="Type a response to the client (press Enter to send)..."
                  className="crm-inline-252357170c"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="submit"
                  disabled={chatSending || !chatInputText.trim()}
                  className="crm-chat-send-btn"
                  title={chatSending ? 'Sending message' : 'Send message'}
                  aria-label={chatSending ? 'Sending message' : 'Send message'}
                  style={{ width: 34, height: 34, minWidth: 34, padding: 0, flex: '0 0 34px' }}
                >
                  <Send size={16} aria-hidden="true" />
                </button>
              </form>
              </>
              )}
            </div>
          )}

          {/* TAB 3: CLIENT ACTIVITY */}
          {profileViewTab === 'activity' && (
            <div className="crm-inline-c1514e7501">
              <div className="crm-inline-29145742ca">
                <div>
                  <h3 className="crm-inline-ea6402deab">
                    📊 Recent Client Activity: {displayName}
                  </h3>
                  <p className="crm-inline-a172100265">
                    Audit history of what this client did in their account, including logins, inquiries, ticket interactions, and navigation.
                  </p>
                </div>
              </div>

              {/* Activity Stats Cards */}
              <div className="crm-inline-3afd5e6ef6">
                <div className="crm-inline-676e6f6921">
                  <div className="crm-inline-e040c98868">
                    Total Page Views
                  </div>
                  <div className="crm-inline-113e0a3cdd">
                    {clientActivityData.stats?.pageViews || 18}
                  </div>
                </div>
                <div className="crm-inline-676e6f6921">
                  <div className="crm-inline-e040c98868">
                    Active Sessions
                  </div>
                  <div className="crm-inline-7a1a7ff2e5">
                    {clientActivityData.stats?.sessions || 4}
                  </div>
                </div>
                <div className="crm-inline-676e6f6921">
                  <div className="crm-inline-e040c98868">
                    Last Portal Session
                  </div>
                  <div className="crm-inline-40bd57df17">
                    {clientActivityData.stats?.lastLogin ? new Date(clientActivityData.stats.lastLogin).toLocaleString() : 'Recent'}
                  </div>
                </div>
              </div>

              {/* Activity Logs Stream */}
              <div className="crm-inline-0607761b0b">
                <div className="crm-inline-685be712ea">
                  Activity Timeline
                </div>
                {(!clientActivityData.logs || clientActivityData.logs.length === 0) ? (
                  <div className="crm-inline-23c1520084">
                    No recorded sessions or activities yet for this client account.
                  </div>
                ) : (
                  <div className="crm-inline-943157e781">
                    {clientActivityData.logs.map((log) => {
                      const isLogin = log.action === 'CLIENT_LOGIN';
                      const isTicket = log.action.includes('TICKET');
                      return (
                        <div
                          key={log.id}
                          className="crm-inline-9d7829cb7c"
                        >
                          <div>
                            <div className="crm-inline-dabb38c638">
                              <span
                                className="crm-inline-6b11f27e98" style={{background: isLogin ? 'rgba(48, 209, 88, 0.15)' : isTicket ? 'rgba(10, 132, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)', color: isLogin ? '#30D158' : isTicket ? '#0A84FF' : 'var(--crm-text-primary)'}}
                              >
                                {log.action}
                              </span>
                              <span className="crm-inline-3623745eed">
                                {log.details}
                              </span>
                            </div>
                            <div className="crm-inline-d3b74b9fc5">
                              IP: {log.ipAddress || '127.0.0.1'} · Source: Client Portal
                            </div>
                          </div>
                          <span className="crm-inline-f5629fa6cd">
                            {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Recent'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 0: MAIN PROFILE OVERVIEW */}
          {profileViewTab === 'overview' && (
            <>
          {/* Client Info Grid - 3 Columns */}
          <div
            className="crm-inline-0452a3cdcb"
          >
            {/* Column 1: Core Details */}
            <div className="crm-inline-7703480394">
              <div className="crm-inline-60c5fc784a">
                Client Details
              </div>
              {[
                ['Country', client.country || '-'],
                ['Funnel', client.funnel || client.service || '-'],
                ['Affiliate', client.affiliate || '-'],
                ['Registered', client.registeredDate || (client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '-')],
                ['Last Comment', client.lastCommentDate || '-'],
              ].map(([label, val]) => (
                <div key={label} className="crm-inline-457779bcb4">
                  <span className="crm-inline-7e0a172adc">{label}</span>
                  <span className="crm-inline-351e855ae3">
                    {label === 'Country' && getCountryFlag(client.countryCode, client.country)}
                    {val}
                  </span>
                </div>
              ))}
            </div>

            {/* Column 2: Customer Intake & Scope (All Enquiry Fields) */}
            <div className="crm-inline-7703480394">
              <div className="crm-inline-013900ce2e">
                Customer Intake & Scope
              </div>
              {[
                ['Company / Org', client.company || 'Individual / None'],
                ['Service Selected', client.service || client.funnel || 'General Inquiry'],
                ['Estimated Budget', client.budget || 'Not specified'],
                ['Target Timeline', client.timeline || 'Flexible'],
                ['Submission Timestamp', client.createdAt ? new Date(client.createdAt).toLocaleString() : (client.registeredDate || '-')],
                ['Entry Origin', client.source === 'website_contact_modal' ? 'Website Modal' : client.source === 'website_contact_form' ? 'Website Form' : (client.source || 'Direct Inquiry')],
              ].map(([label, val]) => (
                <div key={label} className="crm-inline-457779bcb4">
                  <span className="crm-inline-7e0a172adc">{label}</span>
                  <span
                    style={{
                      color:
                        label === 'Estimated Budget'
                          ? '#30D158'
                          : label === 'Service Selected'
                          ? 'var(--crm-accent, #0A84FF)'
                          : 'var(--crm-text-primary, #FFFFFF)',
                      fontWeight: label === 'Estimated Budget' || label === 'Service Selected' ? 600 : 400,
                    }}
                  >
                    {val}
                  </span>
                </div>
              ))}
            </div>

            {/* Column 3: Assignment Chain */}
            <div className="crm-inline-7703480394">
              <div className="crm-inline-60c5fc784a">
                Assignment Chain
              </div>
              {[
                ['Office', `${profileOffice?.name || 'Unassigned (Pool)'}${hasDirectOfficeAssignment ? ' (Direct)' : ''}`, !!(client.assignedToOffice || client.assigned_office_id)],
                ['Team', profileTeam?.name || '-', !!(client.assignedToTeam || client.assigned_team_id)],
                ['Direct Team Leader', profileTeamLeader?.name || '-', !!(client.assignedToTeamLeader || client.assigned_team_leader_id)],
                ['Agent', profileAgent?.name || '-', !!(client.assignedToAgent || client.assigned_agent_id)],
                ['Assigned By', client.assignedBy || '-', false],
              ].map(([label, val, active]) => (
                <div
                  key={label}
                  className="crm-inline-457779bcb4"
                  style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.25fr)', gap: 8, alignItems: 'start' }}
                >
                  <span className="crm-inline-7e0a172adc">{label}</span>
                  <span style={{ color: active ? 'var(--crm-accent, #0A84FF)' : 'var(--crm-text-primary, #FFFFFF)', fontWeight: active ? 600 : 400, textAlign: 'right', overflowWrap: 'anywhere' }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Customer Submission Message */}
          {client.message && (
            <div className="crm-inline-6e6b5d2d86">
              <div
                className="crm-inline-96b5763286"
              >
                <span className="crm-inline-bdd078aa79">💬</span>
                <span>Customer Submission Message</span>
              </div>
              <div
                className="crm-inline-6621321328"
              >
                "{client.message}"
              </div>
            </div>
          )}

          {/* Internal Staff Notes */}
          <div className="crm-inline-6e6b5d2d86">
            <div
              className="crm-inline-eb0bb1be03"
            >
              <div className="crm-inline-88c173ee88">
                <span>📝</span>
                <span>Internal Staff Follow-Up Notes</span>
              </div>
              <button
                type="button"
                className="crm-button crm-button-primary crm-super-admin-btn crm-super-admin-btn-small crm-inline-471ec2ccd9"
                onClick={async () => {
                  if (setData) {
                    setData((prev) => ({
                      ...prev,
                      clients: (prev.clients || []).map((l) =>
                        l.id === client.id ? { ...l, notes: profileNotes } : l
                      ),
                    }));
                  }
                  if (client.id) {
                    try {
                      await updateClientApi(client.id, { notes: profileNotes });
                    } catch (_) {}
                  }
                  showNotification('Internal staff notes saved.');
                }}

              >
                Save Note
              </button>
            </div>
            <textarea
              rows={3}
              value={profileNotes}
              onChange={(e) => setProfileNotes(e.target.value)}
              placeholder="Record call logs, client preferences, quotes discussed, or next action steps..."
              className="crm-inline-dd8b977d2a"
            />
          </div>

          {/* Stage & Comment */}
          <div className="crm-inline-fd79b3f646">
            <div>
              <label className="crm-inline-55ee1f0eec">
                Select Status
              </label>
              <select
                className="crm-super-admin-select crm-inline-69d66e5b2e"

                value={profileStage}
                onChange={(e) => setProfileStage(e.target.value)}
              >
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="crm-inline-55ee1f0eec">
                Add New Activity Comment
              </label>
              <textarea
                value={profileComment}
                onChange={(e) => setProfileComment(e.target.value)}
                placeholder="Log activity, call notes or consultation updates..."
                rows={3}
                className="crm-inline-bdba52e523"
              />
            </div>
          </div>

          {/* Reassign Controls */}
          {data?.offices && (
            <div className="crm-inline-9723e5c182">
              <div className="crm-inline-85b310266c">
                Reassign
              </div>
              <div className="crm-inline-1761803268">
                Assigning directly to an office leaves the client with no team, direct Team Leader, or agent. Choose a team, direct Team Leader, or agent to route the client further.
              </div>

              {/* Quick assign to agent */}
              <div className="crm-inline-72d6c38e5f">
                <div className="crm-inline-5a62cb576a">
                  Quick Assign to Agent
                </div>
                <select
                  className="crm-super-admin-select crm-inline-69d66e5b2e"

                  value={reassignAgentId}
                  onChange={(e) => {
                    const agentId = e.target.value;
                    setReassignAgentId(agentId);
                    if (agentId) {
                      setReassignTeamLeaderId('');
                      const agent = data.users.find((u) => u.id === agentId);
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
                  {(data.offices || []).map((office) => {
                    const officeAgents = (data.users || []).filter(
                      (u) => u.role === ROLE.AGENT && u.officeId === office.id
                    );
                    if (officeAgents.length === 0) return null;
                    return (
                      <optgroup key={office.id} label={`[office] ${office.name}`}>
                        {officeAgents.map((agent) => {
                          const team = (data.teams || []).find((t) => t.id === agent.teamId);
                          return (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                              {team ? ` (${team.name})` : ''}
                            </option>
                          );
                        })}
                      </optgroup>
                    );
                  })}
                  {(() => {
                    const independentAgents = (data.users || []).filter(
                      (u) => u.role === ROLE.AGENT && !u.officeId
                    );
                    return independentAgents.length ? (
                      <optgroup label="Independent agents">
                        {independentAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                      </optgroup>
                    ) : null;
                  })()}
                </select>
              </div>

              {/* Manual office/team override */}
              <div className="crm-inline-24bc94dc38">
                <div className="crm-inline-5c486f2428">
                  Office / Team assignment
                </div>
                <div className="crm-inline-cbafd4541f">
                  <div className="crm-inline-7291e534ce">
                    <div className="crm-inline-c9050f438a">Office</div>
                    <select
                      className="crm-super-admin-select crm-inline-69d66e5b2e"

                      value={reassignOfficeId}
                      onChange={(e) => {
                        setReassignOfficeId(e.target.value);
                        setReassignTeamId('');
                        setReassignTeamLeaderId('');
                        setReassignAgentId('');
                      }}
                    >
                      <option value="">None (Pool)</option>
                      {(data.offices || []).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="crm-super-admin-btn crm-super-admin-btn-small crm-super-admin-btn-secondary"
                      disabled={!reassignOfficeId}
                      onClick={() => {
                        setReassignTeamId('');
                        setReassignTeamLeaderId('');
                        setReassignAgentId('');
                      }}
                    >
                      Assign directly to this office
                    </button>
                  </div>
                  <div className="crm-inline-7291e534ce">
                    <div className="crm-inline-c9050f438a">Team</div>
                    <select
                      className="crm-super-admin-select crm-inline-69d66e5b2e"

                      value={reassignTeamId}
                      onChange={(e) => {
                        const nextTeamId = e.target.value;
                        setReassignTeamId(nextTeamId);
                        setReassignAgentId('');
                        const nextTeam = (data.teams || []).find((team) => team.id === nextTeamId);
                        if (nextTeamId && nextTeam) setReassignOfficeId(nextTeam.officeId || '');
                      }}
                    >
                      <option value="">None</option>
                      {(data.teams || []).map((t) => {
                        const officeName = (data.offices || []).find((office) => office.id === t.officeId)?.name;
                        return (
                          <option key={t.id} value={t.id}>
                            {t.name}{officeName ? ` — ${officeName}` : ' — independent'}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isSuperAdmin && data?.users && (
            <div className="crm-inline-9723e5c182">
              <label htmlFor="client-team-leader-owner" className="crm-inline-97caf87d10">
                Direct Team Leader
              </label>
              <p className="crm-inline-2be3ebe1f3">
                Assign the client directly to a team leader, even when there is no team or agent.
              </p>
              <select
                id="client-team-leader-owner"
                className="crm-super-admin-select crm-inline-69d66e5b2e"

                value={reassignTeamLeaderId}
                onChange={(e) => {
                  const teamLeaderId = e.target.value;
                  setReassignTeamLeaderId(teamLeaderId);
                  if (teamLeaderId) setReassignAgentId('');
                }}
              >
                <option value="">No direct team leader</option>
                {(data.users || [])
                  .filter((user) => user.role === ROLE.TEAM_LEAD)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}{user.teamId ? ` — ${(data.teams || []).find((team) => team.id === user.teamId)?.name || 'team leader'}` : ' — standalone'}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Comment History */}
          {client.commentHistory && client.commentHistory.length > 0 && (
            <div
              className="crm-inline-96993e039c"
            >
              <div
                className="crm-inline-8ca294ed9c"
              >
                Comment History
              </div>
              {[...client.commentHistory].map((entry, i) => (
                <div
                  key={i}
                  className="crm-inline-4456df10b5"
                >
                  <div className="crm-inline-b700c47a7c">
                    <span className="crm-inline-42de2265bb">{entry.author || entry.by || 'Staff'}</span>
                    <span className="crm-inline-54aeff80c9">
                      {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : entry.date || ''}
                    </span>
                  </div>
                  <div className="crm-inline-3414b99eb6">{entry.text}</div>
                </div>
              ))}
            </div>
          )}

          {/* Profile Change History (Audit Log) */}
          <div className="crm-inline-9723e5c182">
            <div
              className="crm-inline-e938e318f7"
            >
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
                      await clearProfileHistoryApi(client.id);
                      setProfileHistory([]);
                    } catch (err) {
                      showNotification('Could not clear profile history: ' + (err.message || 'error'));
                    }
                  }}
                  className="crm-button crm-button-danger crm-inline-3f4b9cc554"
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
              <div className="crm-inline-db47041df6">
                {profileHistory.map((entry) => {
                  const isClientAction = !entry.actorAdminId;
                  const changedFields = entry.after ? Object.keys(entry.after) : [];
                  const date = entry.createdAt
                    ? new Date(
                        entry.createdAt.endsWith('Z') ? entry.createdAt : entry.createdAt + 'Z'
                      ).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
                    : '-';
                  return (
                    <div
                      key={entry.id}
                      className="crm-inline-4065a0f727"
                    >
                      <div
                        className="crm-inline-9acaf13c6a"
                      >
                        <div className="crm-inline-88c173ee88">
                          <span
                            className="crm-inline-7913752a4d" style={{background: isClientAction ? '#1E3A5F' : '#2D3B22', color: isClientAction ? '#3B82F6' : '#0ECB81'}}
                          >
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
                                await deleteProfileHistoryEntryApi(client.id, entry.id);
                                setProfileHistory((prev) => prev.filter((e) => e.id !== entry.id));
                              } catch (err) {
                                showNotification('Could not delete entry: ' + (err.message || 'error'));
                              }
                            }}
                            className="crm-button crm-button-danger crm-inline-d302f5a029"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                      <div className="crm-inline-1584a8a1b4">
                        By: <span style={{ color: isClientAction ? 'var(--crm-text-primary)' : 'var(--crm-accent)' }}>{entry.actorName}</span>
                        {entry.ip && <span className="crm-inline-cfa5ddfa12"> / IP: {entry.ip}</span>}
                      </div>
                      {changedFields.length > 0 &&
                        changedFields
                          .filter((k) => k !== 'avatar_url')
                          .map((field) => {
                            const before = entry.before?.[field];
                            const after = entry.after?.[field];
                            const fieldLabel =
                              {
                                name: 'Name',
                                email: 'Email',
                                phone: 'Phone',
                                status: 'Status',
                              }[field] || field;
                            if (field === 'password')
                              return (
                                <div key={field} className="crm-inline-223bace234">
                                  Password changed
                                </div>
                              );
                            if (before === undefined && after !== undefined)
                              return (
                                <div key={field} className="crm-inline-ba0de114c0">
                                  <span className="crm-inline-54aeff80c9">{fieldLabel}:</span>
                                  <span className="crm-inline-4a2d65d353">{String(after)}</span>
                                </div>
                              );
                            return (
                              <div
                                key={field}
                                className="crm-inline-f42c405d43"
                              >
                                <span className="crm-inline-54aeff80c9">{fieldLabel}:</span>
                                <span
                                  className="crm-inline-0cf506d124"
                                >
                                  {before !== undefined && before !== null ? String(before) : '-'}
                                </span>
                                <span className="crm-inline-54aeff80c9">→</span>
                                <span className="crm-inline-4a2d65d353">
                                  {after !== undefined && after !== null ? String(after) : '-'}
                                </span>
                              </div>
                            );
                          })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="crm-inline-e262f6096d">
            <div className="crm-inline-f36152c67e">
              <button
                className="crm-button crm-button-primary crm-super-admin-btn crm-super-admin-btn-small crm-inline-b268c66aab"
                onClick={saveProfile}

              >
                💾 Save Changes
              </button>
              <button
                className="crm-button crm-button-secondary crm-super-admin-btn crm-super-admin-btn-small crm-super-admin-btn-secondary"
                onClick={unassignClient}
              >
                Return to Pool
              </button>
            </div>
            <div className="crm-inline-f36152c67e">
              {isSuperAdmin && (
                <>
                  <button
                    className="crm-button crm-button-secondary crm-super-admin-btn crm-super-admin-btn-small crm-inline-a6cfd0a49f"
                    onClick={resetClientstatus}
                    title="Reset stage to New and erase all status history"
                  >
                    🔄 Reset Status
                  </button>
                  <button
                    className="crm-button crm-button-secondary crm-super-admin-btn crm-super-admin-btn-small"
                    onClick={clearClientStatusHistory}
                    title="Clear workflow history without changing the current status"
                  >
                    Clear Workflow
                  </button>
                  <button
                    className="crm-button crm-button-secondary crm-super-admin-btn crm-super-admin-btn-small crm-inline-b9279831c8"
                    onClick={clearClientComments}
                    title="Permanently delete all comments on this client"
                  >
                    🗨 Clear Comments
                  </button>
                </>
              )}
              <button
                className="crm-button crm-button-danger crm-super-admin-btn crm-super-admin-btn-small crm-inline-fd8ae4de3b"

                onClick={deleteClient}
              >
                🗑 Move to Bin
              </button>
            </div>
          </div>
          </>
          )}
        </div>
      </div>
      {confirmDialog}
      {deleteMessageTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-chat-message-title"
          onClick={() => { if (!isDeletingMessage) setDeleteMessageTarget(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,.65)' }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ width: '100%', maxWidth: 420, padding: 24, borderRadius: 12, border: '1px solid var(--crm-border)', background: 'var(--crm-card)', color: 'var(--crm-text-primary)', boxShadow: '0 12px 32px rgba(0,0,0,.5)' }}
          >
            <h3 id="delete-chat-message-title" style={{ margin: '0 0 8px', fontSize: 16 }}>Delete message</h3>
            <p style={{ margin: '0 0 20px', color: 'var(--crm-text-muted)', fontSize: 14, lineHeight: 1.5 }}>
              Choose whether to remove this message only from your chat or from the client&apos;s chat too.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="crm-button crm-button-secondary crm-modal-btn-secondary" disabled={isDeletingMessage} onClick={() => setDeleteMessageTarget(null)}>Cancel</button>
              <button type="button" className="crm-button crm-button-secondary crm-modal-btn-secondary" disabled={isDeletingMessage} onClick={() => void deleteChatMessage(true)}>Delete for me</button>
              <button type="button" className="crm-button crm-button-danger crm-modal-btn-danger" disabled={isDeletingMessage} onClick={() => void deleteChatMessage(false)}>Delete for everyone</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
