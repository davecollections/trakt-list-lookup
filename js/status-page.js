const root = document.documentElement;
const toggle = document.getElementById("theme-toggle");
const storedTheme = localStorage.getItem("theme");
const preferredDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

function applyTheme(theme) {
  root.dataset.theme = theme;
  toggle?.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
  );
}

applyTheme(storedTheme || (preferredDark ? "dark" : "light"));

toggle?.addEventListener("click", () => {
  const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", nextTheme);
  applyTheme(nextTheme);
});
