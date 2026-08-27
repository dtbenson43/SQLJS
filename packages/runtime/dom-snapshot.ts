// Normalized DOM tree serialization.
// Produces a stable, comparable structure so two DOM trees can be deep-compared
// regardless of element identity. Used by interpreter/compiler differential tests.

export interface DomSnapshot {
  id: string;
  tag: string;
  text: string;
  class: string;
  attributes: Record<string, string>;
  dataset: Record<string, string>;
  style: Record<string, string>;
  children: DomSnapshot[];
}

export interface DomSnapshotOptions {
  /** Properties to include beyond identity/content. */
  includeStyle?: boolean;
  includeDataset?: boolean;
}

function sortKeys(object: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(object).sort()) sorted[key] = object[key]!;
  return sorted;
}

/** Serialize a DOM tree into a comparable structure. */
export function serializeDom(root: Document | Element, options: DomSnapshotOptions = {}): DomSnapshot[] {
  const includeStyle = options.includeStyle ?? true;
  const includeDataset = options.includeDataset ?? true;

  const toSnapshot = (element: Element): DomSnapshot => {
    const htmlElement = element as HTMLElement;
    const attributes: Record<string, string> = {};
    for (const attr of Array.from(element.attributes ?? [])) attributes[attr.name] = attr.value;

    const dataset: Record<string, string> = {};
    if (includeDataset && htmlElement.dataset) Object.assign(dataset, htmlElement.dataset);

    const style: Record<string, string> = {};
    if (includeStyle && htmlElement.style) {
      const styleObj = htmlElement.style as unknown as Record<string, string>;
      for (const key of Object.keys(styleObj)) {
        const value = styleObj[key];
        if (typeof value === "string" && value.length > 0) style[key] = value;
      }
      // Also support CSSStyleDeclaration-like objects
      if (typeof (htmlElement.style as unknown as { length?: number }).length === "number") {
        const decl = htmlElement.style as unknown as CSSStyleDeclaration;
        for (let i = 0; i < decl.length; i++) {
          const prop = decl.item(i);
          if (prop) style[prop] = decl.getPropertyValue(prop);
        }
      }
    }

    return {
      id: element.id || "",
      tag: element.tagName,
      text: element.textContent ?? "",
      class: htmlElement.className ?? "",
      attributes: sortKeys(attributes),
      dataset: sortKeys(dataset),
      style: sortKeys(style),
      children: Array.from(element.children ?? []).map(toSnapshot),
    };
  };

  // Snapshot the document's top-level children (head + body, or body children).
  const children: Element[] = [];
  if (typeof Document !== "undefined" && root instanceof Document) {
    const doc = root as unknown as Document;
    if (doc.body) children.push(doc.body);
    if (doc.head) children.push(doc.head);
  } else {
    children.push(root as Element);
  }
  return children.map(toSnapshot);
}

/** Deep-compare two DOM snapshots with a human-readable diff message. */
export function domSnapshotsEqual(a: DomSnapshot[], b: DomSnapshot[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
