import { ElementSelector, PropertyPath, QuerySource } from "../language/ast";

export interface ElementRow {
  element: Element;
  id: string | null;
  tag: string;
  text: string | null;
  html: string;
  class: string;
  value: unknown;
  name: string | null;
  type: string | null;
  hidden: boolean | null;
  disabled: boolean | null;
  checked: boolean | null;
  parent: Element | null;
  parentId: string | null;
  attributes: Record<string, string>;
  dataset: Record<string, string>;
  style: Record<string, string>;
  computedStyle: Record<string, string>;
  [key: string]: unknown;
}

/** Adapt one DOM element to the relational row exposed by Elements. */
export function elementToRow(element: Element): ElementRow {
  const htmlElement = element as HTMLElement & {
    value?: unknown;
    name?: string;
    type?: string;
    hidden?: boolean;
    disabled?: boolean;
    checked?: boolean;
  };
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes || [])) attributes[attribute.name] = attribute.value;

  const dataset: Record<string, string> = {};
  if (htmlElement.dataset) Object.assign(dataset, htmlElement.dataset);

  return {
    element,
    id: element.id || null,
    tag: element.tagName,
    text: element.textContent,
    html: element.innerHTML,
    class: htmlElement.className || "",
    value: htmlElement.value,
    name: htmlElement.name || null,
    type: htmlElement.type || null,
    hidden: typeof htmlElement.hidden === "boolean" ? htmlElement.hidden : null,
    disabled: typeof htmlElement.disabled === "boolean" ? htmlElement.disabled : null,
    checked: typeof htmlElement.checked === "boolean" ? htmlElement.checked : null,
    parent: element.parentElement,
    parentId: element.parentElement?.id || null,
    attributes,
    dataset,
    style: styleToRecord(htmlElement.style),
    computedStyle: computedStyleToRecord(element),
  };
}

/** Read a mapped or nested property from an element. */
export function getElementProperty(element: Element, path: PropertyPath | string): unknown {
  const segments = typeof path === "string" ? path.split(".") : path.segments.map((segment) => segment.name);
  if (segments.length === 0) return undefined;
  const [first, ...rest] = segments;
  const htmlElement = element as HTMLElement & Record<string, unknown>;

  switch (first!.toLowerCase()) {
    case "element": return rest.length === 0 ? element : undefined;
    case "id": return element.id || null;
    case "tag": return element.tagName;
    case "text": return element.textContent;
    case "html": return element.innerHTML;
    case "class": return htmlElement.className || "";
    case "value": return rest.length === 0 ? htmlElement.value : undefined;
    case "name": return htmlElement.getAttribute("name");
    case "type": return htmlElement.getAttribute("type");
    case "hidden": return "hidden" in htmlElement ? htmlElement.hidden : null;
    case "disabled": return "disabled" in htmlElement ? htmlElement.disabled : null;
    case "checked": return "checked" in htmlElement ? htmlElement.checked : null;
    case "parent": return rest.length === 0 ? element.parentElement : undefined;
    case "parentid": return element.parentElement?.id || null;
    case "attributes": return rest.length === 1 ? element.getAttribute(rest[0]!) : nestedValue(attributeRecord(element), rest);
    case "dataset": return nestedValue((htmlElement.dataset ?? {}) as Record<string, unknown>, rest);
    case "style": return nestedValue(htmlElement.style, rest);
    case "computedstyle": return nestedValue(computedStyleToRecord(element), rest);
    default: return nestedValue(htmlElement, segments);
  }
}

/** Apply a mapped or nested property and return its previous value. */
export function setElementProperty(element: Element, path: PropertyPath | string, value: unknown): unknown {
  const segments = typeof path === "string" ? path.split(".") : path.segments.map((segment) => segment.name);
  const previous = getElementProperty(element, path);
  const [first, ...rest] = segments;
  const htmlElement = element as HTMLElement & Record<string, unknown>;

  switch (first!.toLowerCase()) {
    case "text": element.textContent = value == null ? "" : String(value); break;
    case "html": element.innerHTML = value == null ? "" : String(value); break;
    case "class": htmlElement.className = value == null ? "" : String(value); break;
    case "value": htmlElement.value = value; break;
    case "name": setOrRemoveAttribute(element, "name", value); break;
    case "type": setOrRemoveAttribute(element, "type", value); break;
    case "hidden": setBooleanProperty(htmlElement, "hidden", value); break;
    case "disabled": setBooleanProperty(htmlElement, "disabled", value); break;
    case "checked": setBooleanProperty(htmlElement, "checked", value); break;
    case "attributes": setOrRemoveAttribute(element, rest.join("."), value); break;
    case "style":
      if (rest.length === 0) setOrRemoveAttribute(element, "style", value);
      else setNested(htmlElement.style as unknown as Record<string, unknown>, rest, value);
      break;
  }
  return previous;
}

