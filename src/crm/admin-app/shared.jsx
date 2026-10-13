import React from 'react';
import { useConfirmDialog } from './components/ConfirmModal/ConfirmModal';
import './components/modal.css';
import { CountrySelect, PhoneInput, isPhoneValid, parseStoredPhone, buildStoredPhone } from './components/CountryPhoneInput/CountryPhoneInput';
import { COUNTRY_LIST, getCountryByCode, getCountryByName } from './countryData';

export const ROLE = {
  SUPER_ADMIN: 'Super Admin',
  OFFICE_MANAGER: 'Office Manager',
  TEAM_LEAD: 'Team Leader',
  AGENT: 'Agent',
};

export function assignableAgents(users, currentUser, { officeId = null, teamId = null } = {}) {
  return (users || []).filter((u) => {
    if (u.role !== ROLE.AGENT) return false;
    if (officeId && u.officeId !== officeId) return false;
    if (teamId && u.teamId !== teamId) return false;
    return true;
  });
}

export function assignableAgentLabel(agent) {
  return agent?.name || '-';
}

export const CLIENT_STATUSES = ['New','In Line','No Answer','Deposit','Failed Deposit','Didn\'t Register','Not Interested','Low Potential','NA1','NA2','NA3','Never Answer','No Potential','Wrong Person','Wrong Number','Call Back'];

// Distinct color per client stage so every pill in the status workflow timeline
// has its own identity instead of falling back to a generic gray.
export const STAGE_COLOR_MAP = {
  'New':              '#8ab89a',
  'In Line':          '#7a9bc4',
  'No Answer':        '#c9a86a',
  'Deposit':          '#7fb89a',
  'Failed Deposit':   '#d98a8a',
  "Didn't Register":  '#a89cc4',
  'Not Interested':   '#c89aa0',
  'Low Potential':    '#c9b56a',
  'NA1':              '#7eb5c0',
  'NA2':              '#6ea0ad',
  'NA3':              '#5e8a9a',
  'Never Answer':     '#c98a8a',
  'No Potential':     '#b07070',
  'Wrong Person':     '#c489a8',
  'Wrong Number':     '#b888c4',
  'Call Back':        '#7eb59a',
};

// Stable fallback palette for any unknown / future stage so we never grey-out.
// We hash the stage name to pick a palette slot deterministically.
const STAGE_FALLBACK_PALETTE = [
  '#a89cc4', '#7eb5b0', '#c9a085', '#7a9bc4', '#c9b56a',
  '#a0b88a', '#c98a8a', '#7eb5c0', '#b89cc4', '#d98a8a',
];

export const stageColor = (stage) => {
  if (!stage) return STAGE_FALLBACK_PALETTE[0];
  if (STAGE_COLOR_MAP[stage]) return STAGE_COLOR_MAP[stage];
  let hash = 0;
  for (let i = 0; i < stage.length; i += 1) {
    hash = (hash * 31 + stage.charCodeAt(i)) >>> 0;
  }
  return STAGE_FALLBACK_PALETTE[hash % STAGE_FALLBACK_PALETTE.length];
};

export function getStatusTheme(status) {
  const norm = String(status || '').toLowerCase().trim();
  if (norm === 'new') {
    return {
      dot: '#0ECB81',
      bg: 'rgba(14, 203, 129, 0.14)',
      color: '#0ECB81',
      border: 'rgba(14, 203, 129, 0.35)',
    };
  }
  if (norm === 'contacted' || norm === 'in line') {
    return {
      dot: '#0A84FF',
      bg: 'rgba(10, 132, 255, 0.14)',
      color: '#0A84FF',
      border: 'rgba(10, 132, 255, 0.35)',
    };
  }
  if (norm === 'converted' || norm === 'deposit' || norm === 'qualified' || norm === 'won') {
    return {
      dot: 'var(--crm-accent)',
      bg: 'color-mix(in srgb, var(--crm-accent) 15%, transparent)',
      color: 'var(--crm-accent)',
      border: 'color-mix(in srgb, var(--crm-accent) 35%, transparent)',
    };
  }
  if (norm === 'call back') {
    return {
      dot: '#7eb59a',
      bg: 'rgba(126, 181, 154, 0.16)',
      color: '#7eb59a',
      border: 'rgba(126, 181, 154, 0.35)',
    };
  }
  if (norm === 'no answer' || norm === 'na1' || norm === 'na2' || norm === 'na3') {
    return {
      dot: '#c9a86a',
      bg: 'rgba(201, 168, 106, 0.16)',
      color: '#c9a86a',
      border: 'rgba(201, 168, 106, 0.35)',
    };
  }
  if (norm === 'not interested' || norm === 'failed deposit' || norm === 'never answer' || norm === 'no potential') {
    return {
      dot: '#F6465D',
      bg: 'rgba(246, 70, 93, 0.14)',
      color: '#F6465D',
      border: 'rgba(246, 70, 93, 0.35)',
    };
  }
  if (norm === 'closed' || norm === 'archived' || norm === 'frozen' || norm === 'blocked') {
    return {
      dot: 'var(--crm-text-secondary)',
      bg: 'rgba(132, 142, 156, 0.14)',
      color: 'var(--crm-text-secondary)',
      border: 'rgba(132, 142, 156, 0.3)',
    };
  }
  // Custom fallback by stageColor
  const baseColor = stageColor(status);
  return {
    dot: baseColor,
    bg: `${baseColor}18`,
    color: baseColor,
    border: `${baseColor}40`,
  };
}

