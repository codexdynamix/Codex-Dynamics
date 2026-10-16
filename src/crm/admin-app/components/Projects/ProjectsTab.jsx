import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './ProjectsTab.css';
import { getAdminSiteContent, runAdminSiteContentAction, uploadAdminSiteImage } from '../../adminApi.js';
import {
  Briefcase,
  Plus,
  Search,
  ExternalLink,
  Star,
  Eye,
  EyeOff,
  Edit3,
  Trash2,
  Copy,
  CheckCircle2,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Upload,
  Sparkles,
  Gauge,
  Image as ImageIcon,
  Check,
  X,
  ArrowUpRight,
  TrendingUp,
  Award,
  Layers,
  FileCode,
  Zap,
  Globe
} from 'lucide-react';
import { crmClassName } from "../../styleHelpers.js";
import { SearchAutocomplete } from '../UserChrome.jsx';
import { useConfirmDialog } from '../ConfirmModal/ConfirmModal.jsx';

const CATEGORIES = [
  'All',
  'Websites & Web Apps',
  'CRMs & Calling Systems',
  'Graphic Design & Branding',
  'Meta & Google Ads',
  'Email Marketing',
  'Custom Software',
];

const normalizeProject = (project) => ({
  ...project,
  id: project.id,
  client: project.client || project.site_name || '',
  category: project.category || 'Websites & Web Apps',
  image: project.image || project.image_url || '',
  shortDescription: project.shortDescription || project.description || '',
  detailedDescription: project.detailedDescription || project.description || '',
  techStack: Array.isArray(project.techStack) ? project.techStack : [],
  metrics: Array.isArray(project.metrics) ? project.metrics : [],
  features: Array.isArray(project.features) ? project.features : [],
  lighthouse: project.lighthouse || {},
  published: project.published !== false && project.is_published !== false,
  featured: Boolean(project.featured),
});

