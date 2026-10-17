import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Headphones,
  Plus,
  Send,
  CheckCircle2,
  Clock,
  AlertCircle,
  Search,
  ArrowLeft,
  Paperclip,
  CheckCheck,
  User,
  Sparkles,
  X,
  MessageSquare,
  ClipboardList,
  Trash2,
  Pencil,
  Check,
} from 'lucide-react';
import { portalDb, type PortalClient, type ClientSupportTicket, type SharedChatMessage } from '../../services/portalDatabase';
import { SearchAutocomplete } from '../../components/SearchAutocomplete.jsx';

interface PortalSupportProps {
  client: PortalClient;
  onNavigate: (path: string) => void;
  requestFeature?: boolean;
}

function areSameChatMessages(current: SharedChatMessage[], next: SharedChatMessage[]) {
  return current.length === next.length && current.every((message, index) => {
    const candidate = next[index];
    return message.id === candidate.id
      && message.text === candidate.text
      && message.sender === candidate.sender
      && message.senderName === candidate.senderName
      && message.editedAt === candidate.editedAt;
  });
}

function ClientDirectChat({ client }: { client: PortalClient }) {
  const [messages, setMessages] = useState<SharedChatMessage[]>([]);
  const [presence, setPresence] = useState({ staffTyping: false, staffOnline: false });
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingText, setEditingText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingHeartbeatRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [history, currentPresence] = await Promise.all([
        portalDb.getSharedChatMessages(client.id),
        portalDb.getSharedChatPresence(),
      ]);
      setMessages(current => areSameChatMessages(current, history) ? current : history);
      setPresence(currentPresence);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Chat could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [client.id]);

  const stopTyping = useCallback(() => {
    if (typingTimeoutRef.current !== null) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = null;
    if (typingHeartbeatRef.current !== null) window.clearInterval(typingHeartbeatRef.current);
    typingHeartbeatRef.current = null;
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      void portalDb.setSharedChatTyping(false).catch((error) => {
        setError(error instanceof Error ? error.message : 'Could not update chat presence.');
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      window.clearInterval(timer);
      if (typingTimeoutRef.current !== null) window.clearTimeout(typingTimeoutRef.current);
      if (typingHeartbeatRef.current !== null) window.clearInterval(typingHeartbeatRef.current);
      if (typingActiveRef.current) {
        void portalDb.setSharedChatTyping(false).catch((error) => {
          console.error('[PortalSupport] Could not clear chat typing presence.', error);
        });
      }
    };
  }, [refresh]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const updateDraft = (value: string) => {
    setDraft(value);
    const typing = Boolean(value.trim());
    if (typing && !typingActiveRef.current) {
      typingActiveRef.current = true;
      void portalDb.setSharedChatTyping(true).catch((error) => {
        setError(error instanceof Error ? error.message : 'Could not update chat presence.');
      });
      typingHeartbeatRef.current = window.setInterval(() => {
        void portalDb.setSharedChatTyping(true).catch((error) => {
          setError(error instanceof Error ? error.message : 'Could not update chat presence.');
        });
      }, 3000);
    }
    if (typingTimeoutRef.current !== null) window.clearTimeout(typingTimeoutRef.current);
    if (typing) typingTimeoutRef.current = window.setTimeout(stopTyping, 8000);
    else stopTyping();
  };

  const send = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    stopTyping();
    try {
      const sent = await portalDb.sendSharedChatMessage(client.id, text);
      setMessages(current => [...current, sent]);
      setDraft('');
      void refresh();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Your message could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (message: SharedChatMessage) => {
    const text = editingText.trim();
    if (!text) return;
    setBusy(true);
    setError('');
    try {
      await portalDb.editSharedChatMessage(message.id, text);
      setEditingId('');
      setEditingText('');
      await refresh();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : 'This message could not be edited.');
    } finally {
      setBusy(false);
    }
  };

  const deleteMessage = async (message: SharedChatMessage) => {
    if (!window.confirm('Hide this message from your chat? The support team will still be able to see it.')) return;
    setBusy(true);
    setError('');
    try {
      await portalDb.deleteSharedChatMessage(message.id);
      setMessages(current => current.filter(item => item.id !== message.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'This message could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  const clearChat = async () => {
    if (!messages.length || !window.confirm('Clear this conversation from your chat? The support team will still be able to see the messages.')) return;
    setBusy(true);
    setError('');
    try {
      await portalDb.clearSharedChatMessages();
      setMessages([]);
      await refresh();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : 'The conversation could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-black/[0.08] bg-white dark:border-white/[0.08] dark:bg-[#18181B]" aria-label="Direct client chat">
    <header className="flex items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0071E3]/10 text-[#0071E3]"><Headphones size={17}/></span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[#1D1D1F] dark:text-white">Codex Dynamics Support</h2>
          <p className="text-[11px] text-[#86868B]">{presence.staffTyping ? 'Support is typing…' : presence.staffOnline ? 'Support team online' : 'Messages are shared with your support team'}</p>
        </div>
      </div>
      <button type="button" onClick={() => void clearChat()} disabled={busy || !messages.length} aria-label="Clear chat" title="Clear chat" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[#8E8E93] hover:bg-[#FF3B30]/10 hover:text-[#FF3B30] disabled:opacity-40"><Trash2 size={16}/></button>
    </header>
    {error && <div role="alert" className="mx-4 mt-3 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</div>}
    <div className="flex-1 space-y-4 overflow-y-auto bg-[#F5F5F7] p-4 dark:bg-[#101012] sm:p-6">
      {loading && <p role="status" className="py-8 text-center text-sm text-[#86868B]">Loading your shared conversation…</p>}
      {!loading && !messages.length && <div className="mx-auto flex max-w-sm flex-col items-center py-12 text-center"><span className="flex size-12 items-center justify-center rounded-full bg-white text-[#0071E3] dark:bg-[#1C1C1E]"><MessageSquare size={22}/></span><h3 className="mt-3 text-sm font-semibold text-[#1D1D1F] dark:text-white">Start a conversation</h3><p className="mt-1 text-xs leading-relaxed text-[#86868B]">Messages here are shared with your Codex Dynamics support team.</p></div>}
      {messages.map(message => {
        const own = message.sender === 'client';
        const created = new Date(message.createdAt).getTime();
        const canEdit = own && Number.isFinite(created) && Date.now() - created >= 0 && Date.now() - created <= 7 * 60 * 1000;
        return <article key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[88%] sm:max-w-[72%] ${own ? 'items-end' : 'items-start'} flex flex-col`}>
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] text-[#86868B]"><span className="font-medium">{own ? 'You' : message.senderName || 'Codex Dynamics Support'}</span><span>·</span><time>{Number.isFinite(created) ? new Date(created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable'}</time></div>
            {editingId === message.id ? <div className="flex w-full gap-1.5"><textarea autoFocus value={editingText} maxLength={5000} onChange={event => setEditingText(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-black/[0.1] bg-white p-2 text-sm text-[#1D1D1F] dark:border-white/[0.1] dark:bg-[#1C1C1E] dark:text-white"/><button type="button" aria-label="Save edit" disabled={busy} onClick={() => void saveEdit(message)} className="rounded-lg bg-[#0071E3] px-2 text-white"><Check size={15}/></button><button type="button" aria-label="Cancel edit" onClick={() => setEditingId('')} className="rounded-lg border border-black/[0.1] px-2 text-[#6E6E73] dark:border-white/[0.12]"><X size={15}/></button></div> : <div className={`whitespace-pre-wrap break-words rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${own ? 'bg-[#0071E3] text-white' : 'border border-black/[0.05] bg-white text-[#1D1D1F] dark:border-white/[0.08] dark:bg-[#1E1E22] dark:text-[#F5F5F7]'}`}>
              {message.text}{message.editedAt && <span className="ml-2 text-[10px] opacity-70">Edited</span>}
            </div>}
            {canEdit && editingId !== message.id && <button type="button" onClick={() => { setEditingId(message.id); setEditingText(message.text); }} className="mt-1 inline-flex items-center gap-1 px-1 text-[10px] text-[#6E6E73] hover:text-[#0071E3]"><Pencil size={11}/>Edit for {Math.max(0, Math.ceil((7 * 60 * 1000 - (Date.now() - created)) / 60000))} min</button>}
            {editingId !== message.id && <button type="button" disabled={busy} onClick={() => void deleteMessage(message)} className="mt-1 inline-flex items-center gap-1 px-1 text-[10px] text-[#6E6E73] hover:text-[#FF3B30] disabled:opacity-50"><Trash2 size={11}/>Delete</button>}
          </div>
        </article>;
      })}
      {presence.staffTyping && <p className="text-xs text-[#86868B]">Support is typing…</p>}
      <div ref={messagesEndRef}/>
    </div>
    <form onSubmit={send} className="flex items-end gap-2 border-t border-black/[0.06] bg-white p-3 dark:border-white/[0.08] dark:bg-[#18181B] sm:p-4">
      <textarea aria-label="Message support" rows={2} maxLength={5000} value={draft} onChange={event => updateDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Write a message…" className="min-h-[44px] min-w-0 flex-1 resize-y rounded-lg border border-black/[0.08] bg-[#F5F5F7] px-3 py-2 text-sm text-[#1D1D1F] outline-none focus:border-[#0071E3] dark:border-white/[0.1] dark:bg-[#242428] dark:text-white"/>
      <button type="submit" disabled={busy || !draft.trim()} aria-label="Send message" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#0071E3] text-white disabled:opacity-40"><Send size={16}/></button>
    </form>
  </section>;
}

export function PortalSupport({ client, requestFeature = false }: PortalSupportProps) {
  const [activeChannel, setActiveChannel] = useState<'chat' | 'tickets'>(requestFeature ? 'tickets' : 'chat');
  const [tickets, setTickets] = useState<ClientSupportTicket[]>(() => portalDb.getSupportTickets(client.id));
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(tickets[0]?.id || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'resolved'>('all');
  const [replyText, setReplyText] = useState('');
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [actionError, setActionError] = useState('');

  // New Ticket Form State
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<ClientSupportTicket['category']>('Website & Code');
  const [priority, setPriority] = useState<ClientSupportTicket['priority']>('Medium');
  const [message, setMessage] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!requestFeature) return;
    setCategory('Custom Feature');
    setSubject((current) => current || 'Custom feature request');
    setMessage('');
    setCreateModalOpen(true);
  }, [requestFeature]);

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) || tickets[0] || null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedTicket?.messages?.length, selectedTicketId]);

  // Real-time synchronization with Admin CRM support chat
  useEffect(() => {
    const handleSync = (e: any) => {
      if (!e.detail?.clientId || e.detail.clientId === client.id) {
        setTickets(portalDb.getSupportTickets(client.id));
      }
    };
    window.addEventListener('cdx_chat_message_received', handleSync);
    window.addEventListener('cdx_portal_database_updated', handleSync);
    window.addEventListener('storage', handleSync);
    return () => {
      window.removeEventListener('cdx_chat_message_received', handleSync);
      window.removeEventListener('cdx_portal_database_updated', handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, [client.id]);

  const filteredTickets = tickets.filter((t) => {
    const matchesSearch =
      t.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.ticketNumber.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filterStatus === 'open') return t.status !== 'Resolved' && t.status !== 'Closed';
    if (filterStatus === 'resolved') return t.status === 'Resolved' || t.status === 'Closed';
    return true;
  });

  const handleSelectTicket = (id: string) => {
    setSelectedTicketId(id);
    setShowMobileChat(true);
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = replyText.trim();
    if (!selectedTicket || !text) return;

    setActionError('');
    try {
      await portalDb.addSupportTicketReply(client.id, selectedTicket.id, text);
      setReplyText('');
      setTickets(portalDb.getSupportTickets(client.id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not send the reply.');
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    setActionError('');
    try {
      const created = await portalDb.createSupportTicket(client.id, {
        subject: subject.trim(),
        category,
        priority,
        message: message.trim(),
      });
      setTickets(portalDb.getSupportTickets(client.id));
      setSelectedTicketId(created.id);
      setShowMobileChat(true);
      setCreateModalOpen(false);
      setSubject('');
      setMessage('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not create the ticket.');
    }
  };

  return (
    <div className="font-sans flex flex-col h-[calc(100vh-140px)] min-h-[580px]">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-black/[0.06] dark:border-white/[0.08] mb-4 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] tracking-tight">
            Support &amp; Direct Messaging
          </h1>
          <p className="text-xs text-[#86868B] mt-0.5">
            Joined channel with your dedicated team
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Support workspace" className="inline-flex rounded-lg bg-black/[0.04] p-1 dark:bg-white/[0.06]">
            <button type="button" role="tab" aria-selected={activeChannel === 'chat'} onClick={() => setActiveChannel('chat')} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${activeChannel === 'chat' ? 'bg-white text-[#1D1D1F] dark:bg-[#242428] dark:text-white' : 'text-[#6E6E73] dark:text-[#98989D]'}`}><MessageSquare size={13}/>Chat</button>
            <button type="button" role="tab" aria-selected={activeChannel === 'tickets'} onClick={() => setActiveChannel('tickets')} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${activeChannel === 'tickets' ? 'bg-white text-[#1D1D1F] dark:bg-[#242428] dark:text-white' : 'text-[#6E6E73] dark:text-[#98989D]'}`}><ClipboardList size={13}/>Tickets</button>
          </div>
          {activeChannel === 'tickets' && <button type="button" onClick={() => setCreateModalOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0071E3] px-3 py-2 text-xs font-medium text-white"><Plus size={14}/><span>New Ticket</span></button>}
        </div>
      </div>

      {actionError && (
        <div role="alert" className="mb-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {activeChannel === 'chat' ? <ClientDirectChat client={client} /> : <>
      {/* Existing ticket workflow remains separate from the shared support chat. */}
      <div className="flex-1 min-h-0 bg-white dark:bg-[#18181B] rounded-3xl border border-black/[0.08] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex overflow-hidden">
        {/* Left Pane: Chat / Ticket List */}
        <div
          className={`${
            showMobileChat ? 'hidden md:flex' : 'flex'
          } w-full md:w-80 lg:w-96 flex-col border-r border-black/[0.06] dark:border-white/[0.08] shrink-0 bg-white dark:bg-[#18181B] min-h-0`}
        >
          {/* Search & Compose Header */}
          <div className="p-3 border-b border-black/[0.06] dark:border-white/[0.08] space-y-2 shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868B]" />
              <SearchAutocomplete
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search conversations..."
                className="w-full bg-[#F5F5F7] dark:bg-[#242428] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#1D1D1F] dark:text-white placeholder-[#86868B] focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
                style={{ minWidth: 0 }}
                buildSuggestions={(query) => filteredTickets.filter((ticket) => [ticket.subject, ticket.ticketNumber]
                  .some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
                  .slice(0, 8).map((ticket) => ({
                    key: ticket.id,
                    value: ticket.subject,
                    label: ticket.subject,
                    meta: `${ticket.ticketNumber} · ${ticket.status}`,
                  }))}
              />
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 bg-[#F5F5F7] dark:bg-[#242428] p-0.5 rounded-lg text-[11px]">
              {(['all', 'open', 'resolved'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setFilterStatus(filter)}
                  className={`flex-1 py-1 rounded-md capitalize font-medium transition-all ${
                    filterStatus === filter
                      ? 'bg-white dark:bg-[#323236] text-[#1D1D1F] dark:text-white shadow-xs'
                      : 'text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {/* Ticket Threads List */}
          <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-black/[0.04] dark:divide-white/[0.04]">
            {filteredTickets.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#86868B]">
                No conversations found
              </div>
            ) : (
              filteredTickets.map((t) => {
                const isSelected = t.id === selectedTicket?.id;
                const lastMsg = t.messages[t.messages.length - 1];
                const isOpen = t.status !== 'Resolved' && t.status !== 'Closed';

                return (
                  <div
                    key={t.id}
                    onClick={() => handleSelectTicket(t.id)}
                    className={`p-3.5 cursor-pointer transition-colors flex items-start gap-3 ${
                      isSelected
                        ? 'bg-[#0071E3]/[0.08] dark:bg-[#0071E3]/[0.15]'
                        : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
                    }`}
                  >
                    {/* Status Avatar */}
                    <div className="size-10 rounded-full bg-gradient-to-br from-[#0071E3] to-[#0A84FF] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                      {t.subject.charAt(0).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <div className="text-xs font-semibold text-[#1D1D1F] dark:text-white truncate">
                          {t.subject}
                        </div>
                        <span className="text-[10px] text-[#86868B] shrink-0 font-mono">
                          {new Date(t.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div className="text-[11px] text-[#86868B] truncate line-clamp-1">
                        {lastMsg ? lastMsg.text : 'No messages'}
                      </div>

                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="font-mono text-[9px] text-[#86868B]">{t.ticketNumber}</span>
                        <span className="text-[#86868B]/40">·</span>
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded-full font-medium ${
                            isOpen
                              ? 'bg-[#0071E3]/10 text-[#0071E3] dark:text-[#0A84FF]'
                              : 'bg-[#30D158]/10 text-[#248A3D] dark:text-[#32D74B]'
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Joined Chat Conversation */}
        <div
          className={`${
            !showMobileChat ? 'hidden md:flex' : 'flex'
          } flex-1 flex-col min-w-0 bg-[#F5F5F7] dark:bg-[#101012] min-h-0`}
        >
          {selectedTicket ? (
            <>
              {/* Joined Chat Header */}
              <div className="h-14 px-4 sm:px-6 bg-white dark:bg-[#18181B] border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => setShowMobileChat(false)}
                    className="md:hidden p-1.5 -ml-1 text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white"
                  >
                    <ArrowLeft size={18} />
                  </button>

                  <div className="size-9 rounded-full bg-[#30D158]/10 text-[#248A3D] dark:text-[#32D74B] flex items-center justify-center font-bold text-xs shrink-0">
                    <User size={16} />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm font-semibold text-[#1D1D1F] dark:text-white truncate">
                        {selectedTicket.subject}
                      </span>
                      <span className="text-[10px] text-[#86868B] font-mono hidden sm:inline">
                        ({selectedTicket.ticketNumber})
                      </span>
                    </div>
                    <div className="text-[11px] text-[#86868B] flex items-center gap-1.5 truncate">
                      <span className="inline-block size-1.5 rounded-full bg-[#30D158]" />
                      <span>Specialist: {selectedTicket.assignedStaff}</span>
                      <span>·</span>
                      <span className="capitalize">{selectedTicket.category}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      selectedTicket.status === 'Resolved'
                        ? 'bg-[#30D158]/10 text-[#248A3D] dark:text-[#32D74B]'
                        : 'bg-[#0071E3]/10 text-[#0071E3]'
                    }`}
                  >
                    {selectedTicket.status}
                  </span>
                </div>
              </div>

              {/* Message Stream */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 min-h-0">
                {selectedTicket.messages.map((m) => {
                  const isClient = m.sender === 'client';
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isClient ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] text-[#86868B]">
                        <span className="font-medium">{m.senderName}</span>
                        <span>·</span>
                        <span className="font-mono">
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div
                        className={`max-w-[85%] sm:max-w-[70%] p-3.5 rounded-2xl text-xs sm:text-[13px] leading-relaxed shadow-xs ${
                          isClient
                            ? 'bg-[#0071E3] text-white rounded-br-xs'
                            : 'bg-white dark:bg-[#1E1E22] text-[#1D1D1F] dark:text-[#F5F5F7] border border-black/[0.05] dark:border-white/[0.08] rounded-bl-xs'
                        }`}
                      >
                        {m.text}

                        <div className={`flex items-center justify-end gap-1 mt-1 text-[9px] ${isClient ? 'text-white/70' : 'text-[#86868B]'}`}>
                          {isClient && <CheckCheck size={12} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Joined Chat Input Bar */}
              <form
                onSubmit={handleSendReply}
                className="p-3 bg-white dark:bg-[#18181B] border-t border-black/[0.06] dark:border-white/[0.08] flex items-center gap-2 shrink-0"
              >
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type a message to your engineering manager..."
                  className="flex-1 bg-[#F5F5F7] dark:bg-[#242428] rounded-xl px-4 py-2.5 text-xs text-[#1D1D1F] dark:text-white placeholder-[#86868B] focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
                />

                <button
                  type="submit"
                  disabled={!replyText.trim()}
                  className="size-9 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] disabled:opacity-30 text-white flex items-center justify-center shrink-0 transition-all shadow-xs"
                >
                  <Send size={15} />
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#86868B]">
              <Headphones size={36} className="mb-2 opacity-50" />
              <div className="text-sm font-medium text-[#1D1D1F] dark:text-white">Select a conversation</div>
              <div className="text-xs mt-1">Choose a ticket from the left or create a new request</div>
            </div>
          )}
        </div>
      </div>
      </>}

      {/* New Ticket Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/[0.1] rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06] dark:border-white/[0.08]">
              <div>
                <h3 className="text-base font-semibold text-[#1D1D1F] dark:text-white">
                  {category === 'Custom Feature' ? 'Request a Custom Feature' : 'New Support Request'}
                </h3>
                <p className="text-xs text-[#86868B]">
                  {category === 'Custom Feature' ? 'Describe the feature you would like our team to build.' : 'Direct communication thread'}
                </p>
              </div>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="p-1 rounded-lg text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-[#86868B] mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g., Update hero headline on homepage"
                  className="w-full bg-[#F5F5F7] dark:bg-[#252528] border border-black/[0.06] dark:border-white/[0.08] rounded-xl px-3.5 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[#86868B] mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full bg-[#F5F5F7] dark:bg-[#252528] border border-black/[0.06] dark:border-white/[0.08] rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
                  >
                    <option value="Website & Code">Website &amp; Code</option>
                    <option value="Custom Feature">Custom Feature</option>
                    <option value="Hosting & Server">Hosting &amp; Server</option>
                    <option value="Billing & Invoicing">Billing &amp; Invoicing</option>
                    <option value="Design & UX">Design &amp; UX</option>
                    <option value="General Question">General Question</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#86868B] mb-1">
                    Priority
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="w-full bg-[#F5F5F7] dark:bg-[#252528] border border-black/[0.06] dark:border-white/[0.08] rounded-xl px-3 py-2 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#86868B] mb-1">
                  Message
                </label>
                <textarea
                  required
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={category === 'Custom Feature'
                    ? 'Describe the feature, the problem it solves, and any important requirements...'
                    : 'Describe your request...'}
                  className="w-full bg-[#F5F5F7] dark:bg-[#252528] border border-black/[0.06] dark:border-white/[0.08] rounded-xl p-3 text-xs text-[#1D1D1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0071E3] resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-[#86868B] hover:text-[#1D1D1F] dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold shadow-xs"
                >
                  Send Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
