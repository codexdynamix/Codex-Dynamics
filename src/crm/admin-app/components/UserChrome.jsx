import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  Building2,
  Users,
  UserCheck,
  KeyRound,
  Mail,
  User as UserIcon,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  ExternalLink,
  LogOut,
  X,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Shield,
  Clock,
  Sparkles,
} from 'lucide-react';
import { ROLE } from '../shared';
import {
  adminLogout,
  getAdminToken,
  updateStaffApi,
  getAdminPendingCounts,
} from '../adminApi';
import { crmClassName } from "../styleHelpers.js";

const ROLE_LOGIN_PATH = {
  [ROLE.SUPER_ADMIN]: '/admin/login/super-admin',
  [ROLE.OFFICE_MANAGER]: '/admin/login/office-manager',
  [ROLE.TEAM_LEAD]: '/admin/login/team-leader',
  [ROLE.AGENT]: '/admin/login/agent',
};

const ICON_PROPS = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};
function CopyIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="9" y="9" width="11" height="11" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg {...ICON_PROPS}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.77 19.77 0 0 1 4.22-5.22" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a19.86 19.86 0 0 1-3.17 4.19" />
      <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
function LogoutIcon({ size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="crm-logout-svg"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function getInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  const letters = parts.map((p) => p[0] || '').join('');
  return (letters || name[0] || '?').slice(0, 2).toUpperCase();
}

export function UserChrome({ user, data, setData }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('credentials');
  const [showPwd, setShowPwd] = useState(false);
  const [copied, setCopied] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const profileThemeStyle = useMemo(() => {
    if (!open || typeof document === 'undefined') return {};
    const crmRoot = document.querySelector('.crm-admin-app');
    if (!crmRoot) return {};

    const computedStyle = window.getComputedStyle(crmRoot);
    return Object.fromEntries(
      ['--crm-bg', '--crm-card', '--crm-card-hover', '--crm-card-surface', '--crm-panel-surface', '--crm-border', '--crm-text-primary', '--crm-text-secondary', '--crm-accent', '--crm-radius', '--crm-ios-shadow-modal']
        .map((property) => [property, computedStyle.getPropertyValue(property).trim()])
        .filter(([, value]) => value)
    );
  }, [open]);

  const isSuperAdmin = user?.role === ROLE.SUPER_ADMIN;
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editConfirm, setEditConfirm] = useState('');
  const [editPwShown, setEditPwShown] = useState(false);
  const [editConfirmShown, setEditConfirmShown] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');

  const office = useMemo(
    () => (user?.officeId ? (data?.offices || []).find((o) => o.id === user.officeId) : null),
    [user, data]
  );
  const team = useMemo(
    () => (user?.teamId ? (data?.teams || []).find((t) => t.id === user.teamId) : null),
    [user, data]
  );

  const roleMeta = useMemo(() => {
    if (!user?.role) return null;
    const map = {
      [ROLE.SUPER_ADMIN]: {
        label: 'Super Admin',
        clearance: 'Master System Authority',
        badgeText: 'Root Authority',
        accentColor: '#F59E0B',
        badgeBg: 'rgba(245, 158, 11, 0.12)',
        badgeBorder: 'rgba(245, 158, 11, 0.28)',
        avatarGradient: '#F59E0B',
        glowColor: 'transparent',
        icon: ShieldCheck,
      },
      [ROLE.OFFICE_MANAGER]: {
        label: 'Office Manager',
        clearance: 'Regional Branch Operations',
        badgeText: 'Branch Client',
        accentColor: '#3B82F6',
        badgeBg: 'rgba(59, 130, 246, 0.12)',
        badgeBorder: 'rgba(59, 130, 246, 0.28)',
        avatarGradient: '#3B82F6',
        glowColor: 'transparent',
        icon: Building2,
      },
      [ROLE.TEAM_LEAD]: {
        label: 'Team Leader',
        clearance: 'Sales Unit Supervision',
        badgeText: 'Unit Supervisor',
        accentColor: '#10B981',
        badgeBg: 'rgba(16, 185, 129, 0.12)',
        badgeBorder: 'rgba(16, 185, 129, 0.28)',
        avatarGradient: '#10B981',
        glowColor: 'transparent',
        icon: Users,
      },
      [ROLE.AGENT]: {
        label: 'Sales Agent',
        clearance: 'Desk Operations & Inbound Calls',
        badgeText: 'Sales Desk',
        accentColor: '#06B6D4',
        badgeBg: 'rgba(6, 182, 212, 0.12)',
        badgeBorder: 'rgba(6, 182, 212, 0.28)',
        avatarGradient: '#06B6D4',
        glowColor: 'transparent',
        icon: UserCheck,
      },
    };
    return map[user.role] || {
      label: user.role,
      clearance: 'Authorized System User',
      badgeText: 'Staff Member',
      accentColor: '#6366F1',
      badgeBg: 'rgba(99, 102, 241, 0.12)',
      badgeBorder: 'rgba(99, 102, 241, 0.28)',
      avatarGradient: '#6366F1',
      glowColor: 'transparent',
      icon: UserIcon,
    };
  }, [user?.role]);

  const RoleIcon = roleMeta?.icon || UserIcon;
  const loginPath = ROLE_LOGIN_PATH[user?.role] || '/admin';
  const initials = getInitials(user?.name);

  useEffect(() => {
    if (open && isSuperAdmin && user) {
      setEditName(user.name || '');
      setEditEmail(user.email || '');
      setEditPassword('');
      setEditConfirm('');
      setEditError('');
      setEditSuccess('');
      setEditPwShown(false);
      setEditConfirmShown(false);
      setActiveTab('credentials');
    }
  }, [open, isSuperAdmin, user?.id]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const copy = (text, key) => {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
    } catch (_) {
      /* clipboard fallback */
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1600);
  };

  const copyAllCredentials = () => {
    const lines = [
      '========================================',
      'CODEX DYNAMICS CRM - CREDENTIALS PASS',
      '========================================',
      `Full Name:      ${user.name || '-'}`,
      `System Role:    ${user.role || '-'}`,
      `Account ID:     #${user.id || '-'}`,
      `Login Email:    ${user.email || '-'}`,
      `Access Key:     ${user.password || '(Active Authenticated Session Key)'}`,
      `Login Portal:   ${user.loginLink || (typeof window !== 'undefined' ? `${window.location.origin}${loginPath}` : loginPath)}`,
    ];
    if (office?.name) lines.push(`Office Branch:  ${office.name}`);
    if (team?.name)   lines.push(`Assigned Team:  ${team.name}`);
    lines.push('Session Status: Online · TLS 1.3 Verified');
    lines.push('========================================');
    copy(lines.join('\n'), 'all');
  };

  const saveAccountDetails = async () => {
    setEditError('');
    setEditSuccess('');
    if (!editName.trim()) return setEditError('Display name cannot be empty.');
    if (!editEmail.trim()) return setEditError('Email address cannot be empty.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(editEmail.trim())) return setEditError('Please enter a valid email address.');
    if (editPassword && editPassword.length < 8)
      return setEditError('Password must be at least 8 characters long.');
    if (editPassword && editPassword !== editConfirm)
      return setEditError('Password confirmation does not match.');

    setEditSaving(true);
    try {
      const updates = { name: editName.trim(), email: editEmail.trim() };
      if (editPassword) updates.password = editPassword;
      const updated = await updateStaffApi(user.id, updates);
      if (setData) {
        setData((prev) => ({
          ...prev,
          users: (prev.users || []).map((u) => (u.id === user.id ? { ...u, ...updated } : u)),
        }));
      }
      setEditPassword('');
      setEditConfirm('');
      setEditSuccess('Administrator credentials saved successfully.');
    } catch (err) {
      setEditError(err?.message || 'Failed to save account changes. Please try again.');
    } finally {
      setEditSaving(false);
    }
  };

  const closeModal = () => {
    setOpen(false);
    setShowPwd(false);
  };

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await adminLogout();
    } finally {
      setOpen(false);
      setShowPwd(false);
      navigate(loginPath, { replace: true });
      setSigningOut(false);
    }
  };

  if (!user) return null;

  return (
    <>
      <div className="crm-user-chrome">
        <button
          type="button"
          className="crm-user-chip"
          onClick={() => setOpen(true)}
          title="View profile and access credentials"
          aria-label={`Open ${user.name}'s profile and credentials`}
        >
          <span className="crm-user-chip-avatar" aria-hidden="true">{initials}</span>
          <span className="crm-user-chip-text">
            <span className="crm-user-chip-name">{user.name}</span>
            <span className="crm-user-chip-role">{user.role}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={handleLogout}
          disabled={signingOut}
          className="crm-logout-btn"
          title="Sign out"
          aria-label={signingOut ? 'Signing out' : 'Log out'}
        >
          <span className="crm-logout-icon" aria-hidden="true">
            <LogoutIcon size={14} />
          </span>
          <span className="crm-logout-label">{signingOut ? 'Signing out...' : 'Logout'}</span>
        </button>
      </div>

      {open &&
        createPortal(
          <div
            className="crm-profile-overlay"
            onClick={closeModal}
            role="presentation"
            style={profileThemeStyle}
          >
            <div
              className="crm-profile-modal crm-admin-profile-modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={`${user.name} profile`}
            >
              {/* Subtle ambient role lighting glow */}
              <div className="crm-profile-ambient-glow" aria-hidden="true" />

              {/* Header */}
              <div className="crm-profile-header-wrap">
                <div className="crm-profile-header-left">
                  <div
                    className="crm-profile-avatar-box"
                    style={{ background: roleMeta?.avatarGradient }}
                  >
                    <span>{initials}</span>
                    <span
                      className="crm-profile-online-pulse"
                      title={user.isLoggedIn ? 'Online · Live Session' : 'Connected'}
                    />
                  </div>

                  <div className="crm-profile-title-block">
                    <div className="crm-profile-name-row">
                      <h3 className="crm-profile-user-name">{user.name}</h3>
                    </div>

                    <div className="crm-profile-clearance-meta">
                      <span
                        className="crm-profile-clearance-tag crm-inline-bca34abce9"
                         style={{color: roleMeta?.accentColor, background: roleMeta?.badgeBg, border: `1px solid ${roleMeta?.badgeBorder}`}}
                      >
                        <RoleIcon size={12} strokeWidth={2.5} />
                        {roleMeta?.badgeText}
                      </span>
                      <span>·</span>
                      <span className="crm-inline-198a38d493">{roleMeta?.clearance}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="crm-profile-close-btn"
                  onClick={closeModal}
                  aria-label="Close credentials profile"
                  title="Close (Esc)"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Segmented Tab Switcher (if Super Admin has edit capabilities) */}
              {isSuperAdmin && (
                <div className="crm-profile-tabs-bar" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'credentials'}
                    className={`crm-profile-tab-button ${activeTab === 'credentials' ? 'is-active' : ''}`}
                    onClick={() => setActiveTab('credentials')}
                  >
                    <KeyRound size={14} />
                    <span>Credentials & Access</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'edit'}
                    className={`crm-profile-tab-button ${activeTab === 'edit' ? 'is-active' : ''}`}
                    onClick={() => setActiveTab('edit')}
                  >
                    <Sliders size={14} />
                    <span>Update Account & Key</span>
                  </button>
                </div>
              )}

              {/* Scrollable Body Content */}
              <div className="crm-profile-content-scroll">
                {activeTab === 'credentials' ? (
                  <>
                    {/* Security Pass Card */}
                    <div className="crm-cred-card">
                      <div className="crm-cred-card-header">
                        <div className="crm-cred-card-header-left">
                          <Lock size={12} style={{ color: roleMeta?.accentColor }} />
                          <span>Administrative Credentials Pass</span>
                        </div>
                        <span className="crm-cred-card-badge">
                          <span
                            className="crm-inline-148b8b865f"
                          />
                          Active Key
                        </span>
                      </div>

                      {/* Login Identifier / Email */}
                      <div className="crm-cred-field">
                        <div className="crm-cred-label">
                          <span>Login Email / Identifier</span>
                          <span className="crm-inline-1fbae50e09">Primary Auth Handle</span>
                        </div>
                        <div className="crm-cred-value-box">
                          <div className="crm-inline-579f58bb02">
                            <Mail size={14} className="crm-inline-1a76a2f246" />
                            <span className="crm-cred-value-text">{user.email || '—'}</span>
                          </div>
                          {user.email && (
                            <div className="crm-cred-actions">
                              <button
                                type="button"
                                className={`crm-cred-btn ${copied === 'email' ? 'is-success' : ''}`}
                                onClick={() => copy(user.email, 'email')}
                                title="Copy Email"
                              >
                                {copied === 'email' ? <Check size={12} /> : <Copy size={12} />}
                                <span>{copied === 'email' ? 'Copied' : 'Copy'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Master Password */}
                      <div className="crm-cred-field">
                        <div className="crm-cred-label">
                          <span>Access Password / Master Key</span>
                          <span className="crm-inline-cdc34a99ce" style={{color: roleMeta?.accentColor}}>Encrypted Database Credential</span>
                        </div>
                        <div className="crm-cred-value-box">
                          <div className="crm-inline-579f58bb02">
                            <KeyRound size={14} className="crm-inline-1a76a2f246" />
                            <span
                              className="crm-cred-value-text"
                              style={{
                                letterSpacing: showPwd ? '0.04em' : '0.18em',
                                color: showPwd ? '#FFFFFF' : '#8E8E93',
                              }}
                            >
                              {showPwd
                                ? (user.password || (isSuperAdmin ? 'Managed via session (set below)' : '—'))
                                : '••••••••••••'}
                            </span>
                          </div>
                          <div className="crm-cred-actions">
                            <button
                              type="button"
                              className="crm-cred-btn"
                              onClick={() => setShowPwd((v) => !v)}
                              title={showPwd ? 'Hide password' : 'Show password'}
                            >
                              {showPwd ? <EyeOff size={12} /> : <Eye size={12} />}
                              <span>{showPwd ? 'Hide' : 'Show'}</span>
                            </button>
                            {user.password && (
                              <button
                                type="button"
                                className={`crm-cred-btn ${copied === 'pwd' ? 'is-success' : ''}`}
                                onClick={() => copy(user.password, 'pwd')}
                                title="Copy Password"
                              >
                                {copied === 'pwd' ? <Check size={12} /> : <Copy size={12} />}
                                <span>{copied === 'pwd' ? 'Copied' : 'Copy'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Direct Login Link */}
                      <div className="crm-cred-field">
                        <div className="crm-cred-label">
                          <span>Direct Login Portal</span>
                          <span className="crm-inline-1fbae50e09">One-Click Role Entry</span>
                        </div>
                        <div className="crm-cred-value-box">
                          <div className="crm-inline-579f58bb02">
                            <ExternalLink size={14} className="crm-inline-1a76a2f246" />
                            <span className="crm-cred-value-text crm-inline-69311b49b4" >
                              {user.loginLink || (typeof window !== 'undefined' ? `${window.location.origin}${loginPath}` : loginPath)}
                            </span>
                          </div>
                          <div className="crm-cred-actions">
                            <button
                              type="button"
                              className={`crm-cred-btn ${copied === 'link' ? 'is-success' : ''}`}
                              onClick={() =>
                                copy(
                                  user.loginLink ||
                                    (typeof window !== 'undefined' ? `${window.location.origin}${loginPath}` : loginPath),
                                  'link'
                                )
                              }
                              title="Copy Login Link"
                            >
                              {copied === 'link' ? <Check size={12} /> : <Copy size={12} />}
                              <span>{copied === 'link' ? 'Copied' : 'Copy'}</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Assigned Location (Office & Team) */}
                      {(office || team) && (
                        <div className="crm-inline-5e8eb17a8f">
                          {office && (
                            <div className="crm-cred-field">
                              <span className="crm-cred-label">Office Branch</span>
                              <div className="crm-cred-value-box crm-inline-5d9a1bcc23" >
                                <Building2 size={13} className="crm-inline-7ff77f848d" />
                                <span className="crm-cred-value-text crm-inline-7a459431c4" >{office.name}</span>
                              </div>
                            </div>
                          )}
                          {team && (
                            <div className="crm-cred-field">
                              <span className="crm-cred-label">Assigned Team</span>
                              <div className="crm-cred-value-box crm-inline-5d9a1bcc23" >
                                <Users size={13} className="crm-inline-7ff77f848d" />
                                <span className="crm-cred-value-text crm-inline-7a459431c4" >{team.name}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Security Protocol Bar */}
                      <div className="crm-cred-security-bar">
                        <div className="crm-inline-fe4ffe5254">
                          <Shield size={12} className="crm-inline-d29419ed51" />
                          <span>TLS 1.3 · Encrypted Auth Token</span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Copy All Credentials Strip */}
                    <div className="crm-profile-quick-bar">
                      <div>
                        <div className="crm-inline-64edfa41b5">Export Credentials</div>
                        <div className="crm-profile-quick-text">Copy full clearance block to clipboard</div>
                      </div>
                      <button
                        type="button"
                        className={`crm-profile-quick-btn ${copied === 'all' ? 'is-success' : ''}`}
                        onClick={copyAllCredentials}
                      >
                        {copied === 'all' ? <Check size={13} /> : <Copy size={13} />}
                        <span>{copied === 'all' ? 'All Credentials Copied!' : 'Copy All Credentials'}</span>
                      </button>
                    </div>
                  </>
                ) : (
                  /* Edit Super Admin Account Section */
                  <div className="crm-profile-edit-box">
                    <p className="crm-profile-edit-desc">
                      Update your primary administrative identity and security password. Changes take effect immediately.
                    </p>

                    {editError && (
                      <div className="crm-profile-status-message crm-profile-status-error">
                        <AlertCircle size={15} className="crm-inline-c2bafe49ca" />
                        <span>{editError}</span>
                      </div>
                    )}

                    {editSuccess && (
                      <div className="crm-profile-status-message crm-profile-status-success">
                        <CheckCircle2 size={15} className="crm-inline-c2bafe49ca" />
                        <span>{editSuccess}</span>
                      </div>
                    )}

                    <div className="crm-profile-field-group">
                      <label className="crm-profile-field-label">Administrator Full Name</label>
                      <div className="crm-profile-input-wrap">
                        <span className="crm-profile-input-icon">
                          <UserIcon size={14} />
                        </span>
                        <input
                          type="text"
                          className="crm-profile-text-input"
                          value={editName}
                          onChange={(e) => {
                            setEditName(e.target.value);
                            setEditError('');
                            setEditSuccess('');
                          }}
                          placeholder="Your full name"
                          autoComplete="name"
                        />
                      </div>
                    </div>

                    <div className="crm-profile-field-group">
                      <label className="crm-profile-field-label">Sign-In Email Address</label>
                      <div className="crm-profile-input-wrap">
                        <span className="crm-profile-input-icon">
                          <Mail size={14} />
                        </span>
                        <input
                          type="email"
                          className="crm-profile-text-input"
                          value={editEmail}
                          onChange={(e) => {
                            setEditEmail(e.target.value);
                            setEditError('');
                            setEditSuccess('');
                          }}
                          placeholder="admin@codexdynamics.com"
                          autoComplete="email"
                        />
                      </div>
                    </div>

                    <div className="crm-profile-field-group">
                      <div className="crm-inline-7a313c5472">
                        <label className="crm-profile-field-label">New Password</label>
                        <span className="crm-inline-e27c476993">Leave blank to keep unchanged</span>
                      </div>
                      <div className="crm-profile-input-wrap">
                        <span className="crm-profile-input-icon">
                          <Lock size={14} />
                        </span>
                        <input
                          type={editPwShown ? 'text' : 'password'}
                          className="crm-profile-text-input"
                          value={editPassword}
                          onChange={(e) => {
                            setEditPassword(e.target.value);
                            setEditError('');
                            setEditSuccess('');
                          }}
                          placeholder="Minimum 8 characters"
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          className="crm-profile-pw-toggle-btn"
                          onClick={() => setEditPwShown((v) => !v)}
                          title={editPwShown ? 'Hide password' : 'Show password'}
                        >
                          {editPwShown ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>

                    {editPassword && (
                      <div className="crm-profile-field-group">
                        <div className="crm-inline-7a313c5472">
                          <label className="crm-profile-field-label">Confirm New Password</label>
                          {editConfirm && (
                            <span
                              className="crm-inline-feb139a49b" style={{color: editPassword === editConfirm ? '#30D158' : '#FF6B6B'}}
                            >
                              {editPassword === editConfirm ? '✓ Passwords match' : '✕ Passwords do not match'}
                            </span>
                          )}
                        </div>
                        <div className="crm-profile-input-wrap">
                          <span className="crm-profile-input-icon">
                            <Lock size={14} />
                          </span>
                          <input
                            type={editConfirmShown ? 'text' : 'password'}
                            className="crm-profile-text-input"
                            value={editConfirm}
                            onChange={(e) => {
                              setEditConfirm(e.target.value);
                              setEditError('');
                              setEditSuccess('');
                            }}
                            placeholder="Re-enter new password"
                            autoComplete="new-password"
                          />
                          <button
                            type="button"
                            className="crm-profile-pw-toggle-btn"
                            onClick={() => setEditConfirmShown((v) => !v)}
                            title={editConfirmShown ? 'Hide password' : 'Show password'}
                          >
                            {editConfirmShown ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="crm-profile-modal-footer">
                <button
                  type="button"
                  className="crm-profile-footer-logout"
                  onClick={handleLogout}
                  disabled={signingOut}
                  title="Sign out of administrative session"
                >
                  <LogOut size={13} />
                  <span>{signingOut ? 'Signing out...' : 'Sign Out'}</span>
                </button>

                <div className="crm-profile-footer-actions">
                  <button
                    type="button"
                    className="crm-profile-footer-btn-secondary"
                    onClick={closeModal}
                  >
                    Done
                  </button>

                  {activeTab === 'edit' && isSuperAdmin && (
                    <button
                      type="button"
                      className="crm-profile-footer-btn-primary"
                      onClick={saveAccountDetails}
                      disabled={editSaving || (editPassword && editPassword !== editConfirm)}
                    >
                      <Check size={14} />
                      <span>{editSaving ? 'Saving...' : 'Save Changes'}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function ProfileRow({ label, value, mono, link, children }) {
  return (
    <div className="crm-profile-row">
      <span className="crm-profile-label">{label}</span>
      <span
        className={
          'crm-profile-value' +
          (mono ? ' crm-profile-mono' : '') +
          (link ? ' crm-profile-link' : '')
        }
      >
        {value}
      </span>
      {children}
    </div>
  );
}

/**
 * SearchAutocomplete
 * A typeahead-style search input. The parent owns the value (so all existing
 * filtering logic keeps working unchanged); we only add a small floating list
 * of matching suggestions while typing. Picking a suggestion sets the value
 * to its `value` field and closes the dropdown.
 *
 * Props:
 *   value, onChange, placeholder, className, style, autoComplete
 *   buildSuggestions(query) -> Array<{ value, label, meta?, key? }>
 *   fetchSuggestions(query) -> Promise<Array<{ value, label, meta?, key? }>>
 *   onSelect(suggestion) -> optional callback with the selected suggestion
 *   maxSuggestions (default 8)
 *   inputProps (extra props forwarded to the <input>)
 */
export function SearchAutocomplete({
  value,
  onChange,
  placeholder,
  className = 'crm-super-admin-input',
  style,
  autoComplete = 'off',
  buildSuggestions,
  fetchSuggestions,
  onSelect,
  maxSuggestions = 8,
  inputProps = {},
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [remoteSuggestions, setRemoteSuggestions] = useState([]);
  const wrapRef = useRef(null);
  const requestRef = useRef(0);
  const listboxId = useId();

  const localSuggestions = useMemo(() => {
    const q = (value || '').trim();
    if (!q || !buildSuggestions) return [];
    let list = [];
    try {
      list = buildSuggestions(q) || [];
    } catch (_) {
      list = [];
    }
    return list.slice(0, maxSuggestions);
  }, [value, buildSuggestions, maxSuggestions]);

  useEffect(() => {
    if (!fetchSuggestions) return undefined;

    const q = (value || '').trim();
    const requestId = ++requestRef.current;
    if (!q) {
      setRemoteSuggestions([]);
      return undefined;
    }
    setRemoteSuggestions([]);

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await fetchSuggestions(q, { limit: maxSuggestions });
        if (!cancelled && requestId === requestRef.current) {
          setRemoteSuggestions(Array.isArray(result) ? result.slice(0, maxSuggestions) : []);
        }
      } catch (_) {
        // The parent search/table remains usable if the typeahead request
        // fails. Never replace newer results with an older failed request.
        if (!cancelled && requestId === requestRef.current) setRemoteSuggestions([]);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, fetchSuggestions, maxSuggestions]);

  const suggestions = fetchSuggestions ? remoteSuggestions : localSuggestions;

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Keep highlight in range when the suggestion list shrinks/grows.
  useEffect(() => {
    if (highlight >= suggestions.length) setHighlight(-1);
  }, [suggestions, highlight]);

  const showDropdown = open && suggestions.length > 0;

  const pick = (s) => {
    if (!s) return;
    onChange(s.value);
    if (onSelect) onSelect(s);
    setOpen(false);
    setHighlight(-1);
  };

  return (
    <div
      ref={wrapRef}
      className="crm-search-autocomplete crm-inline-50666a574d"
       style={{flex: style?.flex ?? 1, minWidth: style?.minWidth ?? 0, maxWidth: style?.maxWidth, width: style?.width}}
    >
      <input
        {...inputProps}
        className={className}
        placeholder={placeholder}
        value={value}
        autoComplete={autoComplete}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={showDropdown && highlight >= 0 ? `${listboxId}-option-${highlight}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && suggestions.length > 0) {
            e.preventDefault();
            setOpen(true);
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp' && suggestions.length > 0) {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            if (showDropdown && highlight >= 0) {
              e.preventDefault();
              pick(suggestions[highlight]);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
          if (inputProps.onKeyDown) inputProps.onKeyDown(e);
        }}
        style={{ ...style, width: '100%' }}
      />
      {showDropdown && (
        <div className="crm-search-suggest" id={listboxId} role="listbox">
          {suggestions.map((s, i) => (
            <button
              type="button"
              id={`${listboxId}-option-${i}`}
              key={s.key != null ? s.key : `${s.value}-${i}`}
              role="option"
              aria-selected={i === highlight}
              className={
                'crm-search-suggest-item' + (i === highlight ? ' is-active' : '')
              }
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
            >
              <span className="crm-search-suggest-label">{s.label}</span>
              {s.meta != null && s.meta !== '' && (
                <span className="crm-search-suggest-meta">{s.meta}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default UserChrome;
