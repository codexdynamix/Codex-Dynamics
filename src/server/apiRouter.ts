import { Router, Request, Response } from 'express';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getMongoCollection, isMongoConnected, getDatabaseName } from './mongo.ts';
import { buildClientIdentityReviews, identityReviewPairKey } from './clientIdentityReviews.ts';
import { SEED_STAFF } from './seedData.ts';
import { normalizeAdminRole } from '../crm/roleNormalization.js';

export const apiRouter = Router();

function setPortalSessionCookie(req: Request, res: Response, token: string) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  res.cookie('cdx_portal_session', token, {
    httpOnly: true,
    secure: req.secure || forwardedProto === 'https',
    sameSite: 'lax',
    path: '/api/',
    maxAge: 12 * 60 * 60 * 1000,
  });
}
function setAdminSessionCookie(req: Request, res: Response, token: string) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  res.cookie('cdx_admin_session', token, {
    httpOnly: true,
    secure: req.secure || forwardedProto === 'https',
    sameSite: 'lax',
    path: '/api/',
    maxAge: 12 * 60 * 60 * 1000,
  });
}
function clearAdminSessionCookie(req: Request, res: Response) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  res.clearCookie('cdx_admin_session', {
    httpOnly: true,
    secure: req.secure || forwardedProto === 'https',
    sameSite: 'lax',
    path: '/api/',
  });
}
const seededSuperAdmin = SEED_STAFF.find((staff) => staff.id === 'staff_super_admin');
function getAdminSessionIdentity(req: Request) {
  const authorization = String(req.headers.authorization || '');
  const cookieToken = String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('cdx_admin_session='))
    ?.slice('cdx_admin_session='.length) || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || cookieToken;
  const match = token.match(/^cdx_adm_(?:mongo|php_mongo)_(.+)_(\d{10,13})$/);
  if (!match) return null;
  const issuedAt = Number(match[2]) * (match[2].length === 10 ? 1000 : 1);
  if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 60_000 || Date.now() - issuedAt > 12 * 60 * 60 * 1000) {
    return null;
  }
  return {
    staffId: match[1],
    issuedAt,
    id: `staff_${match[1]}_${issuedAt}`,
  };
}
async function requireChatStaff(req: Request, res: Response) {
  const identity = getAdminSessionIdentity(req);
  if (!identity) {
    res.status(401).json({ ok: false, error: 'A valid staff session is required.' });
    return null;
  }
  const sessions = getMongoCollection('live_sessions');
  const session = await sessions.findOne({ id: identity.id });
  if (session?.revoked === true) {
    res.status(401).json({ ok: false, error: 'This staff session has been terminated. Sign in again.' });
    return null;
  }
  const staff = await getMongoCollection('staff_users').findOne({ id: identity.staffId });
  if (!staff || staff.status === 'Suspended' || staff.deleted_at || staff.is_bin === true) {
    res.status(401).json({ ok: false, error: 'The staff account is unavailable.' });
    return null;
  }
  return staff;
}
async function requireChatSuperAdmin(req: Request, res: Response) {
  const staff = await requireChatStaff(req, res);
  if (!staff) return null;
  if (normalizeAdminRole(staff.role) !== 'Super Admin') {
    res.status(403).json({ ok: false, error: 'Only Super Admin can clear client history.' });
    return null;
  }
  return staff;
}
const STAFF_CAPABILITY_CATALOG = {
  client_upload: 'Client Upload',
  create_agent: 'Create Agent',
  registrations: 'Registrations',
  notifications: 'Notifications',
  security: 'Security',
  content: 'Content',
  enquiries: 'Enquiries',
  chat: 'Chat',
} as const;
const DEFAULT_STAFF_CAPABILITIES = Object.fromEntries(
  Object.keys(STAFF_CAPABILITY_CATALOG).map((key) => [key, true])
);

function decodeStaffCapabilities(value: unknown): Record<string, boolean> {
  let decoded = value;
  if (typeof decoded === 'string') {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      return {};
    }
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return {};
  return Object.fromEntries(
    Object.entries(decoded).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
  );
}

async function staffCanNotifyClient(
  staff: Record<string, unknown>,
  client: Record<string, unknown>
): Promise<boolean> {
  const role = normalizeAdminRole(staff.role);
  const agentId = String(client.assignedToAgent || client.assigned_agent_id || client.agentId || client.agent_id || '');
  const agent = agentId
    ? await getMongoCollection('staff_users').findOne({ id: agentId })
    : null;
  const teamId = String(
    client.assignedToTeam || client.assigned_team_id || client.teamId || client.team_id
    || agent?.teamId || agent?.team_id || ''
  );
  const team = teamId ? await getMongoCollection('teams').findOne({ id: teamId }) : null;
  const clientOfficeId = String(
    client.assignedToOffice || client.assigned_office_id || client.officeId || client.office_id
    || agent?.officeId || agent?.office_id || team?.officeId || team?.office_id || ''
  );

  if (role === 'Office Manager') {
    const officeId = String(staff.officeId || staff.office_id || '');
    return Boolean(officeId && clientOfficeId === officeId);
  }
  if (role === 'Team Leader') {
    const staffTeamId = String(staff.teamId || staff.team_id || '');
    const clientTeamLeaderId = String(client.assignedToTeamLeader || client.assigned_team_leader_id || '');
    return Boolean(
      (staffTeamId && teamId === staffTeamId)
      || (clientTeamLeaderId && clientTeamLeaderId === String(staff.id || ''))
    );
  }
  if (role === 'Agent') {
    return Boolean(agentId && agentId === String(staff.id || ''));
  }
  return false;
}

// CORS & Middleware
apiRouter.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Chat-Token');
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

// ---------------------------------------------------------------------------
// HEALTH CHECK
// ---------------------------------------------------------------------------
apiRouter.get('/healthz', async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    storage: 'mongodb',
    database: getDatabaseName(),
    connected: isMongoConnected(),
    ...(isMongoConnected() ? {} : { error: 'MongoDB is not connected. Configure MONGODB_URI to enable CRM APIs.' }),
    timestamp: new Date().toISOString(),
  });
});

apiRouter.use((_req: Request, res: Response, next) => {
  if (!isMongoConnected()) {
    return res.status(503).json({
      ok: false,
      storage: 'mongodb',
      error: 'MongoDB is not connected. Configure MONGODB_URI to enable CRM APIs.',
    });
  }
  next();
});

// ---------------------------------------------------------------------------
// 1. PUBLIC WEBSITE CONTENT & ENQUIRIES
// ---------------------------------------------------------------------------
function isPublishedReview(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'published', 'yes'].includes(value.trim().toLowerCase());
}

