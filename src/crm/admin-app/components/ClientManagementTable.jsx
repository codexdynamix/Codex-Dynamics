import React from 'react';
import { CLIENT_STATUSES, getCountryFlag, normalizeStage, ROLE, StatusDropdown } from '../shared';

function getLastActivityLabel(client) {
  if (!client.lastCommentDate) return { label: 'Never', color: null };
  const days = Math.floor((Date.now() - new Date(client.lastCommentDate).getTime()) / 86400000);
  return {
    label: days === 0 ? 'Today' : days === 1 ? '1d ago' : `${days}d ago`,
    color: days === 0 ? '#0ECB81' : days <= 3 ? '#0ECB81' : days <= 7 ? 'var(--crm-accent)' : days <= 30 ? '#FF9F0A' : '#F6465D',
  };
}

export default function ClientManagementTable({
  data,
  clients,
  loading = false,
  selected,
  onTogglePage,
  onToggleClient,
  onOpenClient,
  onStatusChange,
  onEnterPortal,
  onEditClient,
  onMoveToBin,
  page,
  totalPages,
  onPageChange,
  quickAssignment,
}) {
  const pageSelected = clients.length > 0 && clients.every((client) => selected.includes(client.id));

  return (
    <>
      <div className="crm-admin-table-container">
        <table className="crm-admin-table">
          <thead>
            <tr>
              <th className="crm-inline-3666be5c05">
                <input type="checkbox" checked={pageSelected} onChange={(event) => onTogglePage(event.target.checked)} />
              </th>
              <th>Client ID</th>
              <th>Name</th>
              <th>Country</th>
              <th>Status</th>
              <th>Registered</th>
              <th>Last Activity</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr><td colSpan={8} className="crm-inline-69d13600ed">{loading ? 'Loading clients…' : 'No clients match your filters.'}</td></tr>
            ) : clients.map((client) => {
              const isSelected = selected.includes(client.id);
              const lastActivity = getLastActivityLabel(client);
              return (
                <React.Fragment key={client.id}>
                  <tr
                    className="crm-inline-8410c989c9"
                    style={{ background: isSelected ? 'var(--crm-card)' : undefined }}
                    onClick={() => onOpenClient(client)}
                  >
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) => onToggleClient(client.id, event.target.checked)}
                      />
                    </td>
                    <td className="crm-inline-93c6e1d4bb">
                      <div className="crm-inline-9023e926fd">
                        <span className="crm-inline-fc24c65864">{client.id ? client.id.slice(0, 6) : '-'}</span>
                        {client.id && (
                          <button
                            title={client.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              navigator.clipboard.writeText(client.id);
                            }}
                            className="crm-inline-ccd1cf626f"
                          >
                            <i className="fas fa-copy crm-inline-e9e0e4af65" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="crm-inline-2a907996ec">
                        <div>
                          <div className="crm-inline-22d6a321ff">{client.firstName} {client.lastName}</div>
                          <div className="crm-inline-b4bc3c00c9">{client.email || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td>{getCountryFlag(client.countryCode, client.country)} {client.country}</td>
                    <td onClick={(event) => event.stopPropagation()} className="crm-inline-93c6e1d4bb">
                      <StatusDropdown
                        value={normalizeStage(client.stage)}
                        options={CLIENT_STATUSES}
                        onChange={(stage) => onStatusChange(client.id, stage)}
                      />
                    </td>
                    <td className="crm-inline-a81558e644">
                      {client.registeredDate || (client.createdAt ? new Date(client.createdAt).toLocaleDateString() : '-')}
                    </td>
                    <td className="crm-inline-93c6e1d4bb">
                      {lastActivity.color ? (
                        <span
                          className="crm-inline-5b305d031c"
                          style={{
                            background: `${lastActivity.color}18`,
                            color: lastActivity.color,
                            border: `1px solid ${lastActivity.color}33`,
                          }}
                        >
                          {lastActivity.label}
                        </span>
                      ) : <span className="crm-inline-d2b86264af">{lastActivity.label}</span>}
                    </td>
                    <td onClick={(event) => event.stopPropagation()} className="crm-inline-93c6e1d4bb">
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        <button
                          className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-2b76d0882a"
                          onClick={() => onEnterPortal(client)}
                          title="Enter client portal directly (no password needed)"
                        >🚀 Enter Portal</button>
                        <button
                          className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-a9a778b759"
                          onClick={() => onEditClient(client)}
                          title="Edit client profile fields"
                        >Edit</button>
                        <button
                          className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-7106182ce9"
                          onClick={() => onMoveToBin(client)}
                          title="Move to Recycle Bin"
                        >🗑 Bin</button>
                      </div>
                    </td>
                  </tr>
                  {quickAssignment?.clientId === client.id && (
                    <tr className="crm-inline-0c90dd5535">
                      <td colSpan={8} className="crm-inline-8ebf6e213b" onClick={(event) => event.stopPropagation()}>
                        <div className="crm-inline-a92a09d3d7">
                          <span className="crm-inline-a0086506f6">Assign "{client.firstName} {client.lastName}" to:</span>
                          <select
                            className="crm-super-admin-select crm-inline-8fb290329b"
                            value={quickAssignment.agentId}
                            onChange={(event) => quickAssignment.onAgentChange(event.target.value)}
                            autoFocus
                          >
                            <option value="">- Unassign (return to pool) -</option>
                            {data.offices.map((office) => {
                              const officeAgents = data.users.filter((user) => user.role === ROLE.AGENT && user.officeId === office.id);
                              if (!officeAgents.length) return null;
                              return (
                                <optgroup key={office.id} label={`[office] ${office.name}`}>
                                  {officeAgents.map((agent) => {
                                    const team = data.teams.find((item) => item.id === agent.teamId);
                                    return (
                                      <option key={agent.id} value={agent.id}>
                                        {agent.name}{team ? `  /  ${team.name}` : ''}
                                      </option>
                                    );
                                  })}
                                </optgroup>
                              );
                            })}
                            {data.users.filter((user) => user.role === ROLE.AGENT && !user.officeId).map((agent) => (
                              <option key={agent.id} value={agent.id}>{agent.name} (no office)</option>
                            ))}
                          </select>
                          <button
                            className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-7235bfdd8f"
                            onClick={() => quickAssignment.onApply(client)}
                          >✓ Apply</button>
                          <button
                            className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-7c51cb61d4"
                            onClick={quickAssignment.onCancel}
                          >✕ Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="crm-inline-cabecec358">
          <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={page === 1} onClick={() => onPageChange(1)}>«</button>
          <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={page === 1} onClick={() => onPageChange(page - 1)}>‹ Prev</button>
          <span className="crm-inline-2d73a8a9dc">Page {page} of {totalPages}</span>
          <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next ›</button>
          <button className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}>»</button>
        </div>
      )}
    </>
  );
}
