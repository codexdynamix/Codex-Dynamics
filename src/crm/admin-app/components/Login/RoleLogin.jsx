import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ROLE } from '../../shared';
import {
  adminLogin,
  completeSuperAdminPasswordReset,
  fetchAdminMe,
  mapAdminToUser,
  requestSuperAdminPasswordReset,
} from '../../adminApi';

const ROLE_PATH = {
  [ROLE.SUPER_ADMIN]:    'super-admin',
  [ROLE.OFFICE_MANAGER]: 'office-manager',
  [ROLE.TEAM_LEAD]:    'team-leader',
  [ROLE.AGENT]:          'agent',
};

const ROLE_META = {
  [ROLE.SUPER_ADMIN]: {
    icon: '👑',
    accent: '#FF9F0A',
    title: 'Super Admin',
    subtitle: 'Full System Governance & Platform Control',
  },
  [ROLE.OFFICE_MANAGER]: {
    icon: '🏢',
    accent: '#0A84FF',
    title: 'Office Manager',
    subtitle: 'Branch Operations & Performance Oversight',
  },
  [ROLE.TEAM_LEAD]: {
    icon: '👥',
    accent: '#5E5CE6',
    title: 'Team Leader',
    subtitle: 'Unit Coaching & Active Pipeline Routing',
  },
  [ROLE.AGENT]: {
    icon: '⚡',
    accent: '#30D158',
    title: 'Sales Agent',
    subtitle: 'Client Acceleration & Real-Time Engagement',
  },
};

