import { useEffect } from "react";
import PublishedPagesPage from "@/pages/published";

const ROOT = "https://spotonresults.com/";
const PAGES = "https://pages.spotonresults.com/";

function normalizeUrl(value: string) {
  if (!value) return value;
  return value.replace(ROOT, PAGES).replace("https://spotonresults.com/pages/", PAGES);
}

export default function PublishedPagesFixedPage() {
  useEffect(() => {
    const normalizeLinks = () => {
      document.querySelectorAll<HTMLAnchorElement>('a[href^="https://spotonresults.com/"]').forEach((anchor) => {
        anchor.href = normalizeUrl(anchor.href);
      });
    };

    normalizeLinks();
    const observer = new MutationObserver(normalizeLinks);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });

    const originalWriteText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (originalWriteText) {
      navigator.clipboard.writeText = (text: string) => originalWriteText(normalizeUrl(text));
    }

    return () => {
      observer.disconnect();
      if (originalWriteText) navigator.clipboard.writeText = originalWriteText;
    };
  }, []);

  return <PublishedPagesPage />;
}
