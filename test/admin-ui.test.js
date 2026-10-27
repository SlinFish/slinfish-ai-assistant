import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mountAdmin } from "../public/admin.js";
class Element {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.attributes = {};
  }
  set innerHTML(_) {
    assert.fail("Never render user content as HTML");
  }
  append(value) {
    this.children.push(value);
  }
  replaceChildren() {
    this.children = [];
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  focus() {
    this.focused = true;
  }
}
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  business: "hotel",
  businessType: "Hospitality",
  businessName: "Fictional Hotel",
  name: "<img src=x onerror=alert(1)>",
  contact: "demo@example.invalid",
  status: "new",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  version: 1,
  question: "<script>fictional text</script>",
  allowedStatuses: ["contacted", "lost"],
  history: { events: [], nextCursor: null },
};
const event = { preventDefault() {} };
const ok = (data) => ({
  ok: true,
  status: 200,
  headers: { get: () => String(Date.now() + 60000) },
  json: async () => data,
});
const reject = (status) => ({
  ok: false,
  status,
  headers: { get: () => null },
  json: async () => ({ error: "PRIVATE_UNEXPECTED_ERROR" }),
});
async function page(t, respond) {
  const html = await readFile(
      new URL("../public/admin.html", import.meta.url),
      "utf8",
    ),
    elements = new Map();
  for (const match of html.matchAll(/id="([^"]+)"/g))
    elements.set(match[1], new Element());
  const timers = new Map();
  let timerId = 0;
  const calls = [];
  const controller = mountAdmin({
    document: {
      getElementById: (id) => {
        assert.ok(elements.has(id), "Known DOM id required");
        return elements.get(id);
      },
      createElement: () => new Element(),
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return respond(url, options, calls.length);
    },
    history: { replaceState() {} },
    setTimer: (callback) => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimer: (id) => timers.delete(id),
  });
  t.after(() => controller.destroy());
  await controller.ready;
  return { elements, calls, timers, controller, $: (id) => elements.get(id) };
}
const session = () =>
  ok({ authenticated: true, csrfToken: "synthetic-csrf-token" });
const lists = () => ok({ inquiries: [row], nextCursor: null });
function view(p) {
  return p.$("inquiry-rows").children[0].children.at(-1).children[0].onclick();
}

