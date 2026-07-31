const NOTICE_ID = "trakt-api-service-notice";
const ISSUE_URL = "https://github.com/davecollections/trakt-list-lookup/issues/17";

export function showTraktApiServiceNotice() {
  const appShell = document.querySelector(".app-shell");
  if (!appShell || document.querySelector(`#${NOTICE_ID}`)) return;

  const notice = document.createElement("section");
  notice.id = NOTICE_ID;
  notice.setAttribute("role", "alert");
  notice.setAttribute("aria-labelledby", `${NOTICE_ID}-title`);
  notice.innerHTML = `
    <strong id="${NOTICE_ID}-title">Trakt API access change</strong>
    <span>Trakt has changed the access requirements for the API used by this tool. List lookups are temporarily unavailable while the new VIP subscription requirement is assessed.</span>
    <a href="${ISSUE_URL}" target="_blank" rel="noopener noreferrer">View issue #17</a>
  `;

  Object.assign(notice.style, {
    display: "grid",
    gap: "8px",
    marginBottom: "16px",
    padding: "14px 16px",
    border: "1px solid var(--accent)",
    borderRadius: "8px",
    background: "var(--accent-soft)",
    color: "var(--text)",
    boxShadow: "var(--shadow)",
  });

  const title = notice.querySelector("strong");
  if (title) title.style.color = "var(--accent-dark)";

  const link = notice.querySelector("a");
  if (link) {
    link.style.color = "var(--accent-dark)";
    link.style.fontWeight = "700";
  }

  appShell.prepend(notice);
}
