import React, { useEffect, useState } from 'react';
import { User, Building2, Mail, Phone, MapPin, Lock, ShieldCheck, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { portalDb, type PortalClient } from '../../services/portalDatabase';

interface PortalProfileProps {
  client: PortalClient;
  onNavigate: (path: string) => void;
}

export function PortalProfile({ client, onNavigate }: PortalProfileProps) {
  const [name, setName] = useState(client.name ?? '');
  const [company, setCompany] = useState(client.company ?? '');
  const [phone, setPhone] = useState(client.phone ?? '');
  const [address, setAddress] = useState(client.address ?? '');
  const [country, setCountry] = useState(client.country ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState('');

  const [emailNotifs, setEmailNotifs] = useState(client.portalPreferences?.emailDigest ?? true);
  const [billingAlerts, setBillingAlerts] = useState(client.portalPreferences?.billingAlerts ?? true);
  const [securityAlerts, setSecurityAlerts] = useState(client.portalPreferences?.securityAlerts ?? true);

  useEffect(() => {
    setName(client.name ?? '');
    setCompany(client.company ?? '');
    setPhone(client.phone ?? '');
    setAddress(client.address ?? '');
    setCountry(client.country ?? '');
    setEmailNotifs(client.portalPreferences?.emailDigest ?? true);
    setBillingAlerts(client.portalPreferences?.billingAlerts ?? true);
    setSecurityAlerts(client.portalPreferences?.securityAlerts ?? true);
  }, [
    client.id,
    client.name,
    client.company,
    client.phone,
    client.address,
    client.country,
    client.portalPreferences?.emailDigest,
    client.portalPreferences?.billingAlerts,
    client.portalPreferences?.securityAlerts,
  ]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSavedSuccess(false);

    try {
      await portalDb.updateClientProfile(client.id, {
        name,
        company,
        phone,
        address,
        country,
        portalPreferences: {
          emailDigest: emailNotifs,
          billingAlerts,
          securityAlerts,
        },
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update profile.');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSaved(false);
    if (password !== confirmPassword) {
      setPasswordError('The new passwords do not match.');
      return;
    }

    setSavingPassword(true);
    try {
      await portalDb.changeClientPassword(client.id, currentPassword, password, confirmPassword);
      setCurrentPassword('');
      setPassword('');
      setConfirmPassword('');
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Could not change your password.');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-3 w-full font-sans">
      {/* Header */}
      <div className="pb-6 border-b border-black/[0.06] dark:border-white/[0.08]">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#0071E3] mb-1">
          Account Administration
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] tracking-tight">
          Profile &amp; Security Settings
        </h1>
        <p className="text-sm text-[#86868B] mt-1">
          Manage your organizational contact details, authentication credentials, and notification channels.
        </p>
      </div>

      {savedSuccess && (
        <div className="p-4 rounded-2xl bg-[#30D158]/10 border border-[#30D158]/30 text-[#248A3D] dark:text-[#32D74B] text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>Profile changes saved successfully.</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-2xl bg-[#FF3B30]/10 border border-[#FF3B30]/30 text-[#FF3B30] text-xs font-semibold flex items-center gap-2">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-6">
        <form id="portal-profile-form" onSubmit={handleSave}>
        {/* Organization & Contact Card - Apple Settings Style */}
        <div className="p-7 rounded-3xl bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-5">
          <h2 className="text-base font-semibold text-[#1D1D1F] dark:text-white flex items-center gap-2.5">
            <Building2 size={18} className="text-[#0071E3]" />
            <span>Organization &amp; Primary Representative</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#1D1D1F] dark:text-white mb-1.5">Company Name (optional)</label>
              <input
                type="text"
                value={company ?? ''}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] rounded-xl text-xs sm:text-sm text-[#1D1D1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1D1D1F] dark:text-white mb-1.5">Primary Contact Name</label>
              <input
                type="text"
                required
                value={name ?? ''}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] rounded-xl text-xs sm:text-sm text-[#1D1D1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#1D1D1F] dark:text-white mb-1.5">Email (Account Login)</label>
              <input
                type="email"
                disabled
                value={client.email ?? ''}
                className="w-full px-4 py-2.5 bg-black/[0.02] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06] rounded-xl text-xs sm:text-sm text-[#86868B] cursor-not-allowed"
              />
              <span className="text-[10px] text-[#86868B] mt-1 block">Contact project manager to re-assign primary login email.</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1D1D1F] dark:text-white mb-1.5">Telephone / Direct Line</label>
              <input
                type="tel"
                value={phone ?? ''}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] rounded-xl text-xs sm:text-sm text-[#1D1D1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-[#1D1D1F] dark:text-white mb-1.5">Registered Address</label>
              <input
                type="text"
                value={address ?? ''}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] rounded-xl text-xs sm:text-sm text-[#1D1D1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1D1D1F] dark:text-white mb-1.5">Jurisdiction / Country</label>
              <input
                type="text"
                value={country ?? ''}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#F5F5F7] dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] rounded-xl text-xs sm:text-sm text-[#1D1D1F] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
              />
            </div>
          </div>
        </div>
        </form>

        {/* Security & Authentication */}
        <form onSubmit={handleChangePassword} className="p-7 rounded-3xl bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-4">
          <h2 className="text-base font-semibold text-[#1D1D1F] dark:text-white flex items-center gap-2.5">
            <Lock size={18} className="text-[#30D158]" />
            <span>Security &amp; Password</span>
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            {[
              {
                id: 'portal-current-password',
                label: 'Current Password',
                value: currentPassword,
                setValue: setCurrentPassword,
                visible: showCurrentPassword,
                setVisible: setShowCurrentPassword,
                autoComplete: 'current-password',
                placeholder: 'Enter current password',
              },
              {
                id: 'portal-new-password',
                label: 'New Password',
                value: password,
                setValue: setPassword,
                visible: showPassword,
                setVisible: setShowPassword,
                autoComplete: 'new-password',
                placeholder: 'At least 8 characters',
              },
              {
                id: 'portal-confirm-password',
                label: 'Confirm New Password',
                value: confirmPassword,
                setValue: setConfirmPassword,
                visible: showConfirmPassword,
                setVisible: setShowConfirmPassword,
                autoComplete: 'new-password',
                placeholder: 'Re-enter new password',
              },
            ].map((field) => (
              <div key={field.id}>
                <label htmlFor={field.id} className="mb-1.5 block text-xs font-semibold text-[#1D1D1F] dark:text-white">
                  {field.label}
                </label>
                <div className="flex items-center rounded-xl border border-black/[0.06] bg-[#F5F5F7] transition-colors focus-within:border-[#0071E3] dark:border-white/[0.08] dark:bg-[#2C2C2E]">
                  <Lock size={15} className="ml-3.5 shrink-0 text-[#86868B]" aria-hidden="true" />
                  <input
                    id={field.id}
                    type={field.visible ? 'text' : 'password'}
                    value={field.value}
                    onChange={(event) => {
                      field.setValue(event.target.value);
                      setPasswordError('');
                      setPasswordSaved(false);
                    }}
                    placeholder={field.placeholder}
                    autoComplete={field.autoComplete}
                    required
                    minLength={field.id === 'portal-new-password' ? 8 : undefined}
                    className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-xs text-[#1D1D1F] outline-none placeholder:text-[#86868B] dark:text-white sm:text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => field.setVisible((visible) => !visible)}
                    aria-label={`${field.visible ? 'Hide' : 'Show'} ${field.label.toLowerCase()}`}
                    className="mr-1.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-[#86868B] transition-colors hover:bg-black/[0.05] hover:text-[#1D1D1F] dark:hover:bg-white/[0.08] dark:hover:text-white"
                  >
                    {field.visible ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {field.id === 'portal-new-password' && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[#86868B]">
                    Use at least 8 characters.
                  </p>
                )}
                {field.id === 'portal-confirm-password' && confirmPassword && (
                  <p className={`mt-1.5 text-[11px] ${password === confirmPassword ? 'text-[#248A3D] dark:text-[#32D74B]' : 'text-[#FF3B30]'}`}>
                    {password === confirmPassword ? 'Passwords match.' : 'Passwords do not match.'}
                  </p>
                )}
              </div>
            ))}
          </div>

          {passwordError && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-[#FF3B30]/30 bg-[#FF3B30]/10 p-3 text-xs font-medium text-[#FF3B30]">
              <AlertCircle size={15} />
              <span>{passwordError}</span>
            </div>
          )}

          {passwordSaved && (
            <div role="status" className="flex items-center gap-2 rounded-xl border border-[#30D158]/30 bg-[#30D158]/10 p-3 text-xs font-medium text-[#248A3D] dark:text-[#32D74B]">
              <CheckCircle2 size={15} />
              <span>Password updated successfully.</span>
            </div>
          )}

          <div className="flex justify-end border-t border-black/[0.05] pt-4 dark:border-white/[0.06]">
            <button
              type="submit"
              disabled={savingPassword || !currentPassword || password.length < 8 || password !== confirmPassword}
              className="inline-flex items-center gap-2 rounded-xl bg-[#0071E3] px-5 py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#0077ED] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingPassword ? 'Updating Password…' : 'Update Password'}
            </button>
          </div>
        </form>

        {/* Notification Preferences */}
        <div className="p-7 rounded-3xl bg-white dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_8px_rgba(0,0,0,0.03)] space-y-4">
          <h2 className="text-base font-semibold text-[#1D1D1F] dark:text-white">Communication Preferences</h2>

          <div className="space-y-3.5 divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            <label className="flex items-center justify-between pt-1 cursor-pointer">
              <div>
                <div className="text-xs sm:text-sm font-semibold text-[#1D1D1F] dark:text-white">Email Digest &amp; Project Updates</div>
                <div className="text-xs text-[#86868B]">Receive milestones notifications and deployment completions.</div>
              </div>
              <input
                type="checkbox"
                checked={emailNotifs}
                onChange={(e) => setEmailNotifs(e.target.checked)}
                className="size-4 accent-[#0071E3] rounded"
              />
            </label>

            <label className="flex items-center justify-between pt-3.5 cursor-pointer">
              <div>
                <div className="text-xs sm:text-sm font-semibold text-[#1D1D1F] dark:text-white">Billing &amp; Invoice Reminders</div>
                <div className="text-xs text-[#86868B]">Receive renewal dates, PDF invoices, and automated receipts.</div>
              </div>
              <input
                type="checkbox"
                checked={billingAlerts}
                onChange={(e) => setBillingAlerts(e.target.checked)}
                className="size-4 accent-[#0071E3] rounded"
              />
            </label>

            <label className="flex items-center justify-between pt-3.5 cursor-pointer">
              <div>
                <div className="text-xs sm:text-sm font-semibold text-[#1D1D1F] dark:text-white">Domain &amp; Security Alerts</div>
                <div className="text-xs text-[#86868B]">Immediate alerts on domain expirations and SSL renewal notices.</div>
              </div>
              <input
                type="checkbox"
                checked={securityAlerts}
                onChange={(e) => setSecurityAlerts(e.target.checked)}
                className="size-4 accent-[#0071E3] rounded"
              />
            </label>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            form="portal-profile-form"
            className="px-6 py-3 rounded-2xl bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-semibold transition-all shadow-xs active:scale-[0.98]"
          >
            Save Account Settings
          </button>
        </div>
      </div>
    </div>
  );
}