export function StatusDropdown({ value, options, onChange, disabled = false, style = {} }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [coords, setCoords] = React.useState({ top: 0, left: 0, showAbove: false, width: 130 });
  const buttonRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const theme = getStatusTheme(value);

  const parsedOptions = React.useMemo(() => {
    return (options || []).map((opt) => {
      if (typeof opt === 'string') return { value: opt, label: opt };
      return { value: opt.value, label: opt.label || opt.value };
    });
  }, [options]);

  const currentOption = parsedOptions.find(
    (o) => String(o.value).toLowerCase() === String(value).toLowerCase()
  ) || {
    value,
    label: value || 'Select status',
  };

  const handleToggle = (e) => {
    e.stopPropagation();
    if (disabled) return;
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuHeight = Math.min(260, parsedOptions.length * 34 + 30);
      const showAbove = rect.bottom + menuHeight > window.innerHeight && rect.top > menuHeight;
      setCoords({
        top: showAbove ? rect.top - 5 : rect.bottom + 5,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 170)),
        showAbove,
        width: Math.max(124, rect.width),
      });
    }
    setIsOpen((prev) => !prev);
  };

  React.useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target) &&
        menuRef.current &&
        !menuRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleScrollOrResize = () => {
      setIsOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick, true);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (val, e) => {
    if (e) e.stopPropagation();
    if (disabled) return;
    setIsOpen(false);
    if (val !== value && onChange) {
      onChange(val);
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        position: 'relative',
        ...style,
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="crm-inline-d525bb3af3 crm-status-select-trigger" style={{cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, boxShadow: isOpen
            ? '0 0 0 2px color-mix(in srgb, var(--crm-accent) 25%, transparent)'
            : '0 1px 2px rgba(0, 0, 0, 0.25)'}}
      >
        <span className="crm-inline-356292abad">
          <span
            className="crm-inline-356e628bfe" style={{ backgroundColor: theme.dot }}
          />
          <span
            className="crm-inline-fd398377f4" style={{color: theme.color}}
          >
            {currentOption.label}
          </span>
        </span>
        <svg
          className="crm-inline-490b206754" style={{transform: isOpen ? 'rotate(180deg)' : 'none'}}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="listbox"
          onClick={(e) => e.stopPropagation()}
          className="crm-inline-d339885565" style={{top: coords.showAbove ? undefined : coords.top, bottom: coords.showAbove ? window.innerHeight - coords.top : undefined, left: coords.left, width: Math.max(140, coords.width)}}
        >
          <div
            className="crm-inline-7a68d0938e"
          >
            Change Status
          </div>
          {parsedOptions.map((opt) => {
            const isSelected =
              String(opt.value).toLowerCase() === String(value).toLowerCase();
            const optTheme = getStatusTheme(opt.value);
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                onClick={(e) => handleSelect(opt.value, e)}
                className="crm-inline-3b0db4002b crm-status-select-option" style={{color: isSelected ? '#FFFFFF' : 'var(--crm-text-primary)', fontWeight: isSelected ? 600 : 400}}
              >
                <div className="crm-inline-5e58bffd72">
                  <span
                    className="crm-inline-fb118bf1e8" style={{ backgroundColor: optTheme.dot }}
                  />
                  <span className="crm-inline-d2aa6b09e3">
                    {opt.label}
                  </span>
                </div>
                {isSelected && (
                  <svg
                    className="crm-inline-0793948d87"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const normalizeStage = (stage) => {
  if (!stage || typeof stage !== 'string') return 'Unknown';
  const normalized = stage.trim();
  if (normalized.toLowerCase() === 'contacted') {
    // 'Contacted' is intentionally removed as a visible status in Agent Portfolio.
    return 'In Line';
  }
  return normalized;
};

export const NotificationContext = React.createContext(null);
export const DataContext = React.createContext(null);

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="crm-inline-e7a7ddca37">
          <h1>Something went wrong</h1>
          <p>{this.state.error?.message || 'Unexpected error.'}</p>
          <p>Check console for details.</p>
        </div>
      );
    }

    return this.props.children;
  }
}

export const makeLoginLink = (userId, role) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (!role || role === ROLE.SUPER_ADMIN) return `${origin}/admin/login/super-admin`;
  if (role === ROLE.OFFICE_MANAGER) return `${origin}/admin/login/office-manager`;
  if (role === ROLE.TEAM_LEAD) return `${origin}/admin/login/team-leader`;
  if (role === ROLE.AGENT) return `${origin}/admin/login/agent`;
  return `${origin}/admin/staff-login`;
};

export const initialData = {
  users: [],
  offices: [],
  teams: [],
  clients: [],
  deletedClients: [],
};

export const getOfficeName = (officeId, offices) => offices.find((o) => o.id === officeId)?.name || '-';
export const getTeamName = (teamId, teams) => teams.find((t) => t.id === teamId)?.name || '-';
export const getUserName = (userId, users) => users.find((u) => u.id === userId)?.name || '-';

export const normalizeClientAssignment = (client, users, teams) => {
  if (!client) return client;
  const normalized = { ...client };
  const agent = normalized.assignedToAgent ? users.find((u) => u.id === normalized.assignedToAgent) : null;
  const team = normalized.assignedToTeam ? teams.find((t) => t.id === normalized.assignedToTeam) : null;

  if (agent) {
    normalized.assignedToTeam = agent.teamId || null;
    normalized.assignedToOffice = agent.officeId || null;
  } else if (team) {
    normalized.assignedToOffice = team.officeId || null;
  }

  if (normalized.assignedToTeam) {
    const teamFromClient = teams.find((t) => t.id === normalized.assignedToTeam);
    if (teamFromClient) {
      normalized.assignedToOffice = teamFromClient.officeId || normalized.assignedToOffice;
    }
  }

  return normalized;
};

export const getCountryFlag = (code, countryName) => {
  const countryCode = code || getCountryByName(countryName)?.code || '';
  if (!countryCode || typeof countryCode !== 'string') {
    return <span className="crm-flag-fallback" title={countryName || 'Unknown'}>[unknown]</span>;
  }
  const normalized = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return <span className="crm-flag-fallback" title={countryName || countryCode}>{countryCode}</span>;
  }
  const emoji = normalized
    .split('')
    .map((char) => String.fromCodePoint(0x1f1e6 + char.charCodeAt(0) - 65))
    .join('');
  const url = `https://flagcdn.com/24x18/${normalized.toLowerCase()}.png`;
  return (
    <span className="crm-country-flag-wrapper" title={countryName || normalized}>
      <span className="crm-flag-emoji" aria-label={`Flag of ${countryName || normalized}`} role="img">{emoji}</span>
      <img
        className="crm-flag-image"
        src={url}
        alt={countryName || normalized}
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          const fallback = e.currentTarget.previousElementSibling;
          if (fallback) fallback.style.display = 'inline';
        }}
      />
    </span>
  );
};
export const getTeamAgentCount = (teamId, users) => users.filter((u) => u.role === ROLE.AGENT && u.teamId === teamId).length;
export const countByRole = (users, role) => users.filter((u) => u.role === role).length;
export const countOnlineByRole = (users, role) => users.filter((u) => u.role === role && u.isLoggedIn).length;