test("login interface handles unauthorized and network states and clears password immediately", async (t) => {
  let passwordSeen;
  const p = await page(t, (url, options) => {
    if (url.endsWith("/login")) {
      passwordSeen = JSON.parse(options.body).password;
      return reject(401);
    }
    return reject(401);
  });
  assert.equal(p.$("login-panel").hidden, false);
  assert.equal(p.$("dashboard").hidden, true);
  p.$("admin-password").value = "synthetic test passphrase";
  const pending = p.$("login-form").onsubmit(event);
  assert.equal(p.$("admin-password").value, "");
  await pending;
  assert.equal(passwordSeen, "synthetic test passphrase");
  assert.match(p.$("notice").textContent, /Sign-in failed/);
  assert.ok(!p.$("notice").textContent.includes("PRIVATE_UNEXPECTED_ERROR"));
  const offline = await page(t, () => {
    throw new Error("PRIVATE_NETWORK_ERROR");
  });
  assert.equal(offline.$("login-panel").hidden, false);
  assert.match(offline.$("error").textContent, /Connection failed/);
});
test("authenticated table/details render stored markup only as text and show allowed status targets", async (t) => {
  const p = await page(t, (url) =>
    url.endsWith("/session")
      ? session()
      : url.includes("/inquiries?") || url === "/api/admin/inquiries"
        ? lists()
        : ok(row),
  );
  assert.equal(p.$("dashboard").hidden, false);
  assert.equal(
    p.$("inquiry-rows").children[0].children[1].textContent,
    row.name,
  );
  await view(p);
  assert.equal(p.$("detail-question").textContent, row.question);
  assert.deepEqual(
    p.$("status-next").children.map((option) => option.value),
    ["", "contacted", "lost"],
  );
  assert.equal(p.$("detail-heading").focused, true);
  assert.ok(
    p.calls.every(
      (call) =>
        call.options.credentials === "same-origin" &&
        call.options.cache === "no-store",
    ),
  );
});
test("filter/pagination requests preserve chosen scope and empty/loading states", async (t) => {
  let finish;
  const p = await page(t, (url) =>
    url.endsWith("/session") ? session() : lists(),
  );
  p.$("business-filter").value = "auto";
  p.$("status-filter").value = "won";
  // Subsequent calls are allowed to finish out of order; filters must remain explicit.
  const lastFetch = p.calls.length;
  await p.$("filters").onsubmit(event);
  assert.equal(
    p.calls[lastFetch].url,
    "/api/admin/inquiries?business=auto&status=won",
  );
  const empty = await page(t, (url) =>
    url.endsWith("/session")
      ? session()
      : ok({ inquiries: [], nextCursor: null }),
  );
  assert.equal(empty.$("empty").hidden, false);
  assert.equal(empty.$("next-page").disabled, true);
  let count = 0;
  const delayed = await page(t, (url) => {
    if (url.endsWith("/session")) return session();
    if (++count === 1) return lists();
    return new Promise((resolve) => {
      finish = () => resolve(ok({ inquiries: [], nextCursor: null }));
    });
  });
  const pending = delayed.$("refresh").onclick();
  assert.equal(delayed.$("loading").hidden, false);
  finish();
  await pending;
  assert.equal(delayed.$("loading").hidden, true);
  assert.equal(delayed.$("empty").hidden, false);
});
test("stale update is never retried automatically; fresh version and workflow are loaded", async (t) => {
  let detailCalls = 0;
  const p = await page(t, (url, options) => {
    if (url.endsWith("/session")) return session();
    if (options.method === "PATCH") return reject(409);
    if (url === "/api/admin/inquiries") return lists();
    return ok(
      detailCalls++ === 0
        ? row
        : {
            ...row,
            version: 2,
            status: "contacted",
            allowedStatuses: ["qualified", "lost"],
          },
    );
  });
  await view(p);
  p.$("status-next").value = "contacted";
  p.$("status-next").onchange();
  await p.$("status-form").onsubmit(event);
  const writes = p.calls.filter((call) => call.options.method === "PATCH");
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].options.body), {
    status: "contacted",
    version: 1,
  });
  assert.equal(
    writes[0].options.headers["X-CSRF-Token"],
    "synthetic-csrf-token",
  );
  assert.equal(p.$("detail-version").textContent, "2");
  assert.match(p.$("notice").textContent, /Review the latest version/);
  assert.equal(p.$("status-button").disabled, true);
});
test("logout clears sensitive DOM immediately and late responses cannot restore it", async (t) => {
  let finish;
  const p = await page(t, (url, options) => {
    if (url.endsWith("/session")) return session();
    if (url.endsWith("/logout")) return ok({ authenticated: false });
    if (url === "/api/admin/inquiries") return lists();
    return new Promise((resolve) => {
      finish = () => resolve(ok(row));
    });
  });
  const pending = view(p);
  const out = p.$("logout").onclick();
  assert.equal(p.$("inquiry-rows").children.length, 0);
  assert.equal(p.$("detail-name").textContent, "");
  finish();
  await Promise.all([pending, out]);
  assert.equal(p.$("detail-panel").hidden, true);
  assert.equal(p.$("dashboard").hidden, true);
  assert.equal(p.$("login-panel").hidden, false);
  const logout = p.calls.find((call) => call.url.endsWith("/logout"));
  assert.equal(logout.options.headers["X-CSRF-Token"], "synthetic-csrf-token");
});
test("server 401 and client expiry both remove customer content and show session-expired state", async (t) => {
  const p = await page(t, (url) =>
    url.endsWith("/session")
      ? session()
      : url === "/api/admin/inquiries"
        ? lists()
        : reject(401),
  );
  await view(p);
  assert.equal(p.$("dashboard").hidden, true);
  assert.equal(p.$("inquiry-rows").children.length, 0);
  assert.match(p.$("notice").textContent, /expired/);
  const timed = await page(t, (url) =>
    url.endsWith("/session") ? session() : lists(),
  );
  [...timed.timers.values()].at(-1)();
  assert.equal(timed.$("dashboard").hidden, true);
  assert.equal(timed.$("inquiry-rows").children.length, 0);
});
test("server failures are sanitized in UI and do not render an error body", async (t) => {
  const p = await page(t, (url) =>
    url.endsWith("/session") ? session() : reject(500),
  );
  assert.match(p.$("error").textContent, /could not complete/);
  assert.ok(!p.$("error").textContent.includes("PRIVATE_UNEXPECTED_ERROR"));
});
test("successful status update disables duplicate writes and refreshes version and audit", async (t) => {
  let finish;
  const updated = {
    ...row,
    status: "contacted",
    version: 2,
    allowedStatuses: ["qualified", "lost"],
    history: {
      events: [
        {
          id: 1,
          previousStatus: "new",
          status: "contacted",
          createdAt: Date.now(),
          version: 2,
        },
      ],
      nextCursor: null,
    },
  };
  const p = await page(t, (url, options) => {
    if (url.endsWith("/session")) return session();
    if (options.method === "PATCH")
      return new Promise((resolve) => {
        finish = () => resolve(ok(updated));
      });
    return url === "/api/admin/inquiries" ? lists() : ok(row);
  });
  await view(p);
  p.$("status-next").value = "contacted";
  p.$("status-next").onchange();
  const pending = p.$("status-form").onsubmit(event);
  assert.equal(p.$("status-next").disabled, true);
  assert.equal(p.$("status-button").disabled, true);
  await p.$("status-form").onsubmit(event);
  assert.equal(
    p.calls.filter((call) => call.options.method === "PATCH").length,
    1,
  );
  finish();
  await pending;
  assert.equal(p.$("detail-version").textContent, "2");
  assert.equal(p.$("detail-status").textContent, "Contacted");
  assert.equal(p.$("status-next").disabled, false);
  assert.equal(p.$("status-button").disabled, true);
  assert.match(p.$("audit-list").children[0].textContent, /New → Contacted/);
  assert.match(p.$("notice").textContent, /Status updated/);
});
test("older audit pages append safely without replacing current inquiry details", async (t) => {
  const entry = {
    id: 2,
    previousStatus: "contacted",
    status: "qualified",
    createdAt: Date.now(),
    version: 3,
  };
  const p = await page(t, (url) => {
    if (url.endsWith("/session")) return session();
    if (url === "/api/admin/inquiries") return lists();
    if (url.includes("/history?before=2"))
      return ok({
        events: [
          {
            ...entry,
            id: 1,
            previousStatus: "new",
            status: "contacted",
            version: 2,
          },
        ],
        nextCursor: null,
      });
    return ok({ ...row, history: { events: [entry], nextCursor: 2 } });
  });
  await view(p);
  assert.equal(p.$("older-history").disabled, false);
  await p.$("older-history").onclick();
  assert.equal(p.$("audit-list").children.length, 2);
  assert.equal(p.$("older-history").disabled, true);
  assert.equal(p.$("detail-question").textContent, row.question);
});
