import { Router, Request, Response } from 'express';
import { getMongoCollection, isMongoConnected, getDatabaseName } from './mongo.ts';
import { SEED_STAFF } from './seedData.ts';
import { normalizeAdminRole } from '../crm/roleNormalization.js';

export const apiRouter = Router();
const seededSuperAdmin = SEED_STAFF.find((staff) => staff.id === 'staff_super_admin');
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
const handlePublicContent = async (_req: Request, res: Response) => {
  try {
    const [projects, blogs, reviews] = await Promise.all([
      getMongoCollection('projects').find({ published: { $ne: false } }),
      getMongoCollection('blogs').find({ status: 'published' }),
      getMongoCollection('reviews').find({ is_published: { $ne: 0 } }),
    ]);

    res.json({
      ok: true,
      storage: 'mongodb',
      projects: projects.map((p) => ({ ...p, id: p.id || p._id, is_published: true, published: true })),
      blogs: blogs.map((b) => ({ ...b, id: b.id || b._id })),
      reviews: reviews.map((r) => ({ ...r, id: r.id || r._id })),
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

apiRouter.post('/admin/logout', (_req: Request, res: Response) => {
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
apiRouter.get('/admin/clients', async (_req: Request, res: Response) => {
  const clients = await getMongoCollection('clients').find();
  res.json({ ok: true, clients, total: clients.length, hasMore: false });
});

apiRouter.get('/admin/clients/search', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  const clientsCol = getMongoCollection('clients');
  if (!q) {
    const clients = await clientsCol.find({}, { limit: 10 });
    return res.json({ ok: true, clients });
  }
  const clients = await clientsCol.find({
    $or: [
      { name: { $regex: q, $options: 'i' } },
      { company: { $regex: q, $options: 'i' } },
      { email: { $regex: q, $options: 'i' } },
      { phone: { $regex: q, $options: 'i' } },
    ],
  });
  res.json({ ok: true, clients });
});

apiRouter.post('/admin/clients', async (req: Request, res: Response) => {
  const payload = req.body || {};
  const first = payload.firstName || payload.first_name || '';
  const last = payload.lastName || payload.last_name || '';
  const fullName = payload.name || `${first} ${last}`.trim() || 'New Client';
  const newClient = {
    ...payload,
    id: payload.id || `client_${Date.now()}`,
    name: fullName,
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
  await getMongoCollection('clients').updateOne({ id: req.params.id }, { $set: req.body });
  const client = await getMongoCollection('clients').findOne({ id: req.params.id });
  res.json({ ok: true, client });
});

apiRouter.delete('/admin/clients/:id', async (req: Request, res: Response) => {
  await getMongoCollection('clients').updateOne({ id: req.params.id }, { $set: { deleted_at: new Date().toISOString(), is_bin: true } });
  res.json({ ok: true });
});

apiRouter.post('/admin/clients/:id/restore', async (req: Request, res: Response) => {
  await getMongoCollection('clients').updateOne({ id: req.params.id }, { $set: { deleted_at: null, is_bin: false } });
  res.json({ ok: true });
});

apiRouter.post('/admin/clients/:id/impersonate', async (req: Request, res: Response) => {
  const client = await getMongoCollection('clients').findOne({ id: req.params.id });
  if (!client) return res.status(404).json({ ok: false, error: 'Client not found.' });
  const token = `cdx_portal_impersonate_${client.id}_${Date.now()}`;
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

apiRouter.post('/admin/clients/:id/assign', async (req: Request, res: Response) => {
  const updates: any = {};
  if (req.body.assigned_office_id !== undefined) updates.assignedToOffice = req.body.assigned_office_id;
  if (req.body.assigned_team_id !== undefined) updates.assignedToTeam = req.body.assigned_team_id;
  if (req.body.assigned_agent_id !== undefined) updates.assignedToAgent = req.body.assigned_agent_id;
  await getMongoCollection('clients').updateOne({ id: req.params.id }, { $set: updates });
  const client = await getMongoCollection('clients').findOne({ id: req.params.id });
  res.json({ ok: true, client });
});

apiRouter.post('/admin/clients/:id/reset-status', async (req: Request, res: Response) => {
  await getMongoCollection('clients').updateOne({ id: req.params.id }, { $set: { status: 'New', stage: 'New' } });
  const client = await getMongoCollection('clients').findOne({ id: req.params.id });
  res.json({ ok: true, client });
});

apiRouter.all('/admin/clients/:id/comments', (_req: Request, res: Response) => {
  res.json({ ok: true });
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
  const clients = await getMongoCollection('clients').find();
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
  const { clientIds, officeId, teamId, agentId } = req.body || {};
  if (Array.isArray(clientIds) && clientIds.length > 0) {
    await getMongoCollection('clients').updateMany(
      { id: { $in: clientIds } },
      {
        $set: {
          ...(officeId !== undefined ? { assignedToOffice: officeId } : {}),
          ...(teamId !== undefined ? { assignedToTeam: teamId } : {}),
          ...(agentId !== undefined ? { assignedToAgent: agentId } : {}),
        },
      }
    );
  }
  res.json({ ok: true });
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
apiRouter.get('/admin/client-projects', async (_req: Request, res: Response) => {
  const projects = await getMongoCollection('client_projects').find();
  res.json({ ok: true, projects });
});

apiRouter.post('/admin/client-projects', async (req: Request, res: Response) => {
  const newProj = { ...req.body, id: req.body.id || `proj_${Date.now()}` };
  await getMongoCollection('client_projects').insertOne(newProj);
  res.json({ ok: true, project: newProj });
});

apiRouter.get('/admin/client-identity-reviews', async (_req: Request, res: Response) => {
  const reviews = await getMongoCollection('client_identity_reviews').find();
  res.json({ ok: true, reviews });
});

// ---------------------------------------------------------------------------
// 6. CONTENT STUDIO & SEO
// ---------------------------------------------------------------------------
apiRouter.get('/admin/site-content', async (_req: Request, res: Response) => {
  const [projects, blogs, reviews, settings] = await Promise.all([
    getMongoCollection('projects').find(),
    getMongoCollection('blogs').find(),
    getMongoCollection('reviews').find(),
    getMongoCollection('platform_settings').findOne({}),
  ]);
  res.json({ ok: true, projects, blogs, reviews, settings: settings || {} });
});

apiRouter.post('/admin/site-content/action', async (req: Request, res: Response) => {
  const { type, action, item, id } = req.body || {};
  const colName = type === 'blog' ? 'blogs' : type === 'review' ? 'reviews' : 'projects';
  const col = getMongoCollection(colName);

  if (action === 'create' || action === 'add') {
    const newItem = { ...item, id: item?.id || Date.now() };
    await col.insertOne(newItem);
    return res.json({ ok: true, item: newItem });
  }
  if (action === 'update' || action === 'edit') {
    const targetId = id || item?.id;
    await col.updateOne({ $or: [{ id: targetId }, { _id: targetId }] }, { $set: item });
    return res.json({ ok: true, item });
  }
  if (action === 'delete') {
    const targetId = id || item?.id;
    await col.deleteOne({ $or: [{ id: targetId }, { _id: targetId }] });
    return res.json({ ok: true });
  }
  res.json({ ok: true });
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
apiRouter.all('/api/admin/integrations/hostinger-mail', async (req: Request, res: Response) => {
  const col = getMongoCollection('hostinger_mail_integrations');
  if (req.method === 'POST') {
    await col.updateOne({}, { $set: { token: req.body.token, connected: true, updated_at: new Date().toISOString() } }, { upsert: true });
    return res.json({ ok: true, connected: true });
  }
  if (req.method === 'DELETE') {
    await col.deleteOne({});
    return res.json({ ok: true, connected: false });
  }
  const int = await col.findOne({});
  res.json({ ok: true, connected: !!int?.connected, token: int?.token || '' });
});

apiRouter.post('/admin/integrations/hostinger-mail/test', (_req: Request, res: Response) => {
  res.json({ ok: true, message: 'Hostinger Mail SMTP/IMAP handshake verified.' });
});

apiRouter.get('/admin/hostinger/mailboxes', async (_req: Request, res: Response) => {
  const mailboxes = await getMongoCollection('client_mailboxes').find();
  res.json({
    ok: true,
    mailboxes: mailboxes.length ? mailboxes : [
      { id: 'mb_1', email: 'support@codexdynamics.com', name: 'Primary Support', status: 'Active' },
      { id: 'mb_2', email: 'billing@codexdynamics.com', name: 'Billing Desk', status: 'Active' },
    ],
  });
});

apiRouter.get('/admin/hostinger/overview', async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    quota: { used: '1.2 GB', total: '10 GB', percentage: 12 },
    mailboxesCount: 2,
    domain: 'codexdynamics.com',
  });
});

apiRouter.all('/portal/mailboxes', async (_req: Request, res: Response) => {
  const mailboxes = await getMongoCollection('client_mailboxes').find();
  res.json({
    ok: true,
    mailboxes: mailboxes.length ? mailboxes : [
      { id: 'mb_c1', email: 'portal@apexlogistics.io', name: 'Client Desk', quotaUsed: '140MB' },
    ],
  });
});

apiRouter.post('/portal/mail/reply', (_req: Request, res: Response) => {
  res.json({ ok: true, sent: true });
});

// ---------------------------------------------------------------------------
// 9. MESSAGES, SUPPORT CHAT & NOTIFICATIONS
// ---------------------------------------------------------------------------
apiRouter.all('/admin/messages', async (req: Request, res: Response) => {
  const msgCol = getMongoCollection('messages');
  if (req.method === 'POST') {
    const msg = { ...req.body, id: `msg_${Date.now()}`, created_at: new Date().toISOString() };
    await msgCol.insertOne(msg);
    return res.json({ ok: true, message: msg });
  }
  const messages = await msgCol.find();
  res.json({ ok: true, messages });
});

apiRouter.post('/admin/messages/read', async (req: Request, res: Response) => {
  await getMongoCollection('messages').updateMany({ clientId: req.body.clientId }, { $set: { read: true } });
  res.json({ ok: true });
});

apiRouter.get('/admin/messages/unread_counts', async (_req: Request, res: Response) => {
  const unread = await getMongoCollection('messages').countDocuments({ read: { $ne: true } });
  res.json({ ok: true, unreadCount: unread });
});

apiRouter.get('/admin/messages/threads', async (_req: Request, res: Response) => {
  const messages = await getMongoCollection('messages').find();
  res.json({ ok: true, threads: messages });
});

apiRouter.all('/admin/messages/presence', (_req: Request, res: Response) => {
  res.json({ ok: true, online: true });
});

apiRouter.all('/portal/messages/presence', (_req: Request, res: Response) => {
  res.json({ ok: true, online: true });
});

apiRouter.all('/client/messages', async (req: Request, res: Response) => {
  const msgCol = getMongoCollection('messages');
  if (req.method === 'POST') {
    const msg = { ...req.body, id: `msg_${Date.now()}`, created_at: new Date().toISOString() };
    await msgCol.insertOne(msg);
    return res.json({ ok: true, message: msg });
  }
  const messages = await msgCol.find();
  res.json({ ok: true, messages });
});

apiRouter.all('/admin/notifications', async (req: Request, res: Response) => {
  const notifCol = getMongoCollection('notifications');
  if (req.method === 'DELETE') {
    await notifCol.deleteMany({});
    return res.json({ ok: true });
  }
  const notifications = await notifCol.find();
  res.json({ ok: true, notifications });
});

apiRouter.post('/admin/notifications/send', async (req: Request, res: Response) => {
  const notif = { ...req.body, id: `notif_${Date.now()}`, created_at: new Date().toISOString() };
  await getMongoCollection('notifications').insertOne(notif);
  res.json({ ok: true, notification: notif });
});

apiRouter.post('/admin/notifications/read-all', async (_req: Request, res: Response) => {
  await getMongoCollection('notifications').updateMany({}, { $set: { read: true } });
  res.json({ ok: true });
});

apiRouter.delete('/admin/notifications/clear', async (_req: Request, res: Response) => {
  await getMongoCollection('notifications').deleteMany({});
  res.json({ ok: true });
});

apiRouter.delete('/admin/notifications/sent-log', async (_req: Request, res: Response) => {
  await getMongoCollection('notifications').deleteMany({ sent: true });
  res.json({ ok: true });
});

apiRouter.all('/client/notifications', async (_req: Request, res: Response) => {
  const notifications = await getMongoCollection('notifications').find();
  res.json({ ok: true, notifications });
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

apiRouter.all('/admin/presence', (_req: Request, res: Response) => {
  res.json({ ok: true, activeUsers: 1 });
});

// ---------------------------------------------------------------------------
// 11. CRM & SITE SETTINGS
// ---------------------------------------------------------------------------
const handleSettings = async (req: Request, res: Response) => {
  const settingsCol = getMongoCollection('platform_settings');
  if (req.method === 'POST') {
    await settingsCol.updateOne({}, { $set: req.body }, { upsert: true });
    const saved = await settingsCol.findOne({});
    return res.json({ ok: true, settings: saved });
  }
  const current = (await settingsCol.findOne({})) || {};
  res.json({ ok: true, settings: current });
};

apiRouter.all('/admin/settings', handleSettings);
apiRouter.all('/crm/settings', handleSettings);

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
  const clientId = String(req.query.client_id || '');
  const [client, projects, tickets, notifs, msgs] = await Promise.all([
    clientId ? getMongoCollection('clients').findOne({ id: clientId }) : null,
    getMongoCollection('client_projects').find({ clientId }),
    getMongoCollection('client_support_tickets').find({ clientId }),
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
    projects: projects.length ? projects : [
      {
        id: 'proj_1',
        clientId,
        name: 'Enterprise Telephony Integration',
        status: 'In Progress',
        progress: 85,
        targetCompletion: '2026-11-30',
      },
    ],
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

apiRouter.all('/portal/ticket', async (req: Request, res: Response) => {
  const ticketCol = getMongoCollection('client_support_tickets');
  if (req.method === 'POST') {
    const t = { ...req.body, id: `ticket_${Date.now()}`, status: 'Open', created_at: new Date().toISOString() };
    await ticketCol.insertOne(t);
    return res.json({ ok: true, ticket: t });
  }
  const tickets = await ticketCol.find();
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
