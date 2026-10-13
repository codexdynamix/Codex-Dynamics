import React, { useState } from 'react';
import RoleLogin from './RoleLogin.jsx';
import { ROLE } from '../../shared';

export default function StaffLogin({ onAdminLogin }) {
  const [selectedRole, setSelectedRole] = useState(ROLE.SUPER_ADMIN);

  return (
    <div className="crm-inline-b505dbd23d">
      <div
        className="crm-inline-81c0af7688"
      >
        {[
          { role: ROLE.SUPER_ADMIN, label: 'Super Admin' },
          { role: ROLE.OFFICE_MANAGER, label: 'Office Manager' },
          { role: ROLE.TEAM_LEAD, label: 'Team Leader' },
          { role: ROLE.AGENT, label: 'Agent' },
        ].map((item) => (
          <button
            key={item.role}
            type="button"
            onClick={() => setSelectedRole(item.role)}
            className="crm-inline-0acf3d5f18" style={{border: selectedRole === item.role ? '1px solid var(--crm-accent)' : '1px solid var(--crm-border)', background: selectedRole === item.role ? 'var(--crm-accent)' : 'var(--crm-card)', color: selectedRole === item.role ? '#181A20' : 'var(--crm-text-primary)'}}
          >
            {item.label}
          </button>
        ))}
      </div>
      <RoleLogin role={selectedRole} onAdminLogin={onAdminLogin} />
    </div>
  );
}
