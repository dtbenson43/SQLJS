import { execute, QueryResult, RuntimeMessage } from "../runtime";
import { formatProgram } from "../language/formatter";
import { buildPreviewDocument, DEFAULT_CSS, DEFAULT_HTML, DEFAULT_SQL, parseProgram, PlaygroundSource, selectedSql } from "./model";

export interface PlaygroundOptions {
  source?: Partial<PlaygroundSource>;
  title?: string;
}

export class PlaygroundController {
  readonly host: HTMLElement;
  readonly iframe: HTMLIFrameElement;
  readonly sqlEditor: HTMLTextAreaElement;
  readonly htmlEditor: HTMLTextAreaElement;
  readonly cssEditor: HTMLTextAreaElement;
  readonly resultsPanel: HTMLElement;
  readonly messagesPanel: HTMLElement;
  readonly astPanel: HTMLElement;
  readonly generatedPanel: HTMLElement;
  readonly explorerPanel: HTMLElement;
  readonly eventsPanel: HTMLElement;

  private readonly initial: PlaygroundSource;
  private lastResult: QueryResult | undefined;

  constructor(host: HTMLElement, options: PlaygroundOptions = {}) {
    this.host = host;
    this.initial = {
      sql: options.source?.sql ?? DEFAULT_SQL,
      html: options.source?.html ?? DEFAULT_HTML,
      css: options.source?.css ?? DEFAULT_CSS,
    };

    host.replaceChildren();
    host.className = "sqldom-playground";
    const title = document.createElement("h1");
    title.textContent = options.title ?? "SQL DOM Playground";
    host.append(title);

    const toolbar = document.createElement("div");
    toolbar.className = "sqldom-toolbar";
    const run = this.button("Run", () => this.run(false));
    const runSelected = this.button("Run Selected", () => this.run(true));
    const reset = this.button("Reset", () => this.reset());
    toolbar.append(run, runSelected, reset);
    host.append(toolbar);

    const editors = document.createElement("div");
    editors.className = "sqldom-editors";
    this.sqlEditor = this.editor("SQL", this.initial.sql);
    this.htmlEditor = this.editor("HTML", this.initial.html);
    this.cssEditor = this.editor("CSS", this.initial.css);
    editors.append(this.editorPanel("SQL", this.sqlEditor), this.editorPanel("HTML", this.htmlEditor), this.editorPanel("CSS", this.cssEditor));
    host.append(editors);

    const workspace = document.createElement("div");
    workspace.className = "sqldom-workspace";
    this.explorerPanel = this.panel("Object Explorer");
    this.iframe = document.createElement("iframe");
    this.iframe.title = "DOM preview";
    this.iframe.setAttribute("sandbox", "allow-same-origin");
    this.iframe.className = "sqldom-preview";
    const previewPanel = this.panel("Browser Preview");
    previewPanel.append(this.iframe);
    workspace.append(this.explorerPanel, previewPanel);
    host.append(workspace);

    const output = document.createElement("div");
    output.className = "sqldom-output";
    this.resultsPanel = this.panel("Results");
    this.messagesPanel = this.panel("Messages");
    this.astPanel = this.panel("AST");
    this.generatedPanel = this.panel("Generated JavaScript");
    this.eventsPanel = this.panel("Event / Trigger Log");
    output.append(this.resultsPanel, this.messagesPanel, this.astPanel, this.generatedPanel, this.eventsPanel);
    host.append(output);

    this.iframe.addEventListener("load", () => this.refreshExplorer());
    this.reset();
  }

  reset(): void {
    this.iframe.srcdoc = buildPreviewDocument(this.htmlEditor.value, this.cssEditor.value);
    this.clearPanel(this.resultsPanel, "No query has been run.");
    this.clearPanel(this.messagesPanel, "Preview reset.");
    this.clearPanel(this.astPanel, "No AST available.");
    this.clearPanel(this.generatedPanel, "JavaScript compilation is not implemented yet.");
    this.clearPanel(this.eventsPanel, "No events recorded.");
  }