/** Resolve the elements represented by a parsed FROM source. */
export function resolveElementSource(root: Document | Element, source: QuerySource): Element[] {
  if (source.type === "global") {
    if (source.table && source.table.toUpperCase() !== "ELEMENTS") throw new Error(`Unknown element table: ${source.table}`);
    return Array.from(root.querySelectorAll("*"));
  }

  const selected = resolveSelector(root, source.selector);
  if (source.type === "scoped" || source.type === "descendants") {
    return selected.flatMap((element) => Array.from(element.querySelectorAll("*")));
  }
  if (source.type === "children") return selected.flatMap((element) => Array.from(element.children));
  return selected.map((element) => element.parentElement).filter((element) => element !== null) as Element[];
}

export function resolveSelector(root: Document | Element, selector: ElementSelector): Element[] {
  if (selector.kind === "id") {
    const doc = (root.ownerDocument ?? root) as Document;
    const element = typeof doc.getElementById === "function" ? doc.getElementById(selector.value) : null;
    if (element) return [element];
    try {
      const el = root.querySelector?.(`#${cssEscape(selector.value)}`);
      if (el) return [el];
    } catch {
      // ignore
    }
    if ((root as Element).id === selector.value) return [root as Element];
    return [];
  }
  if (selector.kind === "class") {
    const matches = Array.from(root.querySelectorAll(`.${cssEscape(selector.value)}`));
    const rootCls = (root as HTMLElement).className || "";
    if (rootCls.split(/\s+/).includes(selector.value) && !matches.includes(root as Element)) {
      matches.unshift(root as Element);
    }
    return matches;
  }
  const matches = Array.from(root.querySelectorAll(selector.value));
  if ((root as Element).tagName?.toUpperCase() === selector.value.toUpperCase() && !matches.includes(root as Element)) {
    matches.unshift(root as Element);
  }
  return matches;
}

function attributeRecord(element: Element): Record<string, string> {
  const result: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes || [])) result[attribute.name] = attribute.value;
  return result;
}

function styleToRecord(style: any): Record<string, string> {
  if (!style) return {};
  // CSSStyleDeclaration
  if (typeof style.length === "number" && typeof style.item === "function") {
    const result: Record<string, string> = {};
    for (let i = 0; i < style.length; i++) {
      const property = style.item(i);
      if (property) result[property] = style.getPropertyValue(property);
    }
    return result;
  }
  // Plain object (test mock)
  const result: Record<string, string> = {};
  for (const key of Object.keys(style)) {
    const val = style[key];
    if (typeof val === "string") result[key] = val;
  }
  return result;
}

function computedStyleToRecord(element: Element): Record<string, string> {
  const ownerDocument = element.ownerDocument as Document | null;
  const view = ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === "function") return styleToRecord(view.getComputedStyle(element));
  return styleToRecord((element as HTMLElement).style);
}

function nestedValue(object: unknown, segments: string[]): unknown {
  let value: unknown = object;
  for (const segment of segments) {
    if (value == null || (typeof value !== "object" && typeof value !== "function")) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function setNested(object: unknown, segments: string[], value: unknown): void {
  if (segments.length === 0 || object == null) return;
  let target = object as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    const next = target[segment];
    if (next == null || (typeof next !== "object" && typeof next !== "function")) return;
    target = next as Record<string, unknown>;
  }
  target[segments[segments.length - 1]!] = value;
}

function setOrRemoveAttribute(element: Element, name: string, value: unknown): void {
  if (value == null) {
    if (typeof element.removeAttribute === "function") element.removeAttribute(name);
  } else {
    if (typeof element.setAttribute === "function") element.setAttribute(name, String(value));
  }
}

function setBooleanProperty(element: Record<string, unknown>, name: string, value: unknown): void {
  element[name] = value === true || value === 1 || value === "true";
}

function cssEscape(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}
