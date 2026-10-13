import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  MessageSquare,
  Send,
  Search,
  Clock,
  User,
  Globe,
  Monitor,
  ExternalLink,
  Trash2,
  CheckCheck,
  Bot,
  Radio,
  FileText,
  X,
  ArrowRight,
  Maximize2,
  Minimize2,
  Archive,
  ArchiveRestore,
  Eraser,
  CornerDownLeft,
  Pencil,
  Check,
} from 'lucide-react';
import {
  clearAdminChat,
  deleteAdminMessage,
  getAdminChatThreads,
  getAdminMessages,
  getAdminChatPresence,
  getStoredAdminProfile,
  markAdminMessagesRead,
  sendAdminMessage,
  editAdminMessage,
  postAdminPresence,
  saveAdminChatThreadMeta,
} from '../adminApi';
import { SearchAutocomplete } from './UserChrome.jsx';

const formatChatTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};


export default function LiveChatWorkspace({ showNotification = () => {} }) {
  const [threads, setThreads] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [agentInput, setAgentInput] = useState('');
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showArchivedView, setShowArchivedView] = useState(false);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [currentAdmin, setCurrentAdmin] = useState(() => getStoredAdminProfile());
  const [chatPresence, setChatPresence] = useState({ clientTyping: false, staffTyping: false, staffOnline: false });
  const [editingMessageId, setEditingMessageId] = useState('');
  const [editingMessageText, setEditingMessageText] = useState('');

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const agentInputRef = useRef(agentInput);
  agentInputRef.current = agentInput;

  const normalizeThread = (thread) => ({
    ...thread,
    id: thread.client_id || thread.id,
    visitor_name: thread.visitor_name || 'Client',
    visitor_email: thread.visitor_email || '',
    location: thread.company || '',
    status: thread.is_archived ? 'archived' : thread.status,
    is_archived: Boolean(thread.is_archived),
    unread_count: Number(thread.unread_count || 0),
    assigned_agent: thread.assigned_agent || 'Unassigned',
    notes: thread.notes || '',
    messages: [],
  });

  const reloadThreads = async ({ quiet = false } = {}) => {
    if (!quiet) setIsLoadingThreads(true);
    try {
      const profile = getStoredAdminProfile();
      setCurrentAdmin(profile);
      const result = await getAdminChatThreads({ includeArchived: true });
      setThreads((previous) => {
        const previousById = new Map(previous.map((thread) => [thread.id, thread]));
        return result.map((rawThread) => {
          const thread = normalizeThread(rawThread);
          return { ...thread, messages: previousById.get(thread.id)?.messages || [] };
        });
      });
      setSelectedThreadId((current) => result.some((thread) => (thread.client_id || thread.id) === current)
        ? current
        : ((result.find((thread) => !thread.is_archived)?.client_id
          || result.find((thread) => !thread.is_archived)?.id
          || result[0]?.client_id
          || result[0]?.id
          || null)));
    } catch (error) {
      setChatError(error.message || 'Conversations could not be loaded.');
    } finally {
      if (!quiet) setIsLoadingThreads(false);
    }
  };

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) void reloadThreads({ quiet: isLoadingThreads });
    };
    void reloadThreads();
    const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  // Read Tidio config from site settings if present
  const tidioInfo = useMemo(() => {
    try {
      const live = localStorage.getItem('codex_site_config');
      const config = live ? JSON.parse(live) : {};
      const tidio = config.tidio || {};
      return {
        enabled: Boolean(tidio.enabled),
        publicKey: tidio.publicKey || '',
        position: tidio.position || 'bottom-right',
      };
    } catch {
      return { enabled: false, publicKey: '', position: 'bottom-right' };
    }
  }, []);

  const activeThread = useMemo(() => {
    return threads.find((t) => t.id === selectedThreadId) || threads[0] || null;
  }, [threads, selectedThreadId]);

  const reloadMessages = async (clientId, { markRead = false } = {}) => {
    if (!clientId) return;
    const result = await getAdminMessages(clientId, { limit: 100 });
    const messages = result.messages.map((message) => ({
      id: message.id,
      sender: message.sender === 'agent' ? 'agent' : message.sender === 'system' ? 'system' : 'visitor',
      sender_id: message.senderId || message.sender_id || message.agentId || '',
      sender_name: message.senderName || message.sender_name || '',
      text: message.body || message.text || '',
      created_at: message.timestamp || message.createdAt || message.created_at,
      edited_at: message.editedAt || message.edited_at || null,
    }));
    setThreads((prev) => prev.map((thread) => thread.id === clientId
      ? { ...thread, messages, unread_count: markRead ? 0 : result.unreadCount }
      : thread));
    if (markRead && result.unreadCount > 0) await markAdminMessagesRead(clientId);
  };

  useEffect(() => {
    if (!activeThread?.id) return undefined;
    let active = true;
    const load = async () => {
      try {
        await reloadMessages(activeThread.id, { markRead: true });
        if (active) setChatError('');
      } catch (error) {
        if (active) setChatError(error.message || 'Messages could not be loaded.');
      }
    };
    void load();
    const timer = window.setInterval(load, 7000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activeThread?.id]);

  useEffect(() => {
    if (!activeThread?.id) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const presence = await getAdminChatPresence(activeThread.id);
        if (active) setChatPresence(presence);
      } catch { /* presence is best-effort; message loading remains independent */ }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    const heartbeat = () => postAdminPresence(activeThread.id, { isTyping: Boolean(agentInputRef.current.trim()) }).catch(() => {});
    void heartbeat();
    const heartbeatTimer = window.setInterval(heartbeat, 5000);
    return () => { active = false; window.clearInterval(timer); window.clearInterval(heartbeatTimer); };
  }, [activeThread?.id]);

  useEffect(() => () => {
    window.clearTimeout(typingTimeoutRef.current);
    if (activeThread?.id) void postAdminPresence(activeThread.id, { isTyping: false }).catch(() => {});
  }, [activeThread?.id]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages]);

  // Filtered threads list based on search and archive filter
  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      if (showArchivedView ? !t.is_archived : t.is_archived) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchName = t.visitor_name?.toLowerCase().includes(q);
      const matchEmail = t.visitor_email?.toLowerCase().includes(q);
      const matchLocation = t.location?.toLowerCase().includes(q);
      const matchMessages = t.messages?.some((m) => m.text?.toLowerCase().includes(q));
      return matchName || matchEmail || matchLocation || matchMessages;
    });
  }, [threads, searchQuery, showArchivedView]);

  // Stats summary
  const stats = useMemo(() => {
    const total = threads.filter((t) => !t.is_archived).length;
    const active = threads.filter((t) => !t.is_archived && t.status === 'active').length;
    const waiting = threads.filter((t) => !t.is_archived && t.status === 'waiting').length;
    const archived = threads.filter((t) => t.is_archived).length;
    return { total, active, waiting, archived };
  }, [threads]);

  // Handle agent sending a reply
  const handleSendAgentMessage = async () => {
    const text = agentInput.trim();
    if (!text || !activeThread || isSending) return;
    setIsSending(true);
    setChatError('');
    try {
      await sendAdminMessage(activeThread.id, text);
      window.clearTimeout(typingTimeoutRef.current);
      void postAdminPresence(activeThread.id, { isTyping: false }).catch(() => {});
      setAgentInput('');
      await Promise.all([reloadMessages(activeThread.id), reloadThreads({ quiet: true })]);
      showNotification('Reply sent to Client.');
    } catch (error) {
      setChatError(error.message || 'The reply could not be sent.');
    } finally {
      setIsSending(false);
    }
  };

  const handleEditMessage = async (messageId) => {
    const text = editingMessageText.trim();
    if (!text || !activeThread) return;
    try {
      await editAdminMessage(messageId, text);
      setEditingMessageId('');
      setEditingMessageText('');
      await reloadMessages(activeThread.id);
      showNotification('Message updated.');
    } catch (error) {
      setChatError(error.message || 'The message could not be edited.');
    }
  };

  const handclientminTyping = (value) => {
    setAgentInput(value);
    if (!activeThread) return;
    void postAdminPresence(activeThread.id, { isTyping: Boolean(value.trim()) }).catch(() => {});
    window.clearTimeout(typingTimeoutRef.current);
    if (value.trim()) {
      typingTimeoutRef.current = window.setTimeout(() => {
        void postAdminPresence(activeThread.id, { isTyping: false }).catch(() => {});
      }, 2500);
    }
  };

  const handleDeleteMessage = async (messageId) => {
    if (!activeThread || !window.confirm('Delete this message for everyone?')) return;
    try {
      await deleteAdminMessage(messageId);
      await reloadMessages(activeThread.id);
      showNotification('Message deleted.');
    } catch (error) {
      setChatError(error.message || 'The message could not be deleted.');
    }
  };

  const handleClearHistory = async () => {
    if (!activeThread || !window.confirm('Permanently delete every message in this conversation? This cannot be undone.')) return;
    try {
      await clearAdminChat(activeThread.id);
      await reloadMessages(activeThread.id);
      await reloadThreads({ quiet: true });
      showNotification('Conversation history deleted.');
    } catch (error) {
      setChatError(error.message || 'The conversation history could not be deleted.');
    }
  };

  const handleToggleArchive = async (threadId = activeThread?.id) => {
    if (!threadId) return;
    const target = threads.find((thread) => thread.id === threadId);
    const willArchive = !target?.is_archived;
    try {
      await saveAdminChatThreadMeta(threadId, {
        status: target?.status === 'waiting' ? 'waiting' : 'active',
        is_archived: willArchive,
        notes: target?.notes || '',
      });
      await reloadThreads({ quiet: true });
      showNotification(willArchive ? 'Conversation archived.' : 'Conversation restored.');
    } catch (error) {
      setChatError(error.message || 'The conversation could not be updated.');
    }
  };

  const handleDeletePerson = (threadId = activeThread?.id) => {
    if (!threadId) return;
    void handleToggleArchive(threadId);
  };

  const handleSaveThreadNotes = async (threadId, notes) => {
    if (!threadId) return;
    try {
      await saveAdminChatThreadMeta(threadId, {
        status: activeThread?.status === 'waiting' ? 'waiting' : 'active',
        is_archived: Boolean(activeThread?.is_archived),
        notes,
      });
    } catch (error) {
      setChatError(error.message || 'Internal notes could not be saved.');
    }
  };

  const summaryCards = [
    ['Conversations', stats.total, `${stats.active} in progress`, MessageSquare],
    ['Waiting Reply', stats.waiting, 'Awaiting agent response', Clock],
    ['Archived', stats.archived, 'Archived conversations', Archive],
    ['Tidio Gateway', tidioInfo.enabled ? 'Online' : 'Active', tidioInfo.enabled ? 'Live widget linked' : 'Internal CRM gateway', Bot],
  ];

  return (
    <section className="crm-content-hub crm-chat-suite">
      {/* 1. Header Matching Content Studio */}
      <header className="crm-content-hub-header">
        <div className="crm-content-hub-header-copy">
          <div className="crm-content-hub-title-row">
            <span className="crm-content-hub-header-mark">
              <MessageSquare size={18} />
            </span>
            <div>
              <span className="crm-content-hub-kicker">Clients / Chat</span>
              <h2>Live Visitor Chat & Tidio Center</h2>
            </div>
          </div>
          <p>
            Monitor real-time visitor threads, converse directly as an agent, and coordinate live client communication from your central workspace.
          </p>
        </div>

        <div className="crm-content-hub-header-workflow">
          <div className="crm-content-hub-workflow-label">
            <Radio size={13} className="text-emerald-400" />
            <strong>Live Interaction Sync</strong>
          </div>
          <div className="crm-content-hub-workflow-steps">
            <span>Visitor</span>
            <ArrowRight size={12} />
            <span>Tidio Gateway</span>
            <ArrowRight size={12} />
            <span>Agent Reply</span>
          </div>
        </div>
      </header>

      {/* 2. Standard 4-Tile Metrics Bar */}
      <div className="crm-content-hub-summary" aria-label="Live Chat Summary">
        {summaryCards.map(([label, value, detail, Icon]) => (
          <div className="crm-content-hub-summary-card" key={label}>
            <span className="crm-content-hub-summary-icon">
              <Icon size={18} strokeWidth={2.2} />
            </span>
            <div className="crm-content-hub-summary-body">
              <div className="crm-content-hub-summary-val-row">
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
              <small>{detail}</small>
            </div>
          </div>
        ))}
      </div>

      {/* 3. Main Chat Workspace Layout: Joined Console + Standalone Visitor Context Card */}
      <div className="crm-chat-workspace-layout">
        {/* JOINED CHAT ENCLOSURE (Sidebar + Active Conversation) */}
        <div className="crm-chat-console">
          {/* LEFT COLUMN: Joined Sidebar */}
          <aside className="crm-chat-sidebar">
            {/* Top Search Bar: Small Archive toggle on the left, Search field in center, Enter button on the right */}
            <div className="crm-chat-sidebar-head">
              <div className="crm-chat-search-bar">
                {/* Archive View Toggle (Small, on the left of search field) */}
                <button
                  type="button"
                  onClick={() => setShowArchivedView((p) => !p)}
                  className={`crm-chat-archive-toggle-btn ${showArchivedView ? 'active' : ''}`}
                  title={showArchivedView ? 'Show active conversations' : 'Show archived conversations'}
                  aria-label="Archive toggle"
                >
                  <Archive size={14} />
                </button>

                {/* Search Input Field (Magnifying glass correctly positioned on left inside input) */}
                <div className="crm-chat-search-field">
                  <Search size={14} className="crm-chat-search-lens" />
                  <SearchAutocomplete
                    value={searchQuery}
                    onChange={setSearchQuery}
                    inputProps={{
                      onKeyDown: (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          showNotification(searchQuery.trim() ? `Filtered by "${searchQuery.trim()}"` : 'Showing all threads');
                        }
                      },
                    }}
                    placeholder="Search conversations..."
                    className=""
                    style={{ flex: 1, minWidth: 0 }}
                    buildSuggestions={(query) => filteredThreads.filter((thread) => [
                      thread.visitor_name, thread.visitor_email, thread.location, thread.id,
                      ...(thread.messages || []).map((message) => message.text),
                    ].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
                      .slice(0, 8).map((thread) => ({
                        key: thread.id,
                        value: thread.visitor_name || thread.visitor_email || '',
                        label: thread.visitor_name || thread.visitor_email || 'Conversation',
                        meta: [thread.visitor_email, thread.location].filter(Boolean).join(' · '),
                      }))}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="crm-chat-search-clear-btn"
                      title="Clear search"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Enter Button for Search (On the right) */}
                <button
                  type="button"
                  onClick={() => {
                    showNotification(searchQuery.trim() ? `Filtered by "${searchQuery.trim()}"` : 'Showing all threads');
                  }}
                  className="crm-chat-search-enter-btn"
                  title="Search conversations"
                >
                  <span>Enter</span>
                  <CornerDownLeft size={11} />
                </button>
              </div>
            </div>

            {/* Scrollable Threads List */}
            <div className="crm-chat-threads-list">
              {filteredThreads.length === 0 ? (
                <div className="crm-inline-257f97946c">
                  <MessageSquare size={28} className="crm-inline-35d148ae23" />
                  {showArchivedView ? 'No archived conversations.' : 'No conversations found.'}
                </div>
              ) : (
                filteredThreads.map((thread) => {
                  const isSelected = thread.id === activeThread?.id;
                  const lastMsg = thread.messages?.[thread.messages.length - 1];
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => {
                        setSelectedThreadId(thread.id);
                        setThreads((prev) =>
                          prev.map((t) => (t.id === thread.id ? { ...t, unread_count: 0 } : t))
                        );
                      }}
                      className={`crm-chat-thread-card ${isSelected ? 'active' : ''}`}
                    >
                      <div className="crm-chat-avatar">
                        {thread.visitor_name.slice(0, 2).toUpperCase()}
                        <span className={`crm-chat-status-dot ${thread.status}`} />
                      </div>

                      <div className="crm-inline-cbb88a9394">
                        <div className="crm-inline-7fa540528a">
                          <strong className="crm-inline-a3f4aa8616">
                            {thread.visitor_name}
                          </strong>
                          <span className="crm-inline-06261dc46e">
                            {lastMsg ? formatChatTime(lastMsg.created_at) : ''}
                          </span>
                        </div>

                        <div className="crm-inline-4f696e6ad1">
                          <p className="crm-inline-2ce21b3df5">
                            {lastMsg ? (
                              <>
                                {lastMsg.sender === 'agent' && <span className="crm-inline-8d06347a1d">You: </span>}
                                {lastMsg.text}
                              </>
                            ) : (
                              'No messages'
                            )}
                          </p>

                          {thread.unread_count > 0 && (
                            <span className="crm-inline-65a4a9430c">
                              {thread.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* RIGHT COLUMN: Joined Active Conversation Stream */}
          <main className="crm-chat-main">
            {activeThread ? (
              <>
                {/* Header Bar (64px height, perfectly continuous with left sidebar header) */}
                <div className="crm-chat-main-head">
                  <div className="crm-inline-2cc8643ed4">
                    <div className="crm-chat-avatar crm-inline-75e9e53663" >
                      {activeThread.visitor_name.slice(0, 2).toUpperCase()}
                      <span className={`crm-chat-status-dot ${activeThread.status}`} />
                    </div>
                    <div className="crm-inline-2cd52ab948">
                      <div className="crm-inline-9484aff0bd">
                        <h3 className="crm-inline-8d034ef055">
                          {activeThread.visitor_name}
                        </h3>
                        {activeThread.is_archived && (
                          <span className="crm-inline-075a1eb951">
                            Archived
                          </span>
                        )}
                      </div>
                      <div className="crm-inline-0414f51184">
                        <span>{activeThread.location}</span>
                        {chatPresence.clientTyping && <span className="crm-inline-85edd34be8">Client is typing…</span>}
                      </div>
                    </div>
                  </div>

                  {/* Maximize / Downsize Control: Just the arrows only (No button frame) */}
                  <div className="crm-inline-6781c18518">
                    <button
                      type="button"
                      onClick={() => setShowRightPanel((p) => !p)}
                      className="crm-chat-arrows-only-btn"
                      title={showRightPanel ? 'Downsize details' : 'Maximize details'}
                      aria-label={showRightPanel ? 'Downsize details' : 'Maximize details'}
                    >
                      {showRightPanel ? (
                        <Minimize2 size={16} />
                      ) : (
                        <Maximize2 size={16} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Messages Body */}
                <div className="crm-chat-messages-body">
                  {activeThread.messages?.map((msg) => {
                    if (msg.sender === 'system') {
                      return (
                        <div key={msg.id} className="crm-chat-bubble-system">
                          {msg.text}
                        </div>
                      );
                    }

                    const isAgent = msg.sender === 'agent';
                    return (
                      <div
                        key={msg.id}
                        className="crm-chat-message-row crm-inline-4ca55c1c07"
                         style={{alignItems: isAgent ? 'flex-end' : 'flex-start'}}
                      >
                        <div className="crm-inline-88c173ee88" style={{flexDirection: isAgent ? 'row-reverse' : 'row'}}>
                          {editingMessageId === msg.id ? (
                            <div className="crm-inline-333047fbc9">
                              <input
                                aria-label="Edit message"
                                value={editingMessageText}
                                maxLength={5000}
                                onChange={(event) => setEditingMessageText(event.target.value)}
                                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void handleEditMessage(msg.id); } if (event.key === 'Escape') setEditingMessageId(''); }}
                                className="crm-inline-b70bb1acd4"
                              />
                              <button type="button" aria-label="Save edited message" title="Save edit" onClick={() => void handleEditMessage(msg.id)}><Check size={14} /></button>
                              <button type="button" aria-label="Cancel edit" title="Cancel edit" onClick={() => setEditingMessageId('')}>×</button>
                            </div>
                          ) : (
                            <div className={isAgent ? 'crm-chat-bubble-agent' : 'crm-chat-bubble-visitor'}>
                              {msg.sender_name && <strong className="crm-inline-a61382372d">{msg.sender_name}</strong>}
                              {msg.text}
                              {msg.edited_at && <span className="crm-inline-3a34ae4b57">Edited</span>}
                            </div>
                          )}

                          {isAgent && editingMessageId !== msg.id && (() => {
                            const age = Date.now() - new Date(msg.created_at).getTime();
                            const ownMessage = currentAdmin?.role === 'Super Admin' || !msg.sender_id || msg.sender_id === currentAdmin?.id;
                            return ownMessage && age >= 0 && age <= 7 * 60 * 1000 ? (
                              <button
                                type="button"
                                aria-label="Edit message"
                                title="Edit message (available for 7 minutes)"
                                onClick={() => { setEditingMessageId(msg.id); setEditingMessageText(msg.text); }}
                                className="crm-chat-msg-delete-btn"
                              ><Pencil size={10} /></button>
                            ) : null;
                          })()}

                          {/* Delete Individual Message Button (Compact, small) */}
                          <button
                            type="button"
                            onClick={() => handleDeleteMessage(msg.id)}
                            className="crm-chat-msg-delete-btn crm-inline-797e2ad7d6"
                            title="Delete this message"

                          >
                            <Trash2 size={10} />
                          </button>
                        </div>

                        <div className="crm-inline-22274419d6">
                          <span>
                            {formatChatTime(msg.created_at)}
                          </span>
                          {isAgent && (
                            <CheckCheck size={11} className="crm-inline-17b97a833c" />
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <div ref={messagesEndRef} />
                </div>

                {/* Bottom Composer with Normal Send Button (Not Oval) */}
                <div className="crm-chat-composer">
                  <div
                    className="crm-inline-ccd613d060"
                  >
                    <input
                      type="text"
                      value={agentInput}
                      onChange={(e) => handclientminTyping(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSendAgentMessage();
                        }
                      }}
                      placeholder={`Message ${activeThread.visitor_name}...`}
                      className="crm-inline-d0b031e0a5"
                    />
                  </div>

                  {/* Normal rectangular send button with Send icon (Not Oval) */}
                  <button
                    type="button"
                    onClick={handleSendAgentMessage}
                    disabled={!agentInput.trim()}
                    className="crm-chat-send-btn"
                    title="Send message"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </>
            ) : (
              <div className="crm-inline-d37b1cf1e8">
                <MessageSquare size={36} className="crm-inline-01de9b0d87" />
                <h4>No conversation selected</h4>
                <p className="crm-inline-7a459431c4">Pick a thread on the left to start replying.</p>
              </div>
            )}
          </main>
        </div>

        {/* STANDALONE SEPARATE VISITOR CONTEXT CARD */}
        {showRightPanel && activeThread && (
          <aside className="crm-chat-meta-standalone">
            {/* Visitor Context */}
            <div>
              <div className="crm-inline-4184195f94">
                <span className="crm-inline-5d22bbb1c9">
                  <User size={13} />
                  <span>Visitor Context</span>
                </span>
                <span className="crm-inline-38b46222c4">
                  <span className="crm-inline-ab4b144031" />
                  Online
                </span>
              </div>

              <div className="crm-inline-0dd0d7df81">
                <div>
                  <span className="crm-inline-3e879d5ce8">Visitor Name</span>
                  <strong className="crm-inline-8f13939324">{activeThread.visitor_name}</strong>
                </div>

                {activeThread.visitor_email && (
                  <div>
                    <span className="crm-inline-3e879d5ce8">Contact Email</span>
                    <a href={`mailto:${activeThread.visitor_email}`} className="crm-inline-d167226772">
                      {activeThread.visitor_email}
                    </a>
                  </div>
                )}

                <div>
                  <span className="crm-inline-3e879d5ce8">Location</span>
                  <span className="crm-inline-394edf2bf6">
                    <Globe size={12} className="crm-inline-02b3e419af" />
                    {activeThread.location}
                  </span>
                </div>

                <div>
                  <span className="crm-inline-3e879d5ce8">Device & OS</span>
                  <span className="crm-inline-394edf2bf6">
                    <Monitor size={12} className="crm-inline-02b3e419af" />
                    {activeThread.browser}
                  </span>
                </div>

                <div>
                  <span className="crm-inline-3e879d5ce8">IP Address</span>
                  <span className="crm-inline-311a583418">
                    {activeThread.ip_address}
                  </span>
                </div>
              </div>
            </div>

            {/* Conversation actions */}
            <div className="crm-inline-c1d507337e">
              <button
                type="button"
                onClick={() => handleToggleArchive(activeThread.id)}
                className="crm-chat-panel-action-btn crm-inline-492dac157e"
                title={activeThread.is_archived ? 'Unarchive conversation' : 'Archive conversation'}

              >
                {activeThread.is_archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                <span>{activeThread.is_archived ? 'Unarchive' : 'Archive'}</span>
              </button>

              {/* Deleting chat history option in visitor context / profile */}
              <button
                type="button"
                onClick={handleClearHistory}
                className="crm-chat-panel-action-btn warning crm-inline-492dac157e"

                title="Delete entire chat history for this visitor"
              >
                <Eraser size={13} />
                <span>Delete Chat History</span>
              </button>
            </div>

            {/* Tidio Two-Way Sync Status */}
            <div className="crm-inline-8c79d550bf">
              <div className="crm-inline-3ef3034e9c">
                <span className="crm-inline-5d22bbb1c9">
                  <Bot size={13} />
                  <span>Tidio Two-Way Sync</span>
                </span>
                <span className="crm-inline-e78e72327f" />
              </div>

              <p className="crm-inline-e40592281e">
                Synchronizes visitor conversations between the public Tidio chat bubble and this CRM console.
              </p>

              <div className="crm-inline-cf98fc66c5">
                <div className="crm-inline-e982cf4bc9">
                  <span className="crm-inline-02b3e419af">Integration:</span>
                  <strong className="crm-inline-12e1d2b3c8">{tidioInfo.enabled ? 'Live Connected' : 'Ready / Active'}</strong>
                </div>
                <div className="crm-inline-e982cf4bc9">
                  <span className="crm-inline-02b3e419af">Widget Key:</span>
                  <span className="crm-inline-33cb4f770e">
                    {tidioInfo.publicKey ? `${tidioInfo.publicKey.slice(0, 10)}...` : 'Default'}
                  </span>
                </div>
                <div className="crm-inline-e982cf4bc9">
                  <span className="crm-inline-02b3e419af">Webhook:</span>
                  <span className="crm-inline-d1523b4807">/api/tidio/webhook</span>
                </div>
              </div>

              <a
                href="https://www.tidio.com/panel/"
                target="_blank"
                rel="noreferrer"
                className="crm-chat-control-icon-btn crm-inline-4bbc602969"

              >
                <span>Open Tidio Inbox</span>
                <ExternalLink size={12} />
              </a>
            </div>

            {/* Agent Client Notes */}
            <div>
              <span className="crm-inline-6ad1451144">
                <FileText size={13} />
                <span>Private Client Notes</span>
              </span>
              <textarea
                rows={3}
                value={activeThread.notes || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setThreads((prev) =>
                    prev.map((t) => (t.id === activeThread.id ? { ...t, notes: val } : t))
                  );
                }}
                onBlur={(e) => { void handleSaveThreadNotes(activeThread.id, e.currentTarget.value); }}
                placeholder="Private agent notes..."
                className="crm-inline-06858f304c"
              />
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
