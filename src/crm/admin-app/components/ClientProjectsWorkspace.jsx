import React, { useMemo, useState } from 'react';
import { SearchAutocomplete } from './UserChrome.jsx';

const PROJECT_STATUSES = [
  'Planning',
  'In Progress',
  'Waiting for Client',
  'Review',
  'Completed',
  'Maintenance',
];

function handleDialogKeyDown(event, onClose, locked = false) {
  if (event.key === 'Escape' && !locked) {
    onClose();
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget.querySelector('[role="dialog"], [role="alertdialog"]');
  const focusable = [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function parseJson(value, original, originalText, defaultEmpty = false) {
  if (value === originalText) return original === undefined && defaultEmpty ? [] : original;
  return value.trim() ? JSON.parse(value) : [];
}

function jsonText(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function dateFieldValue(value) {
  if (!value) return '';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function Field({ label, id, children, hint }) {
  return (
    <label htmlFor={id} className="crm-inline-18c3b852e9">
      <span>{label}</span>
      {children}
      {hint && <small className="crm-inline-7948d89959">{hint}</small>}
    </label>
  );
}

function ProjectDialog({ clients, project, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    client_id: project?.client_id ?? '',
    name: project?.name ?? '',
    description: project?.description ?? '',
    service: project?.service ?? '',
    status: project?.status ?? 'Planning',
    progress: String(project?.progress ?? 0),
    start_date: dateFieldValue(project?.start_date),
    target_date: dateFieldValue(project?.target_date),
    team_lead: project?.team_lead ?? '',
    milestonesText: jsonText(project?.milestones),
    recentUpdatesText: jsonText(project?.recent_updates),
  }));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const initialMilestonesText = jsonText(project?.milestones);
  const initialUpdatesText = jsonText(project?.recent_updates);
  const initialStartDate = dateFieldValue(project?.start_date);
  const initialTargetDate = dateFieldValue(project?.target_date);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    if (!String(form.client_id).trim()) {
      setFormError('Choose a client for this project.');
      return;
    }
    if (!form.name.trim()) {
      setFormError('Project name is required.');
      return;
    }
    let milestones;
    let recentUpdates;
    try {
      milestones = parseJson(form.milestonesText, project?.milestones, initialMilestonesText, !project);
      recentUpdates = parseJson(form.recentUpdatesText, project?.recent_updates, initialUpdatesText, !project);
    } catch {
      setFormError('Milestones and recent updates must contain valid JSON.');
      return;
    }
    setSaving(true);
    try {
      const selectedClientId = project && String(form.client_id) === String(project.client_id)
        ? project.client_id
        : form.client_id;
      const payload = {
        ...(project || {}),
        client_id: selectedClientId,
        name: form.name.trim(),
        description: form.description,
        service: form.service,
        status: form.status,
        progress: Math.max(0, Math.min(100, Math.round(Number(form.progress) || 0))),
        start_date: project && form.start_date === initialStartDate ? project.start_date : form.start_date,
        target_date: project && form.target_date === initialTargetDate ? project.target_date : form.target_date,
        team_lead: form.team_lead,
        milestones,
        recent_updates: recentUpdates,
      };
      delete payload.id;
      delete payload.client_name;
      delete payload.client_company;
      await onSave(payload);
      onClose();
    } catch (error) {
      setFormError(error?.message || 'The project could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}
      onKeyDown={(event) => handleDialogKeyDown(event, onClose, saving)}
      className="crm-inline-baa37487ae"
      data-testid="overlay-project-dialog"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        aria-describedby="project-dialog-description"
        className="crm-inline-254f4befa0"
        data-testid="dialog-project-form"
      >
        <header className="crm-inline-613423c760">
          <div>
            <p className="crm-inline-b09ca324ad">Client delivery</p>
            <h3 id="project-dialog-title" className="crm-inline-2e0b5672ee">{project ? 'Edit project' : 'Create project'}</h3>
            <p id="project-dialog-description" className="crm-inline-f7e24da242">Manage delivery details for a client account. These records are separate from the public portfolio.</p>
          </div>
          <button type="button" className="crm-project-button" onClick={onClose} disabled={saving} aria-label="Close project form" data-testid="button-close-project-dialog">Close</button>
        </header>

        <form onSubmit={submit} className="crm-inline-ec42375ef9">
          <div className="project-form-grid project-form-client-grid crm-inline-acfbb661d9" >
            <Field label="Client *" id="project-client-id">
              <select
                id="project-client-id"
                required
                autoFocus
                value={String(form.client_id)}
                onChange={(event) => update('client_id', event.target.value)}
                className="crm-themed-form-control crm-themed-form-control--project"
                data-testid="select-project-client"
              >
                <option value="">Choose a client</option>
                {project?.client_id != null && !clients.some((client) => String(client.id) === String(project.client_id)) && (
                  <option value={String(project.client_id)}>{project.client_name || `Client ${project.client_id}`}</option>
                )}
                {clients.map((client) => <option key={client.id} value={String(client.id)}>{client.company ? `${client.name} · ${client.company}` : client.name}</option>)}
              </select>
            </Field>
            <Field label="Project name *" id="project-name">
              <input id="project-name" required maxLength={180} value={form.name} onChange={(event) => update('name', event.target.value)} className="crm-themed-form-control crm-themed-form-control--project" placeholder="Client portal rebuild" data-testid="input-project-name" />
            </Field>
            <Field label="Service" id="project-service">
              <input id="project-service" value={form.service} onChange={(event) => update('service', event.target.value)} className="crm-themed-form-control crm-themed-form-control--project" placeholder="Web application" data-testid="input-project-service" />
            </Field>
            <Field label="Status" id="project-status">
              <select id="project-status" value={form.status} onChange={(event) => update('status', event.target.value)} className="crm-themed-form-control crm-themed-form-control--project" data-testid="select-project-status">
                {!PROJECT_STATUSES.includes(form.status) && form.status && <option value={form.status}>{form.status}</option>}
                {PROJECT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </Field>
            <Field label="Progress" id="project-progress" hint="Whole number from 0 to 100.">
              <input id="project-progress" type="number" min="0" max="100" step="1" value={form.progress} onChange={(event) => update('progress', event.target.value)} className="crm-themed-form-control crm-themed-form-control--project" data-testid="input-project-progress" />
            </Field>
            <Field label="team lead" id="project-team-lead">
              <input id="project-team-lead" value={form.team_lead} onChange={(event) => update('team_lead', event.target.value)} className="crm-themed-form-control crm-themed-form-control--project" placeholder="Assigned staff member" data-testid="input-project-team-lead" />
            </Field>
            <Field label="Start date" id="project-start-date">
              <input id="project-start-date" type="date" value={form.start_date} onChange={(event) => update('start_date', event.target.value)} className="crm-themed-form-control crm-themed-form-control--project" data-testid="input-project-start-date" />
            </Field>
            <Field label="Target date" id="project-target-date">
              <input id="project-target-date" type="date" value={form.target_date} onChange={(event) => update('target_date', event.target.value)} className="crm-themed-form-control crm-themed-form-control--project" data-testid="input-project-target-date" />
            </Field>
          </div>
          <Field label="Description" id="project-description">
            <textarea id="project-description" rows={3} value={form.description} onChange={(event) => update('description', event.target.value)} className="crm-themed-form-control crm-themed-form-control--project crm-themed-form-control--textarea" placeholder="Scope, outcomes, or delivery context" data-testid="textarea-project-description" />
          </Field>
          <div className="project-form-grid project-form-details-grid crm-inline-acfbb661d9" >
            <Field label="Milestones (JSON)" id="project-milestones" hint="Existing API data is preserved unless changed.">
              <textarea id="project-milestones" rows={4} value={form.milestonesText} onChange={(event) => update('milestonesText', event.target.value)} className="crm-themed-form-control crm-themed-form-control--project crm-themed-form-control--textarea crm-themed-form-control--code" placeholder="[]" data-testid="textarea-project-milestones" />
            </Field>
            <Field label="Recent updates (JSON)" id="project-recent-updates" hint="Existing API data is preserved unless changed.">
              <textarea id="project-recent-updates" rows={4} value={form.recentUpdatesText} onChange={(event) => update('recentUpdatesText', event.target.value)} className="crm-themed-form-control crm-themed-form-control--project crm-themed-form-control--textarea crm-themed-form-control--code" placeholder="[]" data-testid="textarea-project-updates" />
            </Field>
          </div>
          {formError && <p role="alert" className="crm-inline-944d944978" data-testid="alert-project-form-error">{formError}</p>}
          <div className="crm-inline-8e16dd9250">
            <button type="button" className="crm-project-button" onClick={onClose} disabled={saving} data-testid="button-cancel-project">Cancel</button>
            <button type="submit" className="crm-project-button crm-project-button--primary" disabled={saving} data-testid="button-save-project">{saving ? 'Saving…' : project ? 'Save changes' : 'Create project'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ArchiveDialog({ project, onClose, onConfirm, busy, error }) {
  return (
    <div
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
      onKeyDown={(event) => handleDialogKeyDown(event, onClose, busy)}
      className="crm-inline-baa37487ae"
      data-testid="overlay-archive-project"
    >
      <section role="alertdialog" aria-modal="true" aria-labelledby="archive-project-title" aria-describedby="archive-project-copy" className="crm-inline-d90ec9d819" data-testid="dialog-archive-project">
        <h3 id="archive-project-title" className="crm-inline-0deb17e367">Archive this project?</h3>
        <p id="archive-project-copy" className="crm-inline-a27ddda35f">“{project.name}” will be removed from this active project list. This action is handled by the project service.</p>
        {error && <p role="alert" className="crm-inline-a1a7412a3b" data-testid="alert-archive-project-error">{error}</p>}
        <div className="crm-inline-f3ecc27eca">
          <button type="button" autoFocus className="crm-project-button" onClick={onClose} disabled={busy} data-testid="button-cancel-archive-project">Keep project</button>
          <button type="button" className="crm-project-button crm-project-button--danger" onClick={onConfirm} disabled={busy} data-testid="button-confirm-archive-project">{busy ? 'Archiving…' : 'Archive project'}</button>
        </div>
      </section>
    </div>
  );
}

export default function ClientProjectsWorkspace({
  clients = [],
  projects = [],
  loading = false,
  error = '',
  onReload = () => {},
  onCreate = async () => {},
  onUpdate = async () => {},
  onDelete = async () => {},
}) {
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [projectDialog, setProjectDialog] = useState(null);
  const [archiveProject, setArchiveProject] = useState(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState('');

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      if (clientFilter && String(project.client_id) !== clientFilter) return false;
      if (statusFilter && project.status !== statusFilter) return false;
      if (!query) return true;
      const client = clients.find((item) => String(item.id) === String(project.client_id));
      return [
        project.name,
        project.description,
        project.service,
        project.status,
        project.team_lead,
        project.client_name,
        project.client_company,
        client?.name,
        client?.company,
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [projects, clients, search, clientFilter, statusFilter]);

  const saveProject = async (payload) => {
    if (projectDialog?.project) await onUpdate(projectDialog.project.id, payload);
    else await onCreate(payload);
  };

  const archive = async () => {
    if (!archiveProject) return;
    setArchiveBusy(true);
    setArchiveError('');
    try {
      await onDelete(archiveProject.id);
      setArchiveProject(null);
    } catch (reason) {
      setArchiveError(reason?.message || 'The project could not be archived.');
    } finally {
      setArchiveBusy(false);
    }
  };

  const statusCounts = useMemo(() => PROJECT_STATUSES.reduce((counts, status) => {
    counts[status] = projects.filter((project) => project.status === status).length;
    return counts;
  }, {}), [projects]);

  return (
    <section className="client-projects-workspace crm-inline-39dbf40f7f" aria-labelledby="client-projects-title"  data-testid="workspace-client-projects">
      <header className="crm-inline-91c912957d">
        <div>
          <p className="crm-inline-b09ca324ad">Delivery operations</p>
          <h2 id="client-projects-title" className="crm-inline-60ab2db7aa">Client projects</h2>
          <p className="crm-inline-f7e24da242">Work in progress for client accounts, separate from public portfolio projects.</p>
        </div>
        <div className="crm-inline-f36152c67e">
          <button type="button" className="crm-project-button" onClick={onReload} disabled={loading} data-testid="button-reload-client-projects">{loading ? 'Refreshing…' : 'Refresh'}</button>
          <button type="button" className="crm-project-button crm-project-button--primary" onClick={() => setProjectDialog({ project: null })} disabled={clients.length === 0} data-testid="button-create-client-project">Create project</button>
        </div>
      </header>

      <div className="client-projects-summary crm-inline-19890b8917"  data-testid="summary-project-statuses">
        {[
          ['Active projects', projects.filter((project) => !['Completed', 'Maintenance'].includes(project.status)).length, 'var(--crm-accent, #0a84ff)'],
          ['In progress', statusCounts['In Progress'], '#44d3a2'],
          ['Waiting on client', statusCounts['Waiting for Client'], '#f0b865'],
          ['Completed', statusCounts.Completed, 'var(--crm-text-secondary, #b0b0b5)'],
        ].map(([label, value, color]) => (
          <div key={label} className="crm-inline-0150d13cbc" data-testid={`stat-client-projects-${String(label).toLowerCase().replaceAll(' ', '-')}`}>
            <span className="crm-inline-e20e510b5e">{label}</span>
            <strong className="crm-inline-c0314578af" style={{color}}>{value}</strong>
          </div>
        ))}
      </div>

      {error && <div role="alert" className="crm-inline-7a4e975388" data-testid="alert-client-projects-error">{error}</div>}

      <div className="client-project-toolbar crm-inline-c47c91daf8" >
        <label htmlFor="client-project-search" className="crm-inline-520ac58ffa">Search projects
          <SearchAutocomplete
            inputProps={{ id: 'client-project-search', type: 'search', 'data-testid': 'input-search-client-projects' }}
            value={search}
            onChange={setSearch}
            placeholder="Name, client, service, team lead…"
            className="crm-themed-form-control crm-themed-form-control--project"
            buildSuggestions={(query) => filteredProjects.filter((project) => {
              const client = clients.find((item) => String(item.id) === String(project.client_id));
              return [project.name, project.description, project.service, project.status, project.team_lead, project.client_name, project.client_company, client?.name, client?.company]
                .some((value) => String(value || '').toLowerCase().includes(query.toLowerCase()));
            }).slice(0, 8).map((project) => ({
              key: project.id,
              value: project.name || project.client_name || '',
              label: project.name || 'Untitled project',
              meta: [project.client_name || clients.find((item) => String(item.id) === String(project.client_id))?.name, project.service, project.status].filter(Boolean).join(' · '),
            }))}
          />
        </label>
        <label htmlFor="client-project-filter-client" className="crm-inline-520ac58ffa">Client
          <select id="client-project-filter-client" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className="crm-themed-form-control crm-themed-form-control--project" data-testid="filter-client-projects-client">
            <option value="">All clients</option>
            {clients.map((client) => <option key={client.id} value={String(client.id)}>{client.name}{client.company ? ` · ${client.company}` : ''}</option>)}
          </select>
        </label>
        <label htmlFor="client-project-filter-status" className="crm-inline-520ac58ffa">Status
          <select id="client-project-filter-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="crm-themed-form-control crm-themed-form-control--project" data-testid="filter-client-projects-status">
            <option value="">All statuses</option>
            {PROJECT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
      </div>

      {loading && (
        <div aria-label="Loading client projects" aria-busy="true" className="crm-inline-19890b8917" data-testid="loading-client-projects">
          {[0, 1, 2].map((index) => <div key={index} className="crm-inline-5743a22c83" data-testid={`skeleton-client-project-${index}`} />)}
        </div>
      )}

      {!loading && error && projects.length === 0 && (
        <div className="crm-inline-3075faa847" data-testid="error-state-client-projects">
          <h3 className="crm-inline-b2ce718d54">Projects could not be loaded</h3>
          <p className="crm-inline-9a72166fdb">{error}</p>
          <button type="button" className="crm-project-button" onClick={onReload} data-testid="button-retry-client-projects">Try again</button>
        </div>
      )}

      {!loading && !error && projects.length === 0 && (
        <div className="crm-inline-fbbb27bdc7" data-testid="empty-client-projects">
          <span className="crm-inline-ada9d5c6f2">+</span>
          <h3 className="crm-inline-b2ce718d54">No delivery projects yet</h3>
          <p className="crm-inline-f4c3ac75f1">Create a project and assign it to a client account to begin tracking delivery.</p>
          <button type="button" className="crm-project-button crm-project-button--primary-outline" onClick={() => setProjectDialog({ project: null })} disabled={clients.length === 0} data-testid="button-create-first-client-project">Create first project</button>
          {clients.length === 0 && <p className="crm-inline-3033b64933" data-testid="text-no-project-clients">Add a client account before creating a project.</p>}
        </div>
      )}

      {!loading && projects.length > 0 && filteredProjects.length === 0 && (
        <div className="crm-inline-2c8f469258" data-testid="empty-filtered-client-projects">No projects match these filters. Adjust the search or choose another client or status.</div>
      )}

      {!loading && filteredProjects.length > 0 && (
        <div className="crm-inline-19890b8917" data-testid="list-client-projects">
          {filteredProjects.map((project) => {
            const client = clients.find((item) => String(item.id) === String(project.client_id));
            const progress = Math.max(0, Math.min(100, Number(project.progress) || 0));
            const approvedMilestones = Array.isArray(project.milestones)
              ? project.milestones.filter((milestone) => milestone?.clientApproved)
              : [];
            return (
              <article key={project.id} className="crm-inline-03ecd5dce7" data-testid={`card-client-project-${project.id}`}>
                <div className="crm-inline-cc3fc3e349">
                  <div className="crm-inline-1116813922">
                    <div className="crm-inline-1d17149d73">
                      <h3 className="crm-inline-ec912ffc39" data-testid={`text-project-name-${project.id}`}>{project.name}</h3>
                      <span className="crm-inline-d823341d13" data-testid={`status-project-${project.id}`}>{project.status || 'Planning'}</span>
                    </div>
                    <p className="crm-inline-f7e24da242" data-testid={`text-project-client-${project.id}`}>{project.client_name || client?.name || `Client ${project.client_id}`}{project.client_company || client?.company ? ` · ${project.client_company || client?.company}` : ''}</p>
                    {project.description && <p className="crm-inline-4fc61fb04f" data-testid={`text-project-description-${project.id}`}>{project.description}</p>}
                  </div>
                  <div className="crm-inline-8e45b81904">
                    <button type="button" className="crm-project-button" onClick={() => setProjectDialog({ project })} data-testid={`button-edit-project-${project.id}`}>Edit</button>
                    <button type="button" className="crm-project-button crm-project-button--danger-outline" onClick={() => { setArchiveProject(project); setArchiveError(''); }} data-testid={`button-archive-project-${project.id}`}>Archive</button>
                  </div>
                </div>
                <div className="project-meta-grid crm-inline-9fca5f8e11" >
                  <div>
                    <div className="crm-inline-eed7f225c7"><span>Delivery progress</span><strong className="crm-inline-a182c66af3" data-testid={`text-project-progress-${project.id}`}>{progress}%</strong></div>
                    <div role="progressbar" aria-label={`${project.name} progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress} className="crm-inline-48225bdb1f" data-testid={`progress-project-${project.id}`}><div className="crm-inline-b8f62cd621" style={{width: `${progress}%`}} /></div>
                  </div>
                  <div data-testid={`text-project-service-${project.id}`}><span className="crm-inline-4e593d8ade">Service</span><span className="crm-inline-7a459431c4">{project.service || 'Not set'}</span></div>
                  <div data-testid={`text-project-team-lead-${project.id}`}><span className="crm-inline-4e593d8ade">team lead</span><span className="crm-inline-7a459431c4">{project.team_lead || 'Unassigned'}</span></div>
                  <div data-testid={`text-project-dates-${project.id}`}><span className="crm-inline-4e593d8ade">Target date</span><span className="crm-inline-7a459431c4">{project.target_date ? String(project.target_date).slice(0, 10) : 'Not set'}</span></div>
                </div>
                {(Array.isArray(project.milestones) && project.milestones.length > 0) && <p className="crm-inline-3033b64933" data-testid={`text-project-milestone-count-${project.id}`}>{project.milestones.length} milestone{project.milestones.length === 1 ? '' : 's'}</p>}
                {approvedMilestones.length > 0 && (
                  <div className="crm-inline-f960db1b69" data-testid={`list-client-approved-milestones-${project.id}`}>
                    <strong className="crm-inline-5026491cd8">Client-approved milestones</strong>
                    <ul className="crm-inline-68bd15f3b0">
                      {approvedMilestones.map((milestone) => (
                        <li key={milestone.id}>
                          {milestone.title || 'Milestone'}
                          {milestone.clientApprovedAt ? ` · ${String(milestone.clientApprovedAt).slice(0, 10)}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {project.recent_updates && <details className="crm-inline-642fa2663e" data-testid={`details-project-updates-${project.id}`}><summary className="crm-inline-8410c989c9">Recent updates</summary><pre className="crm-inline-a96012fe35">{jsonText(project.recent_updates)}</pre></details>}
              </article>
            );
          })}
        </div>
      )}

      {projectDialog && <ProjectDialog clients={clients} project={projectDialog.project} onClose={() => setProjectDialog(null)} onSave={saveProject} />}
      {archiveProject && <ArchiveDialog project={archiveProject} onClose={() => setArchiveProject(null)} onConfirm={archive} busy={archiveBusy} error={archiveError} />}
    </section>
  );
}