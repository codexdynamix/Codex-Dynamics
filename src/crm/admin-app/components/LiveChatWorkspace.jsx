import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  MessageSquare,
  Send,
  Search,
  User,
  Globe,
  Trash2,
  CheckCheck,
  Radio,
  X,
  ArrowRight,
  Maximize2,
  Minimize2,
  Eraser,
  CornerDownLeft,
  Pencil,
  Check,
} from 'lucide-react';
import {
  clearAdminChat,
  deleteAdminClientMessage,
  getAdminChatThreads,
  getAdminMessages,
  getAdminChatPresence,
  getStoredAdminProfile,
  markAdminMessagesRead,
  sendAdminMessage,
  editAdminMessage,
  postAdminPresence,
} from '../adminApi';
import { SearchAutocomplete } from './UserChrome.jsx';

const formatChatTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};


const getClientId = (client) => String(client?.id || client?._id || client?.client_id || '');
const getClientName = (client) => (
  client?.name
  || client?.fullName
  || client?.full_name
  || [client?.firstName, client?.lastName].filter(Boolean).join(' ')
  || client?.email
  || 'Client'
);

const normalizeMessage = (message) => ({
  id: String(message.id || message._id || ''),
  sender: message.sender === 'agent' ? 'agent' : message.sender === 'system' ? 'system' : 'visitor',
  sender_id: message.senderId || message.sender_id || message.agentId || '',
  sender_name: message.senderName || message.sender_name || '',
  text: message.body || message.text || '',
  created_at: message.timestamp || message.createdAt || message.created_at,
  edited_at: message.editedAt || message.edited_at || null,
});

