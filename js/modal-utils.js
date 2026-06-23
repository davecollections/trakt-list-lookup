const modalStack = [];
const modalReturnFocus = new Map();
const modalCloseHandlers = new Map();
let initialized = false;

export function initModalSystem() {
  if (initialized) return;
  initialized = true;

  document.addEventListener("keydown", (event) => {
    const modal = getTopModal();
    if (!modal) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeTopModal();
      return;
    }

    if (event.key === "Tab") {
      trapModalFocus(event, modal);
    }
  });
}

export function openModal(modal, { focusTarget = null, onClose = null } = {}) {
  if (!modal) return;

  if (!modalReturnFocus.has(modal) && document.activeElement instanceof HTMLElement) {
    modalReturnFocus.set(modal, document.activeElement);
  }

  modal.hidden = false;
  document.body.classList.add("modal-open");

  if (!modalStack.includes(modal)) {
    modalStack.push(modal);
  }
  syncModalStack();

  if (onClose) {
    modalCloseHandlers.set(modal, onClose);
  }

  requestAnimationFrame(() => {
    const target = getFocusTarget(focusTarget);
    const fallback = getFocusableElements(modal)[0];
    (target || fallback)?.focus();
  });
}

export function closeModal(modal) {
  if (!modal) return;

  modal.hidden = true;
  modalCloseHandlers.delete(modal);

  const stackIndex = modalStack.indexOf(modal);
  if (stackIndex !== -1) {
    modalStack.splice(stackIndex, 1);
  }
  resetModalAccessibility(modal);
  syncModalStack();

  const returnTarget = modalReturnFocus.get(modal);
  modalReturnFocus.delete(modal);

  if (modalStack.length) {
    requestAnimationFrame(() => {
      const topModal = getTopModal();
      if (topModal) getFocusableElements(topModal)[0]?.focus();
    });
    return;
  }

  document.body.classList.remove("modal-open");
  if (returnTarget instanceof HTMLElement && document.contains(returnTarget)) {
    returnTarget.focus();
  }
}

export function isModalOpen(modal) {
  return Boolean(modal && !modal.hidden);
}

function closeTopModal() {
  const modal = getTopModal();
  if (!modal) return;

  const closeHandler = modalCloseHandlers.get(modal);
  if (closeHandler) {
    closeHandler();
    return;
  }

  closeModal(modal);
}

function getTopModal() {
  for (let index = modalStack.length - 1; index >= 0; index -= 1) {
    const modal = modalStack[index];
    if (modal && !modal.hidden) return modal;
  }
  return null;
}

function syncModalStack() {
  const topModal = getTopModal();

  modalStack.forEach((modal) => {
    const isTop = modal === topModal && !modal.hidden;
    const dialog = modal.querySelector('[role="dialog"]');
    modal.inert = !isTop;
    if (!dialog) return;

    dialog.setAttribute("aria-modal", isTop ? "true" : "false");
    dialog.toggleAttribute("aria-hidden", !isTop);
  });
}

function resetModalAccessibility(modal) {
  modal.inert = false;
  const dialog = modal.querySelector('[role="dialog"]');
  if (!dialog) return;

  dialog.setAttribute("aria-modal", "true");
  dialog.removeAttribute("aria-hidden");
}

function getFocusTarget(target) {
  if (!target) return null;
  return typeof target === "string" ? document.querySelector(target) : target;
}

function getFocusableElements(modal) {
  return [...modal.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.offsetParent !== null);
}

function trapModalFocus(event, modal) {
  const focusableElements = getFocusableElements(modal);
  if (!focusableElements.length) {
    event.preventDefault();
    modal.focus();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (!modal.contains(document.activeElement)) {
    event.preventDefault();
    firstElement.focus();
    return;
  }

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  }

  if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}
