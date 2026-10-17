import React from 'react';

export default function ClientSupportTickets({
  client,
  tickets,
  loading,
  error,
  drafts,
  replyingId,
  onDraftChange,
  onRefresh,
  onReply,
}) {
  return (
    <section style={{ marginBottom: 0, padding: 0, border: 0, borderRadius: 0, background: 'transparent' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div>
          <h3 className="crm-inline-ea6402deab">Support Tickets</h3>
          <p className="crm-inline-a172100265">Client-submitted portal requests and replies. Responses here appear in that ticket in the client portal.</p>
        </div>
        <button type="button" onClick={onRefresh} className="crm-button crm-button-secondary crm-inline-64c753f0c8">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error && <div role="alert" style={{ marginBottom: 12, color: '#ff6961' }}>{error}</div>}
      {loading ? (
        <p className="crm-inline-a172100265">Loading support tickets…</p>
      ) : tickets.length === 0 ? (
        <p className="crm-inline-a172100265">No portal support tickets have been submitted by this client.</p>
      ) : (
        <div
          className="crm-support-ticket-list"
          style={{ border: '1px solid var(--crm-border, rgba(255,255,255,.1))', borderRadius: 12, overflowX: 'hidden', background: 'var(--crm-card, rgba(255,255,255,.03))' }}
        >
          {tickets.map((ticket, index) => (
            <article
              key={ticket.id}
              style={{
                padding: 14,
                borderBottom: index < tickets.length - 1 ? '1px solid var(--crm-border, rgba(255,255,255,.1))' : 0,
              }}
              data-testid={`crm-support-ticket-${ticket.id}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                <div>
                  <strong>{ticket.subject}</strong>
                  <div className="crm-inline-a172100265">{ticket.ticketNumber} · {ticket.category} · {ticket.priority}</div>
                </div>
                <span>{ticket.status}</span>
              </div>
              <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                {(ticket.messages || []).map((message) => (
                  <div key={message.id} style={{ padding: 10, borderRadius: 10, background: message.sender === 'staff' || message.sender === 'agent' ? 'rgba(0,113,227,.12)' : 'rgba(255,255,255,.04)' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      {message.senderName || (message.sender === 'staff' ? 'Support' : client.name)}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>
                  </div>
                ))}
              </div>
              <form onSubmit={(event) => { event.preventDefault(); void onReply(ticket); }} style={{ display: 'flex', gap: 8 }}>
                <input
                  aria-label={`Reply to ${ticket.ticketNumber}`}
                  value={drafts[ticket.id] || ''}
                  onChange={(event) => onDraftChange(ticket.id, event.target.value)}
                  maxLength={5000}
                  placeholder="Write a reply to this portal ticket..."
                  style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--crm-border, rgba(255,255,255,.15))', background: 'var(--crm-input, rgba(0,0,0,.15))', color: 'inherit' }}
                />
                <button
                  type="submit"
                  disabled={replyingId === ticket.id || !String(drafts[ticket.id] || '').trim()}
                  className="crm-button crm-button-primary crm-inline-ff72acff12"
                >
                  {replyingId === ticket.id ? 'Sending…' : 'Reply'}
                </button>
              </form>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
