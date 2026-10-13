function appendClassNames(result, value) {
  if (!value) return;
  if (typeof value === 'string' || typeof value === 'number') {
    result.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => appendClassNames(result, item));
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([className, enabled]) => {
      if (enabled) result.push(className);
    });
  }
}

export function crmClassName(...values) {
  const classNames = [];
  values.forEach((value) => appendClassNames(classNames, value));
  return classNames.join(' ');
}