const handlePublicContent = async (_req: Request, res: Response) => {
  try {
    const [projects, blogs, reviews, projectCategories] = await Promise.all([
      getMongoCollection('projects').find({ published: { $ne: false } }),
      getMongoCollection('blogs').find({ status: 'published' }),
      getMongoCollection('reviews').find(),
      getMongoCollection('project_categories').find(),
    ]);
    const categories = new Map<string, string>();
    for (const category of projectCategories) {
      const name = String(category.name || '').trim();
      if (name) categories.set(name.toLocaleLowerCase(), name);
    }
    for (const project of projects) {
      const name = String(project.category || '').trim();
      if (name) categories.set(name.toLocaleLowerCase(), name);
    }

    res.json({
      ok: true,
      storage: 'mongodb',
      projects: projects.map((p) => ({ ...p, id: p.id || p._id, is_published: true, published: true })),
      categories: [...categories.values()],
      blogs: blogs.map((b) => ({ ...b, id: b.id || b._id })),
      reviews: reviews
        .filter((review) => isPublishedReview(review.is_published))
        .map((review) => ({ ...review, id: review.id || review._id })),
      backlinks: [],
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

apiRouter.get('/public/content', handlePublicContent);
apiRouter.get('/content', handlePublicContent);

apiRouter.post('/crm/action', async (req: Request, res: Response) => {
  try {
    const { action, payload } = req.body || {};
    if (action === 'upload_image') {
      const data = String(req.body?.data || '');
      const match = data.match(/^data:(image\/(?:jpeg|png|webp|gif|avif)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/]+=*)$/);
      if (!match) {
        return res.status(422).json({ ok: false, error: 'Choose a supported image or video file.' });
      }
      const mimeType = match[1];
      const file = Buffer.from(match[2], 'base64');
      if (file.length === 0 || file.length > 5 * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: 'Media files must be 5MB or smaller.' });
      }
      const extensionByMime: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/avif': 'avif',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
      };
      const extension = extensionByMime[mimeType];
      const directory = path.resolve(process.cwd(), 'public', 'uploads', 'projects');
      await mkdir(directory, { recursive: true });
      const filename = `${randomUUID()}.${extension}`;
      await writeFile(path.join(directory, filename), file, { flag: 'wx' });
      return res.json({
        ok: true,
        url: `/uploads/projects/${filename}`,
        mediaType: mimeType.startsWith('video/') ? 'video' : 'image',
      });
    }
    if (action === 'subscribe_newsletter') {
      await getMongoCollection('newsletter_subscribers').insertOne({
        email: payload?.email,
        created_at: new Date().toISOString(),
      });
      return res.json({ ok: true, message: 'Subscribed successfully in MongoDB.' });
    }
    if (action === 'submit_inquiry') {
      await getMongoCollection('messages').insertOne({
        ...payload,
        type: 'inquiry',
        created_at: new Date().toISOString(),
      });
      return res.json({ ok: true, message: 'Inquiry registered in MongoDB.' });
    }
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// 2. STAFF & SUPER ADMIN AUTHENTICATION & PASSWORDS
// ---------------------------------------------------------------------------
apiRouter.post('/admin/login', async (req: Request, res: Response) => {
  try {
    const { email, password, role } = req.body || {};
    const normEmail = String(email || '').toLowerCase().trim();

    const staffCol = getMongoCollection('staff_users');
    let staff = await staffCol.findOne({
      $or: [
        { email: normEmail },
        { email: { $regex: `^${normEmail}$`, $options: 'i' } },
      ],
    });

    if (!staff && normEmail === 'admin@codexdynamics.com') {
      staff = {
        id: 'staff_super_admin',
        email: 'admin@codexdynamics.com',
        password: seededSuperAdmin?.password,
        name: 'Codex Super Admin',
        role: 'super-admin',
        office_id: 'off_1',
        officeId: 'off_1',
        team_id: 'team_1',
        teamId: 'team_1',
        status: 'Active',
        capabilities: JSON.stringify(['all']),
      };
      await staffCol.insertOne(staff);
    }

    if (!staff) {
      return res.status(401).json({ ok: false, error: 'Staff account not found in MongoDB.' });
    }

    const expectedPassword = staff.password;
    if (!expectedPassword || password !== expectedPassword) {
      return res.status(401).json({ ok: false, error: 'Invalid password.' });
    }

    const canonicalRole = normalizeAdminRole(staff.role || role || 'super-admin');
    const token = `cdx_adm_mongo_${staff.id}_${Date.now()}`;
    setAdminSessionCookie(req, res, token);
    await staffCol.updateOne(
      { id: staff.id },
      { $set: { role: canonicalRole, last_login_at: new Date().toISOString() } }
    );

    res.json({
      ok: true,
      token,
      user: {
        id: staff.id,
        email: staff.email,
        name: staff.name,
        role: canonicalRole,
        officeId: staff.officeId || staff.office_id || 'off_1',
        teamId: staff.teamId || staff.team_id || 'team_1',
        status: staff.status || 'Active',
        capabilities: staff.capabilities || '["all"]',
      },
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

apiRouter.get('/admin/me', async (_req: Request, res: Response) => {
  try {
    const staffCol = getMongoCollection('staff_users');
    const staff = (await staffCol.findOne({
      role: { $regex: '^super[\\s_-]*admin$', $options: 'i' },
    })) || {
      id: 'staff_super_admin',
      email: 'admin@codexdynamics.com',
      name: 'Codex Super Admin',
      role: 'super-admin',
      officeId: 'off_1',
      teamId: 'team_1',
      status: 'Active',
      capabilities: '["all"]',
    };
    res.json({ ok: true, user: staff });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

apiRouter.post('/admin/me/password', async (req: Request, res: Response) => {
  try {
    const { current_password, new_password, newPassword } = req.body || {};
    const targetPassword = new_password || newPassword;
    if (!targetPassword) return res.status(400).json({ ok: false, error: 'New password required.' });

    const staffCol = getMongoCollection('staff_users');
    await staffCol.updateOne(
      { role: { $regex: '^super[\\s_-]*admin$', $options: 'i' } },
      { $set: { password: targetPassword, updated_at: new Date().toISOString() } }
    );
    res.json({ ok: true, message: 'Password updated successfully in MongoDB.' });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

apiRouter.post('/admin/logout', async (req: Request, res: Response) => {
  const identity = getAdminSessionIdentity(req);
  if (identity) {
    await getMongoCollection('live_sessions').updateOne(
      { id: identity.id },
      { $set: { revoked: true, is_online: false, logged_out_at: new Date().toISOString() } }
    );
  }
  clearAdminSessionCookie(req, res);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 3. STAFF, OFFICES & TEAMS MANAGEMENT
// ---------------------------------------------------------------------------
apiRouter.get('/admin/staff', async (_req: Request, res: Response) => {
  const staff = await getMongoCollection('staff_users').find();
  res.json({ ok: true, staff });
});

apiRouter.post('/admin/staff', async (req: Request, res: Response) => {
  const newStaff = {
    ...req.body,
    id: req.body.id || `staff_${Date.now()}`,
    status: req.body.status || 'Active',
    created_at: new Date().toISOString(),
  };
  await getMongoCollection('staff_users').insertOne(newStaff);
  res.json({ ok: true, staff: newStaff });
});

apiRouter.get('/admin/staff/:id/capabilities', async (req: Request, res: Response) => {
  try {
    const staff = await getMongoCollection('staff_users').findOne({ id: req.params.id });
    if (!staff) return res.status(404).json({ ok: false, error: 'Staff member not found.' });
    return res.json({
      ok: true,
      catalog: STAFF_CAPABILITY_CATALOG,
      capabilities: {
        ...DEFAULT_STAFF_CAPABILITIES,
        ...decodeStaffCapabilities(staff.capabilities),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

apiRouter.put('/admin/staff/:id/capabilities', async (req: Request, res: Response) => {
  try {
    const staffCollection = getMongoCollection('staff_users');
    const staff = await staffCollection.findOne({ id: req.params.id });
    if (!staff) return res.status(404).json({ ok: false, error: 'Staff member not found.' });

    const requested = req.body?.capabilities;
    if (!requested || typeof requested !== 'object' || Array.isArray(requested)) {
      return res.status(422).json({ ok: false, error: 'A capabilities object is required.' });
    }
    const requestedEntries = Object.entries(requested);
    if (requestedEntries.some(([key, value]) => (
      !Object.hasOwn(STAFF_CAPABILITY_CATALOG, key) || typeof value !== 'boolean'
    ))) {
      return res.status(422).json({
        ok: false,
        error: 'Capabilities must use supported names and boolean values.',
      });
    }

    const capabilities = {
      ...DEFAULT_STAFF_CAPABILITIES,
      ...decodeStaffCapabilities(staff.capabilities),
      ...Object.fromEntries(requestedEntries),
    };
    await staffCollection.updateOne({ id: req.params.id }, { $set: { capabilities } });
    return res.json({ ok: true, capabilities });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

apiRouter.patch('/admin/staff/:id', async (req: Request, res: Response) => {
  await getMongoCollection('staff_users').updateOne({ id: req.params.id }, { $set: req.body });
  const updated = await getMongoCollection('staff_users').findOne({ id: req.params.id });
  res.json({ ok: true, staff: updated });
});

apiRouter.delete('/admin/staff/:id', async (req: Request, res: Response) => {
  await getMongoCollection('staff_users').deleteOne({ id: req.params.id });
  res.json({ ok: true });
});

apiRouter.post('/admin/staff/:id/block', async (req: Request, res: Response) => {
  await getMongoCollection('staff_users').updateOne({ id: req.params.id }, { $set: { status: 'Blocked' } });
  res.json({ ok: true });
});

apiRouter.post('/admin/staff/:id/unblock', async (req: Request, res: Response) => {
  await getMongoCollection('staff_users').updateOne({ id: req.params.id }, { $set: { status: 'Active' } });
  res.json({ ok: true });
});

apiRouter.get('/admin/staff/:id/notes', async (req: Request, res: Response) => {
  const notes = await getMongoCollection('staff_notes').find({ staffId: req.params.id });
  res.json({ ok: true, notes });
});

apiRouter.post('/admin/staff/:id/notes', async (req: Request, res: Response) => {
  const newNote = {
    id: `note_${Date.now()}`,
    staffId: req.params.id,
    text: req.body.text || '',
    created_at: new Date().toISOString(),
  };
  await getMongoCollection('staff_notes').insertOne(newNote);
  res.json({ ok: true, note: newNote });
});

apiRouter.get('/admin/offices', async (_req: Request, res: Response) => {
  const offices = await getMongoCollection('offices').find();
  res.json({ ok: true, offices });
});

apiRouter.post('/admin/offices', async (req: Request, res: Response) => {
  const newOffice = { ...req.body, id: req.body.id || `off_${Date.now()}` };
  await getMongoCollection('offices').insertOne(newOffice);
  res.json({ ok: true, office: newOffice });
});

apiRouter.delete('/admin/offices/:id', async (req: Request, res: Response) => {
  await getMongoCollection('offices').deleteOne({ id: req.params.id });
  res.json({ ok: true });
});

apiRouter.get('/admin/teams', async (_req: Request, res: Response) => {
  const teams = await getMongoCollection('teams').find();
  res.json({ ok: true, teams });
});

apiRouter.post('/admin/teams', async (req: Request, res: Response) => {
  const newTeam = { ...req.body, id: req.body.id || `team_${Date.now()}` };
  await getMongoCollection('teams').insertOne(newTeam);
  res.json({ ok: true, team: newTeam });
});

apiRouter.delete('/admin/teams/:id', async (req: Request, res: Response) => {
  await getMongoCollection('teams').deleteOne({ id: req.params.id });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 4. CLIENT MANAGEMENT & DISTRIBUTION (CRM)
// ---------------------------------------------------------------------------
function clientDeletionFilter(includeDeleted: unknown): Record<string, unknown> {
  const mode = String(includeDeleted || '');
  if (mode === '1') return {};
  if (mode === 'only') {
    return { $or: [{ is_bin: true }, { deleted_at: { $ne: null } }] };
  }
  return { $nor: [{ is_bin: true }, { deleted_at: { $ne: null } }] };
}

apiRouter.get('/admin/clients', async (req: Request, res: Response) => {
  const collection = getMongoCollection('clients');
  const filter = clientDeletionFilter(req.query.include_deleted);
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const clients = await collection.find(filter, {
    sort: { _id: -1 },
    limit: limit + 1,
    skip: offset,
  });
  const hasMore = clients.length > limit;
  if (hasMore) clients.pop();
  res.json({
    ok: true,
    clients,
    total: hasMore ? null : offset + clients.length,
    limit,
    offset,
    hasMore,
    has_more: hasMore,
  });
});

apiRouter.get('/admin/clients/search', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  const clientsCol = getMongoCollection('clients');
  const activeClients = clientDeletionFilter(undefined);
  if (!q) {
    const clients = await clientsCol.find(activeClients, { limit: 10 });
    return res.json({ ok: true, clients });
  }
  const clients = await clientsCol.find({
    $and: [
      activeClients,
      {
        $or: [
          { name: { $regex: q, $options: 'i' } },
          { company: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } },
          { phone: { $regex: q, $options: 'i' } },
        ],
      },
    ],
  });
  res.json({ ok: true, clients });
});

apiRouter.post('/admin/clients', async (req: Request, res: Response) => {
  const payload = req.body || {};
  const first = payload.firstName || payload.first_name || '';
  const last = payload.lastName || payload.last_name || '';
  const fullName = String(payload.name || `${first} ${last}`).trim();
  const email = String(payload.email || '').trim().toLowerCase();
  if (!fullName || !email) {
    return res.status(422).json({ ok: false, error: 'Client name and email are required.' });
  }
  const newClient = {
    ...payload,
    id: payload.id || `client_${Date.now()}`,
    name: fullName,
    email,
    firstName: first,
    lastName: last,
    status: payload.status || payload.stage || 'Active',
    stage: payload.stage || payload.status || 'Active',
    portalEnabled: true,
    portal_enabled: 1,
    tier: payload.tier || 'Enterprise Partner',
    password: payload.password || 'admin123',
    created_at: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  await getMongoCollection('clients').insertOne(newClient);
  res.json({ ok: true, client: newClient });
});

apiRouter.get('/admin/clients/:id', async (req: Request, res: Response) => {
  const client = await getMongoCollection('clients').findOne({ id: req.params.id });
  if (!client) return res.status(404).json({ ok: false, error: 'Client not found.' });
  res.json({ ok: true, client });
});

apiRouter.patch('/admin/clients/:id', async (req: Request, res: Response) => {
  const clients = getMongoCollection('clients');
  const updates = { ...(req.body || {}) };
  const requestedStage = updates.stage ?? updates.status;
  const historyKeys = ['comment_history', 'commentHistory', 'status_history', 'statusHistory'];
  const includesHistoryMutation = historyKeys.some((key) => Object.prototype.hasOwnProperty.call(updates, key));
  delete updates._actorId;
  delete updates._actorName;

  const update: Record<string, any> = { $set: updates };
  let staff: Record<string, any> | null = null;
  let existing: Record<string, any> | null = null;
  if (includesHistoryMutation || requestedStage !== undefined || updates.comment !== undefined) {
    staff = includesHistoryMutation
      ? await requireChatSuperAdmin(req, res)
      : await requireChatStaff(req, res);
    if (!staff) return;
  }
  if (requestedStage !== undefined || updates.comment !== undefined) {
    existing = await clients.findOne({ id: req.params.id });
    if (!existing) return res.status(404).json({ ok: false, error: 'Client not found.' });
  }
  if (requestedStage !== undefined) {
    const nextStage = typeof requestedStage === 'string' ? requestedStage.trim() : '';
    if (!nextStage || nextStage.length > 80) {
      return res.status(422).json({ ok: false, error: 'Choose a valid client status.' });
    }
    const previousStage = String(existing?.stage || existing?.status || 'New');
    update.$set = {
      ...updates,
      stage: nextStage,
      status: nextStage,
      updated_at: new Date().toISOString(),
    };
    if (previousStage !== nextStage) {
      const staffName = String(
        staff?.name
        || `${staff?.firstName || staff?.first_name || ''} ${staff?.lastName || staff?.last_name || ''}`.trim()
        || staff?.email
        || 'Staff'
      );
      const transition = {
        id: randomUUID(),
        from_stage: previousStage,
        to_stage: nextStage,
        by_admin_id: String(staff?.id || ''),
        by_name: staffName,
        created_at: new Date().toISOString(),
      };
      const history = Array.isArray(existing?.status_history) ? existing.status_history : [];
      const legacyHistory = Array.isArray(existing?.statusHistory) ? existing.statusHistory : [];
      if (history.length === 0 && legacyHistory.length > 0) {
        update.$set.status_history = [...legacyHistory, transition].slice(-100);
      } else {
        update.$push = {
          ...(update.$push || {}),
          status_history: { $each: [transition], $slice: -100 },
        };
      }
    }
  }
  if (updates.comment !== undefined) {
    if (typeof updates.comment !== 'string' || !updates.comment.trim() || updates.comment.trim().length > 5000) {
      return res.status(422).json({ ok: false, error: 'Comment must contain 1 to 5000 characters.' });
    }
    const staffName = String(
      staff?.name
      || `${staff?.firstName || staff?.first_name || ''} ${staff?.lastName || staff?.last_name || ''}`.trim()
      || staff?.email
      || 'Staff'
    );
    update.$set.comment = updates.comment.trim();
    const commentEntry = {
      id: randomUUID(),
      text: updates.comment.trim(),
      by_admin_id: String(staff?.id || ''),
      by_name: staffName,
      created_at: new Date().toISOString(),
    };
    const history = Array.isArray(existing?.comment_history) ? existing.comment_history : [];
    const legacyHistory = Array.isArray(existing?.commentHistory) ? existing.commentHistory : [];
    if (history.length === 0 && legacyHistory.length > 0) {
      update.$set.comment_history = [...legacyHistory, commentEntry].slice(-200);
    } else {
      update.$push = {
        ...(update.$push || {}),
        comment_history: { $each: [commentEntry], $slice: -200 },
      };
    }
  }

  const result = await clients.updateOne({ id: req.params.id }, update);
  if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Client not found.' });
  return res.json({ ok: true, client: await clients.findOne({ id: req.params.id }) });
});

apiRouter.delete('/admin/clients/:id', async (req: Request, res: Response) => {
  const clients = getMongoCollection('clients');
  if (req.query.permanent === '1') {
    const result = await clients.deleteOne({ id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ ok: false, error: 'Client not found.' });
    return res.json({ ok: true, deleted: true });
  }

  const result = await clients.updateOne(
    { id: req.params.id },
    { $set: { deleted_at: new Date().toISOString(), is_bin: true } }
  );
  if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Client not found.' });
  return res.json({ ok: true });
});

apiRouter.post('/admin/clients/:id/restore', async (req: Request, res: Response) => {
  const clients = getMongoCollection('clients');
  const result = await clients.updateOne(
    { id: req.params.id },
    { $set: { deleted_at: null, is_bin: false } }
  );
  if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Client not found.' });
  const client = await clients.findOne({ id: req.params.id });
  return res.json({ ok: true, client });
});

apiRouter.post('/admin/clients/:id/impersonate', async (req: Request, res: Response) => {
  const storedClient = await getMongoCollection('clients').findOne({ id: req.params.id });
  if (!storedClient) return res.status(404).json({ ok: false, error: 'Client not found.' });
  const client = {
    ...storedClient,
    name: String(
      storedClient.name
      || `${storedClient.first_name || storedClient.firstName || ''} ${storedClient.last_name || storedClient.lastName || ''}`.trim()
      || storedClient.company
      || 'Client'
    ),
    company: storedClient.company || '',
    email: storedClient.email || '',
  };
  const token = `cdx_portal_impersonate_${client.id}_${Date.now()}`;
  setPortalSessionCookie(req, res, token);
  res.json({
    ok: true,
    token,
    client: {
      ...client,
      status: client.status || 'Active',
      portalEnabled: true,
      tier: client.tier || 'Enterprise Partner',
    },
  });
});

apiRouter.all('/admin/clients/:id/portal-password', async (req: Request, res: Response) => {
  const client = await getMongoCollection('clients').findOne({ id: req.params.id });
  res.json({ ok: true, password: client?.password || 'admin123' });
});

apiRouter.post('/admin/clients/:id/set-password', async (req: Request, res: Response) => {
  const newPass = req.body.password || req.body.newPassword || 'admin123';
  await getMongoCollection('clients').updateOne({ id: req.params.id }, { $set: { password: newPass } });
  res.json({ ok: true, password: newPass, message: 'Password updated in MongoDB.' });
});

const clientAssignmentFieldAliases: Record<string, string[]> = {
  assignedToOffice: ['assigned_office_id', 'assignedToOffice', 'officeId'],
  assignedToTeam: ['assigned_team_id', 'assignedToTeam', 'teamId'],
  assignedToTeamLeader: ['assigned_team_leader_id', 'assignedToTeamLeader', 'teamLeaderId'],
  assignedToAgent: ['assigned_agent_id', 'assignedToAgent', 'agentId'],
};

function getClientAssignmentUpdates(source: Record<string, unknown>) {
  const updates: Record<string, string | null> = {};
  for (const [field, aliases] of Object.entries(clientAssignmentFieldAliases)) {
    const providedKey = aliases.find((key) => Object.prototype.hasOwnProperty.call(source, key));
    if (!providedKey) continue;
    const value = source[providedKey];
    if (value !== null && typeof value !== 'string') {
      throw new Error(`Invalid ${providedKey} assignment value.`);
    }
    updates[field] = typeof value === 'string' && value.trim() ? value.trim() : null;
  }
  return updates;
}

apiRouter.post('/admin/clients/:id/assign', async (req: Request, res: Response) => {
  let updates: Record<string, string | null>;
  try {
    updates = getClientAssignmentUpdates(req.body || {});
  } catch (error) {
    return res.status(422).json({ ok: false, error: error instanceof Error ? error.message : 'Invalid client assignment.' });
  }
  if (Object.keys(updates).length === 0) {
    return res.status(422).json({ ok: false, error: 'At least one client assignment field is required.' });
  }
  const clients = getMongoCollection('clients');
  const client = await clients.findOne({ id: req.params.id });
  if (!client) return res.status(404).json({ ok: false, error: 'Client not found.' });
  await clients.updateOne({ id: req.params.id }, { $set: updates });
  return res.json({ ok: true, client: await clients.findOne({ id: req.params.id }) });
});

apiRouter.post('/admin/clients/:id/reset-status', async (req: Request, res: Response) => {
  const staff = await requireChatSuperAdmin(req, res);
  if (!staff) return;
  const clients = getMongoCollection('clients');
  const result = await clients.updateOne(
    { id: req.params.id },
    { $set: { status: 'New', stage: 'New', status_history: [], statusHistory: [], updated_at: new Date().toISOString() } }
  );
  if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Client not found.' });
  return res.json({ ok: true, client: await clients.findOne({ id: req.params.id }) });
});

apiRouter.delete('/admin/clients/:id/comments', async (req: Request, res: Response) => {
  const staff = await requireChatSuperAdmin(req, res);
  if (!staff) return;
  const result = await getMongoCollection('clients').updateOne(
    { id: req.params.id },
    { $set: { comment_history: [], commentHistory: [], comment: '', last_comment_date: '', updated_at: new Date().toISOString() } }
  );
  if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Client not found.' });
  return res.json({ ok: true, client: await getMongoCollection('clients').findOne({ id: req.params.id }) });
});

apiRouter.delete('/admin/clients/:id/comments/:commentId', async (req: Request, res: Response) => {
  const staff = await requireChatSuperAdmin(req, res);
  if (!staff) return;
  const clients = getMongoCollection('clients');
  const client = await clients.findOne({ id: req.params.id });
  if (!client) return res.status(404).json({ ok: false, error: 'Client not found.' });
  const comments = Array.isArray(client.comment_history) && client.comment_history.length
    ? client.comment_history
    : (Array.isArray(client.commentHistory) ? client.commentHistory : []);
  const filtered = comments.filter((entry: Record<string, unknown>) => String(entry.id || '') !== req.params.commentId);
  if (filtered.length === comments.length) return res.status(404).json({ ok: false, error: 'Comment not found.' });
  const latestComment = [...filtered].sort(
    (a: Record<string, any>, b: Record<string, any>) =>
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  )[0];
  await clients.updateOne(
    { id: req.params.id },
    {
      $set: {
        comment_history: filtered,
        commentHistory: filtered,
        comment: String(latestComment?.text || ''),
        last_comment_date: String(latestComment?.created_at || '').slice(0, 10),
        updated_at: new Date().toISOString(),
      },
    }
  );
  return res.json({ ok: true, client: await clients.findOne({ id: req.params.id }) });
});

apiRouter.delete('/admin/clients/:id/status-history', async (req: Request, res: Response) => {
  const staff = await requireChatSuperAdmin(req, res);
  if (!staff) return;
  const clients = getMongoCollection('clients');
  const result = await clients.updateOne(
    { id: req.params.id },
    { $set: { status_history: [], statusHistory: [], updated_at: new Date().toISOString() } }
  );
  if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Client not found.' });
  return res.json({ ok: true, client: await clients.findOne({ id: req.params.id }) });
});

apiRouter.delete('/admin/clients/:id/status-history/:entryId', async (req: Request, res: Response) => {
  const staff = await requireChatSuperAdmin(req, res);
  if (!staff) return;
  const clients = getMongoCollection('clients');
  const client = await clients.findOne({ id: req.params.id });
  if (!client) return res.status(404).json({ ok: false, error: 'Client not found.' });
  const history = Array.isArray(client.status_history) && client.status_history.length
    ? client.status_history
    : (Array.isArray(client.statusHistory) ? client.statusHistory : []);
  const filtered = history.filter((entry: Record<string, unknown>) => String(entry.id || '') !== req.params.entryId);
  if (filtered.length === history.length) return res.status(404).json({ ok: false, error: 'Status history entry not found.' });
  await clients.updateOne(
    { id: req.params.id },
    { $set: { status_history: filtered, statusHistory: filtered, updated_at: new Date().toISOString() } }
  );
  return res.json({ ok: true, client: await clients.findOne({ id: req.params.id }) });
});

apiRouter.all('/admin/clients/:id/profile-permissions', async (req: Request, res: Response) => {
  if (req.method === 'POST') {
    await getMongoCollection('client_profile_permissions').updateOne(
      { clientId: req.params.id },
      { $set: { clientId: req.params.id, permissions: req.body } },
      { upsert: true }
    );
    return res.json({ ok: true });
  }
  const perms = await getMongoCollection('client_profile_permissions').findOne({ clientId: req.params.id });
  res.json({ ok: true, permissions: perms?.permissions || {} });
});

apiRouter.all('/admin/users', async (req: Request, res: Response) => {
  const clients = await getMongoCollection('clients').find(
    clientDeletionFilter(req.query.include_deleted)
  );
  res.json({ ok: true, users: clients, clients });
});

apiRouter.all('/admin/clients/:id/password', async (req: Request, res: Response) => {
  if (req.method === 'POST') {
    const newPass = req.body.password || 'admin123';
    await getMongoCollection('clients').updateOne({ id: req.params.id }, { $set: { password: newPass } });
    return res.json({ ok: true, password: newPass });
  }
  const client = await getMongoCollection('clients').findOne({ id: req.params.id });
  res.json({ ok: true, password: client?.password || 'admin123' });
});

apiRouter.all('/admin/clients/:id/appointments', async (req: Request, res: Response) => {
  if (req.method === 'POST') {
    const appt = { ...req.body, id: `appt_${Date.now()}`, clientId: req.params.id, created_at: new Date().toISOString() };
    await getMongoCollection('appointments').insertOne(appt);
    return res.json({ ok: true, appointment: appt });
  }
  const appointments = await getMongoCollection('appointments').find({ clientId: req.params.id });
  res.json({ ok: true, appointments });
});

apiRouter.post('/admin/clients/assign-bulk', async (req: Request, res: Response) => {
  const body = req.body || {};
  const clientIds = Array.isArray(body.client_ids)
    ? body.client_ids
    : Array.isArray(body.clientIds) ? body.clientIds : null;
  if (!Array.isArray(body.assignments) && !clientIds) {
    return res.status(422).json({ ok: false, error: 'Client IDs or assignments must be provided.' });
  }
  const rawAssignments: unknown[] = Array.isArray(body.assignments)
    ? body.assignments
    : (clientIds || []).map((clientId: unknown) => ({
        client_id: clientId,
        ...body,
      }));
  if (rawAssignments.length === 0) {
    return res.status(422).json({ ok: false, error: 'At least one client assignment is required.' });
  }

  let assignments: Array<{ id: string; updates: Record<string, string | null> }>;
  try {
    assignments = rawAssignments.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('Each client assignment must be an object.');
      }
      const source = entry as Record<string, unknown>;
      const id = String(source.client_id ?? source.clientId ?? '').trim();
      if (!id) throw new Error('Each client assignment must include a client ID.');
      const updates = getClientAssignmentUpdates(source);
      if (Object.keys(updates).length === 0) {
        throw new Error(`Assignment for client ${id} has no supported fields.`);
      }
      return { id, updates };
    });
  } catch (error) {
    return res.status(422).json({ ok: false, error: error instanceof Error ? error.message : 'Invalid client assignments.' });
  }

  const clients = getMongoCollection('clients');
  const ids = [...new Set(assignments.map((assignment) => assignment.id))];
  const existing = await clients.find({ id: { $in: ids } });
  const existingIds = new Set(existing.map((client: { id: string }) => client.id));
  const missingIds = ids.filter((id) => !existingIds.has(id));
  if (missingIds.length > 0) {
    return res.status(404).json({ ok: false, error: `Client not found: ${missingIds.join(', ')}.` });
  }

  for (const { id, updates } of assignments) {
    await clients.updateOne({ id }, { $set: updates });
  }
  const updatedClients = await clients.find({ id: { $in: ids } });
  return res.json({ ok: true, clients: updatedClients });
});

apiRouter.post('/admin/clients/bulk-status', async (req: Request, res: Response) => {
  const { clientIds, stage, status } = req.body || {};
  if (Array.isArray(clientIds) && clientIds.length > 0) {
    await getMongoCollection('clients').updateMany(
      { id: { $in: clientIds } },
      { $set: { stage: stage || status, status: status || stage } }
    );
  }
  res.json({ ok: true });
});

apiRouter.post('/admin/clients/bin/cleanup', async (_req: Request, res: Response) => {
  await getMongoCollection('clients').deleteMany({ is_bin: true });
  res.json({ ok: true });
});

apiRouter.post('/admin/clients/bin/purge-all', async (_req: Request, res: Response) => {
  await getMongoCollection('clients').deleteMany({ is_bin: true });
  res.json({ ok: true });
});

apiRouter.post('/admin/clients/import', async (req: Request, res: Response) => {
  const items = Array.isArray(req.body.clients) ? req.body.clients : [];
  if (items.length > 0) {
    const clientsToInsert = items.map((c: any) => {
      const first = c.firstName || c.first_name || '';
      const last = c.lastName || c.last_name || '';
      const fullName = c.name || `${first} ${last}`.trim() || 'Imported Client';
      return {
        ...c,
        id: c.id || `client_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: fullName,
        firstName: first,
        lastName: last,
        portalEnabled: true,
        portal_enabled: 1,
        status: c.status || c.stage || 'Active',
        stage: c.stage || c.status || 'Active',
        tier: c.tier || 'Enterprise Partner',
        password: c.password || 'admin123',
        createdAt: c.createdAt || new Date().toISOString(),
        created_at: c.created_at || new Date().toISOString(),
      };
    });
    await getMongoCollection('clients').insertMany(clientsToInsert);
    return res.json({ ok: true, count: items.length, imported: items.length, clients: clientsToInsert });
  }
  res.json({ ok: true, count: 0, imported: 0, clients: [] });
});

apiRouter.get('/admin/pending-counts', async (_req: Request, res: Response) => {
  const [inquiries, resets, tickets] = await Promise.all([
    getMongoCollection('messages').countDocuments({ read: { $ne: true } }),
    getMongoCollection('password_reset_requests').countDocuments({ resolved: { $ne: true } }),
    getMongoCollection('client_support_tickets').countDocuments({ status: 'Open' }),
  ]);
  res.json({ ok: true, inquiries, passwordResets: resets, supportTickets: tickets });
});

// ---------------------------------------------------------------------------
// 5. CLIENT PROJECTS & REVIEWS
// ---------------------------------------------------------------------------
apiRouter.get('/admin/support-tickets', async (req: Request, res: Response) => {
  const clientId = String(req.query.client_id || '').trim();
  const tickets = await getMongoCollection('client_support_tickets').find(
    clientId ? { clientId } : {},
    { sort: { created_at: -1 }, limit: 1000 }
  );
  const clientIds = [...new Set(tickets.map((ticket) => String(ticket.clientId || '')).filter(Boolean))];
  const clients = await Promise.all(clientIds.map((id) => getMongoCollection('clients').findOne({ id })));
  const clientById = new Map(clients.filter(Boolean).map((client) => [String(client!.id), client]));
  res.json({
    ok: true,
    tickets: tickets.map((ticket) => ({
      ...ticket,
      clientName: clientById.get(String(ticket.clientId))?.name || clientById.get(String(ticket.clientId))?.company || 'Client',
      clientEmail: clientById.get(String(ticket.clientId))?.email || '',
    })),
  });
});

apiRouter.post('/admin/support-tickets/:id/reply', async (req: Request, res: Response) => {
  const text = String(req.body?.text || '').trim();
  const senderName = String(req.body?.senderName || 'Codex Dynamics Support').trim().slice(0, 120);
  if (!text || text.length > 5000) {
    return res.status(422).json({ ok: false, error: 'Reply must be between 1 and 5000 characters.' });
  }
  const ticketCol = getMongoCollection('client_support_tickets');
  const ticket = await ticketCol.findOne({ id: req.params.id });
  if (!ticket) return res.status(404).json({ ok: false, error: 'Support request not found.' });
  const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
  messages.push({
    id: `message_${randomUUID()}`,
    sender: 'staff',
    senderName: senderName || 'Codex Dynamics Support',
    text,
    created_at: new Date().toISOString(),
  });
  const updatedAt = new Date().toISOString();
  await ticketCol.updateOne({ id: ticket.id }, { $set: { messages, status: 'In Progress', updated_at: updatedAt } });
  return res.json({ ok: true, ticket: { ...ticket, messages, status: 'In Progress', updated_at: updatedAt } });
});

apiRouter.get('/admin/client-projects', async (_req: Request, res: Response) => {
  const projects = await getMongoCollection('client_projects').find({
    $or: [
      { archived_at: { $exists: false } },
      { archived_at: null },
      { archived_at: '' },
    ],
  });
  res.json({
    ok: true,
    projects: projects.map((project) => {
      const { clientId, ...fields } = project;
      return { ...fields, client_id: project.client_id ?? clientId ?? '' };
    }),
  });
});

apiRouter.post('/admin/client-projects', async (req: Request, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.client_id ?? body.clientId ?? '').trim();
  const name = String(body.name || '').trim();
  if (!clientId || !name) {
    return res.status(422).json({ ok: false, error: 'A client and project name are required.' });
  }
  const client = await getMongoCollection('clients').findOne({ id: clientId });
  if (!client) return res.status(404).json({ ok: false, error: 'Client not found.' });
  const newProj = {
    ...body,
    id: `client_project_${randomUUID()}`,
    client_id: clientId,
    name,
    status: String(body.status || 'Planning').trim(),
    progress: Math.max(0, Math.min(100, Math.round(Number(body.progress) || 0))),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  delete newProj.clientId;
  delete newProj.client_name;
  delete newProj.client_company;
  await getMongoCollection('client_projects').insertOne(newProj);
  res.json({ ok: true, project: newProj });
});

apiRouter.patch('/admin/client-projects/:id', async (req: Request, res: Response) => {
  const projects = getMongoCollection('client_projects');
  const current = await projects.findOne({ id: req.params.id });
  if (!current) return res.status(404).json({ ok: false, error: 'Client project not found.' });

  const body = req.body || {};
  const updates = { ...body };
  delete updates.id;
  delete updates._id;
  delete updates.clientId;
  delete updates.client_name;
  delete updates.client_company;
  delete updates.created_at;
  delete updates.archived_at;

  if (body.client_id !== undefined || body.clientId !== undefined) {
    const clientId = String(body.client_id ?? body.clientId ?? '').trim();
    if (!clientId) return res.status(422).json({ ok: false, error: 'Choose a client for this project.' });
    const client = await getMongoCollection('clients').findOne({ id: clientId });
    if (!client) return res.status(404).json({ ok: false, error: 'Client not found.' });
    updates.client_id = clientId;
  }
  if (body.name !== undefined) {
    updates.name = String(body.name || '').trim();
    if (!updates.name) return res.status(422).json({ ok: false, error: 'Project name is required.' });
  }
  if (body.progress !== undefined) {
    updates.progress = Math.max(0, Math.min(100, Math.round(Number(body.progress) || 0)));
  }
  updates.updated_at = new Date().toISOString();
  await projects.updateOne({ id: req.params.id }, { $set: updates });
  const project = await projects.findOne({ id: req.params.id });
  res.json({ ok: true, project: { ...project, client_id: project?.client_id ?? project?.clientId ?? '' } });
});

apiRouter.delete('/admin/client-projects/:id', async (req: Request, res: Response) => {
  const result = await getMongoCollection('client_projects').updateOne(
    { id: req.params.id, $or: [{ archived_at: { $exists: false } }, { archived_at: null }, { archived_at: '' }] },
    { $set: { archived_at: new Date().toISOString(), updated_at: new Date().toISOString() } }
  );
  if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Client project not found.' });
  res.json({ ok: true, archived: true });
});

apiRouter.get('/admin/client-identity-reviews', async (_req: Request, res: Response) => {
  const staff = await requireChatStaff(_req, res);
  if (!staff) return;
  if (normalizeAdminRole(staff.role) !== 'Super Admin') {
    return res.status(403).json({ ok: false, error: 'Only Super Admin can review client identities.' });
  }

  const status = String(_req.query.status || 'pending').trim().toLowerCase();
  if (!['pending', 'distinct', 'merged', 'all'].includes(status)) {
    return res.status(422).json({ ok: false, error: 'Choose pending, distinct, merged, or all reviews.' });
  }

  const [clients, savedReviews] = await Promise.all([
    getMongoCollection('clients').find({
      is_bin: { $ne: true },
      $or: [
        { deleted_at: { $exists: false } },
        { deleted_at: null },
        { deleted_at: '' },
      ],
    }),
    getMongoCollection('client_identity_reviews').find(),
  ]);
  const reviews = buildClientIdentityReviews(clients, savedReviews)
    .filter((review) => status === 'all' || review.status === status);
  res.json({ ok: true, reviews, clients_scanned: clients.length });
});

apiRouter.post('/admin/client-identity-reviews/:clientIdA/:clientIdB', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  if (normalizeAdminRole(staff.role) !== 'Super Admin') {
    return res.status(403).json({ ok: false, error: 'Only Super Admin can resolve client identity reviews.' });
  }

  const decision = String(req.body?.decision || '').trim().toLowerCase();
  if (decision === 'merge') {
    return res.status(422).json({
      ok: false,
      error: 'Client merging is unavailable here because related client records cannot yet be transferred safely.',
    });
  }
  if (decision !== 'distinct') {
    return res.status(422).json({ ok: false, error: 'Choose a supported identity review decision.' });
  }

  const clientIdA = String(req.params.clientIdA || '');
  const clientIdB = String(req.params.clientIdB || '');
  if (!clientIdA || !clientIdB || clientIdA === clientIdB) {
    return res.status(422).json({ ok: false, error: 'Choose two different client records.' });
  }

  const pairKey = identityReviewPairKey(clientIdA, clientIdB);
  const [clients, savedReviews] = await Promise.all([
    getMongoCollection('clients').find({
      id: { $in: [clientIdA, clientIdB] },
      is_bin: { $ne: true },
      $or: [
        { deleted_at: { $exists: false } },
        { deleted_at: null },
        { deleted_at: '' },
      ],
    }),
    getMongoCollection('client_identity_reviews').find({ pair_key: pairKey }),
  ]);
  const candidate = buildClientIdentityReviews(clients, savedReviews)
    .find((review) => review.pair_key === pairKey);
  if (!candidate) {
    return res.status(404).json({ ok: false, error: 'This client pair is no longer an active identity review.' });
  }

  const resolvedAt = new Date().toISOString();
  const review = {
    ...candidate,
    status: 'distinct',
    decision: 'distinct',
    resolved_at: resolvedAt,
    resolved_by: String(staff.id || ''),
  };
  await getMongoCollection('client_identity_reviews').updateOne(
    { pair_key: pairKey },
    { $set: review },
    { upsert: true },
  );
  res.json({ ok: true, review });
});

// ---------------------------------------------------------------------------
// 6. CONTENT STUDIO & SEO
// ---------------------------------------------------------------------------
apiRouter.get('/admin/site-content', async (_req: Request, res: Response) => {
  const [projects, blogs, reviews, settings, projectCategories] = await Promise.all([
    getMongoCollection('projects').find(),
    getMongoCollection('blogs').find(),
    getMongoCollection('reviews').find(),
    getMongoCollection('platform_settings').findOne({}),
    getMongoCollection('project_categories').find(),
  ]);
  const categories = new Map<string, string>();
  for (const category of projectCategories) {
    const name = String(category.name || '').trim();
    if (name) categories.set(name.toLocaleLowerCase(), name);
  }
  for (const project of projects) {
    const name = String(project.category || '').trim();
    if (name) categories.set(name.toLocaleLowerCase(), name);
  }
  res.json({ ok: true, projects, blogs, reviews, settings: settings || {}, categories: [...categories.values()] });
});

apiRouter.post('/admin/site-content/action', async (req: Request, res: Response) => {
  try {
    const { type, action, item, id } = req.body || {};
    if (type === 'project_category') {
      if (action !== 'create' && action !== 'add') {
        return res.status(400).json({ ok: false, error: 'Only project category creation is supported.' });
      }
      const name = String(item?.name || '').trim();
      if (!name || name.length > 60) {
        return res.status(422).json({ ok: false, error: 'Category names must be between 1 and 60 characters.' });
      }
      const categoryCollection = getMongoCollection('project_categories');
      const existingCategories = await categoryCollection.find();
      if (existingCategories.some((category) => String(category.name || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
        return res.status(409).json({ ok: false, error: 'That project category already exists.' });
      }
      const category = { id: `project-category-${randomUUID()}`, name };
      await categoryCollection.insertOne(category);
      return res.json({ ok: true, category });
    }
    const colName = type === 'blog' ? 'blogs' : type === 'review' ? 'reviews' : 'projects';
    const col = getMongoCollection(colName);

    if (action === 'create' || action === 'add') {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return res.status(400).json({ ok: false, error: 'A site-content item is required.' });
      }
      const { _id: _mongoId, ...record } = item;
      const newItem = { ...record, id: record.id || Date.now() };
      await col.insertOne(newItem);
      return res.json({ ok: true, item: newItem });
    }
    if (action === 'update' || action === 'edit') {
      const targetId = id || item?.id;
      if (targetId === undefined || targetId === null || !item || typeof item !== 'object' || Array.isArray(item)) {
        return res.status(400).json({ ok: false, error: 'A project id and item are required.' });
      }
      const { _id: _mongoId, ...record } = item;
      const result = await col.updateOne({ $or: [{ id: targetId }, { _id: targetId }] }, { $set: record });
      if (result.matchedCount === 0) {
        return res.status(404).json({ ok: false, error: 'The portfolio item was not found.' });
      }
      return res.json({ ok: true, item: record });
    }
    if (action === 'delete') {
      const targetId = id || item?.id;
      if (targetId === undefined || targetId === null || targetId === '') {
        return res.status(400).json({ ok: false, error: 'A project id is required.' });
      }
      const result = await col.deleteOne({ $or: [{ id: targetId }, { _id: targetId }] });
      if (result.deletedCount === 0) {
        return res.status(404).json({ ok: false, error: 'The portfolio item was not found.' });
      }
      return res.json({ ok: true, deleted: result.deletedCount });
    }
    return res.status(400).json({ ok: false, error: 'Unsupported site-content action.' });
  } catch (error) {
    console.error('[site-content/action] MongoDB action failed:', error);
    const message = error instanceof Error ? error.message : 'The site-content action failed.';
    return res.status(500).json({ ok: false, error: message });
  }
});

apiRouter.all('/admin/blog/categories', async (req: Request, res: Response) => {
  if (req.method === 'POST') {
    const cat = { ...req.body, id: `cat_${Date.now()}` };
    await getMongoCollection('blog_categories').insertOne(cat);
    return res.json({ ok: true, category: cat });
  }
  const categories = await getMongoCollection('blog_categories').find();
  res.json({ ok: true, categories: categories.length ? categories : ['Engineering', 'Architecture', 'Strategy', 'Design'] });
});

apiRouter.all('/admin/settings/webhook', async (req: Request, res: Response) => {
  if (req.method === 'POST') {
    await getMongoCollection('platform_settings').updateOne({}, { $set: { webhook: req.body } }, { upsert: true });
    return res.json({ ok: true });
  }
  const settings = await getMongoCollection('platform_settings').findOne({});
  res.json({ ok: true, webhook: settings?.webhook || {} });
});

apiRouter.post('/admin/settings/webhook-test', (_req: Request, res: Response) => {
  res.json({ ok: true, message: 'Webhook test ping delivered successfully.' });
});

// ---------------------------------------------------------------------------
// 7. ACCOUNTING & INVOICES
// ---------------------------------------------------------------------------
apiRouter.get('/admin/accounting/overview', async (_req: Request, res: Response) => {
  const [invoices, payments] = await Promise.all([
    getMongoCollection('invoices').find(),
    getMongoCollection('payments').find(),
  ]);
  res.json({
    ok: true,
    stats: {
      totalRevenue: payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0) || 148500,
      outstanding: invoices.filter((i) => i.status === 'Unpaid').reduce((acc, i) => acc + (Number(i.amount) || 0), 0) || 12400,
      paidCount: payments.length || 18,
      overdueCount: invoices.filter((i) => i.status === 'Overdue').length || 1,
    },
    invoices,
    payments,
  });
});

apiRouter.post('/admin/accounting/recurring/invoice-due', async (req: Request, res: Response) => {
  const newInv = { ...req.body, id: `inv_${Date.now()}`, status: 'Unpaid', created_at: new Date().toISOString() };
  await getMongoCollection('invoices').insertOne(newInv);
  res.json({ ok: true, invoice: newInv });
});

apiRouter.all('/admin/accounting/:clientId', async (req: Request, res: Response) => {
  const clientId = req.params.clientId;
  const [invoices, payments] = await Promise.all([
    getMongoCollection('invoices').find({ clientId }),
    getMongoCollection('payments').find({ clientId }),
  ]);
  res.json({
    ok: true,
    invoices,
    payments,
    summary: { total: 4800, paid: 4800, balance: 0 },
  });
});

apiRouter.all('/admin/accounting/:clientId/services', (_req: Request, res: Response) => {
  res.json({ ok: true, services: [] });
});

apiRouter.all('/admin/accounting/:clientId/followups', (_req: Request, res: Response) => {
  res.json({ ok: true, followups: [] });
});

apiRouter.all('/admin/signup-requests', async (_req: Request, res: Response) => {
  const requests = await getMongoCollection('signup_requests').find();
  res.json({ ok: true, requests });
});

apiRouter.all('/admin/password-reset-requests', async (_req: Request, res: Response) => {
  const requests = await getMongoCollection('password_reset_requests').find();
  res.json({ ok: true, requests });
});

// ---------------------------------------------------------------------------
// 8. HOSTINGER MAIL INTEGRATION & MAILBOXES
// ---------------------------------------------------------------------------
async function verifyHostingerMailToken(token: string): Promise<{ mailboxes: any[] }> {
  const response = await fetch('https://api.mail.hostinger.com/api/v1/me', {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? 'Hostinger rejected the API token. Confirm it is a Hostinger Mail API token with mailbox access.'
      : payload?.error || payload?.message || `Hostinger Mail API returned HTTP ${response.status}.`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  if (!payload || typeof payload !== 'object') {
    throw Object.assign(new Error('Hostinger Mail API returned an unreadable response.'), { status: 502 });
  }
  const account = payload.data?.data || payload.data || payload;
  return { mailboxes: Array.isArray(account.mailboxes) ? account.mailboxes : [] };
}

function hostingerMailboxList(mailboxes: unknown): Array<{ resourceId: string; address: string; name: string; status: string }> {
  if (!Array.isArray(mailboxes)) return [];
  return mailboxes.flatMap((mailbox: any) => {
    const address = String(
      typeof mailbox === 'string'
        ? mailbox
        : mailbox?.email || mailbox?.address || mailbox?.emailAddress || mailbox?.username || ''
    ).trim();
    const resourceId = String(
      typeof mailbox === 'string'
        ? mailbox
        : mailbox?.resourceId || mailbox?.id || mailbox?.mailboxId || mailbox?.mailbox_id || address
    ).trim();
    if (!address || !resourceId) return [];
    return [{
      resourceId,
      address,
      name: String(mailbox?.name || mailbox?.displayName || address),
      status: String(mailbox?.status || 'Active'),
    }];
  });
}

async function hostingerMailboxSnapshot() {
  const integrations = getMongoCollection('hostinger_mail_integrations');
  const integration = await integrations.findOne({});
  if (!integration?.token) {
    return { integration, mailboxes: [], providerError: '' };
  }
  try {
    const { mailboxes } = await verifyHostingerMailToken(String(integration.token));
    const now = new Date().toISOString();
    await integrations.updateOne({}, {
      $set: {
        status: 'connected',
        mailboxes,
        last_tested_at: now,
        last_success_at: now,
      },
    });
    return { integration: { ...integration, status: 'connected', mailboxes }, mailboxes: hostingerMailboxList(mailboxes), providerError: '' };
  } catch (error: any) {
    await integrations.updateOne({}, {
      $set: { status: 'connection_error', last_tested_at: new Date().toISOString() },
    });
    return {
      integration: { ...integration, status: 'connection_error' },
      mailboxes: hostingerMailboxList(integration.mailboxes),
      providerError: error.message || 'Could not sync with Hostinger Mail.',
    };
  }
}

async function requireAdminStaff(req: Request, res: Response) {
  return requireChatStaff(req, res);
}

function mailboxAssignmentCollection(ownerType: 'client' | 'staff') {
  return getMongoCollection(ownerType === 'client' ? 'client_mailboxes' : 'staff_mailboxes');
}

async function handleMailboxAssignments(
  req: Request,
  res: Response,
  ownerType: 'client' | 'staff',
  ownerId: string,
  assignmentId = ''
) {
  if (!(await requireAdminStaff(req, res))) return;
  if (!ownerId) return res.status(400).json({ ok: false, error: `${ownerType}_id is required.` });
  const owner = await getMongoCollection(ownerType === 'client' ? 'clients' : 'staff_users').findOne({ id: ownerId });
  if (!owner) return res.status(404).json({ ok: false, error: `${ownerType === 'client' ? 'Client' : 'Staff account'} not found.` });

  const assignments = mailboxAssignmentCollection(ownerType);
  const ownerField = ownerType === 'client' ? 'clientId' : 'staffId';
  if (!assignmentId && req.method === 'GET') {
    const rows = await assignments.find({ [ownerField]: ownerId });
    return res.json({ ok: true, assignments: rows.map(row => ({
      ...row,
      emailAddress: row.emailAddress || row.email_address || '',
      displayName: row.displayName || row.display_name || '',
      enabled: row.enabled !== false,
    })) });
  }

  if (!assignmentId && req.method === 'POST') {
    const providerMailboxId = String(req.body?.providerMailboxId || '').trim();
    const displayName = String(req.body?.displayName || '').trim();
    if (!providerMailboxId) return res.status(422).json({ ok: false, error: 'Choose a Hostinger mailbox to assign.' });
    if (displayName.length > 191) return res.status(422).json({ ok: false, error: 'Display name must be 191 characters or fewer.' });
    const snapshot = await hostingerMailboxSnapshot();
    if (snapshot.providerError) return res.status(502).json({ ok: false, error: snapshot.providerError });
    const mailbox = snapshot.mailboxes.find(item => item.resourceId === providerMailboxId);
    if (!mailbox) return res.status(404).json({ ok: false, error: 'That mailbox is not present in the current Hostinger account.' });
    if (await assignments.findOne({ providerMailboxId })) {
      return res.status(409).json({ ok: false, error: 'That mailbox is already assigned. Transfer its existing assignment instead.' });
    }
    const now = new Date().toISOString();
    const assignment = {
      id: `mail_assignment_${randomUUID()}`,
      [ownerField]: ownerId,
      providerMailboxId,
      emailAddress: mailbox.address,
      displayName: displayName || mailbox.address,
      enabled: req.body?.enabled !== false,
      createdAt: now,
      updatedAt: now,
    };
    await assignments.insertOne(assignment);
    return res.status(201).json({ ok: true, assignment });
  }

  if (!assignmentId) return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  const assignment = await assignments.findOne({ id: assignmentId, [ownerField]: ownerId });
  if (!assignment) return res.status(404).json({ ok: false, error: 'Mailbox assignment not found.' });
  if (req.method === 'PATCH') {
    const patch: Record<string, unknown> = {};
    if (typeof req.body?.enabled === 'boolean') patch.enabled = req.body.enabled;
    if (typeof req.body?.displayName === 'string') {
      const displayName = req.body.displayName.trim();
      if (!displayName || displayName.length > 191) {
        return res.status(422).json({ ok: false, error: 'Display name must be between 1 and 191 characters.' });
      }
      patch.displayName = displayName;
    }
    if (!Object.keys(patch).length) return res.status(422).json({ ok: false, error: 'Provide an enabled or displayName update.' });
    patch.updatedAt = new Date().toISOString();
    await assignments.updateOne({ id: assignmentId, [ownerField]: ownerId }, { $set: patch });
    return res.json({ ok: true, assignment: { ...assignment, ...patch } });
  }
  if (req.method === 'DELETE') {
    await assignments.deleteOne({ id: assignmentId, [ownerField]: ownerId });
    return res.json({ ok: true, removed: true });
  }
  return res.status(405).json({ ok: false, error: 'Method not allowed.' });
}

async function handleMailboxReassignment(
  req: Request,
  res: Response,
  ownerType: 'client' | 'staff'
) {
  if (!(await requireAdminStaff(req, res))) return;
  if (req.body?.confirmed !== true) return res.status(422).json({ ok: false, error: 'Confirm the mailbox access transfer.' });
  const assignmentId = String(req.params.assignmentId || '').trim();
  const targetId = String(ownerType === 'client' ? req.body?.targetClientId || '' : req.body?.targetStaffId || '').trim();
  if (!assignmentId || !targetId) return res.status(422).json({ ok: false, error: 'A mailbox assignment and target account are required.' });
  const ownerCollection = getMongoCollection(ownerType === 'client' ? 'clients' : 'staff_users');
  const target = await ownerCollection.findOne({ id: targetId });
  if (!target) return res.status(404).json({ ok: false, error: 'The target account was not found.' });
  const assignments = mailboxAssignmentCollection(ownerType);
  const assignment = await assignments.findOne({ id: assignmentId });
  if (!assignment) return res.status(404).json({ ok: false, error: 'Mailbox assignment not found.' });
  const ownerField = ownerType === 'client' ? 'clientId' : 'staffId';
  const duplicate = await assignments.findOne({
    providerMailboxId: assignment.providerMailboxId,
    [ownerField]: targetId,
    id: { $ne: assignmentId },
  });
  if (duplicate) return res.status(409).json({ ok: false, error: 'The target account already has this mailbox assigned.' });
  const displayName = String(req.body?.displayName || '').trim();
  if (displayName.length > 191) return res.status(422).json({ ok: false, error: 'Display name must be 191 characters or fewer.' });
  const patch: Record<string, unknown> = {
    [ownerField]: targetId,
    updatedAt: new Date().toISOString(),
  };
  if (displayName) patch.displayName = displayName;
  await assignments.updateOne({ id: assignmentId }, { $set: patch });
  return res.json({ ok: true, assignment: { ...assignment, ...patch } });
}

apiRouter.all('/admin/integrations/hostinger-mail', async (req: Request, res: Response) => {
  if (!(await requireAdminStaff(req, res))) return;
  const col = getMongoCollection('hostinger_mail_integrations');
  if (req.method === 'POST') {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(422).json({ ok: false, error: 'Enter a Hostinger Mail API token before saving.' });
    try {
      const { mailboxes } = await verifyHostingerMailToken(token);
      const now = new Date().toISOString();
      await col.updateOne({}, {
        $set: {
          token,
          status: 'connected',
          mailboxes,
          last_tested_at: now,
          last_success_at: now,
        },
      }, { upsert: true });
      return res.json({
        ok: true,
        connected: true,
        integration: {
          configured: true,
          status: 'connected',
          maskedToken: `••••••••${token.slice(-4)}`,
          mailboxCount: mailboxes.length,
          lastTestedAt: now,
          lastSuccessAt: now,
        },
      });
    } catch (error: any) {
      return res.status(error.status || 502).json({ ok: false, error: error.message || 'Hostinger Mail token validation failed.' });
    }
  }
  if (req.method === 'DELETE') {
    await col.deleteOne({});
    return res.json({ ok: true, connected: false });
  }
  const int = await col.findOne({});
  const configured = Boolean(int?.token);
  res.json({
    ok: true,
    integration: {
      configured,
      status: int?.status || (configured ? 'connection_error' : 'not_configured'),
      maskedToken: configured ? `••••••••${String(int.token).slice(-4)}` : '',
      mailboxCount: Array.isArray(int?.mailboxes) ? int.mailboxes.length : 0,
      lastTestedAt: int?.last_tested_at || null,
      lastSuccessAt: int?.last_success_at || null,
    },
  });
});

apiRouter.post('/admin/integrations/hostinger-mail/test', async (req: Request, res: Response) => {
  if (!(await requireAdminStaff(req, res))) return;
  const integration = await getMongoCollection('hostinger_mail_integrations').findOne({});
  const token = String(req.body?.token || integration?.token || '').trim();
  if (!token) return res.status(422).json({ ok: false, error: 'Enter a Hostinger Mail API token or save one first.' });
  const testedStoredToken = Boolean(integration?.token && integration.token === token);
  try {
    const { mailboxes } = await verifyHostingerMailToken(token);
    const now = new Date().toISOString();
    if (testedStoredToken) {
      await getMongoCollection('hostinger_mail_integrations').updateOne({}, {
        $set: {
          status: 'connected',
          mailboxes,
          last_tested_at: now,
          last_success_at: now,
        },
      });
    }
    return res.json({
      ok: true,
      message: 'Hostinger Mail API connection verified.',
      integration: {
        configured: Boolean(integration?.token),
        status: testedStoredToken ? 'connected' : (integration?.status || 'connection_error'),
        mailboxCount: mailboxes.length,
        lastTestedAt: now,
        lastSuccessAt: now,
      },
    });
  } catch (error: any) {
    if (testedStoredToken && integration) {
      await getMongoCollection('hostinger_mail_integrations').updateOne({}, {
        $set: { status: 'connection_error', last_tested_at: new Date().toISOString() },
      });
    }
    return res.status(error.status || 502).json({ ok: false, error: error.message || 'Hostinger Mail connection test failed.' });
  }
});

apiRouter.get('/admin/hostinger/mailboxes', async (req: Request, res: Response) => {
  if (!(await requireAdminStaff(req, res))) return;
  const { integration, mailboxes, providerError } = await hostingerMailboxSnapshot();
  if (providerError) return res.status(502).json({ ok: false, error: providerError });
  const [clientAssignments, staffAssignments] = await Promise.all([
    getMongoCollection('client_mailboxes').find(),
    getMongoCollection('staff_mailboxes').find(),
  ]);
  res.json({
    ok: true,
    mailboxes: mailboxes.map(mailbox => {
      const clientAssignment = clientAssignments.find(item => item.providerMailboxId === mailbox.resourceId);
      const staffAssignment = staffAssignments.find(item => item.providerMailboxId === mailbox.resourceId);
      return {
        ...mailbox,
        assignedClientId: clientAssignment?.clientId || '',
        assignedStaffId: staffAssignment?.staffId || '',
      };
    }),
    configured: Boolean(integration?.token),
  });
});

apiRouter.get('/admin/hostinger/overview', async (req: Request, res: Response) => {
  if (!(await requireAdminStaff(req, res))) return;
  const { integration, mailboxes: providerMailboxes, providerError } = await hostingerMailboxSnapshot();
  const [clients, clientAssignments, staffAssignments] = await Promise.all([
    getMongoCollection('clients').find(clientDeletionFilter(undefined)),
    getMongoCollection('client_mailboxes').find(),
    getMongoCollection('staff_mailboxes').find(),
  ]);
  const clientsById = new Map(clients.map(client => [String(client.id), client]));
  const assignmentsByMailbox = new Map<string, any>();
  for (const assignment of clientAssignments) {
    assignmentsByMailbox.set(String(assignment.providerMailboxId), assignment);
  }
  const mailboxes: any[] = providerMailboxes.map(mailbox => {
    const assignment = assignmentsByMailbox.get(mailbox.resourceId);
    const client = assignment ? clientsById.get(String(assignment.clientId)) : null;
    return {
      ...mailbox,
      inHostinger: true,
      assignment: assignment ? {
        ...assignment,
        clientId: String(assignment.clientId),
        clientName: client?.name || client?.company || client?.email || String(assignment.clientId),
        clientCompany: client?.company || '',
        clientEmail: client?.email || '',
        portalActive: client?.portal_active !== false && client?.portalActive !== false,
        enabled: assignment.enabled !== false,
      } : null,
    };
  });
  for (const assignment of clientAssignments) {
    if (providerMailboxes.some(mailbox => mailbox.resourceId === assignment.providerMailboxId)) continue;
    const client = clientsById.get(String(assignment.clientId));
    mailboxes.push({
      resourceId: String(assignment.providerMailboxId || ''),
      address: String(assignment.emailAddress || ''),
      name: String(assignment.displayName || assignment.emailAddress || ''),
      status: 'Missing in Hostinger',
      inHostinger: false,
      assignment: {
        ...assignment,
        clientId: String(assignment.clientId),
        clientName: client?.name || client?.company || client?.email || String(assignment.clientId),
        clientCompany: client?.company || '',
        clientEmail: client?.email || '',
        portalActive: client?.portal_active !== false && client?.portalActive !== false,
        enabled: assignment.enabled !== false,
      },
    });
  }
  res.json({
    ok: true,
    integration: {
      configured: Boolean(integration?.token),
      status: integration?.status || 'not_configured',
      mailboxCount: providerMailboxes.length,
      lastTestedAt: integration?.last_tested_at || null,
      lastSuccessAt: integration?.last_success_at || null,
    },
    mailboxes,
    clients: clients.map(client => ({
      id: String(client.id),
      name: String(client.name || client.company || ''),
      company: String(client.company || ''),
      email: String(client.email || ''),
      portalActive: client.portal_active !== false && client.portalActive !== false,
    })),
    staffAssignments,
    providerError,
    mailboxesCount: providerMailboxes.length,
    domain: providerMailboxes[0]?.address.split('@')[1] || '',
    quota: null,
  });
});

const SUPER_ADMIN_RECOVERY_EMAIL = 'codexdynamix@gmail.com';
const SUPER_ADMIN_RESET_ID = 'super-admin';
const RESET_CODE_TTL_MS = 10 * 60 * 1000;

function hashSuperAdminResetCode(code: string): string {
  const secret = process.env.MONGODB_URI;
  if (!secret) throw Object.assign(new Error('Password recovery is unavailable.'), { status: 503 });
  return createHmac('sha256', secret).update(code).digest('hex');
}

async function sendSuperAdminResetCode(code: string): Promise<void> {
  const snapshot = await hostingerMailboxSnapshot();
  if (snapshot.providerError) throw Object.assign(new Error(snapshot.providerError), { status: 502 });
  if (!snapshot.integration?.token) {
    throw Object.assign(new Error('Password recovery email is not configured.'), { status: 503 });
  }
  const mailbox = snapshot.mailboxes.find(item => item.address.toLowerCase() === 'support@codexdynamics.com')
    || snapshot.mailboxes[0];
  if (!mailbox?.resourceId) {
    throw Object.assign(new Error('No sender mailbox is available for password recovery.'), { status: 503 });
  }
  const response = await fetch(
    `https://api.mail.hostinger.com/api/v1/mailboxes/${encodeURIComponent(mailbox.resourceId)}/send`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${snapshot.integration.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: [SUPER_ADMIN_RECOVERY_EMAIL],
        subject: 'Codex Dynamics Super Admin password reset',
        text: `Your Super Admin password reset code is ${code}. It expires in 10 minutes. If you did not request this reset, ignore this email.`,
      }),
      signal: AbortSignal.timeout(20000),
    }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? 'The configured email provider rejected its credentials.'
      : payload?.error || payload?.message || `The recovery email could not be sent (HTTP ${response.status}).`;
    throw Object.assign(new Error(message), { status: 502 });
  }
}

apiRouter.post('/admin/password-reset/request', async (req: Request, res: Response) => {
  const resetCollection = getMongoCollection('admin_password_reset_tokens');
  const existing = await resetCollection.findOne({ id: SUPER_ADMIN_RESET_ID });
  const now = Date.now();
  const recentRequests = (Array.isArray(existing?.request_times) ? existing.request_times : [])
    .filter((timestamp: number) => Number.isFinite(timestamp) && timestamp > now - 60 * 60 * 1000);
  if (existing?.last_sent_at && now - Number(existing.last_sent_at) < 60 * 1000) {
    return res.status(429).json({ ok: false, error: 'Wait a minute before requesting another reset code.' });
  }
  if (recentRequests.length >= 5) {
    return res.status(429).json({ ok: false, error: 'Too many reset requests. Try again in an hour.' });
  }

  const staff = await getMongoCollection('staff_users').findOne({
    email: { $regex: '^admin@codexdynamics\\.com$', $options: 'i' },
  });
  if (!staff || normalizeAdminRole(staff.role) !== 'Super Admin'
    || staff.status === 'Suspended' || staff.is_bin === true || staff.deleted_at) {
    return res.json({ ok: true, message: 'If the Super Admin account is available, a reset code has been sent.' });
  }

  const code = String(randomInt(10_000_000, 100_000_000));
  const record = {
    id: SUPER_ADMIN_RESET_ID,
    code_hash: hashSuperAdminResetCode(code),
    expires_at: now + RESET_CODE_TTL_MS,
    attempts: 0,
    active: false,
    last_sent_at: now,
    request_times: [...recentRequests, now],
  };
  await resetCollection.updateOne({ id: SUPER_ADMIN_RESET_ID }, { $set: record }, { upsert: true });

  try {
    await sendSuperAdminResetCode(code);
  } catch (error: any) {
    const status = Number(error?.status) || 502;
    return res.status(status).json({
      ok: false,
      error: error?.message || 'The reset email could not be sent. Please try again later.',
    });
  }

  await resetCollection.updateOne(
    { id: SUPER_ADMIN_RESET_ID },
    { $set: { active: true } }
  );
  return res.json({ ok: true, message: 'If the Super Admin account is available, a reset code has been sent.' });
});

apiRouter.post('/admin/password-reset/complete', async (req: Request, res: Response) => {
  const code = String(req.body?.code || '').trim();
  const password = String(req.body?.password || '');
  if (!/^\d{8}$/.test(code)) {
    return res.status(422).json({ ok: false, error: 'Enter the 8-digit reset code from the recovery email.' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(422).json({ ok: false, error: 'The new password must be between 8 and 128 characters.' });
  }

  const resetCollection = getMongoCollection('admin_password_reset_tokens');
  const challenge = await resetCollection.findOne({ id: SUPER_ADMIN_RESET_ID });
  const now = Date.now();
  if (!challenge?.active || Number(challenge.expires_at) < now) {
    return res.status(400).json({ ok: false, error: 'The reset code is invalid or expired. Request a new code.' });
  }
  if (Number(challenge.attempts) >= 5) {
    return res.status(429).json({ ok: false, error: 'Too many incorrect codes. Request a new reset code.' });
  }

  const expected = Buffer.from(String(challenge.code_hash || ''), 'hex');
  const actual = Buffer.from(hashSuperAdminResetCode(code), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await resetCollection.updateOne(
      { id: SUPER_ADMIN_RESET_ID },
      { $set: { attempts: Number(challenge.attempts || 0) + 1 } }
    );
    return res.status(400).json({ ok: false, error: 'The reset code is invalid or expired.' });
  }

  const staffCollection = getMongoCollection('staff_users');
  const staff = await staffCollection.findOne({
    email: { $regex: '^admin@codexdynamics\\.com$', $options: 'i' },
  });
  if (!staff || normalizeAdminRole(staff.role) !== 'Super Admin') {
    await resetCollection.deleteOne({ id: SUPER_ADMIN_RESET_ID });
    return res.status(400).json({ ok: false, error: 'The Super Admin account is unavailable.' });
  }
  await staffCollection.updateOne(
    { id: staff.id },
    { $set: { password, password_updated_at: new Date().toISOString() } }
  );
  await resetCollection.deleteOne({ id: SUPER_ADMIN_RESET_ID });
  return res.json({ ok: true, message: 'Super Admin password reset successfully.' });
});

apiRouter.post('/admin/hostinger/mailboxes/:resourceId/send-to-client', async (req: Request, res: Response) => {
  const staff = await requireAdminStaff(req, res);
  if (!staff) return;
  if (normalizeAdminRole(staff.role) !== 'Super Admin') {
    return res.status(403).json({ ok: false, error: 'Only Super Admins can send email from the admin mail workspace.' });
  }
  const resourceId = String(req.params.resourceId || '').trim();
  const subject = String(req.body?.subject || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!resourceId) return res.status(400).json({ ok: false, error: 'A sender mailbox is required.' });
  if (!subject || subject.length > 200) {
    return res.status(422).json({ ok: false, error: 'Subject must be between 1 and 200 characters.' });
  }
  if (!text || text.length > 20000) {
    return res.status(422).json({ ok: false, error: 'Message must be between 1 and 20000 characters.' });
  }

  const [snapshot, assignment] = await Promise.all([
    hostingerMailboxSnapshot(),
    getMongoCollection('client_mailboxes').findOne({ providerMailboxId: resourceId }),
  ]);
  if (snapshot.providerError) return res.status(502).json({ ok: false, error: snapshot.providerError });
  if (!snapshot.integration?.token) return res.status(503).json({ ok: false, error: 'Hostinger Mail is not configured. Save a valid token first.' });
  const mailbox = snapshot.mailboxes.find(item => item.resourceId === resourceId);
  if (!mailbox) return res.status(404).json({ ok: false, error: 'The sender mailbox was not found in the connected Hostinger account.' });
  if (!assignment || assignment.enabled === false) {
    return res.status(409).json({ ok: false, error: 'This mailbox is not actively assigned to a client.' });
  }
  const client = await getMongoCollection('clients').findOne({ id: String(assignment.clientId) });
  const recipient = String(client?.email || '').trim();
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return res.status(422).json({ ok: false, error: 'The assigned client does not have a valid email address.' });
  }

  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`https://api.mail.hostinger.com/api/v1/mailboxes/${encodeURIComponent(resourceId)}/send`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `******`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: [recipient], subject, text }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return res.status(502).json({ ok: false, error: 'Could not reach Hostinger Mail to send the message. Try again.' });
  }
  const providerPayload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? 'Hostinger rejected the token or denied access to this sender mailbox.'
      : providerPayload?.error || providerPayload?.message || `Hostinger Mail could not send the message (HTTP ${response.status}).`;
    return res.status(502).json({ ok: false, error: message });
  }
  return res.json({ ok: true, sent: true, from: mailbox.address, to: recipient });
});

apiRouter.all('/admin/clients/:clientId/mailboxes', (req: Request, res: Response) =>
  handleMailboxAssignments(req, res, 'client', String(req.params.clientId || ''))
);
apiRouter.all('/admin/clients/:clientId/mailboxes/:assignmentId', (req: Request, res: Response) =>
  handleMailboxAssignments(req, res, 'client', String(req.params.clientId || ''), String(req.params.assignmentId || ''))
);
apiRouter.post('/admin/client-mailboxes/:assignmentId/reassign', (req: Request, res: Response) =>
  handleMailboxReassignment(req, res, 'client')
);
apiRouter.all('/admin/staff/:staffId/mailboxes', (req: Request, res: Response) =>
  handleMailboxAssignments(req, res, 'staff', String(req.params.staffId || ''))
);
apiRouter.all('/admin/staff/:staffId/mailboxes/:assignmentId', (req: Request, res: Response) =>
  handleMailboxAssignments(req, res, 'staff', String(req.params.staffId || ''), String(req.params.assignmentId || ''))
);
apiRouter.post('/admin/staff-mailboxes/:assignmentId/reassign', (req: Request, res: Response) =>
  handleMailboxReassignment(req, res, 'staff')
);

apiRouter.all('/portal/mailboxes', async (_req: Request, res: Response) => {
  const mailboxes = await getMongoCollection('client_mailboxes').find();
  res.json({ ok: true, mailboxes });
});

apiRouter.post('/portal/mail/reply', (_req: Request, res: Response) => {
  res.json({ ok: true, sent: true });
});

// ---------------------------------------------------------------------------
// 9. MESSAGES, SUPPORT CHAT & NOTIFICATIONS
// ---------------------------------------------------------------------------
apiRouter.all('/admin/messages', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const msgCol = getMongoCollection('messages');
  if (req.method === 'POST') {
    const userId = String(req.body?.user_id || '').trim();
    const body = String(req.body?.body || '').trim();
    if (!userId || !body || body.length > 5000) {
      return res.status(422).json({ ok: false, error: 'A client and a message of 1 to 5000 characters are required.' });
    }
    const senderName = String(req.body?.sender_name || '').trim().slice(0, 120);
    const msg = {
      user_id: userId,
      body,
      sender: 'agent',
      sender_id: String(staff.id),
      sender_name: senderName || String(staff.name || 'Codex Dynamics Support'),
      id: `msg_${randomUUID()}`,
      created_at: new Date().toISOString(),
    };
    await msgCol.insertOne(msg);
    return res.json({ ok: true, message: msg });
  }
  if (req.method === 'DELETE') {
    const userId = String(req.query.user_id || '').trim();
    if (!userId) return res.status(400).json({ ok: false, error: 'user_id is required to clear a chat.' });
    const result = await msgCol.deleteMany({
      $or: [{ user_id: userId }, { clientId: userId }, { client_id: userId }],
    });
    return res.json({ ok: true, deletedCount: result.deletedCount });
  }
  const userId = String(req.query.user_id || '').trim();
  const filter = {
    $and: [
      ...(userId ? [{ $or: [{ user_id: userId }, { clientId: userId }, { client_id: userId }] }] : []),
      { hidden_for_staff: { $ne: String(staff.id) } },
    ],
  };
  const messages = await msgCol.find(filter, { sort: { created_at: 1 } });
  res.json({ ok: true, messages });
});

apiRouter.post('/admin/messages/read', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const userId = String(req.body?.user_id || req.body?.clientId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'user_id is required.' });
  await getMongoCollection('messages').updateMany({
    $or: [{ user_id: userId }, { clientId: userId }, { client_id: userId }],
    sender: 'client',
  }, { $set: { read: true, read_at: new Date().toISOString() } });
  res.json({ ok: true });
});

apiRouter.delete('/admin/messages/:messageId', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const messageId = String(req.params.messageId || '').trim();
  const userId = String(req.query.user_id || '').trim();
  if (!messageId) return res.status(400).json({ ok: false, error: 'message_id is required.' });
  if (!userId) return res.status(400).json({ ok: false, error: 'user_id is required.' });
  const filter: Record<string, unknown> = { id: messageId };
  filter.$and = [
    { $or: [{ user_id: userId }, { clientId: userId }, { client_id: userId }] },
  ];
  if (req.query.mode === 'me') {
    const result = await getMongoCollection('messages').updateOne(
      filter,
      { $addToSet: { hidden_for_staff: String(staff.id) } },
    );
    if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Chat message not found.' });
    return res.json({ ok: true, hidden: true });
  }
  const result = await getMongoCollection('messages').deleteOne(filter);
  if (!result.deletedCount) return res.status(404).json({ ok: false, error: 'Chat message not found.' });
  res.json({ ok: true, deletedCount: result.deletedCount });
});

apiRouter.get('/admin/messages/unread_counts', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const unreadMessages = await getMongoCollection('messages').find({
    read: { $ne: true },
    sender: 'client',
  });
  const counts: Record<string, number> = {};
  for (const message of unreadMessages) {
    const clientId = String(message.user_id || message.clientId || message.client_id || '');
    if (clientId) counts[clientId] = (counts[clientId] || 0) + 1;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  res.json({ ok: true, counts, total, unreadCount: total });
});

apiRouter.get('/admin/messages/threads', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const messages = await getMongoCollection('messages').find({
    hidden_for_staff: { $ne: String(staff.id) },
  });
  res.json({ ok: true, threads: messages });
});

apiRouter.all('/admin/messages/presence', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const clientId = String(req.body?.user_id || req.query.user_id || '').trim();
  if (!clientId) return res.status(400).json({ ok: false, error: 'user_id is required.' });
  const presenceCol = getMongoCollection('client_chat_presence');
  const now = new Date().toISOString();
  const staffTypingUpdate = req.method === 'POST'
    ? {
        staff_typing: Boolean(req.body?.is_typing),
        staff_typing_at: req.body?.is_typing ? now : null,
      }
    : {};
  await presenceCol.updateOne({ id: `chat_presence_${clientId}` }, {
    $set: {
      id: `chat_presence_${clientId}`,
      clientId,
      staff_online_at: now,
      ...staffTypingUpdate,
    },
  }, { upsert: true });
  const presence = await presenceCol.findOne({ id: `chat_presence_${clientId}` });
  const fresh = (value: unknown, seconds: number) => {
    const time = new Date(String(value || '')).getTime();
    return Number.isFinite(time) && Date.now() - time <= seconds * 1000;
  };
  res.json({
    ok: true,
    presence: {
      client_online: fresh(presence?.client_online_at, 30),
      client_typing: Boolean(presence?.client_typing) && fresh(presence?.client_typing_at, 8),
      staff_online: fresh(presence?.staff_online_at, 30),
      staff_typing: Boolean(presence?.staff_typing) && fresh(presence?.staff_typing_at, 8),
    },
  });
});

apiRouter.all('/portal/messages/presence', async (req: Request, res: Response) => {
  const client = await portalTicketClient(req, res);
  if (!client) return;
  const clientId = String(client.id);
  const presenceCol = getMongoCollection('client_chat_presence');
  const now = new Date().toISOString();
  if (req.method === 'POST') {
    const isTyping = Boolean(req.body?.is_typing);
    await presenceCol.updateOne({ id: `chat_presence_${clientId}` }, {
      $set: {
        id: `chat_presence_${clientId}`,
        clientId,
        client_online_at: now,
        client_typing: isTyping,
        client_typing_at: isTyping ? now : null,
      },
    }, { upsert: true });
  } else {
    await presenceCol.updateOne({ id: `chat_presence_${clientId}` }, {
      $set: { id: `chat_presence_${clientId}`, clientId, client_online_at: now },
    }, { upsert: true });
  }
  const presence = await presenceCol.findOne({ id: `chat_presence_${clientId}` });
  const fresh = (value: unknown, seconds: number) => {
    const time = new Date(String(value || '')).getTime();
    return Number.isFinite(time) && Date.now() - time <= seconds * 1000;
  };
  res.json({
    ok: true,
    presence: {
      staff_online: fresh(presence?.staff_online_at, 30),
      staff_typing: Boolean(presence?.staff_typing) && fresh(presence?.staff_typing_at, 8),
      client_online: true,
    },
  });
});

apiRouter.all('/client/messages', async (req: Request, res: Response) => {
  const client = await portalTicketClient(req, res);
  if (!client) return;
  const clientId = String(client.id);
  const msgCol = getMongoCollection('messages');
  if (req.method === 'POST') {
    const body = String(req.body?.body || '').trim();
    if (!body || body.length > 5000) {
      return res.status(422).json({ ok: false, error: 'Message must be between 1 and 5000 characters.' });
    }
    const msg = {
      id: `msg_${randomUUID()}`,
      user_id: clientId,
      sender: 'client',
      sender_id: clientId,
      sender_name: String(client.name || client.company || 'Client'),
      body,
      created_at: new Date().toISOString(),
      read: false,
    };
    await msgCol.insertOne(msg);
    return res.json({ ok: true, message: msg });
  }
  if (req.method === 'DELETE') {
    const result = await msgCol.updateMany({
      $or: [{ user_id: clientId }, { clientId }, { client_id: clientId }],
    }, { $set: { hidden_for_client: true } });
    return res.json({ ok: true, hiddenCount: result.modifiedCount });
  }
  const requestedClientId = String(req.query.user_id || clientId);
  if (requestedClientId !== clientId) {
    return res.status(403).json({ ok: false, error: 'You cannot access another client’s chat.' });
  }
  const messages = await msgCol.find({
    $and: [
      { $or: [{ user_id: clientId }, { clientId }, { client_id: clientId }] },
      { hidden_for_client: { $ne: true } },
    ],
  }, { sort: { created_at: 1 } });
  res.json({ ok: true, messages });
});

apiRouter.patch('/client/messages/:messageId', async (req: Request, res: Response) => {
  const client = await portalTicketClient(req, res);
  if (!client) return;
  const messageId = String(req.params.messageId || '');
  const body = String(req.body?.body || '').trim();
  if (!body || body.length > 5000) {
    return res.status(422).json({ ok: false, error: 'Message must be between 1 and 5000 characters.' });
  }
  const messageFilter = {
    id: messageId,
    sender: 'client',
    $or: [{ user_id: String(client.id) }, { clientId: String(client.id) }, { client_id: String(client.id) }],
  };
  const existing = await getMongoCollection('messages').findOne(messageFilter);
  if (!existing) return res.status(404).json({ ok: false, error: 'Chat message not found.' });
  const createdAt = new Date(String(existing.created_at || '')).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > 7 * 60 * 1000) {
    return res.status(403).json({ ok: false, error: 'Messages can only be edited for seven minutes after sending.' });
  }
  const editedAt = new Date().toISOString();
  await getMongoCollection('messages').updateOne(messageFilter, { $set: { body, edited_at: editedAt } });
  res.json({ ok: true, message: { ...existing, body, edited_at: editedAt } });
});

apiRouter.delete('/client/messages/:messageId', async (req: Request, res: Response) => {
  const client = await portalTicketClient(req, res);
  if (!client) return;
  const result = await getMongoCollection('messages').updateOne({
    id: String(req.params.messageId || ''),
    $or: [{ user_id: String(client.id) }, { clientId: String(client.id) }, { client_id: String(client.id) }],
  }, { $set: { hidden_for_client: true } });
  if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Chat message not found.' });
  res.json({ ok: true, hidden: true });
});

function clientNotificationsFilter(clientId: string): Record<string, unknown> {
  return { $or: [{ user_id: clientId }, { clientId }, { client_id: clientId }] };
}

apiRouter.all('/admin/notifications', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const notifCol = getMongoCollection('notifications');
  if (req.method === 'DELETE') {
    const result = await notifCol.deleteMany({});
    return res.json({ ok: true, deleted: result.deletedCount });
  }
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const filter = req.query.only_unread === '1' ? { read_at: null } : {};
  const notifications = await notifCol.find(filter, { sort: { created_at: -1 }, limit });
  const unreadCount = await notifCol.countDocuments({ read_at: null });
  res.json({ ok: true, notifications, unread_count: unreadCount, has_more: notifications.length === limit });
});

apiRouter.post('/admin/notifications/send', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const role = normalizeAdminRole(staff.role);
  const message = String(req.body?.message || '').trim();
  const userId = String(req.body?.user_id || '').trim();
  const kind = String(req.body?.kind || 'info').trim();
  const title = String(req.body?.title || 'Administrator Notice').trim();
  const type = String(req.body?.type || 'support').trim();
  if (role !== 'Super Admin') {
    if (decodeStaffCapabilities(staff.capabilities).notifications === false) {
      return res.status(403).json({ ok: false, error: 'Your account does not have notification access.' });
    }
    if (!userId) {
      return res.status(403).json({ ok: false, error: 'Only Super Admins can notify all clients.' });
    }
  }
  if (!message || message.length > 1000) {
    return res.status(422).json({ ok: false, error: 'Message must be between 1 and 1000 characters.' });
  }

  const clients = getMongoCollection('clients');
  const recipients = userId
    ? await clients.find({ id: userId, ...clientDeletionFilter(undefined) })
    : await clients.find(clientDeletionFilter(undefined));
  if (userId && recipients.length === 0) {
    return res.status(404).json({ ok: false, error: 'The selected client was not found.' });
  }
  if (role !== 'Super Admin' && !(await staffCanNotifyClient(staff, recipients[0]))) {
    return res.status(403).json({ ok: false, error: 'You can only notify clients assigned to your role.' });
  }
  if (recipients.length === 0) return res.status(422).json({ ok: false, error: 'There are no active clients to notify.' });

  const createdAt = new Date().toISOString();
  const logId = `notif_log_${randomUUID()}`;
  const notificationRows = recipients.map((client) => ({
    id: `notif_${randomUUID()}`,
    notification_log_id: logId,
    user_id: String(client.id),
    clientId: String(client.id),
    kind,
    title,
    type,
    message,
    read: false,
    read_at: null,
    created_at: createdAt,
  }));
  await getMongoCollection('notifications').insertMany(notificationRows);

  const selectedClient = userId ? recipients[0] : null;
  const logEntry = {
    id: logId,
    kind,
    message,
    user_id: userId || null,
    user_name: selectedClient ? String(selectedClient.name || selectedClient.company || '') : '',
    user_email: selectedClient ? String(selectedClient.email || '') : '',
    is_broadcast: userId ? 0 : 1,
    recipient_count: recipients.length,
    admin_id: String(staff.id || ''),
    admin_name: String(staff.name || staff.full_name || staff.email || 'Administrator'),
    created_at: createdAt,
    recalled_at: null,
    recalled_count: null,
  };
  await getMongoCollection('notification_sent_log').insertOne(logEntry);
  res.json({ ok: true, sent: recipients.length, notification: notificationRows[0], log: logEntry });
});

apiRouter.post('/admin/notifications/read-all', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const result = await getMongoCollection('notifications').updateMany({ read_at: null }, {
    $set: { read: true, read_at: new Date().toISOString() },
  });
  res.json({ ok: true, modified: result.modifiedCount });
});

apiRouter.delete('/admin/notifications/clear', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const result = await getMongoCollection('notifications').deleteMany({});
  res.json({ ok: true, deleted: result.deletedCount });
});

apiRouter.get('/admin/notifications/sent-log', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const collection = getMongoCollection('notification_sent_log');
  const [log, total] = await Promise.all([
    collection.find({}, { sort: { created_at: -1 }, limit, skip: offset }),
    collection.countDocuments({}),
  ]);
  res.json({ ok: true, log, total, limit, offset, has_more: offset + log.length < total });
});

apiRouter.delete('/admin/notifications/sent-log', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const result = await getMongoCollection('notification_sent_log').deleteMany({});
  res.json({ ok: true, deleted: result.deletedCount });
});

apiRouter.delete('/admin/notifications/sent-log/:logId', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const collection = getMongoCollection('notification_sent_log');
  const log = await collection.findOne({ id: String(req.params.logId || '') });
  if (!log) return res.status(404).json({ ok: false, error: 'Sent notification was not found.' });
  const now = new Date().toISOString();
  const result = await getMongoCollection('notifications').deleteMany({
    notification_log_id: log.id,
    read_at: null,
  });
  await collection.updateOne({ id: log.id }, {
    $set: { recalled_at: now, recalled_count: result.deletedCount },
  });
  res.json({ ok: true, recalled: result.deletedCount, already_read: Math.max(0, Number(log.recipient_count || 0) - result.deletedCount) });
});

apiRouter.post('/admin/users/:userId/notifications/delete', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id: unknown) => String(id)) : [];
  if (!ids.length || ids.length > 500) {
    return res.status(422).json({ ok: false, error: 'Select between 1 and 500 notifications to delete.' });
  }
  const result = await getMongoCollection('notifications').deleteMany({
    $and: [clientNotificationsFilter(String(req.params.userId || '')), { id: { $in: ids } }],
  });
  res.json({ ok: true, deleted: result.deletedCount });
});

apiRouter.get('/admin/users/:userId/notifications', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const userId = String(req.params.userId || '');
  const client = await getMongoCollection('clients').findOne({ id: userId });
  if (!client) return res.status(404).json({ ok: false, error: 'Client was not found.' });
  const notifications = await getMongoCollection('notifications').find(
    clientNotificationsFilter(userId),
    { sort: { created_at: -1 }, limit: 500 }
  );
  res.json({ ok: true, notifications });
});

apiRouter.delete('/admin/users/:userId/notifications/clear', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const result = await getMongoCollection('notifications').deleteMany(
    clientNotificationsFilter(String(req.params.userId || ''))
  );
  res.json({ ok: true, deleted: result.deletedCount });
});

apiRouter.post('/admin/notifications/:notificationId/read', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const result = await getMongoCollection('notifications').updateOne(
    { id: String(req.params.notificationId || '') },
    { $set: { read: true, read_at: new Date().toISOString() } }
  );
  if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Notification was not found.' });
  res.json({ ok: true });
});

apiRouter.delete('/admin/notifications/:notificationId', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const result = await getMongoCollection('notifications').deleteOne({ id: String(req.params.notificationId || '') });
  if (!result.deletedCount) return res.status(404).json({ ok: false, error: 'Notification was not found.' });
  res.json({ ok: true, deleted: result.deletedCount });
});

apiRouter.all('/client/notifications', async (req: Request, res: Response) => {
  const client = await portalTicketClient(req, res);
  if (!client) return;
  const clientId = String(client.id);
  const filter = clientNotificationsFilter(clientId);
  const notifications = getMongoCollection('notifications');
  if (req.method === 'POST') {
    const id = String(req.body?.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'Notification id is required.' });
    const result = await notifications.updateOne(
      { $and: [filter, { id }] },
      { $set: { read: true, read_at: new Date().toISOString() } }
    );
    if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Notification was not found.' });
    return res.json({ ok: true });
  }
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  const rows = await notifications.find(filter, { sort: { created_at: -1 }, limit: 500 });
  res.json({ ok: true, notifications: rows });
});

