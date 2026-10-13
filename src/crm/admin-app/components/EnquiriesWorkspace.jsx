import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Inbox,
  Download,
  Search,
  X,
  Plus,
  Trash2,
  Copy,
  ExternalLink,
  MessageSquare,
} from 'lucide-react';
import { StatusDropdown } from '../shared';
import { createClientApi, deleteClientApi, fetchAllClients, updateClientApi } from '../adminApi';
import { SearchAutocomplete } from './UserChrome.jsx';

function formatRelativeTime(dateString) {
  if (!dateString) return '-';
  try {
    const timestamp = new Date(dateString).getTime();
    if (isNaN(timestamp)) return dateString;
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateString;
  }
}

function cleanPhoneForWhatsApp(phone = '') {
  return String(phone).replace(/[^\d+]/g, '').replace(/^\+/, '');
}

function enquiryStatusFromClient(client) {
  const stage = String(client?.status || client?.stage || 'new').trim().toLowerCase();
  if (['new', 'new intake'].includes(stage)) return 'new';
  if (['deposit', 'converted', 'won', 'client'].includes(stage)) return 'converted';
  if (['closed', 'lost', 'not interested', 'failed deposit', "didn't register", 'no potential'].includes(stage)) {
    return 'closed';
  }
  return 'contacted';
}

function clientstageFromEnquiryStatus(status) {
  return {
    new: 'New',
    contacted: 'In Line',
    converted: 'Deposit',
    closed: 'Not Interested',
  }[status] || 'New';
}

function mapClientToEnquiry(client) {
  const name = client.name || `${client.firstName || ''} ${client.lastName || ''}`.trim();
  return {
    id: client.id,
    clientId: client.id,
    name: name || 'Anonymous Inquiry',
    email: client.email || '',
    phone: client.phone || '',
    company: client.company || '',
    service: client.service || 'General Inquiry',
    budget: client.budget || '',
    timeline: client.timeline || '',
    message: client.message || '',
    source: client.source || 'website_contact_modal',
    status: enquiryStatusFromClient(client),
    stage: client.stage || client.status || 'New',
    created_at: client.createdAt || client.created_at || new Date().toISOString(),
    notes: client.notes || '',
  };
}

