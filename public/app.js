const $ = (id) => document.getElementById(id);
let data = {},
  selected = "realestate",
  generation = 0;
function bubble(text, role = "bot") {
  const el = document.createElement("div");
  el.className = "bubble " + role;
  el.textContent = text;
  $("messages").append(el);
  $("messages").scrollTop = $("messages").scrollHeight;
}
function render() {
  generation++;
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
  $("messages").replaceChildren();
  $("status").textContent = "";
  $("lead").reset();
  bubble(
    "Welcome! Ask about this fictional business. Please use fictional demo information only.",
  );
}
async function post(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      url === "/api/chat" && result.handoff === true
        ? result.message
        : result.error || "Request failed",
    );
  return result;
}
$("chat").onsubmit = async (event) => {
  event.preventDefault();
  const message = $("question").value.trim();
  if (!message) return;
  const current = generation;
  $("question").value = "";
  bubble(message, "user");
  try {
    const result = await post("/api/chat", { business: selected, message });
    if (generation === current) bubble(result.message);
  } catch (error) {
    if (generation === current) bubble(error.message || "Connection failed.");
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
