// Runtime tests for SELECT, UPDATE, INSERT, DELETE, transactions, triggers
import { describe, expect, it } from "vitest";
import { elementToRow, resolveElementSource, setElementProperty, getElementProperty } from "../../runtime/element-row";

// -- Minimal DOM mock shared by all tests -------------------------

/** Registry of all elements by id for getElementById lookups. */
const elementRegistry: Map<string, MockElement> = new Map();

interface MockElement {
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
  querySelectorAll(selector: string): MockElement[];
}

interface MockDocument {
  createElement(tag: string): MockElement;
  getElementById(id: string): MockElement | null;
  querySelectorAll(selector: string): MockElement[];
  body: MockElement | null;
  ownerDocument: null;
}

let nextAnon = 0;

function makeMockDoc(): MockDocument {
  elementRegistry.clear();
  nextAnon = 0;

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
        this.children.push(child);
        const key = child.id || ("__anon_" + (nextAnon++));
        elementRegistry.set(key, child);
        return child;
      },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        child.parentElement = null;
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
    if (el.id) elementRegistry.set(el.id, el);
    return el;
  }

  doc.createElement = (tag: string) => makeElement(tag);
  doc.getElementById = (id: string) => elementRegistry.get(id) ?? null;
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

// -- Tests --------------------------------------------------------

describe("Element row adapter", () => {
  it("maps element properties", () => {
    const doc = makeMockDoc();
    const el = doc.createElement("BUTTON");
    el.id = "btn";
    el.textContent = "Click me";
    el.className = "primary";
    el.disabled = true;
    el.setAttribute("aria-label", "Submit");

    const row = elementToRow(el as any);
    expect(row.id).toBe("btn");
    expect(row.tag).toBe("BUTTON");
    expect(row.text).toBe("Click me");
    expect(row.class).toBe("primary");
    expect(row.disabled).toBe(true);
    expect(row.attributes["aria-label"]).toBe("Submit");
  });

  it("reads and writes nested properties", () => {
    const doc = makeMockDoc();
    const el = doc.createElement("DIV");
    (el as any).style = { color: "black", fontSize: "12px" };

    expect(getElementProperty(el as any, "style.color")).toBe("black");
    setElementProperty(el as any, "style.color", "red");
    expect((el as any).style.color).toBe("red");
    expect(getElementProperty(el as any, "style.color")).toBe("red");
  });

  it("resolves scoped element sources", () => {
    const doc = makeMockDoc();
    const parent = doc.createElement("DIV");
    parent.id = "container";
    doc.body!.appendChild(parent);

    const child1 = doc.createElement("SPAN"); child1.id = "child1";
    const child2 = doc.createElement("SPAN"); child2.id = "child2";
    parent.appendChild(child1);
    parent.appendChild(child2);

    // Global (all elements except body itself, since we query body's children)
    const globalResult = resolveElementSource(doc as any, { type: "global", span: {} as any });
    expect(globalResult.length).toBe(3); // parent, child1, child2

    // Scoped by #id
    const scoped = resolveElementSource(doc as any, {
      type: "scoped",
      selector: { type: "element_selector", span: {} as any, kind: "id", value: "container" },
      span: {} as any,
    });
    expect(scoped.length).toBe(2); // child1, child2
  });
});