function EnquiryMessagePreview({ message, name, service, budget, timeline, created_at }) {
  const [isHovered, setIsHovered] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, showAbove: false });
  const triggerRef = useRef(null);

  const cleanMsg = (message || '').trim();

  const handleMouseEnter = () => {
    if (!cleanMsg) return;
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const popoverWidth = 380;
      const left = Math.max(12, Math.min(rect.left - 20, window.innerWidth - popoverWidth - 20));
      const showAbove = rect.bottom + 260 > window.innerHeight && rect.top > 260;
      const top = showAbove ? rect.top - 8 : rect.bottom + 8;
      setCoords({ top, left, showAbove });
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="crm-inline-70f463985a"
    >
      <div
        className="crm-inline-55d644a737" style={{background: isHovered ? '#282D37' : '#1F242D', border: `1px solid ${isHovered ? 'var(--crm-accent)' : 'var(--crm-border)'}`, cursor: cleanMsg ? 'pointer' : 'default'}}
      >
        <MessageSquare
          size={12}
          className="crm-inline-d017801924" style={{color: isHovered ? 'var(--crm-accent)' : cleanMsg ? '#0A84FF' : '#555E6E'}}
        />
        <span
          className="crm-inline-bff384dec2" style={{color: isHovered ? '#FFFFFF' : cleanMsg ? '#D1D4DC' : '#707784', fontStyle: cleanMsg ? 'normal' : 'italic'}}
        >
          {cleanMsg || 'No message'}
        </span>
      </div>

      {isHovered && cleanMsg && (
        <div
          className="crm-inline-f3a996c200" style={{top: coords.showAbove ? undefined : coords.top, bottom: coords.showAbove ? window.innerHeight - coords.top : undefined, left: coords.left}}
        >
          {/* Popover Header */}
          <div
            className="crm-inline-2a8d40d584"
          >
            <div className="crm-inline-9484aff0bd">
              <span
                className="crm-inline-67221b6c5a"
              >
                {name ? name.charAt(0).toUpperCase() : 'C'}
              </span>
              <div>
                <div className="crm-inline-7d223ed376">
                  {name || 'Prospective Client'}
                </div>
                {service && (
                  <div className="crm-inline-65c44a48c3">
                    {service}
                  </div>
                )}
              </div>
            </div>
            <div className="crm-inline-13cbe03b9a">
              <span
                className="crm-inline-b239f4d301"
              >
                Inquiry Message
              </span>
              {created_at && (
                <div className="crm-inline-76ae81f625">
                  {formatRelativeTime(created_at)}
                </div>
              )}
            </div>
          </div>

          {/* Popover Message Content: Multi-line, Pre-wrap, Proper Line Height */}
          <div
            className="crm-inline-7ba8241f41"
          >
            "{cleanMsg}"
          </div>

          {/* Popover Footer Badges */}
          {(budget || timeline) && (
            <div
              className="crm-inline-fb05e5be2f"
            >
              {budget && (
                <span
                  className="crm-inline-213db3b078"
                >
                  Budget: {budget}
                </span>
              )}
              {timeline && (
                <span
                  className="crm-inline-ec8d5109bb"
                >
                  Timeline: {timeline}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EnquiriesWorkspace({
  showNotification = () => {},
  onOpenClientProfile = null,
  clients = [],
}) {
  const [localList, setLocalList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  useEffect(() => {
    let active = true;
    const loadFromApi = async (initial = false) => {
      if (initial) setIsLoading(true);
      try {
        const result = await fetchAllClients();
        if (!active) return;
        const items = (result.clients || [])
          .filter((client) => !client.deletedAt)
          .map(mapClientToEnquiry)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setLocalList(items);
        setLoadError('');
      } catch (error) {
        if (active) setLoadError(error?.message || 'Could not load inquiries from the CRM API.');
      } finally {
        if (active && initial) setIsLoading(false);
      }
    };

    loadFromApi(true);
    const handleFocus = () => loadFromApi(false);
    window.addEventListener('focus', handleFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Statistics matching platform KPI boxes
  const stats = useMemo(() => {
    const total = localList.length;
    const newCount = localList.filter((e) => e.status === 'new').length;
    const contactedCount = localList.filter((e) => e.status === 'contacted').length;
    const convertedCount = localList.filter((e) => e.status === 'converted' || e.status === 'closed').length;
    return { total, newCount, contactedCount, convertedCount };
  }, [localList]);

  // Services list for filter
  const serviceOptions = useMemo(() => {
    const set = new Set();
    localList.forEach((e) => {
      if (e.service) set.add(e.service);
    });
    return Array.from(set);
  }, [localList]);

  // Filtered inquiries
  const filteredList = useMemo(() => {
    return localList.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }
      if (serviceFilter !== 'all' && item.service !== serviceFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = item.name?.toLowerCase().includes(q);
        const matchEmail = item.email?.toLowerCase().includes(q);
        const matchPhone = item.phone?.toLowerCase().includes(q);
        const matchCompany = item.company?.toLowerCase().includes(q);
        const matchService = item.service?.toLowerCase().includes(q);
        const matchMessage = item.message?.toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchPhone && !matchCompany && !matchService && !matchMessage) {
          return false;
        }
      }
      return true;
    });
  }, [localList, statusFilter, serviceFilter, searchQuery]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, serviceFilter]);

  // Paginated list
  const totalPages = Math.ceil(filteredList.length / pageSize) || 1;
  const paginatedList = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredList.slice(start, start + pageSize);
  }, [filteredList, page, pageSize]);

  // Selection handlers
  const handleToggleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(new Set([...selectedIds, ...paginatedList.map((i) => i.id)]));
    } else {
      const next = new Set(selectedIds);
      paginatedList.forEach((i) => next.delete(i.id));
      setSelectedIds(next);
    }
  };

  const handleToggleSelectOne = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Status updates
  const handleUpdateStatus = async (id, newStatus) => {
    const previous = localList.find((item) => item.id === id);
    setLocalList((prev) => prev.map((item) => (
      item.id === id ? { ...item, status: newStatus, stage: clientstageFromEnquiryStatus(newStatus) } : item
    )));
    try {
      await updateClientApi(String(id), { stage: clientstageFromEnquiryStatus(newStatus) });
      showNotification(`Inquiry updated to "${newStatus}".`);
    } catch (error) {
      if (previous) {
        setLocalList((prev) => prev.map((item) => (item.id === id ? previous : item)));
      }
      showNotification(`Could not update inquiry: ${error?.message || 'API request failed.'}`);
    }
  };

  // Delete single inquiry
  const handleDeleteEnquiry = async (id, name = 'Inquiry') => {
    if (!window.confirm(`Delete inquiry from "${name}"?`)) return;
    try {
      await deleteClientApi(String(id));
      setLocalList((prev) => prev.filter((item) => item.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showNotification(`Deleted inquiry from ${name}.`);
    } catch (error) {
      showNotification(`Could not delete inquiry: ${error?.message || 'API request failed.'}`);
    }
  };

  // Bulk status update
  const handleBulkUpdateStatus = async (status) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map((id) => (
      updateClientApi(String(id), { stage: clientstageFromEnquiryStatus(status) })
    )));
    const succeeded = new Set(ids.filter((_, index) => results[index].status === 'fulfilled'));
    setLocalList((prev) => prev.map((item) => (
      succeeded.has(item.id)
        ? { ...item, status, stage: clientstageFromEnquiryStatus(status) }
        : item
    )));
    const failed = ids.length - succeeded.size;
    showNotification(failed
      ? `Updated ${succeeded.size} inquiries; ${failed} could not be updated.`
      : `Updated ${ids.length} inquiries to "${status}".`);
    setSelectedIds(new Set());
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected inquiries?`)) return;
    const results = await Promise.allSettled(ids.map((id) => deleteClientApi(String(id))));
    const succeeded = new Set(ids.filter((_, index) => results[index].status === 'fulfilled'));
    setLocalList((prev) => prev.filter((item) => !succeeded.has(item.id)));
    const failed = ids.length - succeeded.size;
    showNotification(failed
      ? `Deleted ${succeeded.size} inquiries; ${failed} could not be deleted.`
      : `Deleted ${ids.length} inquiries.`);
    setSelectedIds(new Set());
  };

  // Export CSV
  const handleExportCsv = () => {
    const items = selectedIds.size > 0 ? localList.filter((e) => selectedIds.has(e.id)) : filteredList;
    if (items.length === 0) {
      showNotification('No inquiries to export.');
      return;
    }
    const headers = ['ID', 'Name', 'Email', 'Phone', 'Company', 'Service', 'Budget', 'Timeline', 'Status', 'Date', 'Message'];
    const rows = items.map((e) => [
      e.id,
      `"${(e.name || '').replace(/"/g, '""')}"`,
      `"${(e.email || '').replace(/"/g, '""')}"`,
      `"${(e.phone || '').replace(/"/g, '""')}"`,
      `"${(e.company || '').replace(/"/g, '""')}"`,
      `"${(e.service || '').replace(/"/g, '""')}"`,
      `"${(e.budget || '').replace(/"/g, '""')}"`,
      `"${(e.timeline || '').replace(/"/g, '""')}"`,
      e.status,
      e.created_at,
      `"${(e.message || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `codex-enquiries-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    showNotification(`Exported ${items.length} inquiries to CSV.`);
  };

  // Export JSON
  const handleExportJson = () => {
    const items = selectedIds.size > 0 ? localList.filter((e) => selectedIds.has(e.id)) : filteredList;
    if (items.length === 0) {
      showNotification('No inquiries to export.');
      return;
    }
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `codex-enquiries-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    showNotification(`Exported ${items.length} inquiries to JSON.`);
  };

  // Open the unified client profile modal that is created in CRM
  const handleOpenClient = (enquiry) => {
    let matched = null;
    const allClients = Array.isArray(clients) ? clients : [];

    if (enquiry.clientId) {
      matched = allClients.find((l) => l.id === enquiry.clientId);
    }
    if (!matched && enquiry.id) {
      matched = allClients.find(
        (l) =>
          l.id === `ld_enq_${enquiry.id}` ||
          l.id === String(enquiry.id) ||
          l.enquiryId === enquiry.id
      );
    }
    if (!matched && enquiry.email) {
      const qEmail = enquiry.email.toLowerCase().trim();
      matched = allClients.find(
        (l) => l.email && l.email.toLowerCase().trim() === qEmail
      );
    }
    if (!matched && enquiry.name) {
      const qName = enquiry.name.toLowerCase().trim();
      matched = allClients.find(
        (l) => l.name && l.name.toLowerCase().trim() === qName
      );
    }

    // Merge or construct unified client object with all intake details
    const parts = (enquiry.name || 'New Customer').trim().split(/\s+/);
    const first = parts[0] || 'New';
    const last = parts.slice(1).join(' ') || 'Client';

    const unifiedClient = matched
      ? {
          ...matched,
          stage: enquiry.stage || matched.stage,
          status: enquiry.stage || matched.status || matched.stage,
          // Ensure all rich enquiry intake details are merged into the profile
          company: matched.company || enquiry.company || 'Individual / None',
          service: matched.service || enquiry.service || 'General Inquiry',
          funnel: matched.funnel || enquiry.service || 'Website Inquiry',
          budget: matched.budget || enquiry.budget || 'Not specified',
          timeline: matched.timeline || enquiry.timeline || 'Flexible',
          message: matched.message || enquiry.message || '',
          source: matched.source || enquiry.source || 'website_contact_modal',
          notes: matched.notes || enquiry.notes || '',
        }
      : {
          id: enquiry.clientId || `ld_enq_${enquiry.id || Date.now()}`,
          firstName: first,
          lastName: last,
          name: enquiry.name || `${first} ${last}`,
          email: enquiry.email || '',
          phone: enquiry.phone || '',
          country: enquiry.country || 'United Kingdom',
          countryCode: enquiry.countryCode || 'GB',
          company: enquiry.company || 'Individual / None',
          service: enquiry.service || 'General Inquiry',
          funnel: enquiry.service || 'Website Inquiry',
          budget: enquiry.budget || 'Not specified',
          timeline: enquiry.timeline || 'Flexible',
          message: enquiry.message || '',
          source: enquiry.source || 'website_contact_modal',
          stage: enquiry.stage || (enquiry.status === 'converted' ? 'Deposit' : enquiry.status === 'contacted' ? 'In Line' : 'New'),
          status: enquiry.status === 'converted' ? 'Deposit' : enquiry.status === 'contacted' ? 'In Line' : 'New',
          notes: enquiry.notes || '',
          registeredDate: new Date(enquiry.created_at || Date.now()).toLocaleDateString(),
          createdAt: enquiry.created_at || new Date().toISOString(),
          commentHistory: enquiry.message
            ? [
                {
                  id: `c_${Date.now()}`,
                  author: 'Website Intake',
                  text: `[${enquiry.service || 'Website Inquiry'}] ${enquiry.message}`,
                  timestamp: enquiry.created_at || new Date().toISOString(),
                },
              ]
            : [],
          statusHistory: [
            {
              id: `s_${Date.now()}`,
              status: 'New',
              timestamp: enquiry.created_at || new Date().toISOString(),
            },
          ],
        };

    if (onOpenClientProfile) {
      onOpenClientProfile(unifiedClient);
    }
  };

  const allPageSelected = paginatedList.length > 0 && paginatedList.every((i) => selectedIds.has(i.id));

  return (
    <div className="crm-inline-69d66e5b2e">
      {loadError && (
        <div role="alert" className="crm-inline-67163a599f">
          {loadError}
        </div>
      )}
      {isLoading && localList.length === 0 && (
        <div role="status" className="crm-inline-fd30cb3661">
          Loading inquiries from the CRM…
        </div>
      )}
      {/* 1. Stat Summary Cards - Exactly Matching Clients Table Layout */}
      {/* 1. Metric Counter Boxes - Apple iOS Glass Cards */}
      <div className="crm-inline-c8e1d2b87e">
        {[
          { label: 'Total Inquiries', value: stats.total, color: 'var(--crm-text-primary, #FFFFFF)', sub: 'Historical intake' },
          { label: 'New Intake', value: stats.newCount, color: '#30D158', sub: 'Awaiting first contact' },
          { label: 'Contacted', value: stats.contactedCount, color: 'var(--crm-accent, #0A84FF)', sub: 'In active discussion' },
          { label: 'Converted Client', value: stats.convertedCount, color: '#FF9F0A', sub: 'Moved to project' },
        ].map((s) => (
          <div
            key={s.label}
            className="crm-inline-d99cfa14f2"
          >
            <div className="crm-inline-efb2315007">
              {s.label}
            </div>
            <div className="crm-inline-097a21aa94" style={{color: s.color}}>
              {s.value}
            </div>
            <div className="crm-inline-bea358dfec">
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      {/* 2. Filters & Search Bar - Apple iOS Search Capsule */}
      <div className="crm-inline-eed578362d">
        <div className="crm-inline-9639758d40">
          <Search size={15} className="crm-inline-4f918daff5" />
          <SearchAutocomplete
            className="crm-super-admin-input crm-inline-af55afb88c"
            placeholder="Search customer, email, phone, company, service..."
            value={searchQuery}
            onChange={setSearchQuery}
            style={{ flex: 1, minWidth: 0 }}
            buildSuggestions={(query) => localList
              .filter((item) => [item.name, item.email, item.phone, item.company, item.service]
                .some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
              .slice(0, 8)
              .map((item) => ({
                key: item.id,
                value: item.name || item.email || item.phone || '',
                label: item.name || 'Anonymous inquiry',
                meta: [item.email, item.company, item.service].filter(Boolean).join(' · '),
              }))}
          />
        </div>

        <select
          className="crm-super-admin-select crm-inline-56ff363a0c"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}

        >
          <option value="all">All Statuses ({localList.length})</option>
          <option value="new">New Intake ({stats.newCount})</option>
          <option value="contacted">Contacted ({stats.contactedCount})</option>
          <option value="converted">Converted ({stats.convertedCount})</option>
          <option value="closed">Closed</option>
        </select>

        <select
          className="crm-super-admin-select crm-inline-1c67cc0d5a"
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}

        >
          <option value="all">All Services</option>
          {serviceOptions.map((svc) => (
            <option key={svc} value={svc}>
              {svc}
            </option>
          ))}
        </select>

        {(searchQuery || statusFilter !== 'all' || serviceFilter !== 'all') && (
          <button
            className="crm-super-admin-btn crm-super-admin-btn-small crm-super-admin-btn-secondary"
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
              setServiceFilter('all');
              setPage(1);
            }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* 3. Action Toolbar & Bulk Operations - Apple iOS Buttons */}
      <div className="crm-inline-d8ff6d7c67">
        <button
          className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-3a0c4da2c0"

          onClick={() => setIsAddModalOpen(true)}
        >
          <Plus size={14} /> Log Customer Enquiry
        </button>

        <button
          className="crm-super-admin-btn crm-super-admin-btn-small crm-super-admin-btn-secondary"
          onClick={handleExportCsv}
        >
          <Download size={14} /> Export CSV
        </button>

        <button
          className="crm-super-admin-btn crm-super-admin-btn-small crm-super-admin-btn-secondary"
          onClick={handleExportJson}
        >
          Export JSON
        </button>

        {selectedIds.size > 0 && (
          <>
            <span className="crm-inline-95944ff26a">
              <span>{selectedIds.size} selected</span>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="crm-inline-c580300b0f"
              >
                Clear
              </button>
            </span>
            <span className="crm-inline-e2edc7aebd" />
            <button
              className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-2994d038c7"

              onClick={() => handleBulkUpdateStatus('contacted')}
            >
              Mark Contacted
            </button>
            <button
              className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-39d9f7e38c"

              onClick={() => handleBulkUpdateStatus('converted')}
            >
              Mark Converted
            </button>
            <button
              className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-9d0c45fc2a"

              onClick={handleBulkDelete}
            >
              <Trash2 size={13} /> Delete Selected
            </button>
          </>
        )}
      </div>

      <div className="crm-inline-2b759092af">
        Click any row to open the client profile. Showing {paginatedList.length} of {filteredList.length} enquiries (page {page}/{totalPages})
      </div>

      {/* 4. Table - Designed to fit cleanly on screen like the Clients Table */}
      <div
        className="crm-admin-table-container crm-inline-ded3433288"

      >
        <table className="crm-admin-table crm-inline-69d66e5b2e" >
          <thead>
            <tr>
              <th className="crm-inline-3666be5c05">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={handleToggleSelectAll}
                />
              </th>
              <th className="crm-inline-8c0075cd59">Client ID</th>
              <th>Customer</th>
              <th>Contact Details</th>
              <th>Service & Scope</th>
              <th className="crm-inline-2aced38f5b">Message Preview</th>
              <th className="crm-inline-ee4007d67a">Origin</th>
              <th className="crm-inline-8c0075cd59">Received</th>
              <th className="crm-inline-f063eb930e">Status</th>
              <th className="crm-inline-dc1c782598">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedList.length === 0 ? (
              <tr>
                <td colSpan={10} className="crm-inline-7f2f121e08">
                  No customer enquiries match your filters.
                </td>
              </tr>
            ) : (
              paginatedList.map((item) => {
                const isSelected = selectedIds.has(item.id);
                const displayId = item.clientId || `ld_${item.id}`;

                return (
                  <tr
                    key={item.id}
                    className="crm-inline-8410c989c9" style={{background: isSelected ? 'rgba(10, 132, 255, 0.12)' : undefined}}
                    onClick={() => handleOpenClient(item)}
                  >
                    {/* Checkbox */}
                    <td onClick={(e) => e.stopPropagation()} className="crm-inline-3666be5c05">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelectOne(item.id)}
                      />
                    </td>

                    {/* Client ID with Copy */}
                    <td className="crm-inline-b08c8d0f5a">
                      <div className="crm-inline-9023e926fd">
                        <span className="crm-inline-bde8c5dabe">
                          {String(displayId).slice(0, 10)}
                        </span>
                        <button
                          title="Copy full ID"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(String(displayId));
                            showNotification('Client ID copied!');
                          }}
                          className="crm-inline-ccd1cf626f"
                        >
                          <Copy size={11} />
                        </button>
                      </div>
                    </td>

                    {/* Customer Name & Company (Stacked neatly like Clients table) */}
                    <td>
                      <div
                        className="crm-inline-7751a349f4"
                      >
                        {item.name}
                      </div>
                      <div
                        className="crm-inline-24ac7f96fb"
                      >
                        {item.company || 'Individual Client'}
                      </div>
                    </td>

                    {/* Contact Details (Email + Phone + WhatsApp) */}
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="crm-inline-c1652a8a2c">
                        {item.email && (
                          <a
                            href={`mailto:${item.email}`}
                            className="crm-inline-e07c7167d8"
                            title={item.email}
                          >
                            {item.email}
                          </a>
                        )}
                        {item.phone && (
                          <div className="crm-inline-fe4ffe5254">
                            <a
                              href={`tel:${item.phone}`}
                              className="crm-inline-fcc5c07ecf"
                            >
                              {item.phone}
                            </a>
                            <a
                              href={`https://wa.me/${cleanPhoneForWhatsApp(item.phone)}?text=${encodeURIComponent(`Hi ${item.name}, thank you for contacting Codex Dynamics regarding ${item.service || 'your project'}.`)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="crm-inline-d9e357af6b"
                              title="Chat on WhatsApp"
                            >
                              WA
                            </a>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Service & Scope (Combined neatly to fit screen) */}
                    <td>
                      <div
                        className="crm-inline-1d62c88f91"
                      >
                        {item.service || 'General Inquiry'}
                      </div>
                      {item.budget ? (
                        <span className="crm-inline-d5bd2ec02d">
                          {item.budget}
                        </span>
                      ) : item.timeline ? (
                        <span className="crm-inline-e75be0edca">
                          {item.timeline}
                        </span>
                      ) : null}
                    </td>

                    {/* Message Preview (Interactive with Rich Hover Card) */}
                    <td onClick={(e) => e.stopPropagation()} className="crm-inline-2aced38f5b">
                      <EnquiryMessagePreview
                        message={item.message}
                        name={item.name}
                        service={item.service}
                        budget={item.budget}
                        timeline={item.timeline}
                        created_at={item.created_at}
                      />
                    </td>

                    {/* Origin */}
                    <td className="crm-inline-3338ffbe82">
                      <span className="crm-inline-1958fa618b">
                        {item.source === 'website_contact_modal'
                          ? 'Modal'
                          : item.source === 'manual_crm_entry'
                          ? 'Manual'
                          : 'Form'}
                      </span>
                    </td>

                    {/* Received */}
                    <td
                      className="crm-inline-9394ced8fb"
                      title={new Date(item.created_at).toLocaleString()}
                    >
                      {formatRelativeTime(item.created_at)}
                    </td>

                    {/* Status Dropdown Menu (Designed consistently) */}
                    <td onClick={(e) => e.stopPropagation()} className="crm-inline-cc48c0d129">
                      <StatusDropdown
                        value={item.status}
                        options={[
                          { value: 'new', label: 'New' },
                          { value: 'contacted', label: 'Contacted' },
                          { value: 'converted', label: 'Converted' },
                          { value: 'closed', label: 'Closed' },
                        ]}
                        onChange={(nextStatus) => handleUpdateStatus(item.id, nextStatus)}
                      />
                    </td>

                    {/* Action Buttons */}
                    <td onClick={(e) => e.stopPropagation()} className="crm-inline-2fd8d9f398">
                      <div className="crm-enquiry-actions">
                        <button
                          className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-98138cae3f"
                          onClick={() => handleOpenClient(item)}
                          title="Open client profile"
                        >
                          Profile
                        </button>
                        <button
                          className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-f7704187e0"
                          onClick={() => handleDeleteEnquiry(item.id, item.name)}
                          title="Delete enquiry"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 5. Pagination Bar matching Clients table */}
      {totalPages > 1 && (
        <div className="crm-inline-cabecec358">
          <button
            className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold"
            disabled={page === 1}
            onClick={() => setPage(1)}
          >
            «
          </button>
          <button
            className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ‹ Prev
          </button>
          <span className="crm-inline-2d73a8a9dc">
            Page {page} of {totalPages}
          </span>
          <button
            className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next ›
          </button>
          <button
            className="crm-super-admin-btn crm-super-admin-btn-small crm-pagination-btn-gold"
            disabled={page >= totalPages}
            onClick={() => setPage(totalPages)}
          >
            »
          </button>
        </div>
      )}

      {/* 6. Manual Log Enquiry Modal - Styled with CRM Platform Design */}
      {isAddModalOpen && (
        <div
          className="crm-inline-7d7b56e0c3"
          onClick={() => setIsAddModalOpen(false)}
        >
          <div
            className="crm-inline-129fc39462"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="crm-inline-902aabcacf"
            >
              <div>
                <span className="crm-inline-9f69772858">Manual Intake</span>
                <h3 className="crm-inline-da6215fc7d">
                  Log Customer Enquiry / Client
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="crm-modal-close-btn"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const name = String(formData.get('name') || 'Customer').trim();
                const [firstName, ...lastNameParts] = name.split(/\s+/);
                try {
                  const created = await createClientApi({
                    firstName,
                    lastName: lastNameParts.join(' '),
                    email: String(formData.get('email') || ''),
                    phone: String(formData.get('phone') || ''),
                    company: String(formData.get('company') || ''),
                    service: String(formData.get('service') || 'General Inquiry'),
                    budget: String(formData.get('budget') || ''),
                    timeline: String(formData.get('timeline') || ''),
                    message: String(formData.get('message') || ''),
                    source: 'manual_crm_entry',
                    stage: 'New',
                  });
                  setLocalList((prev) => [mapClientToEnquiry(created), ...prev]);
                  setIsAddModalOpen(false);
                  showNotification(`Logged customer inquiry from "${name}".`);
                } catch (error) {
                  showNotification(`Could not save inquiry: ${error?.message || 'API request failed.'}`);
                }
              }}
              className="crm-inline-acfbb661d9"
            >
              <div className="crm-inline-89dbd8ea8c">
                <div>
                  <label className="crm-inline-5a4cbc301b">
                    Customer Name *
                  </label>
                  <input
                    name="name"
                    required
                    placeholder="Full Name"
                    className="crm-super-admin-input crm-inline-69d66e5b2e"

                  />
                </div>
                <div>
                  <label className="crm-inline-5a4cbc301b">
                    Company / Organization
                  </label>
                  <input
                    name="company"
                    placeholder="Business Name"
                    className="crm-super-admin-input crm-inline-69d66e5b2e"

                  />
                </div>
              </div>

              <div className="crm-inline-89dbd8ea8c">
                <div>
                  <label className="crm-inline-5a4cbc301b">
                    Contact Email *
                  </label>
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="client@company.com"
                    className="crm-super-admin-input crm-inline-69d66e5b2e"

                  />
                </div>
                <div>
                  <label className="crm-inline-5a4cbc301b">
                    Phone Number
                  </label>
                  <input
                    name="phone"
                    placeholder="+1 (555) 000-0000"
                    className="crm-super-admin-input crm-inline-69d66e5b2e"

                  />
                </div>
              </div>

              <div className="crm-inline-89dbd8ea8c">
                <div>
                  <label className="crm-inline-5a4cbc301b">
                    Service Requested
                  </label>
                  <input
                    name="service"
                    defaultValue="High-Performance Website"
                    className="crm-super-admin-input crm-inline-69d66e5b2e"

                  />
                </div>
                <div>
                  <label className="crm-inline-5a4cbc301b">
                    Estimated Budget
                  </label>
                  <input
                    name="budget"
                    placeholder="e.g. $15,000 - $25,000"
                    className="crm-super-admin-input crm-inline-69d66e5b2e"

                  />
                </div>
              </div>

              <div>
                <label className="crm-inline-5a4cbc301b">
                  Customer Intake Message *
                </label>
                <textarea
                  name="message"
                  rows={3}
                  required
                  placeholder="Describe client requirements, project scope, or initial consultation notes..."
                  className="crm-inline-34c20493ac"
                />
              </div>

              <div className="crm-inline-8269eba163">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="crm-super-admin-btn crm-super-admin-btn-small crm-super-admin-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-b268c66aab"

                >
                  Save & Register Client
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