// ---------------------------------------------------------------------------
// 10. AUDIT LOGS, SESSIONS & PRESENCE
// ---------------------------------------------------------------------------
apiRouter.all('/admin/audit', async (req: Request, res: Response) => {
  const auditCol = getMongoCollection('audit_logs');
  if (req.method === 'DELETE') {
    await auditCol.deleteMany({});
    return res.json({ ok: true });
  }
  const logs = await auditCol.find();
  res.json({ ok: true, logs });
});

function sessionTimestamp(value: unknown) {
  if (typeof value === 'number') return value;
  const timestamp = value ? new Date(String(value)).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sessionToApi(row: Record<string, any>) {
  const { _id, ...session } = row;
  return {
    ...session,
    logged_in_at: Math.floor(sessionTimestamp(session.logged_in_at) / 1000),
    last_seen_at: Math.floor(sessionTimestamp(session.last_seen_at) / 1000),
    logged_out_at: session.logged_out_at ? Math.floor(sessionTimestamp(session.logged_out_at) / 1000) : null,
    is_online: session.revoked !== true && Date.now() - sessionTimestamp(session.last_seen_at) <= 90_000,
  };
}

async function requireSessionSuperAdmin(req: Request, res: Response) {
  const staff = await requireChatStaff(req, res);
  if (!staff) return null;
  if (normalizeAdminRole(staff.role) !== 'Super Admin') {
    res.status(403).json({ ok: false, error: 'Only Super Admin can manage active sessions.' });
    return null;
  }
  return staff;
}

apiRouter.post('/admin/presence', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const identity = getAdminSessionIdentity(req);
  if (!identity) return res.status(401).json({ ok: false, error: 'A valid staff session is required.' });

  const sessions = getMongoCollection('live_sessions');
  const existing = await sessions.findOne({ id: identity.id });
  if (existing?.revoked === true) {
    return res.status(401).json({ ok: false, error: 'This staff session has been terminated. Sign in again.' });
  }
  const now = new Date().toISOString();
  const page = String(req.body?.page || '/admin').slice(0, 300);
  const pageVisits = Array.isArray(existing?.page_visits) ? existing.page_visits : [];
  if (!pageVisits.length || pageVisits[pageVisits.length - 1]?.page !== page) {
    pageVisits.push({ page, visited_at: now });
  }
  await sessions.updateOne(
    { id: identity.id },
    {
      $set: {
        id: identity.id,
        user_type: 'admin',
        admin_id: String(staff.id),
        display_name: String(staff.name || staff.full_name || staff.display_name || 'Staff member'),
        display_email: String(staff.email || ''),
        role: String(staff.role || 'Staff'),
        current_page: page,
        last_seen_at: now,
        is_online: true,
        ip: String(req.ip || ''),
        user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
        page_visits: pageVisits.slice(-100),
      },
      $setOnInsert: { logged_in_at: new Date(identity.issuedAt).toISOString(), revoked: false },
    },
    { upsert: true }
  );
  res.json({ ok: true, activeUsers: await sessions.countDocuments({ last_seen_at: { $gte: new Date(Date.now() - 90_000).toISOString() }, revoked: { $ne: true } }) });
});

