const LABELS = Object.freeze({
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
  legacy_closed: "Legacy closed — review required",
});
const MESSAGES = {
  400: "Request rejected. Check the selected status and reload.",
  401: "Session expired or unauthorized. Sign in again.",
  403: "Request not allowed. Sign in again from this local origin.",
  404: "Inquiry not found in this business.",
  409: "This inquiry changed. Review the latest version before trying again.",
  429: "Too many attempts. Wait before trying again.",
  503: "Local service unavailable.",
};
const detailIds = [
  "detail-business",
  "detail-name",
  "detail-contact",
  "detail-status",
  "detail-created",
  "detail-updated",
  "detail-version",
  "detail-question",
];
function failure(status, text) {
  const error = new Error(
    text ||
      MESSAGES[status] ||
      "The local server could not complete the request.",
  );
  error.status = status;
  error.safe = true;
  return error;
}
function date(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "Date unavailable";
  }
}
export function mountAdmin({
  document,
  fetchImpl = fetch,
  history,
  browser,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
}) {
  const $ = (id) => document.getElementById(id);
  const state = {
    authenticated: false,
    csrf: "",
    selected: null,
    next: null,
    older: null,
    updating: false,
  };
  let epoch = 0,
    listSerial = 0,
    detailSerial = 0,
    expiryTimer;
  const say = (text = "", error = false) => {
    $("notice").textContent = error ? "" : text;
    $("error").textContent = error ? text : "";
  };
  const path = (row) =>
    "/api/admin/businesses/" +
    encodeURIComponent(row.business) +
    "/inquiries/" +
    encodeURIComponent(row.id);
  function clearDetail() {
    state.selected = null;
    state.older = null;
    state.updating = false;
    detailSerial++;
    $("status-next").disabled = false;
    $("detail-panel").hidden = true;
    for (const id of detailIds) $(id).textContent = "";
    $("audit-list").replaceChildren();
    $("status-next").replaceChildren();
    $("status-button").disabled = true;
    $("older-history").disabled = true;
  }
  function showLogin(message = "Sign in to manage fictional demo inquiries.") {
    epoch++;
    listSerial++;
    clearDetail();
    clearTimer(expiryTimer);
    state.authenticated = false;
    state.csrf = "";
    state.next = null;
    $("inquiry-rows").replaceChildren();
    $("empty").hidden = true;
    $("loading").hidden = true;
    $("dashboard").hidden = true;
    $("login-panel").hidden = false;
    $("admin-password").value = "";
    $("login-button").disabled = false;
    $("next-page").disabled = true;
    history?.replaceState(null, "", "/admin/login");
    say(message);
  }
  function armExpiry(value) {
    const expires =
      value === null || value === undefined
        ? now() + 30 * 60000
        : Number(value);
    if (!Number.isFinite(expires) || expires <= now()) {
      showLogin(MESSAGES[401]);
      return false;
    }
    clearTimer(expiryTimer);
    expiryTimer = setTimer(
      () => showLogin(MESSAGES[401]),
      Math.min(expires - now(), 30 * 60000),
    );
    return true;
  }
  async function request(url, method = "GET", body) {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: {
          ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
          ...(method === "PATCH" || url.endsWith("/logout")
            ? { "X-CSRF-Token": state.csrf }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw failure(0, "Connection failed. Check the local server and retry.");
    }
    if (!response.ok) throw failure(response.status); // Never display arbitrary error-body text.
    let data;
    try {
      data = await response.json();
    } catch {
      throw failure(0, "Unexpected server response.");
    }
    return { data, expiry: response.headers.get("x-admin-session-expires") };
  }
  function failed(error) {
    if (error.status === 401 || error.status === 403)
      showLogin(MESSAGES[error.status]);
    else
      say(
        error.safe
          ? error.message
          : "Unable to display local data. Reload and try again.",
        true,
      );
  }
  function renderRows(rows) {
    $("inquiry-rows").replaceChildren();
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const text of [
        row.businessType + " · " + row.businessName,
        row.name,
        row.contact,
        LABELS[row.status],
        date(row.createdAt),
      ]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      const td = document.createElement("td"),
        button = document.createElement("button");
      button.type = "button";
      button.textContent = "View";
      button.setAttribute("aria-label", "View inquiry from " + row.name);
      button.onclick = () => loadDetail(row.business, row.id);
      td.append(button);
      tr.append(td);
      $("inquiry-rows").append(tr);
    }
  }
  function appendHistory(events) {
    for (const event of events) {
      const li = document.createElement("li");
      li.textContent = `${LABELS[event.previousStatus]} → ${LABELS[event.status]} · ${date(event.createdAt)} · Local administrator · version ${event.version}`;
      $("audit-list").append(li);
    }
  }
  function renderDetail(row) {
    state.selected = row;
    state.older = row.history.nextCursor;
    for (const [id, text] of Object.entries({
      "detail-business": row.businessType + " · " + row.businessName,
      "detail-name": row.name,
      "detail-contact": row.contact,
      "detail-status": LABELS[row.status],
      "detail-created": date(row.createdAt),
      "detail-updated": date(row.updatedAt),
      "detail-version": String(row.version),
      "detail-question": row.question,
    }))
      $(id).textContent = text;
    $("status-next").replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose next status";
    placeholder.disabled = true;
    placeholder.selected = true;
    $("status-next").append(placeholder);
    for (const status of row.allowedStatuses) {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = LABELS[status];
      $("status-next").append(option);
    }
    $("status-next").value = "";
    $("status-button").disabled = true;
    $("audit-list").replaceChildren();
    appendHistory(row.history.events);
    $("audit-empty").hidden = row.history.events.length !== 0;
    $("older-history").disabled = !state.older;
    $("detail-panel").hidden = false;
  }
  async function loadList(cursor = null, preserveDetail = false) {
    const mine = epoch,
      serial = ++listSerial;
    if (!preserveDetail) clearDetail();
    $("loading").hidden = false;
    $("empty").hidden = true;
    $("next-page").disabled = true;
    $("inquiry-rows").replaceChildren();
    const query = new URLSearchParams();
    if ($("business-filter").value)
      query.set("business", $("business-filter").value);
    if ($("status-filter").value) query.set("status", $("status-filter").value);
    if (cursor) query.set("cursor", cursor);
    try {
      const result = await request(
        "/api/admin/inquiries" + (query.size ? "?" + query : ""),
      );
      if (mine !== epoch || serial !== listSerial || !armExpiry(result.expiry))
        return;
      if (!Array.isArray(result.data.inquiries))
        throw failure(0, "Unexpected server response.");
      renderRows(result.data.inquiries);
      state.next = result.data.nextCursor;
      $("empty").hidden = result.data.inquiries.length !== 0;
      $("next-page").disabled = !state.next;
      return true;
    } catch (error) {
      if (mine === epoch && serial === listSerial) failed(error);
    } finally {
      if (mine === epoch && serial === listSerial) $("loading").hidden = true;
    }
  }
  async function loadDetail(business, id, notice = "") {
    clearDetail();
    const mine = epoch,
      serial = detailSerial;
    say("Loading inquiry…");
    try {
      const result = await request(path({ business, id }));
      if (
        mine !== epoch ||
        serial !== detailSerial ||
        !armExpiry(result.expiry)
      )
        return;
      renderDetail(result.data);
      $("detail-heading").focus();
      say(notice);
    } catch (error) {
      if (mine === epoch && serial === detailSerial) failed(error);
    }
  }
  async function enter(mine) {
    const result = await request("/api/admin/session");
    if (mine !== epoch) return;
    if (
      result.data.authenticated !== true ||
      typeof result.data.csrfToken !== "string"
    )
      throw failure(401);
    state.csrf = result.data.csrfToken;
    state.authenticated = true;
    if (!armExpiry(result.expiry)) return;
    $("login-panel").hidden = true;
    $("dashboard").hidden = false;
    $("dashboard-heading").focus();
    history?.replaceState(null, "", "/admin");
    say("Fictional demo session active.");
    await loadList();
  }
  $("login-form").onsubmit = async (event) => {
    event.preventDefault();
    if ($("login-button").disabled) return;
    const password = $("admin-password").value;
    $("admin-password").value = "";
    const mine = ++epoch;
    $("login-button").disabled = true;
    say("Signing in…");
    try {
      await request("/api/admin/login", "POST", { password });
      if (mine === epoch) await enter(mine);
    } catch (error) {
      if (mine === epoch) {
        showLogin(
          error.status === 401
            ? "Sign-in failed. Check the passphrase."
            : error.safe
              ? error.message
              : "Sign-in unavailable.",
        );
        $("admin-password").focus();
      }
    } finally {
      if (mine === epoch) $("login-button").disabled = false;
    }
  };
  $("logout").onclick = async () => {
    const pending = request("/api/admin/logout", "POST", {});
    showLogin("Signing out…");
    const mine = epoch;
    try {
      await pending;
      if (mine === epoch) say("Signed out.");
    } catch {
      if (mine === epoch)
        say(
          "Local view cleared. Server logout could not be confirmed; sign in again or wait for expiry.",
          true,
        );
    }
  };
  $("filters").onsubmit = (event) => {
    event.preventDefault();
    say("");
    return loadList();
  };
  $("refresh").onclick = () => {
    say("");
    return loadList();
  };
  $("next-page").onclick = () =>
    state.next ? loadList(state.next) : undefined;
  $("status-next").onchange = () => {
    $("status-button").disabled =
      state.updating ||
      !state.selected?.allowedStatuses.includes($("status-next").value);
  };
  $("status-form").onsubmit = async (event) => {
    event.preventDefault();
    const selected = state.selected,
      status = $("status-next").value;
    if (
      state.updating ||
      $("status-button").disabled ||
      !selected?.allowedStatuses.includes(status)
    )
      return;
    const mine = epoch,
      serial = ++detailSerial;
    state.updating = true;
    $("status-next").disabled = true;
    $("status-button").disabled = true;
    say("Updating status…");
    try {
      const result = await request(path(selected), "PATCH", {
        status,
        version: selected.version,
      });
      if (
        mine !== epoch ||
        serial !== detailSerial ||
        !armExpiry(result.expiry)
      )
        return;
      renderDetail(result.data);
      const listed = await loadList(null, true);
      if (mine === epoch && listed)
        say("Status updated. It may no longer match the selected filters.");
    } catch (error) {
      if (mine !== epoch || serial !== detailSerial) return;
      if (error.status === 409)
        await loadDetail(selected.business, selected.id, MESSAGES[409]);
      else failed(error);
    } finally {
      if (mine === epoch && serial === detailSerial) {
        state.updating = false;
        $("status-next").disabled = false;
        $("status-button").disabled = !state.selected?.allowedStatuses.includes(
          $("status-next").value,
        );
      }
    }
  };
  $("older-history").onclick = async () => {
    if (!state.selected || !state.older || $("older-history").disabled) return;
    const mine = epoch,
      serial = detailSerial;
    $("older-history").disabled = true;
    try {
      const result = await request(
        path(state.selected) +
          "/history?before=" +
          encodeURIComponent(state.older),
      );
      if (
        mine !== epoch ||
        serial !== detailSerial ||
        !armExpiry(result.expiry)
      )
        return;
      appendHistory(result.data.events);
      state.older = result.data.nextCursor;
    } catch (error) {
      if (mine === epoch && serial === detailSerial) failed(error);
    } finally {
      if (mine === epoch && serial === detailSerial)
        $("older-history").disabled = !state.older;
    }
  };
  const restore = async () => {
    const mine = epoch;
    try {
      await enter(mine);
    } catch (error) {
      if (mine === epoch) {
        showLogin(
          error.status === 401
            ? undefined
            : error.safe
              ? error.message
              : "Sign-in unavailable.",
        );
        if (error.status !== 401)
          say(error.safe ? error.message : "Sign-in unavailable.", true);
      }
    }
  };
  const onHide = () => showLogin("Sign in to continue.");
  const onShow = (event) => {
    if (event.persisted) void restore();
  };
  browser?.addEventListener("pagehide", onHide);
  browser?.addEventListener("pageshow", onShow);
  const ready = restore();
  return {
    ready,
    destroy() {
      showLogin();
      browser?.removeEventListener("pagehide", onHide);
      browser?.removeEventListener("pageshow", onShow);
    },
  };
}
if (typeof window !== "undefined")
  mountAdmin({
    document: window.document,
    history: window.history,
    browser: window,
  });
