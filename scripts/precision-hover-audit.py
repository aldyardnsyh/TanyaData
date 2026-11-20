"""Precision element audit: font, radius, padding, hover tooltips.
Dijalankan lewat qa_app.py --cmd (app sudah hidup di PORT dari env)."""
import os
import json
from playwright.sync_api import sync_playwright

BASE = os.environ.get("QA_URL", "http://127.0.0.1:3000")
OUT = r"C:\Users\aldya\.browserqa\artifacts\precision-hover"

os.makedirs(OUT, exist_ok=True)

report = {}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(BASE + "/overview", wait_until="domcontentloaded")
    page.wait_for_timeout(2500)

    # --- Computed styles: font, radius, padding ---
    styles = page.evaluate("""() => {
      const out = {};
      const h1 = document.querySelector('h1');
      if (h1) { const s = getComputedStyle(h1); out.h1 = {font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, tracking: s.letterSpacing, lineHeight: s.lineHeight}; }
      const p = document.querySelector('p');
      if (p) { const s = getComputedStyle(p); out.bodyText = {font: s.fontFamily, size: s.fontSize, color: s.color}; }
      const cards = [...document.querySelectorAll('section')].slice(0, 5).map(c => { const s = getComputedStyle(c); return {radius: s.borderRadius, padding: s.padding, border: s.borderColor}; });
      out.cards = cards;
      const btn = document.querySelector('button');
      if (btn) { const s = getComputedStyle(btn); out.button = {radius: s.borderRadius, padding: s.padding, minHeight: s.minHeight}; }
      const mono = [...document.querySelectorAll('*')].find(e => e.textContent?.includes('FTS5') && e.children.length === 0);
      if (mono) { const s = getComputedStyle(mono); out.mono = {font: s.fontFamily, size: s.fontSize, color: s.color}; }
      return out;
    }""")
    report["styles"] = styles

    # --- Hover tooltips on icon buttons ---
    def probe_hover(selector, label):
        try:
            el = page.locator(selector).first
            if el.count() == 0:
                return {"label": label, "found": False}
            before = page.locator("[role=tooltip], [data-tooltip], [title]").count()
            el.hover()
            page.wait_for_timeout(600)
            # cari tooltip yang muncul
            tips = page.evaluate("""() => {
              const t = [...document.querySelectorAll('[role=tooltip],[data-tooltip]')].filter(e => e.offsetParent !== null).map(e => e.textContent?.trim().slice(0,80));
              const titled = [...document.querySelectorAll('[title]')].filter(e => e.offsetParent !== null && e.getAttribute('title')).map(e => e.getAttribute('title').slice(0,80));
              return {roleTips: t, titleTips: titled};
            }""")
            page.screenshot(path=os.path.join(OUT, f"hover-{label}.png"))
            return {"label": label, "found": True, "before": before, "tips": tips}
        except Exception as e:
            return {"label": label, "error": str(e)[:120]}

    report["hovers"] = []
    report["hovers"].append(probe_hover("button[aria-label*='Search' i], button[aria-label*='Cari' i]", "search"))
    report["hovers"].append(probe_hover("button[aria-label*='Notif' i]", "notif"))
    report["hovers"].append(probe_hover("button[aria-label*='Assistant' i], button[aria-label*='Asisten' i]", "assistant"))
    report["hovers"].append(probe_hover("button[aria-label*='Refresh' i], button[aria-label*='Muat' i]", "refresh"))

    # --- Overflow / padding collision detection ---
    overflow = page.evaluate("""() => {
      const bad = [];
      document.querySelectorAll('*').forEach(e => {
        const s = getComputedStyle(e);
        if (s.overflow === 'visible' && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0) {
          bad.push({tag: e.tagName, cls: (e.className||'').toString().slice(0,60), scroll: e.scrollWidth, client: e.clientWidth});
        }
      });
      return bad.slice(0, 15);
    }""")
    report["overflow"] = overflow

    browser.close()

print(json.dumps(report, indent=2, ensure_ascii=False))