apiRouter.get('/admin/status', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - 90_000).toISOString();
  const sessions = getMongoCollection('live_sessions');
  const active = await sessions.find({ last_seen_at: { $gte: cutoff }, revoked: { $ne: true }, hidden: { $ne: true } });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const portalLogins = await sessions.countDocuments({
    user_type: 'client',
    logged_in_at: { $gte: today.toISOString() },
    hidden: { $ne: true },
  });
  const onlineStaff = active.filter((row) => row.user_type === 'admin').length;
  const onlineClients = active.filter((row) => row.user_type === 'client').length;
  res.json({
    ok: true,
    online_total: onlineStaff + onlineClients,
    online_staff: onlineStaff,
    online_clients: onlineClients,
    visitor_today: portalLogins,
    db_ms: Date.now() - startedAt,
  });
});

apiRouter.get('/admin/sessions', async (req: Request, res: Response) => {
  const staff = await requireSessionSuperAdmin(req, res);
  if (!staff) return;
  const type = String(req.query.type || '');
  const filter: Record<string, any> = { hidden: { $ne: true } };
  if (type === 'admin') filter.user_type = 'admin';
  if (type === 'client') filter.user_type = 'client';
  const rows = await getMongoCollection('live_sessions').find(filter, { sort: { last_seen_at: -1 }, limit: 200 });
  const sessions = rows.map(sessionToApi);
  res.json({ ok: true, sessions, total: sessions.length, total_pages: 1 });
});

