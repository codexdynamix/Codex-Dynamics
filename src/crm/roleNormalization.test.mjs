import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeAdminRole } from './roleNormalization.js';

describe('normalizeAdminRole', () => {
  it('normalizes Super Admin variants from persisted records and API responses', () => {
    for (const role of ['super-admin', 'Super Admin', 'super_admin', 'SuperAdmin']) {
      assert.equal(normalizeAdminRole(role), 'Super Admin');
    }
  });

  it('normalizes the other CRM role names consistently', () => {
    assert.equal(normalizeAdminRole('office_manager'), 'Office Manager');
    assert.equal(normalizeAdminRole('team-leader'), 'Team Leader');
    assert.equal(normalizeAdminRole('sales-agent'), 'Agent');
  });

  it('preserves unknown role labels and missing values', () => {
    assert.equal(normalizeAdminRole('Custom Role'), 'Custom Role');
    assert.equal(normalizeAdminRole(undefined), undefined);
  });
});
