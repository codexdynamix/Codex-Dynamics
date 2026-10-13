import React, { useEffect, useState } from 'react';
import {
  getClientProfilePermissionsAdmin,
  saveClientProfilePermissionsAdmin,
} from '../adminApi.js';

const noneSelected = { access: 'none', accounting: 'none' };
const controlStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  border: '1px solid var(--crm-border, #3b3d45)',
  borderRadius: 8,
  background: 'var(--crm-card, #23242a)',
  color: 'var(--crm-text-primary, #fff)',
  fontSize: 12,
};

const levelLabel = (level) => ({
  none: 'No access',
  read: 'Read only',
  edit: 'Read and edit',
}[level] || 'No access');

export default function ClientProfilePermissionManager({ clientId, showNotification }) {
  const [staff, setStaff] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [draft, setDraft] = useState(noneSelected);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setSelectedStaffId('');
    setDraft(noneSelected);
    getClientProfilePermissionsAdmin(clientId)
      .then((result) => {
        if (!active) return;
        setStaff(result.staff || []);
        setPermissions(result.permissions || {});
      })
      .catch((reason) => {
        if (active) setError(reason?.message || 'Could not load staff access for this client.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [clientId]);

  const selectStaff = (staffId) => {
    setSelectedStaffId(staffId);
    setDraft({ ...noneSelected, ...(permissions[staffId] || {}) });
  };

  const save = async (event) => {
    event.preventDefault();
    if (!selectedStaffId) return;
    setSaving(true);
    setError('');
    try {
      const result = await saveClientProfilePermissionsAdmin(clientId, selectedStaffId, draft);
      const saved = result.permissions || draft;
      setPermissions((current) => {
        const next = { ...current };
        if (saved.access === 'none' && saved.accounting === 'none') delete next[selectedStaffId];
        else next[selectedStaffId] = saved;
        return next;
      });
      setDraft(saved);
      showNotification?.('Client profile permissions saved.');
    } catch (reason) {
      setError(reason?.message || 'Could not save client profile permissions.');
    } finally {
      setSaving(false);
    }
  };

  const assignedStaff = staff.filter((member) => {
    const level = permissions[member.id];
    return level && (level.access !== 'none' || level.accounting !== 'none');
  });

  if (loading) return <p className="crm-inline-c48346103f">Loading staff access…</p>;

  return (
    <div className="crm-inline-fe803db9ff">
      <div>
        <h3 className="crm-inline-108932eb67">Staff access to this client</h3>
        <p className="crm-inline-1297139dd2">
          Choose a staff member and grant access to this client’s profile sections. Access &amp; Email and Accounting can have different permission levels.
        </p>
      </div>

      <form onSubmit={save} className="crm-inline-83720e82b9">
        <label className="crm-inline-45536971bb">
          Office manager, team leader, or agent
          <select required style={controlStyle} value={selectedStaffId} onChange={(event) => selectStaff(event.target.value)}>
            <option value="">Select a staff member</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} · {member.role}{member.email ? ` · ${member.email}` : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="crm-inline-a9cc7d7c87">
          {[
            ['access', 'Access & Email'],
            ['accounting', 'Accounting'],
          ].map(([section, label]) => (
            <label key={section} className="crm-inline-45536971bb">
              {label}
              <select
                style={controlStyle}
                value={draft[section]}
                disabled={!selectedStaffId}
                onChange={(event) => setDraft((current) => ({ ...current, [section]: event.target.value }))}
              >
                <option value="none">No access</option>
                <option value="read">Read only</option>
                <option value="edit">Read and edit</option>
              </select>
            </label>
          ))}
        </div>

        <div className="crm-inline-9a325a2ee1">
          <button
            type="submit"
            disabled={!selectedStaffId || saving || staff.length === 0}
            className="crm-inline-bba39da1d8" style={{cursor: saving ? 'wait' : 'pointer', opacity: !selectedStaffId ? 0.6 : 1}}
          >
            {saving ? 'Saving…' : draft.access === 'none' && draft.accounting === 'none' ? 'Remove access' : 'Save permissions'}
          </button>
        </div>
      </form>

      {error && <div role="alert" className="crm-inline-a8ec97f0b6">{error}</div>}

      <section className="crm-inline-ea3d7e6a2e">
        <h4 className="crm-inline-6fa6889525">People with access</h4>
        {assignedStaff.length === 0 ? (
          <p className="crm-inline-14ada2b4f3">No staff members have access to this client’s sensitive profile sections.</p>
        ) : (
          <table className="crm-inline-8fd15676c3">
            <thead>
              <tr>
                {['Staff member', 'Role', 'Access & Email', 'Accounting'].map((heading) => (
                  <th key={heading} className="crm-inline-15687e23cf">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assignedStaff.map((member) => {
                const level = permissions[member.id] || noneSelected;
                return (
                  <tr key={member.id} className="crm-inline-29c888978e">
                    <td className="crm-inline-41d3ac215d">{member.name}{member.email ? <div className="crm-inline-ddb64812f6">{member.email}</div> : null}</td>
                    <td className="crm-inline-41d3ac215d">{member.role}</td>
                    <td className="crm-inline-41d3ac215d">{levelLabel(level.access)}</td>
                    <td className="crm-inline-41d3ac215d">{levelLabel(level.accounting)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}