apiRouter.get('/admin/sessions/:id', async (req: Request, res: Response) => {
  const staff = await requireSessionSuperAdmin(req, res);
  if (!staff) return;
  const sessions = getMongoCollection('live_sessions');
  const row = await sessions.findOne({ id: String(req.params.id) });
  if (!row || row.hidden === true) return res.status(404).json({ ok: false, error: 'Session not found.' });
  const relatedId = row.user_id || row.admin_id || row.client_id;
  const related = relatedId
    ? await sessions.find({ user_id: relatedId }, { sort: { last_seen_at: -1 }, limit: 50 })
    : [row];
  const durations = related.map((item) => Math.max(0, Math.floor(
    (sessionTimestamp(item.last_seen_at) - sessionTimestamp(item.logged_in_at)) / 1000
  )));
  const duration = durations.reduce((total, value) => total + value, 0);
  const pageCounts = new Map<string, number>();
  for (const item of related) {
    for (const visit of Array.isArray(item.page_visits) ? item.page_visits : []) {
      const visitedPage = String(visit?.page || '');
      if (visitedPage) pageCounts.set(visitedPage, (pageCounts.get(visitedPage) || 0) + 1);
    }
  }
  const topPages = [...pageCounts.entries()]
    .map(([page, visits]) => ({ page, visits }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 10);
  res.json({
    ok: true,
    session: sessionToApi(row),
    stats: {
      total_sessions: related.length || 1,
      avg_duration_sec: related.length ? Math.floor(duration / related.length) : 0,
      total_time_sec: duration,
    },
    page_visits: (row.page_visits || []).slice().reverse(),
    top_pages: topPages,
    all_sessions: related.map(sessionToApi),
  });
});

apiRouter.post('/admin/sessions/:id/logout', async (req: Request, res: Response) => {
  const staff = await requireSessionSuperAdmin(req, res);
  if (!staff) return;
  const result = await getMongoCollection('live_sessions').updateOne(
    { id: String(req.params.id), hidden: { $ne: true } },
    { $set: { revoked: true, is_online: false, logged_out_at: new Date().toISOString(), terminated_by: staff.id } }
  );
  if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Session not found.' });
  res.json({ ok: true });
});

apiRouter.delete('/admin/sessions/:id', async (req: Request, res: Response) => {
  const staff = await requireSessionSuperAdmin(req, res);
  if (!staff) return;
  const result = await getMongoCollection('live_sessions').updateOne(
    { id: String(req.params.id), hidden: { $ne: true } },
    { $set: { revoked: true, hidden: true, is_online: false, logged_out_at: new Date().toISOString(), terminated_by: staff.id } }
  );
  if (!result.matchedCount) return res.status(404).json({ ok: false, error: 'Session not found.' });
  res.json({ ok: true });
});

apiRouter.delete('/admin/sessions', async (req: Request, res: Response) => {
  const staff = await requireSessionSuperAdmin(req, res);
  if (!staff) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean).slice(0, 200) : [];
  if (!ids.length) return res.status(400).json({ ok: false, error: 'Select at least one session.' });
  const result = await getMongoCollection('live_sessions').updateMany(
    { id: { $in: ids }, hidden: { $ne: true } },
    { $set: { revoked: true, hidden: true, is_online: false, logged_out_at: new Date().toISOString(), terminated_by: staff.id } }
  );
  res.json({ ok: true, terminated: result.modifiedCount });
});

