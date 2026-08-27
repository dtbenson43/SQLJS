import { PlaygroundController } from "./index";
import "./styles.css";

const host = document.querySelector<HTMLElement>("#playground");
if (!host) throw new Error("Playground host element not found");
new PlaygroundController(host);
