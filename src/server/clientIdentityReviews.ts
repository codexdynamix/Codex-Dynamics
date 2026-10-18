import { createHash } from 'node:crypto';

type ClientRecord = Record<string, any>;

function activeClient(client: ClientRecord): boolean {
  return client.is_bin !== true && !client.deleted_at;
}

function normalizedEmail(client: ClientRecord): string {
  const email = String(client.email || client.email_address || '').trim().toLowerCase();
  return email.includes('@') ? email : '';
}

function normalizedPhone(client: ClientRecord): string {
  const phone = String(client.phone || client.phone_number || client.mobile || '').replace(/\D/g, '');
  return phone.length >= 7 ? phone : '';
}

export function identityReviewPairKey(clientIdA: string, clientIdB: string): string {
  const ids = [clientIdA, clientIdB].sort();
  return createHash('sha256').update(JSON.stringify(ids)).digest('hex');
}

export function buildClientIdentityReviews(
  clients: ClientRecord[],
  savedReviews: ClientRecord[],
): ClientRecord[] {
  const savedByPair = new Map<string, ClientRecord>();
  for (const saved of savedReviews) {
    const idA = String(saved.client_id_a || '');
    const idB = String(saved.client_id_b || '');
    if (!idA || !idB || idA === idB) continue;
    savedByPair.set(saved.pair_key || identityReviewPairKey(idA, idB), saved);
  }

  const candidateReasons = new Map<string, {
    clientA: ClientRecord;
    clientB: ClientRecord;
    reasons: Set<string>;
  }>();
  const groupedClients = new Map<string, { client: ClientRecord; reason: string }[]>();

  for (const client of clients.filter(activeClient)) {
    const clientId = String(client.id || '').trim();
    if (!clientId) continue;
    const email = normalizedEmail(client);
    const phone = normalizedPhone(client);
    for (const [value, reason] of [
      [email, 'Matching email address'],
      [phone, 'Matching phone number'],
    ]) {
      if (!value) continue;
      const key = `${reason}:${value}`;
      const group = groupedClients.get(key) || [];
      group.push({ client, reason });
      groupedClients.set(key, group);
    }
  }

  for (const group of groupedClients.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const first = group[i].client;
        const second = group[j].client;
        const firstId = String(first.id);
        const secondId = String(second.id);
        if (firstId === secondId) continue;

        const [clientA, clientB] = firstId < secondId
          ? [first, second]
          : [second, first];
        const idA = String(clientA.id);
        const idB = String(clientB.id);
        const pairKey = identityReviewPairKey(idA, idB);
        const candidate = candidateReasons.get(pairKey) || {
          clientA,
          clientB,
          reasons: new Set<string>(),
        };
        candidate.reasons.add(group[i].reason);
        candidateReasons.set(pairKey, candidate);
      }
    }
  }

  const reviews = new Map<string, ClientRecord>();
  for (const [pairKey, candidate] of candidateReasons) {
    const { clientA, clientB } = candidate;
    const saved = savedByPair.get(pairKey);
    reviews.set(pairKey, {
      ...(saved || {}),
      id: saved?.id || `identity_${pairKey}`,
      pair_key: pairKey,
      client_id_a: String(clientA.id),
      client_id_b: String(clientB.id),
      client_a_name: clientA.name || clientA.full_name || '',
      client_a_company: clientA.company || '',
      client_a_email: clientA.email || clientA.email_address || '',
      client_a_phone: clientA.phone || clientA.phone_number || clientA.mobile || '',
      client_b_name: clientB.name || clientB.full_name || '',
      client_b_company: clientB.company || '',
      client_b_email: clientB.email || clientB.email_address || '',
      client_b_phone: clientB.phone || clientB.phone_number || clientB.mobile || '',
      reason: [...candidate.reasons].join(' and '),
      status: saved?.status || 'pending',
      created_at: saved?.created_at || clientA.created_at || clientB.created_at || '',
    });
  }

  for (const saved of savedReviews) {
    const idA = String(saved.client_id_a || '');
    const idB = String(saved.client_id_b || '');
    if (!idA || !idB || idA === idB) continue;
    const pairKey = saved.pair_key || identityReviewPairKey(idA, idB);
    if (!reviews.has(pairKey)) reviews.set(pairKey, { ...saved, pair_key: pairKey });
  }

  return [...reviews.values()];
}
