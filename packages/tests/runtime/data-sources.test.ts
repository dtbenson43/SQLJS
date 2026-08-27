import { afterEach, describe, expect, it } from "vitest";
import { execute } from "../../runtime/execute";
import { clearTables, registerTable } from "../../runtime/data-sources";
import { makeMockDoc } from "../helpers/mock-dom";

describe("CSS.Rules and STATE data sources", () => {
  afterEach(() => clearTables());

  it("selects CSS declarations and updates their values", () => {
    const doc = makeMockDoc() as any;
    const declarations: Record<string, string> = { color: "black", padding: "1rem" };
    const style = {
      length: 2,
      item(index: number) { return Object.keys(declarations)[index] ?? ""; },
      getPropertyValue(name: string) { return declarations[name] ?? ""; },
      getPropertyPriority() { return ""; },
      setProperty(name: string, value: string) { declarations[name] = value; },
    };
    const rule = { type: 1, selectorText: ".error", style };
    doc.styleSheets = [{ cssRules: [rule] }];

    const selected = execute("SELECT selector, property, value FROM CSS.Rules WHERE selector = '.error'", { root: doc });
    expect(selected.rows).toEqual([
      { selector: ".error", property: "color", value: "black" },
      { selector: ".error", property: "padding", value: "1rem" },
    ]);

    const updated = execute("UPDATE CSS.Rules SET value = 'red' WHERE selector = '.error' AND property = 'color'", { root: doc });
    expect(updated.affectedRows).toBe(1);
    expect(declarations.color).toBe("red");
  });

  it("queries and updates registered state rows", () => {
    const users = [{ id: 1, name: "Ada", active: true }, { id: 2, name: "Lin", active: false }];
    registerTable("Users", users);
    const doc = makeMockDoc();

    const selected = execute("SELECT id, name FROM STATE.Users WHERE active = true", { root: doc as any });
    expect(selected.rows).toEqual([{ id: 1, name: "Ada" }]);

    const updated = execute("UPDATE STATE.Users SET name = 'Grace' WHERE id = 1", { root: doc as any });
    expect(updated.affectedRows).toBe(1);
    expect(users[0]!.name).toBe("Grace");
  });

  it("rolls back state table updates", () => {
    const rows = [{ id: 1, status: "pending" }];
    registerTable("Orders", rows);
    const result = execute("BEGIN TRANSACTION; UPDATE STATE.Orders SET status = 'done'; ROLLBACK;", { root: makeMockDoc() as any });
    expect(result.messages.some((message) => message.level === "error")).toBe(false);
    expect(rows[0]!.status).toBe("pending");
  });

  it("supports state INSERT and DELETE with rollback", () => {
    const rows: Record<string, unknown>[] = [{ id: 1, status: "pending" }];
    registerTable("Orders", rows);
    const inserted = execute("INSERT INTO STATE.Orders (id, status) VALUES (2, 'new') RETURNING id, status", { root: makeMockDoc() as any });
    expect(inserted.rows).toEqual([{ id: 2, status: "new" }]);
    expect(rows).toHaveLength(2);

    execute("BEGIN TRANSACTION; DELETE FROM STATE.Orders WHERE id = 2; ROLLBACK", { root: makeMockDoc() as any });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ id: 2, status: "new" });
  });

  it("exposes computed styles through the element row", async () => {
    const doc = makeMockDoc() as any;
    const element = doc.createElement("div");
    element.id = "styled";
    element.style = { color: "black" };
    doc.body.appendChild(element);
    doc.defaultView = { getComputedStyle: () => ({ length: 1, item: () => "color", getPropertyValue: () => "red" }) };
    const result = execute("SELECT computedStyle.color FROM Elements WHERE id = 'styled'", { root: doc });
    expect(result.rows).toEqual([{ "computedStyle.color": "red" }]);
  });

  it("dispatches delegated event triggers against inserted or existing elements", () => {
    const doc = makeMockDoc() as any;
    const button = doc.createElement("button"); button.id = "increment";
    const label = doc.createElement("span"); label.id = "label"; label.textContent = "0";
    doc.body.appendChild(button); doc.body.appendChild(label);
    const listeners: Record<string, (event: { target: unknown }) => void> = {};
    doc.addEventListener = (name: string, listener: (event: { target: unknown }) => void) => { listeners[name] = listener; };
    const events: string[] = [];
    execute("CREATE TRIGGER increment_label ON #increment AFTER CLICK AS BEGIN UPDATE #label SET text = '1'; END", {
      root: doc, onEvent: (event) => events.push(`${event.event}:${event.trigger}`),
    });
    listeners.click?.({ target: button });
    expect(label.textContent).toBe("1");
    expect(events).toEqual(["CLICK:increment_label"]);
  });
});
