const IGNORED_TAGS = new Set([
  "BR",
  "CANVAS",
  "IFRAME",
  "IMG",
  "INPUT",
  "SCRIPT",
  "SELECT",
  "STYLE",
  "SVG",
  "TEXTAREA",
  "VIDEO",
]);

function getCopyScope(element: HTMLElement, root: HTMLElement) {
  const section = element.closest<HTMLElement>("[data-section-id]");
  return section && root.contains(section)
    ? { element: section, prefix: `section:${encodeURIComponent(section.dataset.sectionId || "")}` }
    : { element: root, prefix: "site" };
}

function getElementPath(element: HTMLElement, scope: HTMLElement) {
  const segments: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== scope) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.children, current);
    if (index < 0) return null;
    segments.unshift(`${current.tagName.toLowerCase()}-${index}`);
    current = parent;
  }

  return current === scope ? segments.join("/") : null;
}

function getCopyKey(element: HTMLElement, root: HTMLElement) {
  const { element: scope, prefix } = getCopyScope(element, root);
  const path = getElementPath(element, scope);
  return path ? `${prefix}:${path}` : null;
}

function isEditableTextElement(element: HTMLElement) {
  if (
    IGNORED_TAGS.has(element.tagName) ||
    element.closest(".custom-code-injection, [aria-hidden='true']") ||
    (element.isContentEditable && !element.dataset.codexCopyEditable)
  ) {
    return false;
  }

  if (Array.from(element.children).some((child) => child.tagName !== "BR")) return false;
  return true;
}

function getTextElements(root: HTMLElement, overrides: Record<string, string>) {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).filter((element) => {
    if (!isEditableTextElement(element)) return false;
    const key = getCopyKey(element, root);
    return Boolean(element.textContent?.trim()) ||
      Boolean(key && Object.prototype.hasOwnProperty.call(overrides, key)) ||
      element.dataset.codexCopyEditable === "true";
  });
}

export function applySiteCopyOverrides(
  root: HTMLElement,
  overrides: Record<string, string>,
  editing: boolean,
) {
  for (const element of getTextElements(root, overrides)) {
    const key = getCopyKey(element, root);
    if (!key) continue;

    const override = overrides[key];
    if (
      typeof override === "string" &&
      element !== document.activeElement &&
      element.textContent !== override
    ) {
      element.textContent = override;
    }

    if (editing) {
      if (element !== document.activeElement) {
        element.dataset.codexCopyOriginal = element.textContent || "";
      }
      element.contentEditable = "true";
      element.spellcheck = false;
      element.dataset.codexCopyEditable = "true";
      element.dataset.codexCopyKey = key;
    } else if (element.dataset.codexCopyEditable) {
      element.removeAttribute("contenteditable");
      element.removeAttribute("spellcheck");
      delete element.dataset.codexCopyEditable;
      delete element.dataset.codexCopyKey;
      delete element.dataset.codexCopyOriginal;
    }
  }
}