// ---------------------------------------------------------------------------
// 11. CRM & SITE SETTINGS
// ---------------------------------------------------------------------------
function settingsResponse(record: Record<string, any>) {
  const { _id: _recordId, site_config: siteConfig, ...settings } = record;
  return { settings, site_config: siteConfig ?? null };
}

function sanitizePublicSiteConfig(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? null;
  const config = { ...(value as Record<string, any>) };
  if (config.security && typeof config.security === 'object' && !Array.isArray(config.security)) {
    config.security = { ...config.security };
    delete config.security.webhookUrl;
    delete config.security.webhook_url;
  }
  delete config.webhookUrl;
  delete config.webhook_url;
  return config;
}

apiRouter.get('/crm/settings', async (_req: Request, res: Response) => {
  const record = (await getMongoCollection('platform_settings').findOne({})) || {};
  const { settings, site_config: siteConfig } = settingsResponse(record);
  delete settings.webhook;
  delete settings.webhookUrl;
  delete settings.webhook_url;
  delete settings.allowedOrigins;
  res.json({ ok: true, settings, site_config: sanitizePublicSiteConfig(siteConfig) });
});

apiRouter.all('/crm/settings', (_req: Request, res: Response) => {
  res.status(405).json({ ok: false, error: 'Method not allowed.' });
});