describe("Runtime execute (end-to-end)", () => {
  // Dynamic import to avoid circular deps
  async function exec(sql: string, doc?: MockDocument) {
    const { execute } = await import("../../runtime/execute");
    const root = doc ?? makeMockDoc();
    return execute(sql, { root: root as any });
  }

  it("executes SELECT * FROM Elements", async () => {
    const doc = makeMockDoc();
    const div = doc.createElement("DIV"); div.id = "app"; doc.body!.appendChild(div);
    const btn = doc.createElement("BUTTON"); btn.id = "save"; btn.textContent = "Save"; btn.className = "primary";
    doc.body!.appendChild(btn);

    const result = await exec("SELECT * FROM Elements", doc);
    expect(result.rows.length).toBe(2);
    const saveRow = result.rows.find((r: any) => r.id === "save");
    expect(saveRow).toBeDefined();
    if (saveRow) {
      expect(saveRow.tag).toBe("BUTTON");
      expect(saveRow.text).toBe("Save");
    }
  });

  it("executes SELECT with column projection", async () => {
    const doc = makeMockDoc();
    const btn = doc.createElement("BUTTON"); btn.id = "btn1"; btn.textContent = "Hi";
    doc.body!.appendChild(btn);

    const result = await exec("SELECT id, tag, text FROM Elements WHERE tag = 'BUTTON'", doc);
    expect(result.rows.length).toBe(1);
    expect(result.columns).toContain("id");
    expect(result.columns).toContain("tag");
    expect(result.columns).toContain("text");
  });

  it("executes UPDATE with SET", async () => {
    const doc = makeMockDoc();
    const div = doc.createElement("DIV"); div.id = "msg"; div.textContent = "Hello";
    doc.body!.appendChild(div);

    const result = await exec("UPDATE FROM Elements SET text = 'Goodbye' WHERE id = 'msg'", doc);
    expect(result.affectedRows).toBe(1);
    expect(div.textContent).toBe("Goodbye");
  });

  it("executes INSERT INTO", async () => {
    const doc = makeMockDoc();
    const container = doc.createElement("DIV"); container.id = "list";
    doc.body!.appendChild(container);

    const result = await exec(
      "INSERT INTO #list (tag, class, text) VALUES ('li', 'item', 'Buy milk')",
      doc
    );
    expect(result.affectedRows).toBe(1);
    expect(container.children.length).toBe(1);
    expect(container.children[0]!.tagName).toBe("LI");
    expect(container.children[0]!.textContent).toBe("Buy milk");
  });

  it("executes DELETE FROM", async () => {
    const doc = makeMockDoc();
    const div = doc.createElement("DIV"); div.id = "todelete";
    doc.body!.appendChild(div);
    expect(doc.body!.children.length).toBe(1);

    const result = await exec("DELETE FROM Elements WHERE id = 'todelete'", doc);
    expect(result.affectedRows).toBe(1);
    expect(doc.body!.children.length).toBe(0);
  });

  it("executes BEGIN TRANSACTION / COMMIT", async () => {
    const doc = makeMockDoc();
    const div = doc.createElement("DIV"); div.id = "txn"; div.textContent = "Original";
    doc.body!.appendChild(div);

    await exec("BEGIN TRANSACTION; UPDATE FROM Elements SET text = 'Changed' WHERE id = 'txn'; COMMIT", doc);
    expect(div.textContent).toBe("Changed");
  });

  it("executes BEGIN TRANSACTION / ROLLBACK", async () => {
    const doc = makeMockDoc();
    const div = doc.createElement("DIV"); div.id = "txn2"; div.textContent = "Original";
    doc.body!.appendChild(div);

    await exec("BEGIN TRANSACTION; UPDATE FROM Elements SET text = 'Changed' WHERE id = 'txn2'; ROLLBACK", doc);
    expect(div.textContent).toBe("Original");
  });

  it("reports parse errors gracefully", async () => {
    const doc = makeMockDoc();
    const result = await exec("SELEC * FROM Elements", doc);
    const errors = result.messages.filter((m: any) => m.level === "error");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("handles WHERE with LIKE", async () => {
    const doc = makeMockDoc();
    const div = doc.createElement("DIV"); div.className = "error-message";
    doc.body!.appendChild(div);

    const result = await exec("SELECT * FROM Elements WHERE class LIKE '%error%'", doc);
    expect(result.rows.length).toBe(1);
  });

  it("reports multiple independent statements", async () => {
    const doc = makeMockDoc();
    const d1 = doc.createElement("DIV"); d1.id = "a"; d1.textContent = "";
    const d2 = doc.createElement("DIV"); d2.id = "b"; d2.textContent = "";
    doc.body!.appendChild(d1);
    doc.body!.appendChild(d2);

    const result = await exec(
      "UPDATE FROM Elements SET text = 'X' WHERE id = 'a'; UPDATE FROM Elements SET text = 'Y' WHERE id = 'b'",
      doc
    );
    expect(d1.textContent).toBe("X");
    expect(d2.textContent).toBe("Y");
    expect(result.affectedRows).toBe(2);
  });

  it("restores deleted elements upon ROLLBACK", async () => {
    const doc = makeMockDoc();
    const div = doc.createElement("DIV"); div.id = "preserved"; div.textContent = "Keep me";
    doc.body!.appendChild(div);
    expect(doc.body!.children.length).toBe(1);

    await exec("BEGIN TRANSACTION; DELETE FROM Elements WHERE id = 'preserved'; ROLLBACK", doc);
    expect(doc.body!.children.length).toBe(1);
    expect(doc.body!.children[0]!.id).toBe("preserved");
  });

  it("handles INSERT with arbitrary column ordering and non-first tag", async () => {
    const doc = makeMockDoc();
    const container = doc.createElement("DIV"); container.id = "box";
    doc.body!.appendChild(container);

    const result = await exec(
      "INSERT INTO #box (class, text, tag) VALUES ('card', 'Hello Card', 'span')",
      doc
    );
    expect(result.affectedRows).toBe(1);
    expect(container.children.length).toBe(1);
    const child = container.children[0]!;
    expect(child.tagName).toBe("SPAN");
    expect(child.className).toBe("card");
    expect(child.textContent).toBe("Hello Card");
  });

  it("executes mutation triggers with OLD and NEW references", async () => {
    const doc = makeMockDoc();
    const user = doc.createElement("INPUT"); user.id = "username"; user.value = "alice";
    const status = doc.createElement("SPAN"); status.id = "status"; status.textContent = "initial";
    doc.body!.appendChild(user);
    doc.body!.appendChild(status);

    const sql = `
      CREATE TRIGGER update_status
      ON #username
      AFTER UPDATE OF value
      AS BEGIN
        UPDATE #status SET text = NEW.value;
      END;
      UPDATE Elements SET value = 'bob' WHERE id = 'username';
    `;

    const result = await exec(sql, doc);
    expect(user.value).toBe("bob");
    expect(status.textContent).toBe("bob");
  });

  it("formats expression columns properly in SELECT output", async () => {
    const doc = makeMockDoc();
    const el = doc.createElement("BUTTON"); el.id = "btn"; el.textContent = "5";
    doc.body!.appendChild(el);

    const result = await exec("SELECT CAST(text AS INT) + 1 AS next_val FROM Elements WHERE id = 'btn'", doc);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!["next_val"]).toBe(6);
  });

  it("handles positional INSERT without explicit column list", async () => {
    const doc = makeMockDoc();
    const container = doc.createElement("DIV"); container.id = "box2";
    doc.body!.appendChild(container);

    const result = await exec(
      "INSERT INTO #box2 VALUES ('p', 'highlight', 'Paragraph text')",
      doc
    );
    expect(result.affectedRows).toBe(1);
    expect(container.children.length).toBe(1);
    const child = container.children[0]!;
    expect(child.tagName).toBe("P");
    expect(child.className).toBe("highlight");
    expect(child.textContent).toBe("Paragraph text");
  });

  it("executes DELETE without optional FROM", async () => {
    const doc = makeMockDoc();
    const div = doc.createElement("DIV"); div.id = "del-no-from";
    doc.body!.appendChild(div);
    expect(doc.body!.children.length).toBe(1);

    const result = await exec("DELETE Elements WHERE id = 'del-no-from'", doc);
    expect(result.affectedRows).toBe(1);
    expect(doc.body!.children.length).toBe(0);
  });

  it("ensures DOM state is mutated when AFTER UPDATE triggers execute", async () => {
    const doc = makeMockDoc();
    const count = doc.createElement("SPAN"); count.id = "count"; count.textContent = "1";
    const logger = doc.createElement("DIV"); logger.id = "log"; logger.textContent = "";
    doc.body!.appendChild(count);
    doc.body!.appendChild(logger);

    // Trigger reads the DOM element #count directly during trigger execution
    const sql = `
      CREATE TRIGGER log_change
      ON #count
      AFTER UPDATE OF text
      AS BEGIN
        UPDATE #log SET text = NEW.text;
      END;
      UPDATE #count SET text = '2';
    `;

    await exec(sql, doc);
    expect(count.textContent).toBe("2");
    expect(logger.textContent).toBe("2");
  });
});

