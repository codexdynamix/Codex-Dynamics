import React, { useState, useContext, useMemo } from 'react';
import { DataContext } from '../../shared';
import { deleteAuditEntryApi, clearAuditLogApi } from '../../adminApi';
import { SearchAutocomplete } from '../UserChrome.jsx';

const AuditLog = () => {
  const { auditLog, setAuditLog } = useContext(DataContext);
  const [searchQuery, setSearchQuery] = useState('');
  const [clearing, setClearing] = useState(false);

  const formattedLogs = useMemo(() => {
    const base = (auditLog || []).map((log) => ({
      ...log,
      timestamp: log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp),
    }));
    base.sort((a, b) => (b.timestamp?.getTime?.() || 0) - (a.timestamp?.getTime?.() || 0));
    return base;
  }, [auditLog]);

  const filteredLogs = useMemo(() => {
    return formattedLogs.filter((log) => {
      if (searchQuery) {
        const haystack = `${log.admin || ''} ${log.action || ''} ${log.details || ''} ${log.clientName || ''}`.toLowerCase();
        if (!haystack.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    });
  }, [formattedLogs, searchQuery]);

  const handleDeleteEntry = async (log) => {
    if (!window.confirm('Delete this audit log entry?')) return;
    try {
      await deleteAuditEntryApi(log.id);
      if (setAuditLog) setAuditLog(prev => prev.filter(e => e.id !== log.id));
    } catch (err) {
      alert('Could not delete entry: ' + (err.message || 'Unknown error'));
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Clear the ENTIRE audit log? This cannot be undone.')) return;
    setClearing(true);
    try {
      await clearAuditLogApi();
      if (setAuditLog) setAuditLog([]);
    } catch (err) {
      alert('Could not clear audit log: ' + (err.message || 'Unknown error'));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div id="audit-log-section" className="crm-admin-section">
      <h2>[list] Audit & Activity Logs</h2>

      <div
        className="search-container crm-inline-3b6fdca1a7"

      >
        <SearchAutocomplete
          inputProps={{ type: 'search', id: 'audit-log-search' }}
          className="crm-search-input crm-inline-dde904ca90"
          placeholder="[search]  Search by admin, action, client..."
          value={searchQuery}
          onChange={setSearchQuery}
          buildSuggestions={(query) => formattedLogs
            .filter((log) => `${log.admin || ''} ${log.action || ''} ${log.details || ''} ${log.clientName || ''}`.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map((log) => ({
              key: log.id,
              value: log.action || log.clientName || log.admin || '',
              label: log.action || 'Activity',
              meta: [log.admin, log.clientName, log.details].filter(Boolean).join(' · '),
            }))}
        />

        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="crm-inline-f67ccf1861"
          >
            Clear Search
          </button>
        )}

        <div className="crm-inline-43a6f20a69">
          <span className="crm-inline-37d0b7ce9d">
            {filteredLogs.length} of {formattedLogs.length} records
          </span>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={clearing || formattedLogs.length === 0}
            className="crm-btn-danger crm-inline-75a0d92cff"
             style={{cursor: clearing || formattedLogs.length === 0 ? 'not-allowed' : 'pointer', opacity: clearing || formattedLogs.length === 0 ? 0.5 : 1}}
          >
            {clearing ? 'Clearing...' : 'Clear All Logs'}
          </button>
        </div>
      </div>

      <div className="crm-admin-table-container">
        <table className="crm-admin-table">
          <thead>
            <tr>
              <th className="crm-inline-8506681389">Timestamp</th>
              <th className="crm-inline-611bf920db">Actor</th>
              <th className="crm-inline-7006b2a9a3">Action</th>
              <th>Details</th>
              <th className="crm-inline-e53acebfb8">Delete</th>
            </tr>
          </thead>
          <tbody id="audit-log-tbody">
            {filteredLogs.length === 0 ? (
              <tr>
                <td
                  colSpan="5"
                  className="crm-inline-eaa75fff39"
                >
                  No audit logs found.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => (
                <tr key={log.id || `${log.timestamp?.getTime?.()}-${log.action}`}>
                  <td className="crm-inline-933a8ef29e">
                    {log.timestamp instanceof Date && !isNaN(log.timestamp)
                      ? log.timestamp.toLocaleString()
                      : '-'}
                  </td>
                  <td>
                    <strong>{log.admin}</strong>
                  </td>
                  <td>
                    <code
                      className="crm-inline-fe9300a757"
                    >
                      {log.action}
                    </code>
                  </td>
                  <td className="crm-inline-313ab4d50a">{log.details}</td>
                  <td className="crm-inline-72a68ac344">
                    <button
                      title="Delete this entry"
                      onClick={() => handleDeleteEntry(log)}
                      className="crm-inline-8d8ad6ecd6"
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditLog;
