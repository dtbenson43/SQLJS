import { execute, QueryResult, RuntimeMessage } from "../runtime";
import { formatProgram } from "../language/formatter";
import { compileProgram } from "../compiler";
import { elementToRow } from "../runtime/element-row";
import { registerTable } from "../runtime/data-sources";
import {
  buildPreviewDocument,
  DEFAULT_CSS,
  DEFAULT_HTML,
  DEFAULT_SQL,
  EXAMPLES,
  parseProgram,
  PlaygroundExample,
  PlaygroundSource,
  selectedSql,
} from "./model";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

type MonacoEditor = Monaco.editor.IStandaloneCodeEditor;

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
  readonly exampleSelect: HTMLSelectElement;

  private readonly initial: PlaygroundSource;
  private lastResult: QueryResult | undefined;
  private readonly monacoEditors = new Map<HTMLTextAreaElement, MonacoEditor>();
  private monacoModule: typeof Monaco | undefined;
  private selectedExplorerElement: Element | null = null;

  constructor(host: HTMLElement, options: PlaygroundOptions = {}) {
    this.host = host;
    this.initial = {
      sql: options.source?.sql ?? DEFAULT_SQL,
      html: options.source?.html ?? DEFAULT_HTML,
      css: options.source?.css ?? DEFAULT_CSS,
    };

    // Seed default state table for immediate demo usage
    this.seedDefaultState();

    host.replaceChildren();
    host.className = "sqldom-playground";

    const header = document.createElement("header");
    header.className = "sqldom-header";
    const title = document.createElement("h1");
    title.textContent = options.title ?? "SQL-DOM Playground";
    const badge = document.createElement("span");
    badge.className = "sqldom-version-badge";
    badge.textContent = "v0.1";
    header.append(title, badge);
    host.append(header);

    const toolbar = document.createElement("div");
    toolbar.className = "sqldom-toolbar";

    const run = this.button("▶ Run (Ctrl+Enter)", () => this.run(false), "primary");
    const runSelected = this.button("Run Selected", () => this.run(true));
    const reset = this.button("↺ Reset Preview", () => this.reset());

    const exampleContainer = document.createElement("div");
    exampleContainer.className = "sqldom-example-container";
    const exampleLabel = document.createElement("label");
    exampleLabel.textContent = "Preset Example:";
    this.exampleSelect = document.createElement("select");
    this.exampleSelect.className = "sqldom-example-select";
    this.exampleSelect.setAttribute("aria-label", "Select demo preset");

    for (const example of EXAMPLES) {
      const option = document.createElement("option");
      option.value = example.id;
      option.textContent = example.name;
      this.exampleSelect.append(option);
    }

    this.exampleSelect.addEventListener("change", () => {
      const selected = EXAMPLES.find((e) => e.id === this.exampleSelect.value);
      if (selected) this.loadExample(selected);
    });

    exampleContainer.append(exampleLabel, this.exampleSelect);
    toolbar.append(run, runSelected, reset, exampleContainer);
    host.append(toolbar);

    const editors = document.createElement("div");
    editors.className = "sqldom-editors";
    this.sqlEditor = this.editor("SQL", this.initial.sql);
    this.htmlEditor = this.editor("HTML", this.initial.html);
    this.cssEditor = this.editor("CSS", this.initial.css);
    editors.append(
      this.editorPanel("SQL Query Editor", this.sqlEditor, "sql"),
      this.editorPanel("Initial HTML", this.htmlEditor, "html"),
      this.editorPanel("Initial CSS", this.cssEditor, "css")
    );
    host.append(editors);

    const workspace = document.createElement("div");
    workspace.className = "sqldom-workspace";
    this.explorerPanel = this.panel("Object Explorer (Click element to inspect)");
    this.iframe = document.createElement("iframe");
    this.iframe.title = "DOM preview";
    this.iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
    this.iframe.className = "sqldom-preview";
    const previewPanel = this.panel("Live Browser Preview");
    previewPanel.append(this.iframe);
    workspace.append(this.explorerPanel, previewPanel);
    host.append(workspace);

    const output = document.createElement("div");
    output.className = "sqldom-output";
    this.resultsPanel = this.panel("Results Grid");
    this.messagesPanel = this.panel("Messages");
    this.astPanel = this.panel("AST Inspector");
    this.generatedPanel = this.panel("Generated JavaScript");
    this.eventsPanel = this.panel("Event / Trigger Log");
    output.append(this.resultsPanel, this.messagesPanel, this.astPanel, this.generatedPanel, this.eventsPanel);
    host.append(output);

    // Global keyboard shortcut
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          this.run(false);
        }
      });
    }

    this.iframe.addEventListener("load", () => this.refreshExplorer());
    this.reset();
  }

  private seedDefaultState(): void {
    registerTable("Users", [
      { id: 1, name: "Fox Mulder", role: "Special Agent", active: true },
      { id: 2, name: "Dana Scully", role: "Special Agent", active: true },
      { id: 3, name: "Walter Skinner", role: "Assistant Director", active: true },
      { id: 4, name: "C.G.B. Spender", role: "Cigarette Smoking Man", active: false },
    ]);
  }

  loadExample(example: PlaygroundExample): void {
    this.setEditorValue(this.sqlEditor, example.sql);
    this.setEditorValue(this.htmlEditor, example.html);
    this.setEditorValue(this.cssEditor, example.css);
    this.reset();
    this.renderMessages([
      { text: `Loaded preset: "${example.name}" - ${example.description}`, level: "info" },
    ]);
  }

  setEditorValue(editor: HTMLTextAreaElement, value: string): void {
    editor.value = value;
    const monaco = this.monacoEditors.get(editor);
    if (monaco && monaco.getValue() !== value) {
      monaco.setValue(value);
    }
  }

  reset(): void {
    this.iframe.srcdoc = buildPreviewDocument(this.editorValue(this.htmlEditor), this.editorValue(this.cssEditor));
    this.clearPanel(this.resultsPanel, "No query has been run. Click 'Run' to execute.");
    this.clearPanel(this.messagesPanel, "Preview reset to initial HTML and CSS.");
    this.clearPanel(this.astPanel, "No AST available.");
    this.clearPanel(this.generatedPanel, "No JavaScript has been generated.");
    this.clearPanel(this.eventsPanel, "No events or triggers recorded yet.");
    this.selectedExplorerElement = null;
  }

  run(onlySelection: boolean): QueryResult | undefined {
    const sqlValue = this.editorValue(this.sqlEditor);
    const selection = this.monacoEditors.get(this.sqlEditor)?.getSelection();
    const start = selection
      ? this.monacoEditors.get(this.sqlEditor)!.getModel()?.getOffsetAt(selection.getStartPosition())
      : this.sqlEditor.selectionStart;
    const end = selection
      ? this.monacoEditors.get(this.sqlEditor)!.getModel()?.getOffsetAt(selection.getEndPosition())
      : this.sqlEditor.selectionEnd;
    const sql = selectedSql(sqlValue, onlySelection ? start ?? null : null, onlySelection ? end ?? null : null);
    const preview = this.iframe.contentDocument;
    if (!preview) {
      this.renderMessages([{ text: "Preview document is not ready.", level: "error" }]);
      return undefined;
    }

    const parsed = parseProgram(sql);
    if (parsed.program) {
      this.astPanel.textContent = JSON.stringify(parsed.program, null, 2);
      this.generatedPanel.textContent = compileProgram(parsed.program);
    } else {
      this.astPanel.textContent = parsed.diagnostics.join("\n");
      this.generatedPanel.textContent = "Compilation unavailable until the SQL parses successfully.";
    }

    const sqlModel = this.monacoEditors.get(this.sqlEditor)?.getModel();
    if (sqlModel && this.monacoModule) {
      const markers = parsed.errors && parsed.errors.length > 0 && !parsed.program
        ? parsed.errors.map((d) => ({
            severity: this.monacoModule!.MarkerSeverity.Error,
            message: d.message,
            startLineNumber: d.line,
            startColumn: d.column,
            endLineNumber: d.line,
            endColumn: d.column + (d.length || 1),
          }))
        : [];
      this.monacoModule.editor.setModelMarkers(sqlModel, "sqldom", markers);
    }

    this.lastResult = execute(sql, { root: preview, onEvent: (event) => this.logEvent(event) });
    this.renderResult(this.lastResult);
    this.renderMessages(this.lastResult.messages);
    this.refreshExplorer();
    return this.lastResult;
  }

  private renderResult(result: QueryResult): void {
    this.resultsPanel.replaceChildren(this.heading("Results Grid"));
    if (result.columns.length === 0 || result.rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sqldom-empty-state";
      empty.textContent =
        result.rows.length === 0 && result.columns.length > 0
          ? "No rows returned."
          : result.affectedRows !== undefined
          ? `Statement completed successfully (${result.affectedRows} element(s) affected).`
          : "Statement completed without a result set.";
      this.resultsPanel.append(empty);
      return;
    }
    const tableContainer = document.createElement("div");
    tableContainer.className = "sqldom-table-container";
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
    tableContainer.append(table);
    this.resultsPanel.append(tableContainer);
  }

  private renderMessages(messages: RuntimeMessage[]): void {
    this.messagesPanel.replaceChildren(this.heading("Messages"));
    const list = document.createElement("ul");
    list.className = "sqldom-messages-list";
    for (const message of messages) {
      const item = document.createElement("li");
      item.dataset.level = message.level;
      item.className = `sqldom-message sqldom-message-${message.level}`;
      item.textContent = message.text;
      list.append(item);
    }
    this.messagesPanel.append(list);
  }

  private refreshExplorer(): void {
    this.explorerPanel.replaceChildren(this.heading("Object Explorer (Click element to inspect)"));
    const preview = this.iframe.contentDocument;
    if (!preview?.body) return;
    const tree = document.createElement("ul");
    tree.className = "sqldom-tree";
    for (const child of Array.from(preview.body.children)) tree.append(this.explorerNode(child));
    this.explorerPanel.append(tree);
  }

  private explorerNode(element: Element): HTMLLIElement {
    const item = document.createElement("li");
    item.className = "sqldom-tree-node";
    const labelSpan = document.createElement("span");
    labelSpan.className = "sqldom-tree-label";
    const label = element.id
      ? `#${element.id}`
      : element.className
      ? `${element.tagName.toLowerCase()}.${String(element.className).trim().replace(/\s+/g, ".")}`
      : element.tagName.toLowerCase();
    labelSpan.textContent = label;

    labelSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      this.inspectElement(element, labelSpan);
    });

    item.append(labelSpan);

    if (element.children.length > 0) {
      const children = document.createElement("ul");
      children.className = "sqldom-tree-children";
      for (const child of Array.from(element.children)) children.append(this.explorerNode(child));
      item.append(children);
    }
    return item;
  }

  private inspectElement(element: Element, labelSpan: HTMLElement): void {
    this.explorerPanel.querySelectorAll(".sqldom-tree-label.active").forEach((el) => el.classList.remove("active"));
    labelSpan.classList.add("active");
    this.selectedExplorerElement = element;

    // Flash element outline in preview iframe
    const htmlElement = element as HTMLElement;
    const previousOutline = htmlElement.style.outline;
    htmlElement.style.outline = "2px solid #3b82f6";
    setTimeout(() => {
      htmlElement.style.outline = previousOutline;
    }, 1000);

    // Project element row into Results Grid
    const row = elementToRow(element);
    const inspectCols = ["id", "tag", "text", "class", "value", "disabled", "hidden", "parentId"];
    const projectedRow: Record<string, unknown> = {};
    for (const col of inspectCols) projectedRow[col] = (row as Record<string, unknown>)[col];

    this.renderResult({
      columns: inspectCols,
      rows: [projectedRow],
      messages: [{ text: `Inspected element <${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}>`, level: "info" }],
      durationMs: 0,
    });
  }

  private button(label: string, action: () => void, variant: "primary" | "secondary" = "secondary"): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = `sqldom-btn sqldom-btn-${variant}`;
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

  private editorPanel(label: string, editor: HTMLTextAreaElement, type: "sql" | "html" | "css"): HTMLElement {
    const panel = this.panel(label);
    panel.append(editor);
    this.upgradeToMonaco(label, editor, type);
    return panel;
  }

  private async upgradeToMonaco(label: string, textarea: HTMLTextAreaElement, type: "sql" | "html" | "css"): Promise<void> {
    if (typeof window === "undefined") return;
    const monaco = await import("monaco-editor/esm/vs/editor/editor.api");
    this.monacoModule = monaco;
    const container = document.createElement("div");
    container.className = "sqldom-monaco-editor";
    textarea.hidden = true;
    textarea.parentElement?.append(container);

    const language = type === "sql" ? "sqldom-sql" : type;
    if (type === "sql" && !monaco.languages.getLanguages().some((entry) => entry.id === language)) {
      monaco.languages.register({ id: language });
      monaco.languages.setMonarchTokensProvider(language, {
        tokenizer: {
          root: [
            [
              /\b(SELECT|FROM|WHERE|UPDATE|SET|INSERT|INTO|VALUES|DELETE|CREATE|TRIGGER|AFTER|BEFORE|ON|AS|BEGIN|END|COMMIT|ROLLBACK|TRANSACTION|AND|OR|NOT|LIKE|IS|NULL|TRUE|FALSE|CAST|RETURNING|OF|CHILDREN|DESCENDANTS|PARENT|CSS|STATE)\b/i,
              "keyword",
            ],
            [/\b(LEN|LOWER|UPPER|COALESCE|COUNT|ABS|ROUND)\b/i, "predefined"],
            [/\b(Elements|CSS\.Rules|STATE\.[a-zA-Z_]\w*)\b/i, "type"],
            [/--.*$/, "comment"],
            [/\/\*/, "comment", "@comment"],
            [/'[^']*'/, "string"],
            [/\$?[a-zA-Z_][\w$]*/, "identifier"],
            [/\d+(\.\d+)?/, "number"],
            [/[=><!~]+/, "operator"],
          ],
          comment: [
            [/[^\/*]+/, "comment"],
            [/\*\//, "comment", "@pop"],
            [/[\/*]/, "comment"],
          ],
        },
      });

      monaco.languages.registerCompletionItemProvider(language, {
        provideCompletionItems: (_model, position) => ({
          suggestions: [
            ...["SELECT", "FROM", "WHERE", "UPDATE", "SET", "INSERT", "INTO", "VALUES", "DELETE", "BEGIN TRANSACTION", "COMMIT", "ROLLBACK", "CREATE TRIGGER", "AFTER CLICK", "AS BEGIN", "END"].map((label) => ({
              label,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: label,
              range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            })),
            ...["Elements", "CSS.Rules", "STATE.Users"].map((label) => ({
              label,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: label,
              range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            })),
            ...["id", "tag", "text", "html", "class", "value", "name", "type", "hidden", "disabled", "checked", "parentId", "style", "dataset", "attributes", "computedStyle"].map((label) => ({
              label,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: label,
              range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            })),
            ...["CAST", "LEN", "LOWER", "UPPER", "COALESCE"].map((label) => ({
              label,
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: `${label}()`,
              range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
            })),
          ],
        }),
      });
    }

    const instance = monaco.editor.create(container, {
      value: textarea.value,
      language,
      automaticLayout: true,
      minimap: { enabled: false },
      theme: "vs-dark",
      fontSize: 13,
      lineNumbers: "on",
      tabSize: 2,
      scrollBeyondLastLine: false,
    });

    instance.onDidChangeModelContent(() => {
      textarea.value = instance.getValue();
    });

    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      this.run(false);
    });

    this.monacoEditors.set(textarea, instance);
  }

  private editorValue(editor: HTMLTextAreaElement): string {
    return this.monacoEditors.get(editor)?.getValue() ?? editor.value;
  }

  private logEvent(event: { trigger: string; event: string; target: Element; messages: RuntimeMessage[] }): void {
    const item = document.createElement("div");
    item.className = "sqldom-event-item";
    const badge = document.createElement("span");
    badge.className = "sqldom-event-badge";
    badge.textContent = event.event;
    const desc = document.createElement("span");
    desc.textContent = ` → ${event.trigger} on ${displayValue(event.target)}`;
    item.append(badge, desc);
    this.eventsPanel.append(item);
    this.refreshExplorer();
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
    message.className = "sqldom-empty-state";
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
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export {
  buildPreviewDocument,
  DEFAULT_CSS,
  DEFAULT_HTML,
  DEFAULT_SQL,
  EXAMPLES,
  parseProgram,
  type PlaygroundExample,
  selectedSql,
} from "./model";

