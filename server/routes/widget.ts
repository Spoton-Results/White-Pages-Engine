import { Router, type Request, type Response } from "express";

const router = Router();

/**
 * GET /widget/form.js
 *
 * Serves a self-contained, zero-dependency contact form widget.
 * Embed on any published page:
 *
 *   <script
 *     src="https://YOUR_NEXUS_URL/widget/form.js"
 *     data-nexus-api-url="https://YOUR_NEXUS_URL"
 *     data-nexus-website-id="..."
 *     data-nexus-page-id="..."
 *     data-nexus-service-id="..."
 *     data-nexus-location-id="..."       (optional)
 *     data-nexus-form-title="..."        (optional, default: "Get in Touch")
 *     data-nexus-form-subtitle="..."     (optional)
 *     data-nexus-button-text="..."       (optional, default: "Send Message")
 *     data-nexus-accent-color="#2563eb"  (optional)
 *   ></script>
 */
router.get("/form.js", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const script = `(function () {
  var s = document.currentScript ||
    (function () {
      var tags = document.querySelectorAll('script[data-nexus-website-id]');
      return tags[tags.length - 1];
    })();
  if (!s) return;

  var cfg = {
    apiUrl:      (s.getAttribute('data-nexus-api-url') || '').replace(/\\/$/, ''),
    websiteId:   s.getAttribute('data-nexus-website-id') || '',
    pageId:      s.getAttribute('data-nexus-page-id') || '',
    serviceId:   s.getAttribute('data-nexus-service-id') || '',
    locationId:  s.getAttribute('data-nexus-location-id') || '',
    title:       s.getAttribute('data-nexus-form-title') || 'Get in Touch',
    subtitle:    s.getAttribute('data-nexus-form-subtitle') || "Send us a message and we'll get back to you shortly.",
    btnText:     s.getAttribute('data-nexus-button-text') || 'Send Message',
    accent:      s.getAttribute('data-nexus-accent-color') || '#2563eb',
  };

  var FIELD = 'width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:7px;padding:9px 12px;font-size:14px;color:#111827;outline:none;font-family:inherit;';
  var LABEL = 'display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:5px;';

  var wrap = document.createElement('div');
  wrap.style.cssText = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:480px;width:100%;';
  wrap.innerHTML =
    '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 28px 24px;box-shadow:0 1px 4px rgba(0,0,0,.07);">' +
      '<h3 id="nxs-title" style="margin:0 0 4px;font-size:18px;font-weight:700;color:#111827;"></h3>' +
      '<p  id="nxs-sub"   style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.5;"></p>' +
      '<div id="nxs-body">' +
        '<div style="margin-bottom:14px;"><label style="' + LABEL + '">Name <span style="color:#ef4444;">*</span></label>' +
          '<input id="nxs-name" type="text"  placeholder="Your full name"   style="' + FIELD + '"/></div>' +
        '<div style="margin-bottom:14px;"><label style="' + LABEL + '">Email <span style="color:#ef4444;">*</span></label>' +
          '<input id="nxs-email" type="email" placeholder="you@example.com"  style="' + FIELD + '"/></div>' +
        '<div style="margin-bottom:14px;"><label style="' + LABEL + '">Phone</label>' +
          '<input id="nxs-phone" type="tel"   placeholder="(555) 000-0000"   style="' + FIELD + '"/></div>' +
        '<div style="margin-bottom:20px;"><label style="' + LABEL + '">Message</label>' +
          '<textarea id="nxs-msg" rows="3" placeholder="How can we help?" style="' + FIELD + 'resize:vertical;"></textarea></div>' +
        '<button id="nxs-btn" type="button" style="width:100%;border:none;border-radius:7px;padding:11px 20px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .15s;color:#fff;font-family:inherit;"></button>' +
        '<div id="nxs-status" style="display:none;margin-top:14px;padding:11px 14px;border-radius:7px;font-size:14px;text-align:center;"></div>' +
      '</div>' +
    '</div>';

  s.parentNode.insertBefore(wrap, s.nextSibling);

  document.getElementById('nxs-title').textContent = cfg.title;
  document.getElementById('nxs-sub').textContent   = cfg.subtitle;
  var btn = document.getElementById('nxs-btn');
  btn.textContent = cfg.btnText;
  btn.style.background = cfg.accent;

  // Focus ring
  wrap.querySelectorAll('input,textarea').forEach(function (el) {
    el.addEventListener('focus', function () {
      this.style.borderColor = cfg.accent;
      this.style.boxShadow  = '0 0 0 3px ' + cfg.accent + '33';
    });
    el.addEventListener('blur', function () {
      this.style.borderColor = '#d1d5db';
      this.style.boxShadow  = 'none';
    });
  });

  function showStatus(ok, msg) {
    var el = document.getElementById('nxs-status');
    el.style.display     = 'block';
    el.style.background  = ok ? '#f0fdf4' : '#fef2f2';
    el.style.color       = ok ? '#166534' : '#dc2626';
    el.style.border      = '1px solid ' + (ok ? '#bbf7d0' : '#fecaca');
    el.textContent       = msg;
  }

  btn.addEventListener('click', function () {
    var name  = document.getElementById('nxs-name').value.trim();
    var email = document.getElementById('nxs-email').value.trim();
    var phone = document.getElementById('nxs-phone').value.trim();
    var msg   = document.getElementById('nxs-msg').value.trim();

    if (!name || !email) {
      showStatus(false, 'Please enter your name and email address.');
      return;
    }
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) {
      showStatus(false, 'Please enter a valid email address.');
      return;
    }

    btn.textContent  = 'Sending\\u2026';
    btn.disabled     = true;
    btn.style.opacity = '0.65';
    document.getElementById('nxs-status').style.display = 'none';

    var payload = {
      websiteId:      cfg.websiteId,
      pageId:         cfg.pageId,
      serviceId:      cfg.serviceId,
      submitterName:  name,
      submitterEmail: email,
      submitterPhone: phone || undefined,
      message:        msg   || undefined,
      sourcePageUrl:  window.location.href,
      sourcePageTitle: document.title,
    };
    if (cfg.locationId) payload.locationId = cfg.locationId;

    fetch(cfg.apiUrl + '/api/form-tracking/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok) {
          document.getElementById('nxs-body').innerHTML =
            '<div style="text-align:center;padding:28px 0;">' +
              '<div style="font-size:44px;margin-bottom:14px;">\\u2705</div>' +
              '<div style="font-size:17px;font-weight:700;color:#111827;margin-bottom:6px;">Message received!</div>' +
              '<div style="font-size:14px;color:#6b7280;">We\\'ll be in touch with you shortly.</div>' +
            '</div>';
        } else {
          btn.textContent   = cfg.btnText;
          btn.disabled      = false;
          btn.style.opacity = '1';
          showStatus(false, res.d.error || 'Something went wrong. Please try again.');
        }
      })
      .catch(function () {
        btn.textContent   = cfg.btnText;
        btn.disabled      = false;
        btn.style.opacity = '1';
        showStatus(false, 'Network error. Please check your connection and try again.');
      });
  });
})();`;

  res.send(script);
});

export default router;
