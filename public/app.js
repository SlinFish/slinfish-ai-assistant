const $ = (id) => document.getElementById(id);
let data = {},
  selected = "realestate",
  generation = 0,
  contextHandle = "",
  contextBusiness = "",
  contextSequence = 0,
  chatPending = false;
const isContextHandle = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
function resetRemote(handle, business) {
  if (isContextHandle(handle)) void post("/api/chat/reset", { business }, { "X-Chat-Context": handle }).catch(() => {});
}
function forgetContext() {
  resetRemote(contextHandle, contextBusiness);
  contextHandle = "";
  contextBusiness = "";
  contextSequence = 0;
}
function resetConversation() {
  generation++;
  forgetContext();
  chatPending = false;
  const button = $("chat").querySelector("button");
  if (button) button.disabled = false;
  $("question").value = "";
  $("messages").replaceChildren();
  bubble("Welcome! Ask about this fictional business. Please use fictional demo information only.");
}
function bubble(text, role = "bot") {
  const el = document.createElement("div");
  el.className = "bubble " + role;
  el.textContent = text;
  $("messages").append(el);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function render() {
  resetConversation();
  $("businesses").replaceChildren();
  for (const [id, business] of Object.entries(data)) {
    const btn = document.createElement("button");
    btn.textContent = business.sector;
    btn.className = id === selected ? "active" : "";
    btn.onclick = () => {
      selected = id;
      render();
    };
    $("businesses").append(btn);
  }
  $("name").textContent = data[selected].name + " · " + data[selected].sector;
  $("status").textContent = "";
  $("lead").reset();
}
async function post(url, payload, headers = {}, receive) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  receive?.(response);
  if (!response.ok)
    throw new Error(
      url === "/api/chat" && result.handoff === true
        ? result.message
        : result.error || "Request failed",
    );
  return result;
}
if ($("reset-chat")) $("reset-chat").onclick = resetConversation;
$("chat").onsubmit = async (event) => {
  event.preventDefault();
  const message = $("question").value.trim();
  if (!message || chatPending) return;
  const current = generation, business = selected;
  const button = $("chat").querySelector("button");
  chatPending = true;
  if (button) button.disabled = true;
  const headers = { "X-Chat-Context": contextHandle || "new" };
  if (contextHandle) headers["X-Chat-Sequence"] = String(contextSequence + 1);
  $("question").value = "";
  bubble(message, "user");
  let receivedHandle = "", receivedSequence = 0;
  try {
    const result = await post("/api/chat", { business, message }, headers, (response) => {
      receivedHandle = response.headers?.get("x-chat-context") || "";
      receivedSequence = Number(response.headers?.get("x-chat-sequence") || 0);
    });
    if (generation !== current) { resetRemote(receivedHandle, business); return; }
    if (contextHandle && contextHandle !== receivedHandle) resetRemote(contextHandle, contextBusiness);
    contextHandle = ""; contextBusiness = ""; contextSequence = 0;
    if (!result.handoff && isContextHandle(receivedHandle) && Number.isInteger(receivedSequence) && receivedSequence >= 1 && receivedSequence <= 6) {
      contextHandle = receivedHandle;
      contextBusiness = business;
      contextSequence = receivedSequence;
    }
    bubble(result.message);
  } catch (error) {
    if (generation === current) { forgetContext(); bubble(error.message || "Connection failed."); }
    else resetRemote(receivedHandle, business);
  } finally {
    if (generation === current) { chatPending = false; if (button) button.disabled = false; }
  }
};
$("lead").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.target,
    button = form.querySelector("button"),
    current = generation;
  if (button.disabled) return;
  button.disabled = true;
  const fields = new FormData(form);
  try {
    const result = await post("/api/lead", {
      business: selected,
      name: fields.get("name"),
      contact: fields.get("contact"),
      question: fields.get("question"),
      consent: fields.get("consent") === "on",
    });
    if (generation === current) {
      $("status").textContent = result.message;
      form.reset();
    }
  } catch (error) {
    if (generation === current)
      $("status").textContent =
        error.message || "Connection failed. Nothing was confirmed saved.";
  } finally {
    button.disabled = false;
  }
};
fetch("/api/businesses")
  .then((response) => {
    if (!response.ok) throw new Error("Unavailable");
    return response.json();
  })
  .then((result) => {
    data = result;
    render();
  })
  .catch(() => bubble("Business information unavailable."));