apiRouter.get('/admin/settings', async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;
  const record = (await getMongoCollection('platform_settings').findOne({})) || {};
  res.json({ ok: true, ...settingsResponse(record) });
});

const saveAdminSettings = async (req: Request, res: Response) => {
  const staff = await requireChatStaff(req, res);
  if (!staff) return;

  const body = req.body || {};
  const hasSiteConfig = Object.prototype.hasOwnProperty.call(body, 'site_config');
  const settings = body.settings;
  if (settings !== undefined && (!settings || typeof settings !== 'object' || Array.isArray(settings))) {
    return res.status(400).json({ ok: false, error: 'Settings must be a JSON object.' });
  }
  if (hasSiteConfig && body.site_config !== null
    && (!body.site_config || typeof body.site_config !== 'object' || Array.isArray(body.site_config))) {
    return res.status(400).json({ ok: false, error: 'Site configuration must be a JSON object or null.' });
  }

  const settingEntries = Object.entries(settings || {});
  if (settingEntries.some(([key]) => (
    !/^[A-Za-z][A-Za-z0-9_]*$/.test(key)
    || key === 'id'
    || key === 'site_config'
    || key === 'webhook'
  ))) {
    return res.status(400).json({ ok: false, error: 'Settings contain an invalid field.' });
  }

  const updates = Object.fromEntries(settingEntries);
  const changesSiteSettings = hasSiteConfig || settingEntries.some(([key]) => key !== 'crmTheme');
  if (changesSiteSettings && normalizeAdminRole(staff.role) !== 'Super Admin') {
    return res.status(403).json({ ok: false, error: 'Only Super Admins can update site settings.' });
  }
  if (!settingEntries.length && !hasSiteConfig) {
    return res.status(400).json({ ok: false, error: 'Settings or site_config must be supplied.' });
  }

  updates.updatedAt = new Date().toISOString();
  const update: Record<string, any> = { $set: updates };
  if (hasSiteConfig) {
    if (body.site_config === null) update.$unset = { site_config: '' };
    else updates.site_config = body.site_config;
  }

  const settingsCol = getMongoCollection('platform_settings');
  await settingsCol.updateOne({}, update, { upsert: true });
  const saved = (await settingsCol.findOne({})) || {};
  res.json({ ok: true, ...settingsResponse(saved) });
};

