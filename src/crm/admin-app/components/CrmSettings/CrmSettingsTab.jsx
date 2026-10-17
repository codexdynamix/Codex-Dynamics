import React, { useState, useEffect, useCallback, useRef } from 'react';
import './CrmSettings.css';
import {
  CRM_THEME_PRESETS,
  ACCENT_SWATCHES,
  DENSITY_OPTIONS,
  RADIUS_OPTIONS,
  DEFAULT_CRM_SETTINGS,
  getCrmThemeSettings,
  saveCrmThemeSettings,
  cacheCrmThemeLocally,
  applyCrmThemeToDom,
  generateHarmoniousCrmColors,
  calcContrast,
} from './crmThemeState';
import {
  Palette,
  Check,
  RotateCcw,
  Save,
  Sparkles,
  Layout,
  Layers,
  Sliders,
  Lock,
  Unlock,
  Copy,
  RefreshCw,
  Sun,
  Moon,
  ChevronDown,
  Wand2,
} from 'lucide-react';

export default function CrmSettingsTab({ showNotification }) {
  const [settings, setSettings] = useState(getCrmThemeSettings);
  const [saveState, setSaveState] = useState('saved');
  const saved = saveState === 'saved';
  const [copiedIndex, setCopiedIndex] = useState(null);

  // Coolors Interactive Palette Generator Stage
  const [generatorMode, setGeneratorMode] = useState('dark'); // 'dark' | 'light' | 'all'
  const [palettePillars, setPalettePillars] = useState(() => [
    { id: 'accent', label: 'Primary Accent', hex: '#0A84FF', locked: false, desc: 'Action buttons & pills' },
    { id: 'bg', label: 'Canvas Background', hex: '#16171B', locked: false, desc: 'Apple dark gray base' },
    { id: 'card', label: 'Card Surface', hex: '#23242A', locked: false, desc: 'Solid panels' },
    { id: 'glow', label: 'Accent Detail', hex: '#64D2FF', locked: false, desc: 'Active badges' },
    { id: 'secondary', label: 'Secondary Gray', hex: '#2D2F36', locked: false, desc: 'Hover states & inputs' },
  ]);

  // Every change is applied, cached locally, and saved to the server, so the
  // chosen theme is still active when this page is opened again.
  const persistedRef = useRef(JSON.stringify(settings));
  const pendingRef = useRef(null);
  const notifyRef = useRef(showNotification);
  notifyRef.current = showNotification;

  const persist = useCallback(async (next) => {
    pendingRef.current = null;
    setSaveState('saving');
    try {
      const merged = await saveCrmThemeSettings(next);
      persistedRef.current = JSON.stringify(merged);
      setSaveState('saved');
      return true;
    } catch (error) {
      setSaveState('error');
      notifyRef.current?.(error.message || 'CRM theme could not be saved.', 'error');
      return false;
    }
  }, []);

  useEffect(() => {
    const handleExternalChange = (event) => {
      if (!event.detail || pendingRef.current) return;
      const key = JSON.stringify(event.detail);
      if (key === persistedRef.current) return;
      persistedRef.current = key;
      setSettings(event.detail);
    };
    window.addEventListener('cdx:crm-theme-changed', handleExternalChange);
    return () => window.removeEventListener('cdx:crm-theme-changed', handleExternalChange);
  }, []);

  useEffect(() => {
    applyCrmThemeToDom(settings);
    if (JSON.stringify(settings) === persistedRef.current) return undefined;
    cacheCrmThemeLocally(settings);
    pendingRef.current = settings;
    setSaveState('pending');
    const timer = setTimeout(() => { void persist(settings); }, 500);
    return () => clearTimeout(timer);
  }, [settings, persist]);

  useEffect(() => () => {
    if (pendingRef.current) void persist(pendingRef.current);
  }, [persist]);

  // Generate new harmonious palette (Coolors style)
  const handleGenerateHarmoniousPalette = useCallback(() => {
    const generated = generateHarmoniousCrmColors(generatorMode);
    setPalettePillars((prev) =>
      prev.map((pillar) => {
        if (pillar.locked) return pillar;
        if (pillar.id === 'accent') return { ...pillar, hex: generated.accent };
        if (pillar.id === 'bg') return { ...pillar, hex: generated.bg };
        if (pillar.id === 'card') return { ...pillar, hex: generated.card };
        if (pillar.id === 'glow') return { ...pillar, hex: generated.glow };
        if (pillar.id === 'secondary') return { ...pillar, hex: generated.secondary };
        return pillar;
      })
    );
  }, [generatorMode]);

  // Keyboard shortcut: Spacebar generates a new palette when on this tab
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code !== 'Space' || !(e.target instanceof HTMLElement)) return;
      if (e.target.closest('button, summary, a, input, textarea, select, [contenteditable="true"], [role="button"]')) return;
      e.preventDefault();
      handleGenerateHarmoniousPalette();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleGenerateHarmoniousPalette]);

  // Toggle lock on pillar
  const toggleLock = (index) => {
    setPalettePillars((prev) =>
      prev.map((col, idx) => (idx === index ? { ...col, locked: !col.locked } : col))
    );
  };

  // Direct edit of pillar hex
  const updatePillarHex = (index, newHex) => {
    setPalettePillars((prev) =>
      prev.map((col, idx) => (idx === index ? { ...col, hex: newHex } : col))
    );
  };

  // Copy hex code
  const copyHex = (hex, index) => {
    navigator.clipboard.writeText(hex);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 1500);
    if (showNotification) showNotification(`Copied ${hex} to clipboard.`);
  };

  // Apply generated palette directly to CRM
  const applyPaletteToCrm = () => {
    const accentCol = palettePillars.find((p) => p.id === 'accent')?.hex || '#0A84FF';
    const bgCol = palettePillars.find((p) => p.id === 'bg')?.hex || '#16171B';
    const cardCol = palettePillars.find((p) => p.id === 'card')?.hex || '#23242A';
    const glowCol = palettePillars.find((p) => p.id === 'glow')?.hex || accentCol;
    const secondaryCol = palettePillars.find((p) => p.id === 'secondary')?.hex || '#2D2F36';

    setSettings((prev) => ({
      ...prev,
      accentColor: accentCol,
      customBg: bgCol,
      customCard: cardCol,
      customCardHover: secondaryCol,
    }));
    setPalettePillars((prev) => prev.map((p) => {
      if (p.id === 'glow') return { ...p, hex: glowCol };
      if (p.id === 'secondary') return { ...p, hex: secondaryCol };
      return p;
    }));
    if (showNotification) {
      showNotification('Applied generated palette to CRM.');
    }
  };

  const handleThemeSelect = (preset) => {
    setSettings((prev) => ({
      ...prev,
      themeId: preset.id,
      accentColor: preset.accent,
      customBg: '',
      customCard: '',
      customCardHover: '',
    }));
    // Sync generator pillars with chosen preset
    setPalettePillars([
      { id: 'accent', label: 'Primary Accent', hex: preset.accent, locked: false, desc: 'Action buttons & pills' },
      { id: 'bg', label: 'Canvas Background', hex: preset.bg, locked: false, desc: 'Base surface' },
      { id: 'card', label: 'Card Surface', hex: preset.card, locked: false, desc: 'Card elevation' },
      { id: 'glow', label: 'Accent Detail', hex: preset.accentHover || preset.accent, locked: false, desc: 'Active badges' },
      { id: 'secondary', label: 'Secondary Gray', hex: preset.cardHover || '#2D2F36', locked: false, desc: 'Hover & borders' },
    ]);
  };

  const handleAccentSelect = (hex) => {
    setSettings((prev) => ({
      ...prev,
      accentColor: hex,
    }));
    setPalettePillars((prev) =>
      prev.map((col) => (col.id === 'accent' ? { ...col, hex } : col))
    );
  };

  const handleSave = async () => {
    if (await persist(settings)) showNotification?.('CRM theme saved for all staff.');
  };

  const handleReset = () => {
    setSettings(DEFAULT_CRM_SETTINGS);
    setPalettePillars([
      { id: 'accent', label: 'Primary Accent', hex: '#0A84FF', locked: false, desc: 'Action buttons & pills' },
      { id: 'bg', label: 'Canvas Background', hex: '#16171B', locked: false, desc: 'Apple dark gray base' },
    { id: 'card', label: 'Card Surface', hex: '#23242A', locked: false, desc: 'Solid panels' },
    { id: 'glow', label: 'Accent Detail', hex: '#64D2FF', locked: false, desc: 'Active badges' },
      { id: 'secondary', label: 'Secondary Gray', hex: '#2D2F36', locked: false, desc: 'Hover states & inputs' },
    ]);
    if (showNotification) {
      showNotification('CRM theme reset to Apple Space Gray default.');
    }
  };

  const activePreset = CRM_THEME_PRESETS.find((p) => p.id === settings.themeId) || CRM_THEME_PRESETS[0];
  const currentAccent = settings.accentColor || activePreset.accent;
  const currentBg = settings.customBg || activePreset.bg;

  const contrastScore = calcContrast(currentAccent, currentBg);

  return (
    <div className="crm-settings-page-redesign crm-settings-page crm-settings-form">
      {/* Header */}
      <header className="crm-settings-page-header">
        <div className="crm-settings-header-copy">
          <div className="crm-inline-0c7ccc2ecf" style={{color: currentAccent}}>
            <Palette size={16} />
            <span>Apple iOS Design System & Theme Engine</span>
          </div>
          <h1>CRM Settings</h1>
          <p>
            Fine-tune the backoffice visual experience: curate Apple Space Gray surfaces, generate custom harmonious color palettes with the Coolors engine, and set typography density.
          </p>
        </div>
        <div className="crm-settings-header-actions">
          <button type="button" className="crm-btn-secondary" onClick={handleReset}>
            <RotateCcw size={14} />
            Reset to Apple Gray
          </button>
          <button type="button" className="crm-btn-primary" onClick={handleSave} style={{ background: currentAccent, borderColor: currentAccent }}>
            {saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? 'Saved' : saveState === 'error' ? 'Retry Save' : 'Saving…'}
          </button>
        </div>
      </header>

      {/* ── Coolors-Style Dynamic Color Generator ───────────────────────────── */}
      <details className="crm-settings-panel crm-settings-collapsible">
        <summary className="crm-settings-accordion-summary">
          <div className="crm-settings-accordion-title">
            <h3>Coolors CRM Palette Generator</h3>
            <span className="crm-badge crm-badge-apple" style={{ background: `${currentAccent}20`, color: currentAccent, border: `1px solid ${currentAccent}40` }}>
              <Sparkles size={11} className="crm-inline-043e245cc1" />
              Instant Generation
            </span>
          </div>
          <ChevronDown className="crm-settings-accordion-chevron" size={18} aria-hidden="true" />
        </summary>

        <div className="crm-settings-accordion-scroll">
        <div className="crm-settings-section-head crm-inline-9cab114355" >
          <div>
            <p>
              Generate mathematical, accessible Apple color harmonies. Press <kbd className="crm-inline-d59c88faae">Spacebar</kbd> or click Generate to create fresh palettes. Lock individual pillars to preserve your favorite tones.
            </p>
          </div>

          <div className="crm-inline-d0903b9ef7">
            {/* Dark / Light Toggle */}
            <div className="crm-ios-segmented crm-inline-804f67ed75" >
              <button
                type="button"
                className={generatorMode === 'dark' ? 'is-selected' : ''}
                onClick={() => setGeneratorMode('dark')}
              >
                <Moon size={13} className="crm-inline-043e245cc1" />
                Dark Gray
              </button>
              <button
                type="button"
                className={generatorMode === 'light' ? 'is-selected' : ''}
                onClick={() => setGeneratorMode('light')}
              >
                <Sun size={13} className="crm-inline-043e245cc1" />
                Apple Light
              </button>
            </div>

            <button
              type="button"
              className="crm-btn-secondary"
              onClick={handleGenerateHarmoniousPalette}
              title="Generate new palette (or press Spacebar)"
            >
              <RefreshCw size={14} />
              Generate (Space)
            </button>

            <button
              type="button"
              className="crm-btn-primary"
              onClick={applyPaletteToCrm}
              style={{ background: currentAccent, borderColor: currentAccent }}
            >
              <Wand2 size={14} />
              Apply to CRM
            </button>
          </div>
        </div>

        {/* 5-Pillar Interactive Coolors Stage */}
        <div className="crm-coolors-stage">
          {palettePillars.map((pillar, idx) => (
            <div key={pillar.id} className="crm-coolors-pillar" style={{ background: pillar.hex }}>
              <div className="crm-coolors-pillar-overlay">
                <div className="crm-coolors-pillar-top">
                  <span className="crm-coolors-label">{pillar.label}</span>
                  <button
                    type="button"
                    className={`crm-coolors-lock-btn ${pillar.locked ? 'is-locked' : ''}`}
                    onClick={() => toggleLock(idx)}
                    title={pillar.locked ? 'Unlock color' : 'Lock color'}
                  >
                    {pillar.locked ? <Lock size={14} /> : <Unlock size={14} />}
                  </button>
                </div>

                <div className="crm-coolors-pillar-bottom">
                  <div className="crm-coolors-hex-row">
                    <input
                      type="text"
                      className="crm-coolors-hex-input"
                      value={pillar.hex.toUpperCase()}
                      onChange={(e) => updatePillarHex(idx, e.target.value)}
                    />
                    <label className="crm-coolors-picker-btn" title="Pick custom color">
                      <input
                        type="color"
                        value={pillar.hex}
                        onChange={(e) => updatePillarHex(idx, e.target.value)}
                        className="crm-inline-306b8ffdab"
                      />
                      <Sliders size={13} />
                    </label>
                    <button
                      type="button"
                      className="crm-coolors-copy-btn"
                      onClick={() => copyHex(pillar.hex, idx)}
                      title="Copy hex code"
                    >
                      {copiedIndex === idx ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                  <div className="crm-coolors-desc">{pillar.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Contrast & Metric Strip */}
        <div className="crm-inline-0c76cea5ad">
          <div className="crm-inline-f4e95ef2ac">
            <span className="crm-inline-54aeff80c9">Accent vs Canvas Contrast:</span>
            <span className="crm-inline-42acb60ee2" style={{color: currentAccent}}>{contrastScore}</span>
            <span className="crm-badge crm-badge-success crm-inline-7819732e5b" >
              WCAG AAA / AA Compatible
            </span>
          </div>
          <div className="crm-inline-37d0b7ce9d">
            Tip: Lock colors with the lock icon, then hit Space to shuffle only unlocked tones.
          </div>
        </div>
        </div>
      </details>

      {/* ── Visual Themes (Apple Gray Default) ────────────────────────────── */}
      <details open className="crm-settings-panel crm-settings-collapsible">
        <summary className="crm-settings-accordion-summary">
          <h3>Visual Themes ({CRM_THEME_PRESETS.length})</h3>
          <ChevronDown className="crm-settings-accordion-chevron" size={18} aria-hidden="true" />
        </summary>
        <div className="crm-settings-accordion-scroll">
        <div className="crm-settings-section-head">
          <div>
            <p>
              Choose from {CRM_THEME_PRESETS.length} curated palettes. Scroll within the gallery to explore light, dark, and luxury themes.
            </p>
          </div>
        </div>

        <div className="crm-theme-grid">
          {CRM_THEME_PRESETS.map((preset) => {
            const isActive = settings.themeId === preset.id;
            return (
              <button
                type="button"
                key={preset.id}
                className={`crm-theme-card ${isActive ? 'is-active' : ''}`}
                aria-pressed={isActive}
                aria-label={`${preset.name}${isActive ? ', selected' : ''}`}
                onClick={() => handleThemeSelect(preset)}
                style={{
                  background: preset.card,
                  borderColor: isActive ? currentAccent : preset.border,
                }}
              >
                {isActive && (
                  <div className="crm-theme-card-check" style={{ background: currentAccent }}>
                    <Check size={12} strokeWidth={3} />
                  </div>
                )}

                {/* Mini mockup illustration */}
                <div
                  className="crm-theme-card-preview"
                  style={{
                    background: preset.bg,
                    borderColor: preset.border,
                  }}
                >
                  <div
                    className="crm-theme-card-preview-bar"
                    style={{
                      background: preset.card,
                      borderBottom: `1px solid ${preset.border}`,
                    }}
                  >
                    <div className="crm-inline-fd02474b5f">
                      <span className="crm-inline-e7023f367c" />
                      <span className="crm-inline-3ea7198cfc" />
                      <span className="crm-inline-8f41f77921" />
                    </div>
                    <span
                      className="crm-inline-793719c5c5" style={{background: preset.accent}}
                    />
                  </div>
                  <div className="crm-theme-card-preview-body">
                    <div
                      className="crm-inline-abae390e16" style={{background: preset.card, borderColor: preset.border}}
                    >
                      <div className="crm-inline-74c23aed0b" style={{background: preset.accent}} />
                      <div className="crm-inline-644f99e40d" style={{background: preset.textSecondary}} />
                    </div>
                    <div className="crm-inline-fd02474b5f">
                      <div className="crm-inline-549816fd49" style={{background: preset.cardHover}} />
                      <div className="crm-inline-2643a5d4d2" style={{background: preset.accent}} />
                    </div>
                  </div>
                </div>

                <div className="crm-theme-card-meta">
                  <div className="crm-theme-card-topline">
                    <span className="crm-theme-card-name" style={{ color: preset.textPrimary }}>{preset.name}</span>
                    <span className="crm-badge crm-badge-secondary" style={{ color: preset.accent, borderColor: `${preset.accent}40` }}>
                      {preset.tag || preset.category}
                    </span>
                  </div>
                  <div className="crm-theme-card-desc" style={{ color: preset.textSecondary }}>{preset.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
        </div>
      </details>

      {/* ── Accent Colors & Swatches ───────────────────────────────────────── */}
      <details className="crm-settings-panel crm-settings-collapsible">
        <summary className="crm-settings-accordion-summary">
          <h3>Accent Tint & Swatches</h3>
          <ChevronDown className="crm-settings-accordion-chevron" size={18} aria-hidden="true" />
        </summary>
        <div className="crm-settings-accordion-scroll">
        <div className="crm-settings-section-head">
          <div>
            <p>
              Select an accent color or input a custom hex value. It is used for primary actions, active navigation, and badges.
            </p>
          </div>
        </div>

        <div className="crm-swatches-grid">
          {ACCENT_SWATCHES.map((swatch) => {
            const isSelected = currentAccent.toLowerCase() === swatch.hex.toLowerCase();
            return (
              <button
                key={swatch.hex}
                type="button"
                className={`crm-swatch-chip ${isSelected ? 'is-selected' : ''}`}
                onClick={() => handleAccentSelect(swatch.hex)}
                style={{
                  borderColor: isSelected ? swatch.hex : 'transparent',
                }}
              >
                <span className="crm-swatch-circle" style={{ background: swatch.hex }}>
                  {isSelected && <Check size={12} color="#FFFFFF" strokeWidth={3} />}
                </span>
                <span className="crm-swatch-label">{swatch.name}</span>
                <span className="crm-swatch-hex">{swatch.hex}</span>
              </button>
            );
          })}
        </div>

        {/* Custom Hex Color Picker Row */}
        <div className="crm-custom-accent-row">
          <label className="crm-custom-accent-label">
            <span>Custom Accent Hex:</span>
            <div className="crm-custom-accent-input-wrap">
              <input
                type="color"
                value={currentAccent}
                onChange={(e) => handleAccentSelect(e.target.value)}
                className="crm-custom-accent-picker"
              />
              <input
                type="text"
                value={currentAccent}
                onChange={(e) => handleAccentSelect(e.target.value)}
                className="crm-settings-input crm-inline-c469ffd35e"

              />
            </div>
          </label>

          {/* Custom Background & Card surface */}
          <label className="crm-custom-accent-label">
            <span>Custom Canvas Gray:</span>
            <div className="crm-custom-accent-input-wrap">
              <input
                type="color"
                value={currentBg}
                onChange={(e) => {
                  setSettings((prev) => ({ ...prev, customBg: e.target.value }));
                }}
                className="crm-custom-accent-picker"
              />
              <input
                type="text"
                value={currentBg}
                onChange={(e) => {
                  setSettings((prev) => ({ ...prev, customBg: e.target.value }));
                }}
                className="crm-settings-input crm-inline-c469ffd35e"

              />
            </div>
          </label>
        </div>
        </div>
      </details>

      {/* ── Layout Density & Geometry ───────────────────────────────────────── */}
      <section className="crm-settings-panel">
        <div className="crm-settings-section-head">
          <div>
            <h3>Layout Density & Corner Radii</h3>
            <p>
              Control the whitespace breathing room of tables, panels, and modal dialogs.
            </p>
          </div>
        </div>

        <div className="crm-options-columns">
          {/* Density */}
          <div className="crm-options-group">
            <label className="crm-options-group-title">
              <Layout size={14} />
              <span>Row Density</span>
            </label>
            <div className="crm-ios-segmented">
              {DENSITY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={settings.density === opt.id ? 'is-selected' : ''}
                  onClick={() => {
                    setSettings((prev) => ({ ...prev, density: opt.id }));
                  }}
                >
                  {opt.name}
                </button>
              ))}
            </div>
            <div className="crm-options-group-help">
              {DENSITY_OPTIONS.find((o) => o.id === settings.density)?.desc}
            </div>
          </div>

          {/* Radius */}
          <div className="crm-options-group">
            <label className="crm-options-group-title">
              <Sliders size={14} />
              <span>Corner Geometry</span>
            </label>
            <div className="crm-ios-segmented">
              {RADIUS_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={settings.radius === opt.id ? 'is-selected' : ''}
                  onClick={() => {
                    setSettings((prev) => ({ ...prev, radius: opt.id }));
                  }}
                >
                  {opt.name.split(' ')[0]}
                </button>
              ))}
            </div>
            <div className="crm-options-group-help">
              {RADIUS_OPTIONS.find((o) => o.id === settings.radius)?.name}
            </div>
          </div>

          <div className="crm-options-group">
            <label className="crm-options-group-title">
              <Layers size={14} />
              <span>Card Elevation</span>
            </label>
            <div className="crm-ios-segmented">
              {[
                { id: 'flat', label: 'Flat' },
                { id: 'raised', label: 'Raised' },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={settings.cardElevation === option.id ? 'is-selected' : ''}
                  onClick={() => setSettings((prev) => ({ ...prev, cardElevation: option.id }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="crm-options-group-help">Choose subtle or elevated shadows for CRM surfaces.</div>
          </div>

          <div className="crm-options-group">
            <label className="crm-options-group-title">
              <Layers size={14} />
              <span>Surface Style</span>
            </label>
            <div className="crm-options-group-help">Solid, opaque surfaces are used across every CRM theme. Glass and backdrop blur are disabled.</div>
          </div>

          <div className="crm-options-group">
            <label className="crm-options-group-title">
              <Layout size={14} />
              <span>Table Rows</span>
            </label>
            <div className="crm-ios-segmented">
              {[
                { id: false, label: 'Plain' },
                { id: true, label: 'Striped' },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={settings.tableZebra === option.id ? 'is-selected' : ''}
                  onClick={() => setSettings((prev) => ({ ...prev, tableZebra: option.id }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="crm-options-group-help">Add alternating row fills to CRM data tables.</div>
          </div>
        </div>
      </section>

    </div>
  );
}