  run(onlySelection: boolean): QueryResult | undefined {
    const sql = selectedSql(this.sqlEditor.value, onlySelection ? this.sqlEditor.selectionStart : null, onlySelection ? this.sqlEditor.selectionEnd : null);
    const preview = this.iframe.contentDocument;
    if (!preview) {
      this.renderMessages([{ text: "Preview document is not ready.", level: "error" }]);
      return undefined;
    }

    const parsed = parseProgram(sql);
    if (parsed.program) this.astPanel.textContent = JSON.stringify(parsed.program, null, 2);
    else this.astPanel.textContent = parsed.diagnostics.join("\n");

    this.lastResult = execute(sql, { root: preview });
    this.renderResult(this.lastResult);
    this.renderMessages(this.lastResult.messages);
    this.refreshExplorer();
    return this.lastResult;
  }

  private renderResult(result: QueryResult): void {
    this.resultsPanel.replaceChildren(this.heading("Results"));
    if (result.columns.length === 0 || result.rows.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = result.rows.length === 0 ? "No rows returned." : "Statement completed without a result set.";
      this.resultsPanel.append(empty);
      return;
    }
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    for (const column of result.columns) {
      const cell = document.createElement("th");
      cell.textContent = column;
      head.append(cell);
    }
    const body = table.createTBody();
    for (const row of result.rows) {
      const line = body.insertRow();
      for (const column of result.columns) {
        const cell = line.insertCell();
        cell.textContent = displayValue(row[column]);
      }
    }
    this.resultsPanel.append(table);
  }

  private renderMessages(messages: RuntimeMessage[]): void {
    this.messagesPanel.replaceChildren(this.heading("Messages"));
    const list = document.createElement("ul");
    for (const message of messages) {
      const item = document.createElement("li");
      item.dataset.level = message.level;
      item.textContent = message.text;
      list.append(item);
    }
    this.messagesPanel.append(list);
  }

  private refreshExplorer(): void {
    this.explorerPanel.replaceChildren(this.heading("Object Explorer"));
    const preview = this.iframe.contentDocument;
    if (!preview?.body) return;
    const tree = document.createElement("ul");
    for (const child of Array.from(preview.body.children)) tree.append(this.explorerNode(child));
    this.explorerPanel.append(tree);
  }

  private explorerNode(element: Element): HTMLLIElement {
    const item = document.createElement("li");
    const label = element.id ? `#${element.id}` : element.className ? `${element.tagName.toLowerCase()}.${String(element.className).trim().replace(/\s+/g, ".")}` : element.tagName.toLowerCase();
    item.textContent = label;
    if (element.children.length > 0) {
      const children = document.createElement("ul");
      for (const child of Array.from(element.children)) children.append(this.explorerNode(child));
      item.append(children);
    }
    return item;
  }

  private button(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  private editor(label: string, value: string): HTMLTextAreaElement {
    const editor = document.createElement("textarea");
    editor.value = value;
    editor.setAttribute("aria-label", label);
    editor.spellcheck = false;
    return editor;
  }

  private editorPanel(label: string, editor: HTMLTextAreaElement): HTMLElement {
    const panel = this.panel(label);
    panel.append(editor);
    return panel;
  }

  private panel(label: string): HTMLElement {
    const panel = document.createElement("section");
    panel.className = "sqldom-panel";
    panel.append(this.heading(label));
    return panel;
  }

  private heading(text: string): HTMLHeadingElement {
    const heading = document.createElement("h2");
    heading.textContent = text;
    return heading;
  }

  private clearPanel(panel: HTMLElement, text: string): void {
    panel.replaceChildren(this.heading(panel.querySelector("h2")?.textContent ?? ""));
    const message = document.createElement("p");
    message.textContent = text;
    panel.append(message);
  }
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") {
    if ("tagName" in value && typeof (value as any).tagName === "string") {
      const tag = String((value as any).tagName).toLowerCase();
      const id = (value as any).id ? `#${(value as any).id}` : "";
      return `<${tag}${id}>`;
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

export { buildPreviewDocument, DEFAULT_CSS, DEFAULT_HTML, DEFAULT_SQL, parseProgram, selectedSql } from "./model";