export default function LiveChatWorkspace({ showNotification = () => {}, clients = [], currentUser }) {
  const [threads, setThreads] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [agentInput, setAgentInput] = useState('');
  const [showRightPanel, setShowRightPanel] = useState(true);
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

  const reloadThreads = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setIsLoadingThreads(true);
    try {
      const profile = getStoredAdminProfile();
      setCurrentAdmin(profile);
      const result = await getAdminChatThreads();
      const clientById = new Map(clients.map((client) => [getClientId(client), client]).filter(([id]) => id));
      const messagesByClient = new Map();
      result.forEach((message) => {
        const clientId = String(message.user_id || message.clientId || message.client_id || '');
        if (!clientById.has(clientId)) return;
        if (!messagesByClient.has(clientId)) messagesByClient.set(clientId, []);
        messagesByClient.get(clientId).push(message);
      });

      const nextThreads = Array.from(clientById.entries()).map(([clientId, client]) => {
        const clientMessages = (messagesByClient.get(clientId) || [])
          .sort((left, right) => new Date(left.timestamp || left.createdAt || left.created_at || 0)
            - new Date(right.timestamp || right.createdAt || right.created_at || 0))
          .map(normalizeMessage);
        const lastMessage = clientMessages[clientMessages.length - 1];
        const unreadCount = (messagesByClient.get(clientId) || [])
          .filter((message) => message.sender === 'client' && message.read !== true).length;
        return {
          id: clientId,
          client_id: clientId,
          visitor_name: getClientName(client),
          visitor_email: client.email || '',
          location: client.company || client.organization || client.location || '',
          client,
          status: 'active',
          unread_count: unreadCount,
          messages: clientMessages,
          last_message_at: lastMessage?.created_at || null,
        };
      });

      setThreads(nextThreads);
      setSelectedThreadId((current) => nextThreads.some((thread) => thread.id === current)
        ? current
        : (nextThreads[0]?.id || null));
      setChatError('');
    } catch (error) {
      setChatError(error.message || 'Conversations could not be loaded.');
    } finally {
      if (!quiet) setIsLoadingThreads(false);
    }
  }, [clients]);

  useEffect(() => {
    let active = true;
    const refresh = () => { if (active) void reloadThreads({ quiet: true }); };
    void reloadThreads();
    const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [reloadThreads]);

  const activeThread = useMemo(() => {
    return threads.find((t) => t.id === selectedThreadId) || threads[0] || null;
  }, [threads, selectedThreadId]);

  const reloadMessages = async (clientId, { markRead = false } = {}) => {
    if (!clientId) return;
    const result = await getAdminMessages(clientId, { limit: 100 });
    const messages = result.messages.map(normalizeMessage);
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

  // Every assigned client appears here, including clients with no chat history.
  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchName = t.visitor_name?.toLowerCase().includes(q);
      const matchEmail = t.visitor_email?.toLowerCase().includes(q);
      const matchLocation = t.location?.toLowerCase().includes(q);
      const matchMessages = t.messages?.some((m) => m.text?.toLowerCase().includes(q));
      return matchName || matchEmail || matchLocation || matchMessages;
    });
  }, [threads, searchQuery]);

  const stats = useMemo(() => ({
    total: threads.length,
    withMessages: threads.filter((thread) => thread.messages.length > 0).length,
    unread: threads.reduce((totalUnread, thread) => totalUnread + thread.unread_count, 0),
  }), [threads]);

  // Handle agent sending a reply
  const handleSendAgentMessage = async () => {
    const text = agentInput.trim();
    if (!text || !activeThread || isSending) return;
    setIsSending(true);
    setChatError('');
    try {
      await sendAdminMessage(
        activeThread.id,
        text,
        currentUser?.name || currentUser?.fullName || currentAdmin?.name || 'Codex Dynamics Support',
      );
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
      await deleteAdminClientMessage(activeThread.id, messageId);
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

  const summaryCards = [
    ['Assigned Clients', stats.total, 'Available in your chat list'],
    ['Existing Chats', stats.withMessages, 'Clients with conversation history'],
    ['Unread Messages', stats.unread, 'Waiting for a staff reply'],
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
              <h2>Client Conversations</h2>
            </div>
          </div>
          <p>
            Open any assigned client here to continue the same conversation available in their profile.
          </p>
        </div>

        <div className="crm-content-hub-header-workflow">
          <div className="crm-content-hub-workflow-label">
            <Radio size={13} className="text-emerald-400" />
            <strong>Profile Chat Shortcut</strong>
          </div>
          <div className="crm-content-hub-workflow-steps">
            <span>Assigned Client</span>
            <ArrowRight size={12} />
            <span>Existing Chat</span>
            <ArrowRight size={12} />
            <span>Reply</span>
          </div>
        </div>
      </header>

      {/* 2. Standard 4-Tile Metrics Bar */}
      <div className="crm-content-hub-summary" aria-label="Live Chat Summary">
        {summaryCards.map(([label, value, detail]) => (
          <div className="crm-content-hub-summary-card" key={label}>
            <span className="crm-content-hub-summary-icon">
              <MessageSquare size={18} strokeWidth={2.2} />
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
            <div className="crm-chat-sidebar-head">
              <div className="crm-chat-search-bar">
                <div className="crm-chat-search-field">
                  <Search size={14} className="crm-chat-search-lens" />
                  <SearchAutocomplete
                    value={searchQuery}
                    onChange={setSearchQuery}
                    inputProps={{
                      onKeyDown: (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          showNotification(searchQuery.trim() ? `Filtered clients by "${searchQuery.trim()}"` : 'Showing all assigned clients');
                        }
                      },
                    }}
                    placeholder="Search assigned clients..."
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

                <button
                  type="button"
                  onClick={() => {
                    showNotification(searchQuery.trim() ? `Filtered clients by "${searchQuery.trim()}"` : 'Showing all assigned clients');
                  }}
                  className="crm-chat-search-enter-btn"
                  title="Search conversations"
                >
                  <span>Enter</span>
                  <CornerDownLeft size={11} />
                </button>
              </div>
            </div>

            <div className="crm-chat-threads-list">
              {chatError && <p className="crm-error-text" role="alert">{chatError}</p>}
              {filteredThreads.length === 0 ? (
                <div className="crm-inline-257f97946c">
                  <MessageSquare size={28} className="crm-inline-35d148ae23" />
                  {isLoadingThreads
                    ? 'Loading assigned clients...'
                    : clients.length === 0
                      ? 'No clients are currently assigned to your account.'
                      : 'No assigned clients match your search.'}
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
                    aria-label="Send message"
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

        {/* Client details */}
        {showRightPanel && activeThread && (
          <aside className="crm-chat-meta-standalone">
            <div>
              <div className="crm-inline-4184195f94">
                <span className="crm-inline-5d22bbb1c9">
                  <User size={13} />
                  <span>Client Details</span>
                </span>
              </div>

              <div className="crm-inline-0dd0d7df81">
                <div>
                  <span className="crm-inline-3e879d5ce8">Name</span>
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

                {activeThread.location && (
                  <div>
                    <span className="crm-inline-3e879d5ce8">Company / Location</span>
                    <span className="crm-inline-394edf2bf6">
                      <Globe size={12} className="crm-inline-02b3e419af" />
                      {activeThread.location}
                    </span>
                  </div>
                )}
                {activeThread.client?.phone && (
                  <div>
                    <span className="crm-inline-3e879d5ce8">Phone</span>
                    <span className="crm-inline-394edf2bf6">{activeThread.client.phone}</span>
                  </div>
                )}
                {activeThread.client?.stage && (
                  <div>
                    <span className="crm-inline-3e879d5ce8">Client Stage</span>
                    <span className="crm-inline-394edf2bf6">{activeThread.client.stage}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="crm-inline-c1d507337e">
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
          </aside>
        )}
      </div>
    </section>
  );
}
