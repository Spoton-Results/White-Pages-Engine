import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const STALE_BANK_COPY = "1 Claude API call per service creates all 10 banks: 5 core + 5 extended; bulk pages use 0 AI calls after";
const CURRENT_BANK_COPY = "1 Claude API call per service creates all 14 banks: 5 core + 5 extended + 4 SEO expansion; bulk pages use 0 AI calls after";

function correctStaleBankCopy() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent?.includes(STALE_BANK_COPY)) {
      node.textContent = node.textContent.replace(STALE_BANK_COPY, CURRENT_BANK_COPY);
    }
    node = walker.nextNode();
  }
}

createRoot(document.getElementById("root")!).render(<App />);

setInterval(correctStaleBankCopy, 1000);