export const formatClientId = (id) => {
  if (!id || typeof id !== 'string') return '#00000';
  const match = id.match(/(\d+)/);
  const num = match ? Number(match[1]) : NaN;
  if (Number.isNaN(num)) return '#00000';
  return `#${String(num).padStart(5, '0')}`;
};

export const statusClass = (stage) => {
  const key = stage
    ?.toLowerCase()
    ?.replace(/[^a-z0-9]+/g, '-')
    ?.replace(/^-+|-+$/g, '') || 'unknown';
  return `crm-status-${key}`;
};


// --- Edit Client modal: lets super admin / staff edit core client fields. ---
export function EditClientModal({ client, onClose, onSave }) {
  const [firstName, setFirstName] = React.useState(client?.firstName || '');
  const [lastName, setLastName] = React.useState(client?.lastName || '');
  const [email, setEmail] = React.useState(client?.email || '');
  const [registeredDate, setRegisteredDate] = React.useState(() => {
    const raw = client?.registeredDate || client?.registered_date || client?.createdAt || client?.created_at;
    if (!raw) return new Date().toISOString().slice(0, 10);
    try {
      const d = new Date(raw);
      return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
    } catch {
      return '';
    }
  });
  const [formError, setFormError] = React.useState('');

  const initCountry = React.useMemo(
    () => getCountryByCode(client?.countryCode) || getCountryByName(client?.country) || null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [selectedCountry, setSelectedCountry] = React.useState(initCountry);

  const initPhone = React.useMemo(() => {
    const parsed = parseStoredPhone(client?.phone || '');
    const countryCode = initCountry?.code
      || parsed.countryCode
      || '';
    return { countryCode, number: parsed.number };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [phoneCountryCode, setPhoneCountryCode] = React.useState(initPhone.countryCode);
  const [phoneNumber, setPhoneNumber] = React.useState(initPhone.number);

  if (!client) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedEmail = email.trim();
    if (!trimmedFirst || !trimmedLast || !trimmedEmail) {
      setFormError('First name, last name and email are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmedEmail)) {
      setFormError('Please enter a valid email address.');
      return;
    }
    setFormError('');
    const fullPhone = buildStoredPhone(phoneCountryCode, phoneNumber);
    const payload = {
      firstName: trimmedFirst,
      lastName: trimmedLast,
      name: `${trimmedFirst} ${trimmedLast}`,
      email: trimmedEmail,
      phone: fullPhone,
      country: selectedCountry?.name || '',
      countryCode: selectedCountry?.code || '',
      registeredDate: registeredDate ? (isNaN(new Date(registeredDate).getTime()) ? registeredDate : new Date(registeredDate).toLocaleDateString()) : '',
      registered_date: registeredDate ? (isNaN(new Date(registeredDate).getTime()) ? registeredDate : new Date(registeredDate).toLocaleDateString()) : '',
    };
    onSave(payload);
  };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 9999, overflowY: 'auto', padding: '24px 16px', WebkitOverflowScrolling: 'touch' };
  const card = { background: 'var(--crm-card)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 520, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', color: 'var(--crm-text-primary)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)', boxSizing: 'border-box', margin: 'auto' };
  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div className="crm-inline-e6820ebf12">
          <h2 className="crm-inline-85390b2215">Edit Client Profile</h2>
          <button type="button" onClick={onClose} className="crm-inline-3b8a3be2e6">Ã—</button>
        </div>
        <p className="crm-inline-85073d66cc">Changes here propagate everywhere this client is shown.</p>
        {formError && (
          <div className="crm-inline-f3aa554bfd">
            {formError}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="crm-inline-a5a6cf1e63">
            <div>
              <label className="crm-shared-form-label">First Name</label>
              <input className="crm-shared-form-control" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div>
              <label className="crm-shared-form-label">Last Name</label>
              <input className="crm-shared-form-control" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>
          <label className="crm-shared-form-label">Email</label>
          <input type="email" className="crm-shared-form-control" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label className="crm-shared-form-label">Country</label>
          <CountrySelect
            value={selectedCountry?.code || ''}
            onChange={(c) => setSelectedCountry(c)}
          />
          <label className="crm-shared-form-label">Phone</label>
          <PhoneInput
            countryCode={phoneCountryCode}
            onCountryCodeChange={(code) => {
              setPhoneCountryCode(code);
              if (!selectedCountry) {
                const c = COUNTRY_LIST.find(x => x.code === code);
                if (c) setSelectedCountry(c);
              }
            }}
            number={phoneNumber}
            onNumberChange={setPhoneNumber}
          />
          <label className="crm-shared-form-label">Registered Date</label>
          <input
            type="date"
            className="crm-shared-form-control"
            value={registeredDate}
            onChange={(e) => setRegisteredDate(e.target.value)}
          />
          <p className="crm-pw-hint">Manage portal passwords in the client profile’s Security section.</p>
          <div className="crm-inline-1781884cc8">
            <button type="button" onClick={onClose} className="crm-inline-2c973ceaf4">Cancel</button>
            <button type="submit" className="crm-inline-c5dabdbbe2">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Shared modal primitives (used by Edit*Modal below) ---
function _EyeIcon({ visible }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {visible ? (
        <><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.77 19.77 0 0 1 4.22-5.22"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a19.86 19.86 0 0 1-3.17 4.19"/><path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/><line x1="1" y1="1" x2="23" y2="23"/></>
      ) : (
        <><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></>
      )}
    </svg>
  );
}

function CopyBtn({ link }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied!' : 'Copy link'}
      className="crm-inline-9307cb8178" style={{background: copied ? 'rgba(14,203,129,0.12)' : 'var(--crm-bg)', color: copied ? '#0ECB81' : 'var(--crm-text-secondary)'}}
    >
      {copied
        ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      }
    </button>
  );
}

function PwField({ value, onChange, readOnly, placeholder, autoComplete }) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="crm-inline-e2d2ab2e87">
      <input
        className="crm-inline-b84b696801" style={{color: value ? 'var(--crm-text-primary)' : '#5E6673', fontStyle: value ? 'normal' : 'italic'}}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        title={show ? 'Hide' : 'Reveal'}
        disabled={!value && readOnly}
        className="crm-inline-f8f9da7be1" style={{color: (!value && readOnly) ? '#3A3F4A' : 'var(--crm-text-secondary)', cursor: (!value && readOnly) ? 'default' : 'pointer'}}
      >
        <_EyeIcon visible={show} />
      </button>
    </div>
  );
}

function _PwSection({ currentPassword, newPassword, onNewPasswordChange, newPasswordLabel }) {
  const hasStored = !!currentPassword;
  return (
    <>
      <div className="crm-shared-form-group">
        <label className="crm-shared-compact-label">Current Password</label>
        <PwField value={currentPassword} readOnly placeholder="not recorded" />
        {!hasStored && (
          <p className="crm-inline-5659a97463">
            This account's password predates our records. Set a new one below to store it going forward.
          </p>
        )}
      </div>
      <div className="crm-shared-form-group">
        <label className="crm-shared-compact-label">
          {newPasswordLabel || 'New Password'}{' '}
          <span className="crm-inline-69a5f75021">(blank = keep current)</span>
        </label>
        <PwField value={newPassword} onChange={onNewPasswordChange} placeholder="Enter new password..." autoComplete="new-password" />
      </div>
    </>
  );
}

function _SectionDivider({ label, blockBtn }) {
  return (
    <div className="crm-inline-6831d5e0b3">
      <span className="crm-inline-394d3bc063">{label}</span>
      {blockBtn}
    </div>
  );
}

function _BlockBtn({ isBlocked, onBlock }) {
  return (
    <button
      type="button"
      onClick={onBlock}
      className="crm-inline-5b61831c2b" style={{border: `1px solid ${isBlocked ? 'rgba(14,203,129,0.35)' : 'rgba(246,70,93,0.35)'}`, background: isBlocked ? 'rgba(14,203,129,0.1)' : 'rgba(246,70,93,0.1)', color: isBlocked ? '#0ECB81' : '#F6465D'}}
    >
      {isBlocked ? 'Unblock' : 'Block'}
    </button>
  );
}

const _lnkRow = { display: 'flex', alignItems: 'center', gap: 4 };
const _lnkInput = { flex: 1, width: 'auto', padding: '7px 10px', borderRadius: 4, border: '1px solid var(--crm-border)', background: 'var(--crm-bg)', color: 'var(--crm-text-secondary)', fontSize: 11, minWidth: 0, outline: 'none', cursor: 'default', boxShadow: 'none' };
const _errBox = { background: 'rgba(246,70,93,0.1)', border: '1px solid rgba(246,70,93,0.35)', color: '#F6465D', padding: '6px 10px', borderRadius: 4, fontSize: 12, marginBottom: 10 };

// --- Edit Office modal ---
export function EditOfficeModal({ office, officeManager, isManagerBlocked, onBlock, onClose, onSave }) {
  const [officeName, setOfficeName] = React.useState(office?.name || '');
  const [managerName, setManagerName] = React.useState(officeManager?.name || '');
  const [managerEmail, setManagerEmail] = React.useState(officeManager?.email || '');
  const [newPassword, setNewPassword] = React.useState('');
  const [error, setError] = React.useState('');

  if (!office) return null;

  const currentPassword = officeManager?.password || officeManager?.clientPassword || '';
  const loginLink = officeManager ? (officeManager.loginLink || makeLoginLink(officeManager.id, ROLE.OFFICE_MANAGER)) : null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmedOfficeName = officeName.trim();
    if (!trimmedOfficeName) { setError('Office name is required.'); return; }
    const trimmedEmail = managerEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) { setError('Login email is not valid.'); return; }
    setError('');
    onSave({
      officeName: trimmedOfficeName,
      managerName: managerName.trim() || undefined,
      managerEmail: trimmedEmail || undefined,
      managerPassword: newPassword.trim() || undefined,
    });
  };

  return (
    <div className="crm-modal-overlay" onClick={onClose}>
      <div className="crm-modal-content crm-inline-fbe883cb79"  onClick={e => e.stopPropagation()}>
        <div className="crm-modal-header">
          <span className="crm-modal-title">Edit Office</span>
          <button type="button" className="crm-modal-close-btn" onClick={onClose} title="Close">âœ•</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="crm-modal-body crm-inline-fb77cefaa5" >
            {error && <div style={_errBox}>{error}</div>}
            <div className="crm-shared-form-group">
              <label className="crm-shared-compact-label">Office Name</label>
              <input value={officeName} onChange={e => setOfficeName(e.target.value)} required autoFocus />
            </div>

            {officeManager ? (
              <>
                <_SectionDivider
                  label="Office Manager"
                  blockBtn={onBlock && <_BlockBtn isBlocked={isManagerBlocked} onBlock={onBlock} />}
                />
                <div className="crm-shared-form-group">
                  <label className="crm-shared-compact-label">Manager Name</label>
                  <input value={managerName} onChange={e => setManagerName(e.target.value)} />
                </div>
                <div className="crm-shared-form-group">
                  <label className="crm-shared-compact-label">Login Email</label>
                  <input type="email" value={managerEmail} onChange={e => setManagerEmail(e.target.value)} placeholder="manager@example.com" autoComplete="off" />
                </div>
                <_PwSection
                  currentPassword={currentPassword}
                  newPassword={newPassword}
                  onNewPasswordChange={e => setNewPassword(e.target.value)}
                />
                <div className="crm-shared-form-group">
                  <label className="crm-shared-compact-label">Login Link</label>
                  <div style={_lnkRow}>
                    <input style={_lnkInput} value={loginLink || ''} readOnly />
                    <CopyBtn link={loginLink} />
                  </div>
                </div>
              </>
            ) : (
              <p className="crm-inline-31e33bac85">No manager assigned yet.</p>
            )}
          </div>
          <div className="crm-modal-footer">
            <button type="button" className="crm-modal-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="crm-modal-btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Edit Team modal ---
export function EditTeamModal({ team, offices, teamLeader, isLeaderBlocked, onBlock, onClose, onSave }) {
  const [name, setName] = React.useState(team?.name || '');
  const [maxSize, setMaxSize] = React.useState(team?.maxSize != null ? String(team.maxSize) : '');
  const [officeId, setOfficeId] = React.useState(team?.officeId || '');
  const [leaderName, setLeaderName] = React.useState(teamLeader?.name || '');
  const [leaderEmail, setLeaderEmail] = React.useState(teamLeader?.email || '');
  const [newPassword, setNewPassword] = React.useState('');
  const [error, setError] = React.useState('');
  if (!team) return null;

  const currentPassword = teamLeader?.password || teamLeader?.clientPassword || '';
  const loginLink = teamLeader ? (teamLeader.loginLink || makeLoginLink(teamLeader.id, ROLE.TEAM_LEAD)) : null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) { setError('Team name is required.'); return; }
    const trimmedEmail = leaderEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) { setError('Login email is not valid.'); return; }
    setError('');
    const payload = { name: trimmedName };
    if (maxSize !== '') payload.maxSize = Number(maxSize);
    if (officeId) payload.officeId = officeId;
    if (leaderName.trim()) payload.leaderName = leaderName.trim();
    if (trimmedEmail) payload.leaderEmail = trimmedEmail;
    if (newPassword.trim()) payload.leaderPassword = newPassword.trim();
    onSave(payload);
  };

  return (
    <div className="crm-modal-overlay" onClick={onClose}>
      <div className="crm-modal-content crm-inline-fbe883cb79"  onClick={e => e.stopPropagation()}>
        <div className="crm-modal-header">
          <span className="crm-modal-title">Edit Team</span>
          <button type="button" className="crm-modal-close-btn" onClick={onClose} title="Close">âœ•</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="crm-modal-body crm-inline-fb77cefaa5" >
            {error && <div style={_errBox}>{error}</div>}
            <div className="crm-inline-0d0adf5272">
              <div>
                <label className="crm-shared-compact-label">Team Name</label>
                <input value={name} onChange={e => setName(e.target.value)} required autoFocus />
              </div>
              <div>
                <label className="crm-shared-compact-label">Max Agents</label>
                <input type="number" min="1" value={maxSize} onChange={e => setMaxSize(e.target.value)} placeholder="No limit" />
              </div>
            </div>
            {offices && offices.length > 0 && (
              <div className="crm-shared-form-group">
                <label className="crm-shared-compact-label">Office</label>
                <select value={officeId} onChange={e => setOfficeId(e.target.value)}>
                  <option value="">- Keep current -</option>
                  {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            )}

            {teamLeader ? (
              <>
                <_SectionDivider
                  label="Team Leader"
                  blockBtn={onBlock && <_BlockBtn isBlocked={isLeaderBlocked} onBlock={onBlock} />}
                />
                <div className="crm-shared-form-group">
                  <label className="crm-shared-compact-label">Leader Name</label>
                  <input value={leaderName} onChange={e => setLeaderName(e.target.value)} />
                </div>
                <div className="crm-shared-form-group">
                  <label className="crm-shared-compact-label">Login Email</label>
                  <input type="email" value={leaderEmail} onChange={e => setLeaderEmail(e.target.value)} placeholder="leader@example.com" autoComplete="off" />
                </div>
                <_PwSection
                  currentPassword={currentPassword}
                  newPassword={newPassword}
                  onNewPasswordChange={e => setNewPassword(e.target.value)}
                />
                <div className="crm-shared-form-group">
                  <label className="crm-shared-compact-label">Login Link</label>
                  <div style={_lnkRow}>
                    <input style={_lnkInput} value={loginLink || ''} readOnly />
                    <CopyBtn link={loginLink} />
                  </div>
                </div>
              </>
            ) : (
              <p className="crm-inline-31e33bac85">No leader assigned yet.</p>
            )}
          </div>
          <div className="crm-modal-footer">
            <button type="button" className="crm-modal-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="crm-modal-btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Edit Agent modal ---
export function EditAgentModal({ agent, teams, isBlocked, onBlock, onClose, onSave }) {
  const [name, setName] = React.useState(agent?.name || '');
  const [agentEmail, setAgentEmail] = React.useState(agent?.email || '');
  const [newPassword, setNewPassword] = React.useState('');
  const [teamId, setTeamId] = React.useState(agent?.teamId || '');
  const [error, setError] = React.useState('');
  if (!agent) return null;

  const currentPassword = agent?.password || agent?.clientPassword || '';
  const loginLink = agent ? (agent.loginLink || makeLoginLink(agent.id, ROLE.AGENT)) : null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) { setError('Agent name is required.'); return; }
    const trimmedEmail = agentEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) { setError('Login email is not valid.'); return; }
    setError('');
    const payload = { name: trimmedName };
    if (trimmedEmail) payload.email = trimmedEmail;
    if (newPassword.trim()) payload.password = newPassword.trim();
    if (teamId) payload.teamId = teamId;
    onSave(payload);
  };

  return (
    <div className="crm-modal-overlay" onClick={onClose}>
      <div className="crm-modal-content crm-inline-fbe883cb79"  onClick={e => e.stopPropagation()}>
        <div className="crm-modal-header">
          <span className="crm-modal-title">Edit Agent</span>
          <button type="button" className="crm-modal-close-btn" onClick={onClose} title="Close">âœ•</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="crm-modal-body crm-inline-fb77cefaa5" >
            {error && <div style={_errBox}>{error}</div>}
            <div style={{ ...(_fg), display: 'flex', flexDirection: 'column' }}>
              <div className="crm-inline-ba411bb914">
                <label style={{ ..._lbl, margin: 0 }}>Agent Name</label>
                {onBlock && <_BlockBtn isBlocked={isBlocked} onBlock={onBlock} />}
              </div>
              <input value={name} onChange={e => setName(e.target.value)} required autoFocus />
            </div>
            <div className="crm-shared-form-group">
              <label className="crm-shared-compact-label">Login Email</label>
              <input type="email" value={agentEmail} onChange={e => setAgentEmail(e.target.value)} placeholder="agent@example.com" autoComplete="off" />
            </div>
            <_PwSection
              currentPassword={currentPassword}
              newPassword={newPassword}
              onNewPasswordChange={e => setNewPassword(e.target.value)}
            />
            <div className="crm-shared-form-group">
              <label className="crm-shared-compact-label">Login Link</label>
              <div style={_lnkRow}>
                <input style={_lnkInput} value={loginLink || ''} readOnly />
                <CopyBtn link={loginLink} />
              </div>
            </div>
            {teams && teams.length > 0 && (
              <div className="crm-shared-form-group">
                <label className="crm-shared-compact-label">Team</label>
                <select value={teamId} onChange={e => setTeamId(e.target.value)}>
                  <option value="">- Keep current -</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="crm-modal-footer">
            <button type="button" className="crm-modal-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="crm-modal-btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Create Agent modal for delegated Team Leader / Agent portfolios ---
export function CreateAgentModal({ team, onClose, onCreate }) {
  const [name, setName] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedPassword = password.trim();
    if (!trimmedName) { setError('Agent name is required.'); return; }
    if (!trimmedPassword) { setError('Agent password is required.'); return; }
    setError('');
    setSaving(true);
    try {
      const created = await onCreate(trimmedName, trimmedPassword);
      if (created) onClose();
      else setError('Could not create the agent.');
    } catch (createError) {
      setError(createError?.message || 'Could not create the agent.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="crm-modal-overlay" onClick={onClose}>
      <div className="crm-modal-content crm-inline-fbe883cb79"  onClick={event => event.stopPropagation()}>
        <div className="crm-modal-header">
          <span className="crm-modal-title">Add Agent</span>
          <button type="button" className="crm-modal-close-btn" onClick={onClose} title="Close">âœ•</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="crm-modal-body crm-inline-fb77cefaa5" >
            {error && <div style={_errBox}>{error}</div>}
            <div className="crm-shared-form-group">
              <label className="crm-shared-compact-label">Team</label>
              <input value={team?.name || 'Current team'} readOnly />
            </div>
            <div className="crm-shared-form-group">
              <label className="crm-shared-compact-label">Agent Name</label>
              <input value={name} onChange={event => setName(event.target.value)} required autoFocus autoComplete="off" />
            </div>
            <div className="crm-shared-form-group">
              <label className="crm-shared-compact-label">Agent Password</label>
              <input type="password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="new-password" />
            </div>
          </div>
          <div className="crm-modal-footer">
            <button type="button" className="crm-modal-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="crm-modal-btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create Agent'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}


// --- Create Client modal: spawn a new client with optional team/agent target. ---
//
// Used by OfficeManagerPanel + TeamLeaderPanel. The backend auto-defaults the
// office/team to the caller's scope when those fields are omitted, so the
// modal only surfaces selectors for the levels the actor can choose. The
// SuperAdminPanel has its own (much richer) client-import flow and does not
// use this modal.
export function CreateClientModal({ scope, teamsForOffice = [], agents = [], onClose, onCreate }) {
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [selectedCountry, setSelectedCountry] = React.useState(null);
  const [phoneCountryCode, setPhoneCountryCode] = React.useState('');
  const [phoneNumber, setPhoneNumber] = React.useState('');
  const [funnel, setFunnel] = React.useState('');
  const [teamId, setTeamId] = React.useState(scope?.teamId || '');
  const [agentId, setAgentId] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState('');

  React.useEffect(() => {
    if (selectedCountry && !phoneCountryCode) setPhoneCountryCode(selectedCountry.code);
  }, [selectedCountry, phoneCountryCode]);

  const filteredAgents = teamId
    ? agents.filter(a => a.teamId === teamId)
    : agents;
  const phoneValid = isPhoneValid(phoneCountryCode, phoneNumber);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const f = firstName.trim();
    const l = lastName.trim();
    const em = email.trim();
    if (!f || !l || !em) {
      setFormError('First name, last name and email are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) {
      setFormError('Please enter a valid email address.');
      return;
    }
    setFormError('');
    setSubmitting(true);
    const fullPhone = buildStoredPhone(phoneCountryCode, phoneNumber);
    try {
      await onCreate({
        firstName:   f,
        lastName:    l,
        name:        `${f} ${l}`,
        email:       em,
        phone:       fullPhone,
        country:     selectedCountry?.name || '',
        countryCode: selectedCountry?.code || '',
        stage:       'New',
        funnel:      funnel.trim() || null,
        assignedToOffice: scope?.officeId || null,
        assignedToTeam:   teamId || scope?.teamId || null,
        assignedToTeamLeader: scope?.teamLeaderId || null,
        assignedToAgent:  agentId || scope?.agentId || null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 9999, overflowY: 'auto', padding: '24px 16px' };
  const card = { background: 'var(--crm-card)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 520, maxHeight: 'calc(100vh - 48px)', overflowY: 'auto', color: 'var(--crm-text-primary)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)', boxSizing: 'border-box', margin: 'auto' };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div className="crm-inline-e6820ebf12">
          <h2 className="crm-inline-85390b2215">New Client</h2>
          <button type="button" onClick={onClose} className="crm-inline-3b8a3be2e6">Ã—</button>
        </div>
        <p className="crm-inline-85073d66cc">
          {scope?.teamId
            ? 'Client will be created inside your team.'
            : scope?.officeId
              ? 'Client will be created inside your office. Pick a team and agent if you already know who should work it.'
              : 'Client will be created in the unassigned pool.'}
        </p>
        {formError && (
          <div className="crm-inline-f3aa554bfd">
            {formError}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="crm-inline-a5a6cf1e63">
            <div>
              <label className="crm-shared-form-label">First Name *</label>
              <input className="crm-shared-form-control" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus />
            </div>
            <div>
              <label className="crm-shared-form-label">Last Name *</label>
              <input className="crm-shared-form-control" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>
          <label className="crm-shared-form-label">Email *</label>
          <input type="email" className="crm-shared-form-control" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label className="crm-shared-form-label">Country</label>
          <CountrySelect
            value={selectedCountry?.code || ''}
            onChange={(c) => setSelectedCountry(c)}
          />
          <label className="crm-shared-form-label">Phone</label>
          <PhoneInput
            countryCode={phoneCountryCode}
            onCountryCodeChange={(code) => {
              setPhoneCountryCode(code);
              if (!selectedCountry) {
                const c = COUNTRY_LIST.find(x => x.code === code);
                if (c) setSelectedCountry(c);
              }
            }}
            number={phoneNumber}
            onNumberChange={setPhoneNumber}
          />
          <label className="crm-shared-form-label">Funnel</label>
          <input className="crm-shared-form-control" value={funnel} onChange={(e) => setFunnel(e.target.value)} placeholder="organic, paid, etc." />
          {teamsForOffice.length > 0 && !scope?.teamId && (
            <>
              <label className="crm-shared-form-label">Team (optional)</label>
              <select className="crm-shared-form-control" value={teamId} onChange={(e) => { setTeamId(e.target.value); setAgentId(''); }}>
                <option value="">- Unassigned -</option>
                {teamsForOffice.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </>
          )}
          {filteredAgents.length > 0 && (
            <>
              <label className="crm-shared-form-label">Agent (optional)</label>
              <select className="crm-shared-form-control" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">- Unassigned -</option>
                {filteredAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </>
          )}
          <div className="crm-inline-1781884cc8">
            <button type="button" onClick={onClose} className="crm-inline-2c973ceaf4">Cancel</button>
            <button type="submit" disabled={submitting || !phoneValid} className="crm-inline-2bbf12b48b" style={{cursor: (submitting || !phoneValid) ? 'not-allowed' : 'pointer', opacity: (submitting || !phoneValid) ? 0.5 : 1}}>
              {submitting ? 'Creating...' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Add Comment modal: append a single comment to a client's thread. ---
//
// Used by OfficeManagerPanel + TeamLeaderPanel + (already in) AgentPanel.
// On submit, calls onSubmit(text) which is expected to call updateClient with
// `{ comment: text }`. The backend appends a row to client_comments and bumps
// last_comment_date - the optimistic+canonical refresh in App.updateClient
// keeps the UI in sync.
export function AddCommentModal({ clientName, onClose, onSubmit }) {
  const [text, setText] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setSubmitting(true);
    try {
      await onSubmit(t);
    } finally {
      setSubmitting(false);
    }
  };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 };
  const card = { background: 'var(--crm-card)', border: '1px solid var(--crm-border)', borderRadius: 12, padding: 24, width: '100%', maxWidth: 480, color: 'var(--crm-text-primary)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div className="crm-inline-e6820ebf12">
          <h2 className="crm-inline-a99a16b9d4">Add Comment</h2>
          <button type="button" onClick={onClose} className="crm-inline-3b8a3be2e6">Ã—</button>
        </div>
        {clientName && (
          <p className="crm-inline-6f5923741d">
            Client: <span className="crm-inline-3414b99eb6">{clientName}</span>
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            autoFocus
            placeholder="Type your note..."
            className="crm-inline-46bac05bd1"
          />
          <div className="crm-inline-db23bd62ea">
            <button type="button" onClick={onClose} className="crm-inline-11061ad594">Cancel</button>
            <button type="submit" disabled={submitting || !text.trim()} className="crm-inline-6eb9080c36" style={{cursor: (submitting || !text.trim()) ? 'not-allowed' : 'pointer', opacity: (submitting || !text.trim()) ? 0.5 : 1}}>
              {submitting ? 'Saving...' : 'Save Comment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
