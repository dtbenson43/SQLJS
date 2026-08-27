// Minimal DOM mock shared by runtime and compiler tests.
// Avoids a jsdom dependency while exercising the full element adapter surface.

export interface MockElement {
  id: string;
  tagName: string;
  textContent: string | null;
  innerHTML: string;
  className: string;
  hidden: boolean;
  disabled: boolean;
  checked: boolean;
  value: unknown;
  name: string | null;
  type: string | null;
  parentElement: MockElement | null;
  nextSibling: MockElement | null;
  children: MockElement[];
  attributes: { name: string; value: string }[];
  dataset: Record<string, string>;
  style: Record<string, string>;
  ownerDocument: MockDocument | null;
  classList: { contains(c: string): boolean };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  appendChild(child: MockElement): MockElement;
  removeChild(child: MockElement): MockElement;
  insertBefore(child: MockElement, ref: MockElement | null): MockElement;
  querySelectorAll(selector: string): MockElement[];
}

export interface MockDocument {
  createElement(tag: string): MockElement;
  getElementById(id: string): MockElement | null;
  querySelectorAll(selector: string): MockElement[];
  body: MockElement | null;
  ownerDocument: null;
}

const registry: Map<string, MockElement> = new Map();
let anon = 0;

export function makeMockDoc(): MockDocument {
  registry.clear();
  anon = 0;

  const doc: MockDocument = {} as any;

  function makeElement(tag: string, props?: Partial<MockElement>): MockElement {
    const el: MockElement = {
      id: props?.id ?? "",
      tagName: tag.toUpperCase(),
      textContent: props?.textContent ?? null,
      innerHTML: props?.innerHTML ?? "",
      className: props?.className ?? "",
      hidden: props?.hidden ?? false,
      disabled: props?.disabled ?? false,
      checked: props?.checked ?? false,
      value: props?.value ?? "",
      name: props?.name ?? null,
      type: props?.type ?? null,
      parentElement: null,
      nextSibling: null,
      children: [],
      attributes: [],
      dataset: {},
      style: {},
      ownerDocument: doc,
      classList: {
        contains(c: string) { return el.className.split(/\s+/).includes(c); },
      },
      getAttribute(name) {
        const a = this.attributes.find((a) => a.name === name.toLowerCase());
        return a ? a.value : null;
      },
      setAttribute(name, value) {
        const a = this.attributes.find((a) => a.name === name.toLowerCase());
        if (a) a.value = value;
        else this.attributes.push({ name: name.toLowerCase(), value });
      },
      removeAttribute(name) {
        this.attributes = this.attributes.filter((a) => a.name !== name.toLowerCase());
      },
      appendChild(child) {
        if (child.parentElement) child.parentElement.removeChild(child);
        child.parentElement = this;
        child.ownerDocument = doc;
        if (this.children.length > 0) {
          this.children[this.children.length - 1]!.nextSibling = child;
        }
        this.children.push(child);
        const key = child.id || ("__anon_" + (anon++));
        registry.set(key, child);
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        child.parentElement = null;
        child.nextSibling = null;
        return child;
      },
      insertBefore(child, ref) {
        if (child.parentElement) child.parentElement.removeChild(child);
        child.parentElement = this;
        child.ownerDocument = doc;
        const idx = ref ? this.children.indexOf(ref) : this.children.length;
        if (idx < 0) this.children.push(child);
        else this.children.splice(idx, 0, child);
        const key = child.id || ("__anon_" + (anon++));
        registry.set(key, child);
        return child;
      },
      querySelectorAll(selector) {
        const results: MockElement[] = [];
        const collect = (n: MockElement) => {
          if (matchSelector(n, selector)) results.push(n);
          for (const c of n.children) collect(c);
        };
        for (const c of this.children) collect(c);
        return results;
      },
    };
    if (el.id) registry.set(el.id, el);
    return el;
  }

  doc.createElement = (tag: string) => makeElement(tag);
  doc.getElementById = (id: string) => registry.get(id) ?? null;
  doc.querySelectorAll = (selector: string) => doc.body?.querySelectorAll(selector) ?? [];
  doc.body = makeElement("BODY", { id: "__body" });
  doc.ownerDocument = null;

  return doc;
}

function matchSelector(el: MockElement, selector: string): boolean {
  if (selector === "*") return true;
  if (selector.startsWith("#")) return el.id === selector.slice(1);
  if (selector.startsWith(".")) {
    const cls = selector.slice(1);
    return el.className.split(/\s+/).includes(cls);
  }
  return el.tagName === selector.toUpperCase();
}
