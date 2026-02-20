async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    renderRoles(data);
    renderPipeline(data);
    renderBudget(data);
    renderNightShift(data);
  } catch (err) {
    console.error("Failed to fetch status:", err);
  }

  try {
    const res = await fetch("/api/sessions");
    const data = await res.json();
    renderSessions(data.sessions);
  } catch (err) {
    console.error("Failed to fetch sessions:", err);
  }
}

function renderRoles(data) {
  const el = document.getElementById("roles");
  const projectEl = document.getElementById("project-name");
  projectEl.textContent = data.projectName;

  const pm = data.pm;
  let html = `
    <div class="role-item">
      <span class="role-dot ${pm.state !== "idle" ? "active" : ""}"></span>
      <span class="role-name">PM</span>
      <span class="role-status">${pm.state}${pm.lastPollAt ? ` (${timeAgo(pm.lastPollAt)})` : ""}</span>
    </div>
    <div class="role-item">
      <span class="role-dot ${pm.ctoRunning ? "active" : ""}"></span>
      <span class="role-name">CTO</span>
      <span class="role-status">${pm.ctoRunning ? "reviewing " + pm.ctoReviewing.map(n => "#" + n).join(", ") : "idle"}</span>
    </div>
  `;

  for (const dev of data.developers) {
    const elapsed = timeAgo(dev.startedAt);
    html += `
      <div class="role-item">
        <span class="role-dot active"></span>
        <span class="role-name">Dev #${dev.issueNumber}</span>
        <span class="role-status">coding (${elapsed})</span>
      </div>
    `;
  }

  el.innerHTML = html;
}

function renderPipeline(data) {
  const el = document.getElementById("pipeline");
  const pm = data.pm;
  el.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">PRs awaiting CTO</span>
      <span class="stat-value">${pm.prsAwaitingCTO}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">PRs awaiting human</span>
      <span class="stat-value">${pm.prsAwaitingHuman}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Active developers</span>
      <span class="stat-value">${pm.activeDevelopers}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Issues in queue</span>
      <span class="stat-value">${pm.issuesInQueue}</span>
    </div>
  `;
}

function renderBudget(data) {
  const el = document.getElementById("budget");
  const b = data.budget;
  el.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">Project sessions</span>
      <span class="stat-value">${b.activeProjectSessions}/${b.maxProjectSessions}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Total sessions</span>
      <span class="stat-value">${b.activeTotalSessions}/${b.maxTotalSessions}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Est. cost today</span>
      <span class="stat-value">$${b.estimatedDailyCostUsd.toFixed(2)}/$${b.maxDailyCostUsd.toFixed(2)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Burn rate</span>
      <span class="stat-value">$${b.burnRatePerMinute.toFixed(2)}/min</span>
    </div>
  `;
}

function renderNightShift(data) {
  const el = document.getElementById("night-shift");
  if (!el) return;
  const ns = data.nightShift;
  if (!ns) {
    el.innerHTML = '<span class="stat-label">Disabled</span>';
    return;
  }
  const sourceLabel = ns.usageSource === "api" ? "API" : "estimated";
  let html = `
    <div class="stat-row">
      <span class="stat-label">Status</span>
      <span class="stat-value">${ns.active ? "active" : ns.windowOpen ? "window open" : "idle"}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Weekly usage</span>
      <span class="stat-value">${ns.weeklyUsagePercent.toFixed(1)}% (${sourceLabel})</span>
    </div>
  `;
  if (ns.fiveHourUtilization != null) {
    html += `
    <div class="stat-row">
      <span class="stat-label">5-hour usage</span>
      <span class="stat-value">${ns.fiveHourUtilization.toFixed(1)}%</span>
    </div>
    `;
  }
  html += `
    <div class="stat-row">
      <span class="stat-label">Headroom</span>
      <span class="stat-value">${ns.headroomPercent.toFixed(1)}%</span>
    </div>
  `;
  if (ns.throttled) {
    html += `<div class="stat-row"><span class="stat-label" style="color: #e0af68">Throttled: approaching safety margin</span></div>`;
  }
  el.innerHTML = html;
}

function renderSessions(sessions) {
  const el = document.getElementById("sessions");
  if (!sessions || sessions.length === 0) {
    el.innerHTML = '<span class="stat-label">No active sessions</span>';
    return;
  }
  el.innerHTML = sessions
    .map(s => `<a class="session-link" href="/terminal?session=${encodeURIComponent(s)}">${s}</a>`)
    .join("");
}

function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// Initial fetch + poll every 5s
fetchStatus();
setInterval(fetchStatus, 5000);