export default function ProjectsTab({ showNotification = () => {} }) {
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [confirmDialog, confirm] = useConfirmDialog();
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'published' | 'draft' | 'featured'
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'table'
  const [selectedIds, setSelectedIds] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [previewModalProject, setPreviewModalProject] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const interactionInProgressRef = useRef(false);
  const refreshInProgressRef = useRef(false);
  interactionInProgressRef.current = isSaving || isUploadingImage || isModalOpen;

  const refreshProjects = useCallback(async ({ force = false, showLoading = false } = {}) => {
    if (refreshInProgressRef.current || (!force && interactionInProgressRef.current)) {
      return { ok: false, skipped: true };
    }
    refreshInProgressRef.current = true;
    if (showLoading) setIsLoading(true);
    setLoadError('');
    try {
      const content = await getAdminSiteContent();
      setProjects((content.projects || []).map(normalizeProject));
      return { ok: true };
    } catch (error) {
      const message = error.message || 'Portfolio projects could not be loaded.';
      setLoadError(message);
      return { ok: false, error };
    } finally {
      refreshInProgressRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects({ force: true, showLoading: true });
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshProjects();
    };
    const refreshInterval = window.setInterval(refreshWhenVisible, 30000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(refreshInterval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshProjects]);

  // Form State for Create / Edit
  const [formData, setFormData] = useState({
    id: '',
    title: '',
    client: '',
    category: 'Websites & Web Apps',
    tag: '',
    completionDate: '',
    site_url: '',
    image: '',
    video: '',
    shortDescription: '',
    detailedDescription: '',
    challenge: '',
    solution: '',
    impact: '',
    techStack: [],
    newTechInput: '',
    metrics: [],
    features: [],
    newFeatureInput: '',
    lighthouse: {
      performance: '',
      accessibility: '',
      bestPractices: '',
      seo: '',
    },
    featured: false,
    published: true,
  });

  const fileInputRef = useRef(null);

  const persistAndBroadcast = async (updatedProjects) => {
    setIsSaving(true);
    const changed = updatedProjects.filter((project) => {
      const previous = projects.find((item) => String(item.id) === String(project.id));
      return !previous || JSON.stringify(previous) !== JSON.stringify(project);
    });
    const removed = projects.filter((project) =>
      !updatedProjects.some((item) => String(item.id) === String(project.id))
    );
    const idMap = new Map();
    try {
      for (const project of changed) {
        const existing = projects.some((item) => String(item.id) === String(project.id));
        const result = await runAdminSiteContentAction(existing ? 'update' : 'create', {
          ...project,
          is_published: project.published ? 1 : 0,
        });
        idMap.set(String(project.id), result.item?.id || result.id || project.id);
      }
      for (const project of removed) {
        await runAdminSiteContentAction('delete', { id: project.id });
      }
      const saved = updatedProjects.map((project) => ({
        ...project,
        id: idMap.get(String(project.id)) || project.id,
      }));
      setProjects(saved);
      const detail = saved.filter((project) => project.published !== false);
      window.dispatchEvent(new CustomEvent('codex_projects_updated', { detail }));
      document.querySelectorAll('iframe').forEach((iframe) => {
        iframe.contentWindow?.postMessage({ type: 'CODEX_PROJECTS_UPDATE', projects: detail }, '*');
      });
      return true;
    } catch (error) {
      setLoadError(error.message || 'The portfolio changes could not be saved.');
      showNotification(error.message || 'The portfolio changes could not be saved.');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncToSite = async () => {
    setIsSyncing(true);
    try {
      const result = await refreshProjects({ force: true });
      if (!result.ok) throw result.error || new Error('Portfolio refresh is already in progress.');
      showNotification('Portfolio refreshed from the shared database.');
    } catch (error) {
      showNotification(error.message || 'Portfolio refresh failed.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Open modal for new project
  const handleOpenCreateModal = () => {
    setEditingProject(null);
    setFormData({
      id: `proj-${Date.now()}`,
      title: '',
      client: '',
      category: 'Websites & Web Apps',
      tag: '',
      completionDate: '',
      site_url: '',
      image: '',
      video: '',
      shortDescription: '',
      detailedDescription: '',
      challenge: '',
      solution: '',
      impact: '',
      techStack: [],
      newTechInput: '',
      metrics: [],
      features: [],
      newFeatureInput: '',
      lighthouse: {
        performance: '',
        accessibility: '',
        bestPractices: '',
        seo: '',
      },
      featured: false,
      published: true,
    });
    setIsModalOpen(true);
  };

  // Open modal for editing existing project
  const handleOpenEditModal = (proj) => {
    setEditingProject(proj);
    setFormData({
      id: proj.id,
      title: proj.title || '',
      client: proj.client || '',
      category: proj.category || 'Websites & Web Apps',
      tag: proj.tag || '',
      completionDate: proj.completionDate || '',
      site_url: proj.site_url || '',
      image: proj.image || '',
      video: proj.video || '',
      shortDescription: proj.shortDescription || '',
      detailedDescription: proj.detailedDescription || '',
      challenge: proj.challenge || '',
      solution: proj.solution || '',
      impact: proj.impact || '',
      techStack: Array.isArray(proj.techStack) ? [...proj.techStack] : [],
      newTechInput: '',
      metrics: Array.isArray(proj.metrics) ? proj.metrics.map(m => ({ ...m })) : [],
      features: Array.isArray(proj.features) ? [...proj.features] : [],
      newFeatureInput: '',
      lighthouse: proj.lighthouse || {
        performance: '',
        accessibility: '',
        bestPractices: '',
        seo: '',
      },
      featured: Boolean(proj.featured),
      published: proj.published !== false,
    });
    setIsModalOpen(true);
  };

  // Toggle Featured status
  const handleToggleFeatured = async (id, e) => {
    e?.stopPropagation();
    const updated = projects.map(p => p.id === id ? { ...p, featured: !p.featured } : p);
    if (!(await persistAndBroadcast(updated))) return;
    const target = updated.find(p => p.id === id);
    showNotification(target.featured ? `Marked "${target.title}" as Featured.` : `Removed Featured from "${target.title}".`);
  };

  // Toggle Published status
  const handleTogglePublished = async (id, e) => {
    e?.stopPropagation();
    const updated = projects.map(p => p.id === id ? { ...p, published: !p.published } : p);
    if (!(await persistAndBroadcast(updated))) return;
    const target = updated.find(p => p.id === id);
    showNotification(target.published ? `Published "${target.title}" to main site.` : `Unpublished "${target.title}" (hidden from main site).`);
  };

  // Duplicate Project
  const handleDuplicateProject = async (proj, e) => {
    e?.stopPropagation();
    const newProj = {
      ...proj,
      id: `proj-${Date.now()}`,
      title: `${proj.title} (Copy)`,
      client: `${proj.client} (Clone)`,
      featured: false,
    };
    const updated = [newProj, ...projects];
    if (await persistAndBroadcast(updated)) showNotification(`Duplicated "${proj.title}".`);
  };

  // Delete single project
  const handleDeleteProject = async (id, e) => {
    e?.stopPropagation();
    const project = projects.find((item) => String(item.id) === String(id));
    if (!project) return;
    const confirmed = await confirm({
      title: 'Delete portfolio project?',
      message: `“${project.title || 'Untitled project'}” will be permanently removed from the portfolio showcase.`,
      confirmLabel: 'Delete project',
      tone: 'danger',
    });
    if (!confirmed) return;

    const updated = projects.filter((item) => String(item.id) !== String(id));
    if (await persistAndBroadcast(updated)) {
      setSelectedIds((previous) => previous.filter((selectedId) => String(selectedId) !== String(id)));
      showNotification(`Deleted "${project.title || 'Untitled project'}" from the portfolio.`);
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    const confirmed = await confirm({
      title: `Delete ${count} portfolio project${count === 1 ? '' : 's'}?`,
      message: 'The selected projects will be permanently removed from the portfolio showcase.',
      confirmLabel: `Delete ${count} project${count === 1 ? '' : 's'}`,
      tone: 'danger',
    });
    if (!confirmed) return;

    const selected = new Set(selectedIds.map(String));
    const updated = projects.filter((project) => !selected.has(String(project.id)));
    if (!(await persistAndBroadcast(updated))) return;
    setSelectedIds([]);
    showNotification(`Deleted ${count} project${count === 1 ? '' : 's'} from the portfolio.`);
  };

  // Bulk Publish / Unpublish
  const handleBulkPublish = async (publish = true) => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    const updated = projects.map(p => selectedIds.includes(p.id) ? { ...p, published: publish } : p);
    if (await persistAndBroadcast(updated)) showNotification(`${publish ? 'Published' : 'Unpublished'} ${count} project(s).`);
  };

  // Store uploaded media in the shared site library and keep only its URL in project data.
  const handleImageFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      showNotification('Media file is larger than 5MB. Please select a smaller file.');
      e.target.value = '';
      return;
    }
    const isVideo = file.type === 'video/mp4' || file.type === 'video/webm';
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
    if (!isVideo && !allowedImageTypes.includes(file.type)) {
      showNotification('Choose a JPG, PNG, WebP, GIF, AVIF, MP4, or WebM file.');
      e.target.value = '';
      return;
    }

    setIsUploadingImage(true);
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('The image could not be read.'));
        reader.readAsDataURL(file);
      });
      const uploaded = await uploadAdminSiteImage({ name: file.name, data });
      setFormData(prev => ({
        ...prev,
        ...(uploaded.mediaType === 'video'
          ? { video: uploaded.url }
          : { image: uploaded.url }),
      }));
      showNotification(`${isVideo ? 'Animation' : 'Image'} uploaded and ready to use.`);
    } catch (error) {
      showNotification(error.message || 'Image upload failed.');
    } finally {
      setIsUploadingImage(false);
      e.target.value = '';
    }
  };

  // Add Tech Tag
  const handclientdTechTag = () => {
    const tag = formData.newTechInput.trim();
    if (tag && !formData.techStack.includes(tag)) {
      setFormData(prev => ({
        ...prev,
        techStack: [...prev.techStack, tag],
        newTechInput: ''
      }));
    }
  };

  // Remove Tech Tag
  const handleRemoveTechTag = (tagToRemove) => {
    setFormData(prev => ({
      ...prev,
      techStack: prev.techStack.filter(t => t !== tagToRemove)
    }));
  };

  // Add Metric
  const handclientdMetric = () => {
    setFormData(prev => ({
      ...prev,
      metrics: [...prev.metrics, { label: '', value: '', detail: '' }]
    }));
  };

  // Update Metric
  const handleUpdateMetric = (index, field, value) => {
    setFormData(prev => {
      const nextMetrics = [...prev.metrics];
      nextMetrics[index] = { ...nextMetrics[index], [field]: value };
      return { ...prev, metrics: nextMetrics };
    });
  };

  // Remove Metric
  const handleRemoveMetric = (index) => {
    setFormData(prev => ({
      ...prev,
      metrics: prev.metrics.filter((_, i) => i !== index)
    }));
  };

  // Save Modal Project
  const handleSaveProjectForm = async (e) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      showNotification('Please enter a project title.');
      return;
    }

    const projectRecord = {
      id: formData.id || `proj-${Date.now()}`,
      title: formData.title.trim(),
      client: formData.client.trim(),
      category: formData.category,
      tag: formData.tag.trim(),
      completionDate: formData.completionDate.trim(),
      site_url: formData.site_url.trim() || '',
      image: formData.image.trim(),
      video: formData.video.trim(),
      shortDescription: formData.shortDescription.trim(),
      detailedDescription: formData.detailedDescription.trim() || formData.shortDescription.trim(),
      challenge: formData.challenge.trim(),
      solution: formData.solution.trim(),
      impact: formData.impact.trim(),
      techStack: formData.techStack,
      metrics: formData.metrics,
      features: formData.features,
      lighthouse: formData.lighthouse,
      featured: formData.featured,
      published: formData.published,
    };

    let updatedList;
    if (editingProject) {
      updatedList = projects.map(p => p.id === editingProject.id ? projectRecord : p);
    } else {
      updatedList = [projectRecord, ...projects];
    }

    if (await persistAndBroadcast(updatedList)) {
      setIsModalOpen(false);
      showNotification(`${editingProject ? 'Updated' : 'Added'} project "${projectRecord.title}".`);
    }
  };

  // Filtered & Searched Projects list
  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const matchCat = activeCategory === 'All' || p.category === activeCategory;
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'published' && p.published) ||
        (statusFilter === 'draft' && !p.published) ||
        (statusFilter === 'featured' && p.featured);

      if (!matchCat || !matchStatus) return false;

      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;

      const titleMatch = (p.title || '').toLowerCase().includes(q);
      const clientMatch = (p.client || '').toLowerCase().includes(q);
      const catMatch = (p.category || '').toLowerCase().includes(q);
      const tagMatch = (p.tag || '').toLowerCase().includes(q);
      const techMatch = Array.isArray(p.techStack) && p.techStack.some(t => t.toLowerCase().includes(q));

      return titleMatch || clientMatch || catMatch || tagMatch || techMatch;
    });
  }, [projects, activeCategory, statusFilter, searchQuery]);

  // Compute stat highlights
  const stats = useMemo(() => {
    const total = projects.length;
    const published = projects.filter(p => p.published).length;
    const featured = projects.filter(p => p.featured).length;
    const scoredProjects = projects.filter(
      (project) =>
        project.lighthouse?.performance !== undefined &&
        project.lighthouse?.performance !== null &&
        project.lighthouse?.performance !== '' &&
        Number.isFinite(Number(project.lighthouse?.performance)),
    );
    const avgLighthouse = scoredProjects.length
      ? Math.round(
          scoredProjects.reduce((acc, project) => acc + Number(project.lighthouse?.performance || 0), 0) /
            scoredProjects.length,
        )
      : null;
    return { total, published, featured, avgLighthouse };
  }, [projects]);

  return (
    <div className="crm-projects-workspace">
      {confirmDialog}
      {/* ── Top Header ────────────────────────────────────────── */}
      <div className="crm-proj-header">
        <div className="crm-proj-title-group">
          <h2>
            <span className="crm-proj-title-icon">
              <Briefcase size={18} />
            </span>
            Client Projects & Portfolio Showcase
          </h2>
          <p>
            Upload and manage client projects that appear directly in the public <strong>/work</strong> and homepage showcase section of <strong>codexdynamics.com</strong>.
          </p>
        </div>

        <div className="crm-proj-header-actions">
          <a
            href="/?page=work"
            target="_blank"
            rel="noreferrer"
            className="crm-btn-secondary"
            title="View live portfolio on public website"
          >
            <ExternalLink size={13} />
            <span>View on Site</span>
          </a>

          <button
            type="button"
            className="crm-btn-secondary"
            onClick={handleSyncToSite}
            disabled={isSyncing}
            title="Force push showcase updates to website"
          >
            <Sparkles size={13} color="var(--crm-accent)" />
            <span>{isSyncing ? 'Syncing...' : 'Sync to Main Site'}</span>
          </button>

          <button
            type="button"
            className="crm-btn-primary"
            onClick={handleOpenCreateModal}
          >
            <Plus size={14} />
            <span>Upload New Project</span>
          </button>
        </div>
      </div>

      {/* ── Stat Counters ─────────────────────────────────────── */}
      <div className="crm-proj-stats-grid">
        <div className="crm-proj-stat-card">
          <div className="crm-proj-stat-icon">
            <Layers size={20} />
          </div>
          <div className="crm-proj-stat-info">
            <span className="crm-proj-stat-label">Total Projects</span>
            <span className="crm-proj-stat-value">{stats.total}</span>
          </div>
        </div>

        <div className="crm-proj-stat-card">
          <div className="crm-proj-stat-icon green">
            <CheckCircle2 size={20} />
          </div>
          <div className="crm-proj-stat-info">
            <span className="crm-proj-stat-label">Published on Site</span>
            <span className="crm-proj-stat-value">{stats.published}</span>
          </div>
        </div>

        <div className="crm-proj-stat-card">
          <div className="crm-proj-stat-icon">
            <Star size={20} />
          </div>
          <div className="crm-proj-stat-info">
            <span className="crm-proj-stat-label">Featured Showcases</span>
            <span className="crm-proj-stat-value">{stats.featured}</span>
          </div>
        </div>

        <div className="crm-proj-stat-card">
          <div className="crm-proj-stat-icon blue">
            <Gauge size={20} />
          </div>
          <div className="crm-proj-stat-info">
            <span className="crm-proj-stat-label">Avg. Lighthouse</span>
            <span className="crm-proj-stat-value">
              {stats.avgLighthouse === null ? '—' : `${stats.avgLighthouse}/100`}
            </span>
          </div>
        </div>
      </div>

      {/* ── Filter & Search Toolbar ───────────────────────────── */}
      <div className="crm-proj-toolbar">
        <div className="crm-proj-toolbar-top">
          <div className="crm-proj-search-box">
            <Search size={15} className="crm-proj-search-icon" />
            <SearchAutocomplete
              className="crm-proj-search-input"
              placeholder="Search projects by title, client, or tech stack..."
              value={searchQuery}
              onChange={setSearchQuery}
              style={{ flex: 1, minWidth: 0 }}
              buildSuggestions={(query) => filteredProjects.filter((project) => [
                project.title, project.client, project.category, project.shortDescription, project.detailedDescription,
                ...(Array.isArray(project.techStack) ? project.techStack : []),
              ].some((value) => String(value || '').toLowerCase().includes(query.toLowerCase())))
                .slice(0, 8).map((project) => ({
                  key: project.id,
                  value: project.title || project.client || '',
                  label: project.title || 'Untitled project',
                  meta: [project.client, project.category, ...(project.techStack || []).slice(0, 2)].filter(Boolean).join(' · '),
                }))}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="crm-inline-a81dd5579a"
                aria-label="Clear project search"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="crm-proj-toolbar-actions">
            {/* Status Segmented Control */}
            <div className="crm-studio-segmented-tabs crm-inline-54d863fd85" >
              {[
                { id: 'all', label: 'All Status' },
                { id: 'published', label: 'Published' },
                { id: 'featured', label: 'Featured' },
                { id: 'draft', label: 'Draft' },
              ].map(st => (
                <button
                  key={st.id}
                  type="button"
                  className={crmClassName(`crm-studio-tab-btn ${statusFilter === st.id ? 'active' : ''}`, "crm-inline-52547ca0f7")}
                  onClick={() => setStatusFilter(st.id)}

                >
                  {st.label}
                </button>
              ))}
            </div>

            {/* View Mode (Grid vs Table) */}
            <div className="crm-studio-segmented-tabs crm-inline-54d863fd85" >
              <button
                type="button"
                className={crmClassName(`crm-studio-tab-btn ${viewMode === 'grid' ? 'active' : ''}`, "crm-inline-c193781b87")}
                onClick={() => setViewMode('grid')}
                aria-label="Grid card view"
                aria-pressed={viewMode === 'grid'}
                title="Grid Card View"
              >
                <LayoutGrid size={13} />
                <span>Grid</span>
              </button>
              <button
                type="button"
                className={crmClassName(`crm-studio-tab-btn ${viewMode === 'table' ? 'active' : ''}`, "crm-inline-c193781b87")}
                onClick={() => setViewMode('table')}
                aria-label="Table view"
                aria-pressed={viewMode === 'table'}
                title="Table View"
              >
                <List size={13} />
                <span>Table</span>
              </button>
            </div>
          </div>
        </div>

        {/* Category Pills */}
        <div className="crm-proj-category-pills">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              type="button"
              className={`crm-proj-cat-pill ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ── Bulk Actions Floating Bar (When items selected) ──── */}
      {selectedIds.length > 0 && (
        <div className="crm-inline-0ae3d65428">
          <span className="crm-inline-c5b215a1c0">
            {selectedIds.length} project(s) selected
          </span>
          <div className="crm-inline-54a4986ffc">
            <button
              type="button"
              className="crm-btn-secondary crm-inline-52547ca0f7"

              onClick={() => handleBulkPublish(true)}
            >
              Publish Selected
            </button>
            <button
              type="button"
              className="crm-btn-secondary crm-inline-52547ca0f7"

              onClick={() => handleBulkPublish(false)}
            >
              Unpublish Selected
            </button>
            <button
              type="button"
              className="crm-super-admin-btn crm-super-admin-btn-small crm-inline-f81186f4de"

              onClick={handleBulkDelete}
            >
              Delete Selected
            </button>
          </div>
        </div>
      )}

      {/* ── Project Cards Grid View ───────────────────────────── */}
      {viewMode === 'grid' && (
        <div className="crm-proj-grid">
          {filteredProjects.map(proj => {
            const isSelected = selectedIds.includes(proj.id);
            const perfScore = proj.lighthouse?.performance;

            return (
              <div
                key={proj.id}
                className={`crm-proj-card ${proj.featured ? 'featured' : ''}`}
                style={isSelected ? { borderColor: 'var(--crm-accent)', background: '#252932' } : {}}
              >
                {/* Media Image & Status Badges */}
                <div className="crm-proj-card-media">
                  {proj.image && (
                    <img
                      src={proj.image}
                      alt={proj.title}
                      className="crm-proj-card-img"
                      onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                    />
                  )}

                  <div className="crm-proj-media-badges">
                    <div className="crm-proj-badge-left">
                      <span className={`crm-proj-status-badge ${proj.published ? 'published' : 'draft'}`}>
                        {proj.published ? 'Live on Site' : 'Draft'}
                      </span>
                      {proj.featured && (
                        <span className="crm-proj-featured-badge">
                          <Star size={10} fill="#121418" /> Featured
                        </span>
                      )}
                    </div>

                    <div className="crm-proj-lighthouse-chip" title="Google Lighthouse Score">
                      <Zap size={10} />
                      <span>
                        {perfScore === '' || perfScore === undefined || perfScore === null
                          ? 'No score'
                          : `${perfScore}/100`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="crm-proj-card-content">
                  <div className="crm-proj-card-meta">
                    <span className="crm-proj-card-client">{proj.client}</span>
                    <span className="crm-proj-card-date">{proj.completionDate || '—'}</span>
                  </div>

                  <h3 className="crm-proj-card-title">{proj.title}</h3>
                  <p className="crm-proj-card-desc">{proj.shortDescription}</p>

                  {/* Highlights Metrics */}
                  {Array.isArray(proj.metrics) && proj.metrics.length > 0 && (
                    <div className="crm-proj-metrics-row">
                      {proj.metrics.slice(0, 2).map((m, idx) => (
                        <div key={idx} className="crm-proj-metric-item">
                          <span className="crm-proj-metric-val">{m.value}</span>
                          <span className="crm-proj-metric-lbl">{m.label}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tech Tags */}
                  {Array.isArray(proj.techStack) && proj.techStack.length > 0 && (
                    <div className="crm-proj-tech-tags">
                      {proj.techStack.slice(0, 4).map(tech => (
                        <span key={tech} className="crm-proj-tag-pill">{tech}</span>
                      ))}
                      {proj.techStack.length > 4 && (
                        <span className="crm-proj-tag-pill crm-inline-f9136614bb" >
                          +{proj.techStack.length - 4}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Card Footer Actions */}
                  <div className="crm-proj-card-footer">
                    <label className="crm-inline-bd8d475e22">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          setSelectedIds(prev =>
                            isSelected ? prev.filter(x => x !== proj.id) : [...prev, proj.id]
                          );
                        }}
                      />
                      <span>Select</span>
                    </label>

                    <div className="crm-proj-card-actions">
                      {proj.site_url && (
                        <a
                          href={proj.site_url}
                          target="_blank"
                          rel="noreferrer"
                          className="crm-proj-action-btn"
                          title="Open live client website"
                          aria-label={`Open live website for ${proj.title}`}
                        >
                          <Globe size={13} />
                          <span>Open site</span>
                        </a>
                      )}

                      <button
                        type="button"
                        className={`crm-proj-action-btn star ${proj.featured ? 'active' : ''}`}
                        onClick={(e) => handleToggleFeatured(proj.id, e)}
                        title={proj.featured ? 'Remove featured' : 'Mark as featured showcase'}
                        aria-label={proj.featured ? `Remove ${proj.title} from featured showcase` : `Feature ${proj.title} on showcase`}
                      >
                        <Star size={13} fill={proj.featured ? 'currentColor' : 'none'} />
                        <span>{proj.featured ? 'Featured' : 'Feature'}</span>
                      </button>

                      <button
                        type="button"
                        className="crm-proj-action-btn"
                        onClick={(e) => handleTogglePublished(proj.id, e)}
                        title={proj.published ? 'Unpublish from main site' : 'Publish to main site'}
                        aria-label={proj.published ? `Unpublish ${proj.title} from main site` : `Publish ${proj.title} to main site`}
                      >
                        {proj.published ? <Eye size={13} color="#0ECB81" /> : <EyeOff size={13} />}
                        <span>{proj.published ? 'Unpublish' : 'Publish'}</span>
                      </button>

                      <button
                        type="button"
                        className="crm-proj-action-btn"
                        onClick={(e) => handleDuplicateProject(proj, e)}
                        title="Duplicate project"
                        aria-label={`Duplicate ${proj.title}`}
                      >
                        <Copy size={13} />
                        <span>Duplicate</span>
                      </button>

                      <button
                        type="button"
                        className="crm-proj-action-btn"
                        onClick={() => handleOpenEditModal(proj)}
                        title="Edit project details"
                        aria-label={`Edit ${proj.title}`}
                      >
                        <Edit3 size={13} />
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        className="crm-proj-action-btn delete"
                        onClick={(e) => handleDeleteProject(proj.id, e)}
                        title="Delete project"
                        aria-label={`Delete ${proj.title}`}
                      >
                        <Trash2 size={13} />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Table View ────────────────────────────────────────── */}
      {viewMode === 'table' && (
        <div className="crm-proj-table-wrap">
          <table className="crm-proj-table">
            <thead>
              <tr>
                <th className="crm-inline-1c1995f34b">
                  <input
                    type="checkbox"
                    aria-label="Select all filtered projects"
                    checked={filteredProjects.length > 0 && selectedIds.length === filteredProjects.length}
                    onChange={() => {
                      if (selectedIds.length === filteredProjects.length) {
                        setSelectedIds([]);
                      } else {
                        setSelectedIds(filteredProjects.map(p => p.id));
                      }
                    }}
                  />
                </th>
                <th className="crm-inline-d4260d2a3e">Cover</th>
                <th>Project Title & Client</th>
                <th>Category</th>
                <th className="crm-inline-72a68ac344">Lighthouse</th>
                <th className="crm-inline-72a68ac344">Status</th>
                <th className="crm-inline-72a68ac344">Featured</th>
                <th className="crm-inline-13cbe03b9a">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map(proj => {
                const isSelected = selectedIds.includes(proj.id);
                return (
                  <tr key={proj.id} style={isSelected ? { background: 'color-mix(in srgb, var(--crm-accent) 5%, transparent)' } : {}}>
                    <td className="crm-inline-72a68ac344">
                      <input
                        type="checkbox"
                        aria-label={`Select ${proj.title}`}
                        checked={isSelected}
                        onChange={() => {
                          setSelectedIds(prev =>
                            isSelected ? prev.filter(x => x !== proj.id) : [...prev, proj.id]
                          );
                        }}
                      />
                    </td>
                    <td>
                      {proj.image ? (
                        <img
                          src={proj.image}
                          alt={proj.title}
                          className="crm-inline-13d7e7ed99"
                          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                        />
                      ) : (
                        <ImageIcon size={16} aria-label="No project image" />
                      )}
                    </td>
                    <td>
                      <div className="crm-inline-487fba9832">{proj.title}</div>
                      <div className="crm-inline-ecc726c335">{proj.client}</div>
                    </td>
                    <td>
                      <span className="crm-proj-tag-pill">{proj.category}</span>
                    </td>
                    <td className="crm-inline-72a68ac344">
                      <span className="crm-inline-0950fdda64">
                        {proj.lighthouse?.performance === '' ||
                        proj.lighthouse?.performance === undefined ||
                        proj.lighthouse?.performance === null
                          ? '—'
                          : `${proj.lighthouse?.performance}/100`}
                      </span>
                    </td>
                    <td className="crm-inline-72a68ac344">
                      <button
                        type="button"
                        onClick={(e) => handleTogglePublished(proj.id, e)}
                        className={crmClassName(`crm-proj-status-badge ${proj.published ? 'published' : 'draft'}`, "crm-inline-4fc8e9a239")}
                        aria-label={proj.published ? `Unpublish ${proj.title} from main site` : `Publish ${proj.title} to main site`}
                      >
                        {proj.published ? 'Live' : 'Draft'}
                      </button>
                    </td>
                    <td className="crm-inline-72a68ac344">
                      <button
                        type="button"
                        onClick={(e) => handleToggleFeatured(proj.id, e)}
                        className="crm-inline-8c7950b676"
                        style={{color: proj.featured ? 'var(--crm-accent)' : '#555D6C'}}
                        aria-label={proj.featured ? `Remove ${proj.title} from featured showcase` : `Feature ${proj.title} on showcase`}
                        title={proj.featured ? 'Remove from featured showcase' : 'Feature on showcase'}
                      >
                        <Star size={16} fill={proj.featured ? 'var(--crm-accent)' : 'none'} />
                        <span>{proj.featured ? 'Featured' : 'Feature'}</span>
                      </button>
                    </td>
                    <td className="crm-inline-13cbe03b9a">
                      <div className="crm-inline-5f904f50c9">
                        <button
                          type="button"
                          className="crm-proj-action-btn"
                          onClick={() => handleOpenEditModal(proj)}
                          title="Edit"
                          aria-label={`Edit ${proj.title}`}
                        >
                          <Edit3 size={12} />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          className="crm-proj-action-btn delete"
                          onClick={(e) => handleDeleteProject(proj.id, e)}
                          title="Delete"
                          aria-label={`Delete ${proj.title}`}
                        >
                          <Trash2 size={12} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty State */}
      {filteredProjects.length === 0 && (
        <div className="crm-inline-9035397669">
          <Briefcase size={36} color="var(--crm-text-secondary)" className="crm-inline-2bb935ac41" />
          <h4 className="crm-inline-401ee7b72f">No projects found</h4>
          <p className="crm-inline-b6e046df95">
            No projects match the selected category or search query.
          </p>
          <button
            type="button"
            className="crm-btn-primary"
            onClick={handleOpenCreateModal}
          >
            <Plus size={14} />
            <span>Upload New Project</span>
          </button>
        </div>
      )}

      {/* ── Upload & Edit Modal ───────────────────────────────── */}
      {isModalOpen && (
        <div className="crm-proj-modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="crm-proj-modal" onClick={e => e.stopPropagation()}>
            <div className="crm-proj-modal-header">
              <h3>
                <Briefcase size={18} color="var(--crm-accent)" />
                <span>{editingProject ? 'Edit Client Project' : 'Upload New Client Project'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="crm-inline-7f5ada64a8"
                aria-label="Close project form"
                title="Close project form"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveProjectForm} className="crm-proj-modal-body">
              {/* 1. Core Identification */}
              <div className="crm-proj-form-section">
                <span className="crm-proj-section-title">1. Project Identity & Client</span>

                <div className="crm-proj-form-grid-2">
                  <div className="crm-proj-form-group">
                    <label>Project Title *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. ApexStore: Headless E-Commerce Web App"
                      value={formData.title}
                      onChange={e => setFormData({ ...formData, title: e.target.value })}
                    />
                  </div>
                  <div className="crm-proj-form-group">
                    <label>Or enter Direct Animation URL (MP4 / WebM)</label>
                    <input
                      type="text"
                      placeholder="https://.../project-animation.mp4"
                      value={formData.video}
                      onChange={e => setFormData({ ...formData, video: e.target.value })}
                    />
                  </div>

                  <div className="crm-proj-form-group">
                    <label>Client / Brand Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Northline Global Commerce"
                      value={formData.client}
                      onChange={e => setFormData({ ...formData, client: e.target.value })}
                    />
                  </div>
                </div>

                <div className="crm-proj-form-grid-2">
                  <div className="crm-proj-form-group">
                    <label>Category</label>
                    <select
                      value={formData.category}
                      onChange={e => setFormData({ ...formData, category: e.target.value })}
                    >
                      {CATEGORIES.filter(c => c !== 'All').map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div className="crm-proj-form-group">
                    <label>Tag / Specialty Label</label>
                    <input
                      type="text"
                      placeholder="e.g. Web Development · E-Commerce"
                      value={formData.tag}
                      onChange={e => setFormData({ ...formData, tag: e.target.value })}
                    />
                  </div>
                </div>

                <div className="crm-proj-form-grid-2">
                  <div className="crm-proj-form-group">
                    <label>Live Website URL</label>
                    <input
                      type="url"
                      placeholder="https://client-project.com"
                      value={formData.site_url}
                      onChange={e => setFormData({ ...formData, site_url: e.target.value })}
                    />
                  </div>

                  <div className="crm-proj-form-group">
                    <label>Completion Year / Quarter</label>
                    <input
                      type="text"
                      placeholder="e.g. Q4 2026"
                      value={formData.completionDate}
                      onChange={e => setFormData({ ...formData, completionDate: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* 2. Media & Thumbnail Upload */}
              <div className="crm-proj-form-section">
                <span className="crm-proj-section-title">2. Cover Image & Animation</span>

                <div
                  className="crm-proj-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm"
                    className="crm-inline-f2892a2e8a"
                    onChange={handleImageFileChange}
                    disabled={isUploadingImage}
                  />
                  <Upload size={24} color="var(--crm-accent)" />
                  <div className="crm-inline-f0f37ecba2">
                    {isUploadingImage ? 'Uploading media…' : 'Click to upload a project image or animation'}
                  </div>
                  <div className="crm-inline-d77fd45478">
                    JPG, PNG, WebP, GIF, AVIF, MP4, or WebM · up to 5MB
                  </div>
                </div>

                {(formData.image || formData.video) && (
                  <div className="crm-proj-image-preview-wrap">
                    {formData.video ? (
                      <video
                        src={formData.video}
                        poster={formData.image || undefined}
                        className="crm-proj-image-preview"
                        autoPlay
                        muted
                        loop
                        playsInline
                      />
                    ) : (
                      <img
                        src={formData.image}
                        alt="Project Preview"
                        className="crm-proj-image-preview"
                      />
                    )}
                    <div className="crm-inline-54a4986ffc">
                      {formData.image && (
                        <button
                          type="button"
                          className="crm-proj-remove-img-btn"
                          onClick={() => setFormData(prev => ({ ...prev, image: '' }))}
                          title="Remove image"
                          aria-label="Remove project image"
                        >
                          <X size={14} />
                        </button>
                      )}
                      {formData.video && (
                        <button
                          type="button"
                          className="crm-proj-remove-img-btn"
                          onClick={() => setFormData(prev => ({ ...prev, video: '' }))}
                          title="Remove animation"
                          aria-label="Remove project animation"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="crm-proj-form-group">
                  <label>Or enter Direct Image URL</label>
                  <input
                    type="text"
                    placeholder="/work/northline-logistics.jpg or https://..."
                    value={formData.image}
                    onChange={e => setFormData({ ...formData, image: e.target.value })}
                  />
                </div>

              </div>

              {/* 3. Narrative & Case Study */}
              <div className="crm-proj-form-section">
                <span className="crm-proj-section-title">3. Case Study & Results Narrative</span>

                <div className="crm-proj-form-group">
                  <label>Short Description (Shown on cards)</label>
                  <textarea
                    rows={2}
                    placeholder="A sub-second e-commerce web application replacing a legacy monolith..."
                    value={formData.shortDescription}
                    onChange={e => setFormData({ ...formData, shortDescription: e.target.value })}
                  />
                </div>

                <div className="crm-proj-form-group">
                  <label>Client Challenge (Problem statement)</label>
                  <textarea
                    rows={2}
                    placeholder="A sluggish legacy storefront with 6.2s Time-to-Interactive..."
                    value={formData.challenge}
                    onChange={e => setFormData({ ...formData, challenge: e.target.value })}
                  />
                </div>

                <div className="crm-proj-form-group">
                  <label>Our Solution (What Codex Dynamics engineered)</label>
                  <textarea
                    rows={2}
                    placeholder="Built a high-performance React 19 storefront running on edge runtime..."
                    value={formData.solution}
                    onChange={e => setFormData({ ...formData, solution: e.target.value })}
                  />
                </div>

                <div className="crm-proj-form-group">
                  <label>Measurable Impact (Business results)</label>
                  <textarea
                    rows={2}
                    placeholder="+41% conversion rate increase in the first 30 days..."
                    value={formData.impact}
                    onChange={e => setFormData({ ...formData, impact: e.target.value })}
                  />
                </div>
              </div>

              {/* 4. Tech Stack Tags */}
              <div className="crm-proj-form-section">
                <span className="crm-proj-section-title">4. Technologies & Tools</span>

                <div className="crm-inline-54a4986ffc">
                  <input
                    type="text"
                    placeholder="e.g. React 19, TypeScript, WebRTC..."
                    value={formData.newTechInput}
                    onChange={e => setFormData({ ...formData, newTechInput: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handclientdTechTag();
                      }
                    }}
                    className="crm-inline-ee3d55bf99"
                  />
                  <button
                    type="button"
                    className="crm-btn-secondary"
                    onClick={handclientdTechTag}
                  >
                    Add Tag
                  </button>
                </div>

                <div className="crm-proj-tech-tags crm-inline-11fcc64d09" >
                  {formData.techStack.map(tag => (
                    <span key={tag} className="crm-proj-tag-pill crm-inline-77062f23f3" >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTechTag(tag)}
                        className="crm-inline-626df2ffa7"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* 5. Metrics & Lighthouse */}
              <div className="crm-proj-form-section">
                <span className="crm-proj-section-title">5. Business Metrics & Lighthouse Speed</span>

                <div className="crm-inline-c1d507337e">
                  {formData.metrics.map((m, idx) => (
                    <div key={idx} className="crm-inline-b41dbad860">
                      <input
                        type="text"
                        placeholder="Label (e.g. Conversion)"
                        value={m.label}
                        onChange={e => handleUpdateMetric(idx, 'label', e.target.value)}
                        className="crm-inline-ee3d55bf99"
                      />
                      <input
                        type="text"
                        placeholder="Value (e.g. +45%)"
                        value={m.value}
                        onChange={e => handleUpdateMetric(idx, 'value', e.target.value)}
                        className="crm-inline-9ed99d3bca"
                      />
                      <input
                        type="text"
                        placeholder="Detail (e.g. In 30 days)"
                        value={m.detail}
                        onChange={e => handleUpdateMetric(idx, 'detail', e.target.value)}
                        className="crm-inline-ee3d55bf99"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveMetric(idx)}
                        className="crm-inline-5ebff57056"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="crm-btn-secondary crm-inline-82c4dd50ae"

                    onClick={handclientdMetric}
                  >
                    + Add Metric Highlight
                  </button>
                </div>

                {/* Lighthouse Performance Score Input */}
                <div className="crm-proj-form-grid-2 crm-inline-54d32d80db" >
                  <div className="crm-proj-form-group">
                    <label>Lighthouse Performance Score (0 - 100)</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={formData.lighthouse.performance}
                      onChange={e => setFormData({
                        ...formData,
                        lighthouse: {
                          ...formData.lighthouse,
                          performance: e.target.value === '' ? '' : Number(e.target.value),
                        }
                      })}
                    />
                  </div>
                  <div className="crm-proj-form-group">
                    <label>SEO Score (0 - 100)</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={formData.lighthouse.seo}
                      onChange={e => setFormData({
                        ...formData,
                        lighthouse: {
                          ...formData.lighthouse,
                          seo: e.target.value === '' ? '' : Number(e.target.value),
                        }
                      })}
                    />
                  </div>
                </div>
              </div>

              {/* 6. Visibility Toggles */}
              <div className="crm-proj-form-section crm-inline-c16bccca5b" >
                <div className="crm-inline-51769e74e1">
                  <label className="crm-inline-2176b2aa53">
                    <input
                      type="checkbox"
                      checked={formData.published}
                      onChange={e => setFormData({ ...formData, published: e.target.checked })}
                    />
                    <span className="crm-inline-330fc168ac">
                      Publish Immediately to Website Showcase
                    </span>
                  </label>

                  <label className="crm-inline-2176b2aa53">
                    <input
                      type="checkbox"
                      checked={formData.featured}
                      onChange={e => setFormData({ ...formData, featured: e.target.checked })}
                    />
                    <span className="crm-inline-d6152cf0c4">
                      Mark as Featured Showcase (Bento placement)
                    </span>
                  </label>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="crm-proj-modal-footer">
                <button
                  type="button"
                  className="crm-btn-secondary"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="crm-btn-primary"
                  disabled={isSaving || isUploadingImage}
                >
                  <Check size={14} />
                  <span>
                    {isUploadingImage
                      ? 'Uploading media…'
                      : isSaving
                        ? 'Saving…'
                        : editingProject ? 'Save Changes' : 'Upload & Publish'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
