import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import './search-autocomplete.css';

/**
 * @typedef {{ key?: string | number, value: string, label: string, meta?: string }} SearchSuggestion
 * @typedef {Object} SearchAutocompleteProps
 * @property {string} value
 * @property {(value: string) => void} onChange
 * @property {string} [placeholder]
 * @property {string} [className]
 * @property {React.CSSProperties} [style]
 * @property {string} [autoComplete]
 * @property {(query: string) => SearchSuggestion[]} [buildSuggestions]
 * @property {(query: string, options: { limit: number }) => Promise<SearchSuggestion[]>} [fetchSuggestions]
 * @property {(suggestion: SearchSuggestion) => void} [onSelect]
 * @property {number} [maxSuggestions]
 * @property {React.InputHTMLAttributes<HTMLInputElement>} [inputProps]
 */

/** @param {SearchAutocompleteProps} props */
export function SearchAutocomplete({
  value,
  onChange,
  placeholder,
  className = '',
  style,
  autoComplete = 'off',
  buildSuggestions,
  fetchSuggestions = null,
  onSelect = null,
  maxSuggestions = 8,
  inputProps = {},
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [remoteSuggestions, setRemoteSuggestions] = useState([]);
  const wrapRef = useRef(null);
  const requestRef = useRef(0);
  const listboxId = useId();

  const localSuggestions = useMemo(() => {
    const query = (value || '').trim();
    if (!query || !buildSuggestions) return [];
    return (buildSuggestions(query) || []).slice(0, maxSuggestions);
  }, [value, buildSuggestions, maxSuggestions]);

  useEffect(() => {
    if (!fetchSuggestions) return undefined;

    const query = (value || '').trim();
    const requestId = ++requestRef.current;
    if (!query) {
      setRemoteSuggestions([]);
      return undefined;
    }
    setRemoteSuggestions([]);

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await fetchSuggestions(query, { limit: maxSuggestions });
        if (!cancelled && requestId === requestRef.current) {
          setRemoteSuggestions(Array.isArray(result) ? result.slice(0, maxSuggestions) : []);
        }
      } catch (error) {
        if (!cancelled && requestId === requestRef.current) setRemoteSuggestions([]);
        if (!cancelled) console.error('Search suggestions could not be loaded:', error);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, fetchSuggestions, maxSuggestions]);

  const suggestions = fetchSuggestions ? remoteSuggestions : localSuggestions;

  useEffect(() => {
    function onClickOutside(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (highlight >= suggestions.length) setHighlight(-1);
  }, [suggestions, highlight]);

  const showDropdown = open && suggestions.length > 0;
  const pick = (suggestion) => {
    if (!suggestion) return;
    onChange(suggestion.value);
    onSelect?.(suggestion);
    setOpen(false);
    setHighlight(-1);
  };

  return (
    <div
      ref={wrapRef}
      className="crm-search-autocomplete"
      style={{ flex: style?.flex ?? 1, minWidth: style?.minWidth ?? 0, maxWidth: style?.maxWidth, width: style?.width }}
    >
      <input
        {...inputProps}
        className={className}
        placeholder={placeholder}
        value={value}
        autoComplete={autoComplete}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={showDropdown ? listboxId : undefined}
        aria-activedescendant={showDropdown && highlight >= 0 ? `${listboxId}-option-${highlight}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && suggestions.length > 0) {
            event.preventDefault();
            setOpen(true);
            setHighlight((current) => Math.min(current + 1, suggestions.length - 1));
          } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
            event.preventDefault();
            setHighlight((current) => Math.max(current - 1, 0));
          } else if (event.key === 'Enter' && showDropdown && highlight >= 0) {
            event.preventDefault();
            pick(suggestions[highlight]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
          inputProps.onKeyDown?.(event);
        }}
        style={{ ...style, width: '100%' }}
      />
      {showDropdown && (
        <div className="crm-search-suggest" id={listboxId} role="listbox">
          {suggestions.map((suggestion, index) => (
            <button
              type="button"
              id={`${listboxId}-option-${index}`}
              key={suggestion.key != null ? suggestion.key : `${suggestion.value}-${index}`}
              role="option"
              aria-selected={index === highlight}
              className={`crm-search-suggest-item${index === highlight ? ' is-active' : ''}`}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(suggestion);
              }}
            >
              <span className="crm-search-suggest-label">{suggestion.label}</span>
              {suggestion.meta != null && suggestion.meta !== '' && (
                <span className="crm-search-suggest-meta">{suggestion.meta}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default SearchAutocomplete;
