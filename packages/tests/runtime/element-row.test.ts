import { describe, expect, it } from "vitest";
import { getElementProperty, setElementProperty } from "../../runtime/element-row";

describe("element property adapter", () => {
  it("maps text, attributes, and nested style properties", () => {
    const element = {
      id: "message",
      tagName: "DIV",
      textContent: "Hello",
      innerHTML: "Hello",
      className: "notice",
      style: { color: "black" },
      dataset: {},
      attributes: [],
      getAttribute(name: string) { return name === "aria-label" ? "Message" : null; },
      setAttribute() {},
      removeAttribute() {},
    } as unknown as Element & HTMLElement;

    expect(getElementProperty(element, "text")).toBe("Hello");
    expect(getElementProperty(element, "style.color")).toBe("black");
    expect(getElementProperty(element, "attributes.aria-label")).toBe("Message");
    expect(setElementProperty(element, "text", "Goodbye")).toBe("Hello");
    expect(element.textContent).toBe("Goodbye");
  });
});