const RoleLogin = ({ role, onAdminLogin }) => {
  const navigate  = useNavigate();
  const meta      = ROLE_META[role] || ROLE_META[ROLE.AGENT];
  const rolePath  = ROLE_PATH[role];

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error,        setError]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  useEffect(() => {
    fetchAdminMe()
      .then((admin) => {
        if (admin?.role === role && admin.id) navigate(`/admin/${rolePath}/${admin.id}`, { replace: true });
      })
      .catch(() => {});
  }, [role, rolePath, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const admin = await adminLogin(email.trim(), password, role);

      if (admin.role !== role) {
        setError(`This account has the ${admin.role} role. Please use the correct login page.`);
        return;
      }

      if (typeof onAdminLogin === 'function') {
        onAdminLogin(mapAdminToUser(admin));
      }

      navigate(`/admin/${rolePath}/${admin.id}`, { replace: true });
    } catch (err) {
      setError(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestPasswordReset = async () => {
    setRecoveryError('');
    setRecoveryMessage('');
    setRecoveryLoading(true);
    try {
      await requestSuperAdminPasswordReset();
      setRecoveryMode(true);
      setRecoveryMessage('A reset code has been sent to codexdynamix@gmail.com. It expires in 10 minutes.');
    } catch (requestError) {
      setRecoveryError(requestError.message || 'Could not send the reset code. Please try again.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleCompletePasswordReset = async (event) => {
    event.preventDefault();
    setRecoveryError('');
    setRecoveryMessage('');
    if (newPassword !== confirmPassword) {
      setRecoveryError('The new passwords do not match.');
      return;
    }
    if (newPassword.length < 12) {
      setRecoveryError('Use a password with at least 12 characters.');
      return;
    }

    setRecoveryLoading(true);
    try {
      await completeSuperAdminPasswordReset(recoveryCode.trim(), newPassword);
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setRecoveryCode('');
      setRecoveryMode(false);
      setRecoveryMessage('Your password has been reset. Sign in with your new password.');
    } catch (requestError) {
      setRecoveryError(requestError.message || 'Could not reset the password. Please try again.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  return (
    <div className="crm-inline-cf0ee39fa6">
      {/* iOS Ambient Light Orbs */}
      <div className="crm-inline-125812edbc" />

      <div className="crm-inline-bce1671d37">

        {/* Back navigation */}
        <div className="crm-inline-8550a8b16c">
          <Link
            to="/admin"
            className="crm-inline-4a3a5353f3 crm-role-login-back"
          >
            <span>‹</span>
            <span>All Portals</span>
          </Link>
        </div>

        {/* Apple iOS Inset Grouped Frosted Glass Card */}
        <div className="crm-inline-a18d7c18f1">

          {/* iOS App Icon Squircle */}
          <div className="crm-inline-4b61dddd95">
            <div className="crm-inline-a7f179cb84" style={{ background: meta.accent }}>
              {meta.icon}
            </div>

            <div className="crm-inline-0aa5121659">
              Codex Dynamics
            </div>

            <h1 className="crm-inline-de4a3ec16e">
              {meta.title}
            </h1>
            <p className="crm-inline-517f022bc5">
              {meta.subtitle}
            </p>
          </div>

          {/* Error Banner */}
          {!recoveryMode && error && (
            <div className="crm-inline-a8b1c4036c">
              <span className="crm-inline-3d555f179c">⚠️</span>
              <span className="crm-inline-84a68f2fcc">
                {error}
              </span>
            </div>
          )}
          {recoveryError && (
            <div className="crm-inline-a8b1c4036c" role="alert">
              <span className="crm-inline-3d555f179c">⚠️</span>
              <span className="crm-inline-84a68f2fcc">{recoveryError}</span>
            </div>
          )}
          {recoveryMessage && (
            <div className="crm-role-login-recovery-message" role="status">
              {recoveryMessage}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} hidden={recoveryMode}>
            <div className="crm-inline-cff169011b">
              {/* Email row */}
              <div className="crm-inline-f7067d88d9">
                <label className="crm-inline-e86365d9a2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  placeholder="Enter your staff email"
                  required
                  autoFocus
                  autoComplete="email"
                  className="crm-inline-9bf326a9aa"
                />
              </div>

              {/* Password row */}
              <div className="crm-inline-b26ba52da4">
                <label className="crm-inline-e86365d9a2">
                  Password
                </label>
                <div className="crm-inline-6781c18518">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                    className="crm-inline-9bf326a9aa"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((v) => !v)}
                    className="crm-inline-8ba3581fd4"
                    tabIndex={-1}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {showPassword ? (
                        <>
                          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.83 21.83 0 0 1-3.17 4.19" />
                          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Apple iOS System Blue Action Button */}
            <button
              type="submit"
              disabled={loading}
              className="crm-inline-16f7250a81 crm-role-login-submit" style={{background: loading ? 'rgba(10, 132, 255, 0.5)' : '#0A84FF', cursor: loading ? 'wait' : 'pointer'}}
            >
              {loading ? (
                <span>Authenticating...</span>
              ) : (
                <span>Sign In to {meta.title}</span>
              )}
            </button>
          </form>

          {role === ROLE.SUPER_ADMIN && !recoveryMode && (
            <button
              type="button"
              className="crm-role-login-recovery-link"
              disabled={recoveryLoading}
              onClick={handleRequestPasswordReset}
            >
              {recoveryLoading ? 'Sending reset code…' : 'Forgot password?'}
            </button>
          )}

          {recoveryMode && (
            <form className="crm-role-login-recovery-form" onSubmit={handleCompletePasswordReset}>
              <label className="crm-inline-e86365d9a2" htmlFor="super-admin-reset-code">8-digit reset code</label>
              <input
                id="super-admin-reset-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{8}"
                maxLength={8}
                autoComplete="one-time-code"
                required
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                className="crm-role-login-recovery-input"
                placeholder="Enter code from Gmail"
              />
              <label className="crm-inline-e86365d9a2" htmlFor="super-admin-new-password">New password</label>
              <input
                id="super-admin-new-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="crm-role-login-recovery-input"
                placeholder="At least 12 characters"
              />
              <label className="crm-inline-e86365d9a2" htmlFor="super-admin-confirm-password">Confirm new password</label>
              <input
                id="super-admin-confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="crm-role-login-recovery-input"
                placeholder="Enter the new password again"
              />
              <button type="submit" disabled={recoveryLoading || recoveryCode.length !== 8} className="crm-inline-16f7250a81 crm-role-login-submit">
                {recoveryLoading ? 'Resetting password…' : 'Reset Super Admin password'}
              </button>
              <button type="button" className="crm-role-login-recovery-link" onClick={() => { setRecoveryMode(false); setRecoveryError(''); setRecoveryMessage(''); }}>
                Back to sign in
              </button>
            </form>
          )}
        </div>

      </div>
    </div>
  );
};

export default RoleLogin;
