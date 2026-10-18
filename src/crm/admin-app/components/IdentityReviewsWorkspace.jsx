import React, { useMemo, useState } from 'react';
import { SearchAutocomplete } from './UserChrome.jsx';

const buttonBase = {
  minHeight: 34,
  padding: '7px 11px',
  border: '1px solid var(--crm-border, rgba(255,255,255,.14))',
  borderRadius: 6,
  background: 'var(--crm-card, #242426)',
  color: 'var(--crm-text-primary, #f5f5f7)',
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

function ClientIdentity({ side, name, company, email, phone, clientId }) {
  return (
    <div className="crm-inline-93af0493e4" data-testid={`identity-client-${side}-${clientId}`}>
      <div className="crm-inline-b6a3168d00">
        <span className="crm-inline-98bd871d06">Client {side}</span>
        <span className="crm-inline-cb7b2ae3ee" data-testid={`text-identity-client-id-${side}-${clientId}`}>ID {clientId}</span>
      </div>
      <h3 className="crm-inline-c2a1417392" data-testid={`text-identity-client-name-${side}-${clientId}`}>{name || 'Unnamed client'}</h3>
      <p className="crm-inline-3fbc652c49" data-testid={`text-identity-client-company-${side}-${clientId}`}>{company || 'Company not provided'}</p>
      <div className="crm-inline-8a586de17a">
        <span className="crm-inline-fecfdae891" data-testid={`text-identity-client-email-${side}-${clientId}`}>{email || 'Email not provided'}</span>
        <span data-testid={`text-identity-client-phone-${side}-${clientId}`}>{phone || 'Phone not provided'}</span>
      </div>
    </div>
  );
}

export default function IdentityReviewsWorkspace({
  reviews = [],
  loading = false,
  error = '',
  onReload = () => {},
  onResolve = async () => {},
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [busyKey, setBusyKey] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const statuses = useMemo(() => [...new Set(reviews.map((review) => review.status).filter(Boolean))], [reviews]);
  const filteredReviews = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reviews.filter((review) => {
      if (statusFilter !== 'all' && statusFilter && review.status !== statusFilter) return false;
      if (!query) return true;
      return [
        review.client_a_name,
        review.client_a_company,
        review.client_a_email,
        review.client_a_phone,
        review.client_b_name,
        review.client_b_company,
        review.client_b_email,
        review.client_b_phone,
        review.reason,
        review.status,
        review.client_id_a,
        review.client_id_b,
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [reviews, search, statusFilter]);

  const runResolve = async (review, decision) => {
    const key = `${review.client_id_a}-${review.client_id_b}`;
    setBusyKey(key);
    setActionError('');
    setNotice('');
    try {
      const result = await onResolve({ review, decision });
      if (result === false || result?.ok === false || result?.success === false) {
        throw new Error(result?.error || 'The identity service did not confirm this resolution.');
      }
    } catch (reason) {
      const message = reason?.message || 'The identity review could not be resolved.';
      setActionError(message);
      setNotice('');
      setBusyKey('');
      return;
    }
    setNotice('Marked as distinct. Refreshing the review queue.');
    try {
      await onReload(statusFilter || 'pending');
    } catch (reason) {
      setActionError(`Resolution submitted, but the review queue could not be refreshed: ${reason?.message || 'Please try again.'}`);
    } finally {
      setBusyKey('');
    }
  };

  return (
    <section className="identity-reviews-workspace crm-inline-39dbf40f7f" aria-labelledby="identity-reviews-title"  data-testid="workspace-identity-reviews">
      <header className="crm-inline-91c912957d">
        <div>
          <p className="crm-inline-a271fddf57">Super Admin · Identity integrity</p>
          <h2 id="identity-reviews-title" className="crm-inline-60ab2db7aa">Client identity reviews</h2>
          <p className="crm-inline-441384af36">Review client records that share contact details. Mark a pair as distinct after comparing both records. Merging is disabled until related data can be transferred safely.</p>
        </div>
        <button type="button" style={buttonBase} onClick={() => onReload(statusFilter || 'pending')} disabled={loading || Boolean(busyKey)} data-testid="button-reload-identity-reviews">{loading ? 'Refreshing…' : 'Refresh queue'}</button>
      </header>

      <div className="identity-reviews-summary crm-inline-19890b8917"  data-testid="summary-identity-reviews">
        <div className="crm-inline-0150d13cbc" data-testid="stat-identity-review-total"><span className="crm-inline-60f707c5a0">Review pairs</span><strong className="crm-inline-eee75c7d5b">{reviews.length}</strong></div>
        <div className="crm-inline-6f0cf7a506" data-testid="stat-identity-review-statuses"><span className="crm-inline-60f707c5a0">Statuses in queue</span><strong className="crm-inline-7b1cd5d73b">{statuses.length}</strong></div>
      </div>

      {(error || actionError) && <div role="alert" className="crm-inline-7a4e975388" data-testid="alert-identity-reviews-error">{actionError || error}</div>}
      {notice && <div role="status" className="crm-inline-3cf7de1ad5" data-testid="status-identity-reviews-notice">{notice}</div>}

      <div className="identity-review-toolbar crm-inline-c47c91daf8" >
        <label htmlFor="identity-review-search" className="crm-inline-520ac58ffa">Search pair details
          <SearchAutocomplete
            inputProps={{ id: 'identity-review-search', type: 'search', 'data-testid': 'input-search-identity-reviews' }}
            value={search}
            onChange={setSearch}
            placeholder="Client, email, company, reason, ID…"
            className="crm-themed-form-control crm-themed-form-control--identity"
            buildSuggestions={(query) => reviews.filter((review) => (statusFilter === 'all' || !statusFilter || review.status === statusFilter) && [
              review.client_a_name, review.client_a_company, review.client_a_email, review.client_a_phone,
              review.client_b_name, review.client_b_company, review.client_b_email, review.client_b_phone,
              review.reason, review.status, review.client_id_a, review.client_id_b,
            ].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
              .slice(0, 8).map((review) => ({
                key: `${review.client_id_a}-${review.client_id_b}`,
                value: review.client_a_name || String(review.client_id_a),
                label: `${review.client_a_name || `Client ${review.client_id_a}`} / ${review.client_b_name || `Client ${review.client_id_b}`}`,
                meta: [review.client_a_email, review.client_b_email, review.status].filter(Boolean).join(' · '),
              }))}
          />
        </label>
        <label htmlFor="identity-review-status-filter" className="crm-inline-520ac58ffa">Review status
          <select id="identity-review-status-filter" value={statusFilter} onChange={(event) => {
            const nextStatus = event.target.value;
            setStatusFilter(nextStatus);
            void onReload(nextStatus);
          }} className="crm-themed-form-control crm-themed-form-control--identity" data-testid="filter-identity-reviews-status">
            <option value="pending">Needs review</option>
            <option value="distinct">Marked distinct</option>
            <option value="all">All statuses</option>
          </select>
        </label>
      </div>

      {loading && <div aria-label="Loading identity reviews" aria-busy="true" className="crm-inline-19890b8917" data-testid="loading-identity-reviews">{[0, 1].map((index) => <div key={index} className="crm-inline-2c174dd6e8" data-testid={`skeleton-identity-review-${index}`} />)}</div>}

      {!loading && error && reviews.length === 0 && <div className="crm-inline-3075faa847" data-testid="error-state-identity-reviews"><h3 className="crm-inline-b2ce718d54">Reviews could not be loaded</h3><p className="crm-inline-9a72166fdb">{error}</p><button type="button" style={buttonBase} onClick={onReload} data-testid="button-retry-identity-reviews">Try again</button></div>}

      {!loading && !error && reviews.length === 0 && <div className="crm-inline-38d180080d" data-testid="empty-identity-reviews">
        <span aria-hidden="true" className="crm-inline-df38bf24b8">?</span>
        <h3 className="crm-inline-b2ce718d54">{statusFilter === 'pending' ? 'No identity reviews waiting' : 'No matching identity reviews'}</h3>
        <p className="crm-inline-b09a9a5b62">Potential duplicates with matching email addresses or phone numbers appear here automatically.</p>
      </div>}

      {!loading && reviews.length > 0 && filteredReviews.length === 0 && <div className="crm-inline-2c8f469258" data-testid="empty-filtered-identity-reviews">No reviews match your search or status filter.</div>}

      {!loading && filteredReviews.length > 0 && <div className="crm-inline-3f73082e13" data-testid="list-identity-reviews">
        {filteredReviews.map((review) => {
          const key = `${review.client_id_a}-${review.client_id_b}`;
          const busy = busyKey === key;
          return (
            <article key={key} className="crm-inline-9ef2594ffb" data-testid={`card-identity-review-${review.client_id_a}-${review.client_id_b}`}>
              <header className="crm-inline-a5536978f7">
                <div className="crm-inline-1d17149d73">
                  <span className="crm-inline-cb7b2ae3ee" data-testid={`text-identity-review-pair-${review.client_id_a}-${review.client_id_b}`}>PAIR {review.client_id_a} / {review.client_id_b}</span>
                  <span className="crm-inline-ca457ab75c" data-testid={`status-identity-review-${review.client_id_a}-${review.client_id_b}`}>{review.status || 'Needs review'}</span>
                </div>
                <time dateTime={review.created_at || undefined} className="crm-inline-2d4293ada5" data-testid={`text-identity-review-created-${review.client_id_a}-${review.client_id_b}`}>{review.created_at ? new Date(review.created_at).toLocaleString() : 'Date unavailable'}</time>
              </header>

              <div className="identity-review-pair crm-inline-f7c613f171" >
                <ClientIdentity side="A" name={review.client_a_name} company={review.client_a_company} email={review.client_a_email} phone={review.client_a_phone} clientId={review.client_id_a} />
                <div className="identity-review-pair-arrow crm-inline-15dcc312ad" aria-hidden="true" >↔</div>
                <ClientIdentity side="B" name={review.client_b_name} company={review.client_b_company} email={review.client_b_email} phone={review.client_b_phone} clientId={review.client_id_b} />
              </div>

              <div className="crm-inline-f520b44ad0" data-testid={`text-identity-review-reason-${review.client_id_a}-${review.client_id_b}`}>
                <span className="crm-inline-a2073d4b8b">Reason flagged</span>
                <span className="crm-inline-1ba5fe2da0">{review.reason || 'No reason supplied.'}</span>
              </div>

              <div className="crm-inline-a37fd3c259">
                <p className="crm-inline-3b1ae40ed8">Resolve only after comparing the contact and company details above.</p>
                <div className="crm-inline-8e45b81904">
                  {review.status === 'pending' && <button type="button" style={{ ...buttonBase, borderColor: 'rgba(68,211,162,.35)', color: '#72d8af' }} disabled={busy || Boolean(busyKey)} onClick={() => runResolve(review, 'distinct')} data-testid={`button-mark-distinct-${review.client_id_a}-${review.client_id_b}`}>{busy ? 'Saving…' : 'Mark as distinct'}</button>}
                  {review.status !== 'pending' && <span className="crm-inline-2d4293ada5">{review.status === 'distinct' ? 'Resolved as distinct' : `Resolved: ${review.status}`}</span>}
                </div>
              </div>
            </article>
          );
        })}
      </div>}

    </section>
  );
}