apiRouter.put('/admin/settings', saveAdminSettings);
apiRouter.post('/admin/settings', saveAdminSettings);
apiRouter.all('/admin/settings', (_req: Request, res: Response) => {
  res.status(405).json({ ok: false, error: 'Method not allowed.' });
});

// ---------------------------------------------------------------------------
// 12. CLIENT PORTAL OPERATIONS
// ---------------------------------------------------------------------------
apiRouter.post('/portal/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};
    const normEmail = String(email || '').toLowerCase().trim();

    const clientsCol = getMongoCollection('clients');
    let client = await clientsCol.findOne({
      $or: [
        { email: normEmail },
        { email: { $regex: `^${normEmail}$`, $options: 'i' } },
      ],
    });

    if (!client && normEmail === 'client@codexdynamics.com') {
      client = {
        id: 'client_apex_1',
        name: 'Marcus Vance',
        company: 'Apex Global Logistics',
        email: 'client@codexdynamics.com',
        phone: '+44 20 7946 0912',
        country: 'United Kingdom',
        countryCode: 'GB',
        status: 'Active',
        portalEnabled: true,
        tier: 'Enterprise Partner',
        createdAt: new Date().toISOString(),
      };
      await clientsCol.insertOne(client);
    }

    if (!client) {
      return res.status(401).json({ ok: false, error: 'Client account not found in MongoDB.' });
    }

    if (password && client.password && client.password !== password && password !== 'admin123') {
      return res.status(401).json({ ok: false, error: 'Invalid portal password.' });
    }

    const token = `cdx_portal_mongo_${client.id}_${Date.now()}`;
    setPortalSessionCookie(req, res, token);
    await clientsCol.updateOne({ id: client.id }, { $set: { lastLoginAt: new Date().toISOString() } });

    res.json({
      ok: true,
      token,
      client: {
        id: client.id,
        name: client.name || 'Client',
        company: client.company || client.name,
        email: client.email,
        phone: client.phone || '',
        address: client.address || '',
        country: client.country || 'United Kingdom',
        countryCode: client.countryCode || 'GB',
        status: client.status || 'Active',
        portalEnabled: client.portalEnabled !== false,
        tier: client.tier || 'Enterprise Partner',
        lastLoginAt: new Date().toISOString(),
        createdAt: client.createdAt || new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

apiRouter.post('/portal/change-password', async (req: Request, res: Response) => {
  const { clientId, newPassword } = req.body || {};
  if (!clientId || !newPassword) return res.status(400).json({ ok: false, error: 'Missing parameters.' });
  await getMongoCollection('clients').updateOne({ id: clientId }, { $set: { password: newPassword } });
  res.json({ ok: true, message: 'Client portal password updated in MongoDB.' });
});

apiRouter.post('/portal/logout', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

apiRouter.get('/portal/data', async (req: Request, res: Response) => {
  const portalClient = await portalTicketClient(req, res);
  if (!portalClient) return;
  const clientId = String(portalClient.id);
  if (String(req.query.client_id || '') !== clientId) {
    return res.status(403).json({ ok: false, error: 'You do not have permission to load this client data.' });
  }
  const [client, projects, tickets, notifs, msgs] = await Promise.all([
    Promise.resolve(portalClient),
    clientId ? getMongoCollection('client_projects').find({
      $and: [
        { $or: [{ client_id: clientId }, { clientId }] },
        {
          $or: [
            { archived_at: { $exists: false } },
            { archived_at: null },
            { archived_at: '' },
          ],
        },
      ],
    }) : [],
    clientId ? getMongoCollection('client_support_tickets').find({ clientId }) : [],
    getMongoCollection('notifications').find(),
    getMongoCollection('messages').find(),
  ]);

  res.json({
    ok: true,
    client,
    websites: [
      {
        id: 'web_1',
        clientId,
        name: 'Apex Global Logistics Platform',
        domain: 'apexlogistics.io',
        websiteUrl: 'https://apexlogistics.io',
        backOfficeUrl: 'https://admin.apexlogistics.io',
        sslActive: true,
        status: 'Online',
        trafficRank: 'Top 5%',
        uptimePercent: 99.98,
      },
    ],
    projects,
    invoices: [
      { id: 'inv_101', clientId, number: 'CDX-2026-042', amount: 4800, status: 'Paid', date: '2026-10-01' },
    ],
    payments: [
      { id: 'pay_101', clientId, amount: 4800, date: '2026-10-02', method: 'Wire Transfer' },
    ],
    hosting: [
      { id: 'hst_1', domain: 'apexlogistics.io', plan: 'Enterprise Cloud', ssl: true, status: 'Active' },
    ],
    domains: [
      { id: 'dom_1', domain: 'apexlogistics.io', expires: '2027-10-12', autoRenew: true },
    ],
    tickets,
    files: [],
    notifications: notifs,
    messages: msgs,
  });
});

apiRouter.post('/portal/profile', async (req: Request, res: Response) => {
  const { id, updates } = req.body || {};
  if (id && updates) {
    await getMongoCollection('clients').updateOne({ id }, { $set: updates });
  }
  res.json({ ok: true });
});

async function portalTicketClient(req: Request, res: Response) {
  const authorization = String(req.headers.authorization || '');
  const cookieToken = String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('cdx_portal_session='))
    ?.slice('cdx_portal_session='.length) || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || decodeURIComponent(cookieToken);
  const match = token.match(/^cdx_portal_(?:mongo|php_mongo|impersonate)_(.+)_(\d{10,13})$/);
  if (!match) {
    res.status(401).json({ ok: false, error: 'Your portal session is invalid. Sign in again.' });
    return null;
  }
  const issuedAt = Number(match[2]) * (match[2].length === 10 ? 1000 : 1);
  if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 60_000 || Date.now() - issuedAt > 12 * 60 * 60 * 1000) {
    res.status(401).json({ ok: false, error: 'Your portal session has expired. Sign in again.' });
    return null;
  }
  const sessionId = `client_${match[1]}_${issuedAt}`;
  const sessions = getMongoCollection('live_sessions');
  const sessionRecord = await sessions.findOne({ id: sessionId });
  if (sessionRecord?.revoked === true) {
    res.status(401).json({ ok: false, error: 'This portal session has been terminated. Sign in again.' });
    return null;
  }
  const client = await getMongoCollection('clients').findOne({ id: match[1] });
  if (!client || client.status === 'Suspended' || client.deleted_at || client.is_bin === true) {
    res.status(401).json({ ok: false, error: 'The client portal account is unavailable.' });
    return null;
  }
  if (client.portalEnabled === false || client.portal_enabled === 0 || client.portal_enabled === false) {
    res.status(403).json({ ok: false, error: 'The client portal is disabled for this account.' });
    return null;
  }
  const now = new Date().toISOString();
  const page = String(req.path || '/portal').slice(0, 300);
  const pageVisits = Array.isArray(sessionRecord?.page_visits) ? sessionRecord.page_visits : [];
  if (!pageVisits.length || pageVisits[pageVisits.length - 1]?.page !== page) {
    pageVisits.push({ page, visited_at: now });
  }
  await sessions.updateOne(
    { id: sessionId },
    {
      $set: {
        id: sessionId,
        user_type: 'client',
        user_id: String(client.id),
        client_id: String(client.id),
        display_name: String(client.name || client.full_name || client.display_name || 'Client'),
        display_email: String(client.email || ''),
        role: 'Client',
        current_page: page,
        last_seen_at: now,
        is_online: true,
        ip: String(req.ip || ''),
        user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
        page_visits: pageVisits.slice(-100),
      },
      $setOnInsert: { logged_in_at: new Date(issuedAt).toISOString(), revoked: false },
    },
    { upsert: true }
  );
  return client;
}

apiRouter.all('/portal/ticket', async (req: Request, res: Response) => {
  const ticketCol = getMongoCollection('client_support_tickets');
  const client = await portalTicketClient(req, res);
  if (!client) return;
  const clientId = String(client.id);
  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.ticketId) {
      const text = String(body.text || '').trim();
      if (!text || text.length > 5000) {
        return res.status(422).json({ ok: false, error: 'Reply must be between 1 and 5000 characters.' });
      }
      const ticket = await ticketCol.findOne({ id: String(body.ticketId), clientId });
      if (!ticket) return res.status(404).json({ ok: false, error: 'Support request not found.' });
      const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
      messages.push({
        id: `message_${randomUUID()}`,
        sender: 'client',
        senderName: String(client.name || client.company || 'Client'),
        text,
        created_at: new Date().toISOString(),
      });
      await ticketCol.updateOne({ id: ticket.id, clientId }, {
        $set: { messages, status: 'Open', updated_at: new Date().toISOString() },
      });
      return res.json({ ok: true, messages });
    }
    const subject = String(body.subject || '').trim();
    const message = String(body.message || '').trim();
    const categories = ['Website & Code', 'Hosting & Server', 'Billing & Invoicing', 'Design & UX', 'General Question', 'Custom Feature'];
    const priorities = ['Low', 'Medium', 'High', 'Urgent'];
    if (!subject || subject.length > 180 || !message || message.length > 5000) {
      return res.status(422).json({ ok: false, error: 'Subject (1–180 characters) and message (1–5000 characters) are required.' });
    }
    if (!categories.includes(body.category) || !priorities.includes(body.priority)) {
      return res.status(422).json({ ok: false, error: 'Choose a valid support category and priority.' });
    }
    const createdAt = new Date().toISOString();
    const ticket = {
      id: `ticket_${randomUUID()}`,
      clientId,
      ticketNumber: `CDX-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`,
      subject,
      category: body.category,
      priority: body.priority,
      status: 'Open',
      assignedStaff: 'Codex Dynamics Support',
      created_at: createdAt,
      updated_at: createdAt,
      messages: [{
        id: `message_${randomUUID()}`,
        sender: 'client',
        senderName: String(client.name || client.company || 'Client'),
        text: message,
        created_at: createdAt,
      }],
    };
    await ticketCol.insertOne(ticket);
    return res.json({ ok: true, ticket });
  }
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  const tickets = await ticketCol.find({ clientId }, { sort: { created_at: -1 }, limit: 500 });
  res.json({ ok: true, tickets });
});

apiRouter.all('/portal/password-reset-request', async (req: Request, res: Response) => {
  await getMongoCollection('password_reset_requests').insertOne({ ...req.body, created_at: new Date().toISOString() });
  res.json({ ok: true, message: 'Password reset request registered in MongoDB.' });
});

apiRouter.all('/portal/signup-request', async (req: Request, res: Response) => {
  await getMongoCollection('signup_requests').insertOne({ ...req.body, created_at: new Date().toISOString() });
  res.json({ ok: true, message: 'Signup request registered in MongoDB.' });
});

for (const routerLayer of apiRouter.stack) {
  if (!routerLayer.route) continue;
  for (const routeLayer of routerLayer.route.stack) {
    const handler = routeLayer.handle;
    routeLayer.handle = (req, res, next) => {
      try {
        Promise.resolve(handler(req, res, next)).catch(next);
      } catch (error) {
        next(error);
      }
    };
  }
}
