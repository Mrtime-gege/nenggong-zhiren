/* 能工智人 login page. Dependency-free and CSP-friendly. */
(() => {
  const form = document.getElementById("login-form");
  const button = document.getElementById("login-submit");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const totp = document.getElementById("totp");
  const totpProgress = document.getElementById("totp-progress");
  const toggle = document.getElementById("password-toggle");
  const caps = document.getElementById("caps-lock");
  const error = document.querySelector(".login-error");
  const card = document.querySelector(".login-card");
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  if (username && !username.value) username.focus();

  function setLoading(loading) {
    if (!button) return;
    button.classList.toggle("is-loading", loading);
    button.disabled = loading;
    button.setAttribute("aria-busy", loading ? "true" : "false");
    const label = button.querySelector(".submit-label");
    if (label) label.textContent = loading ? "正在验证…" : "登录控制台";
  }

  function updateTotp() {
    if (!totp) return;
    const digits = String(totp.value || "").replace(/\D/g, "").slice(0, 6);
    if (totp.value !== digits) totp.value = digits;
    if (totpProgress) {
      totpProgress.textContent = `${digits.length} / 6`;
      totpProgress.classList.toggle("complete", digits.length === 6);
    }
  }

  function updateCaps(event) {
    if (!caps) return;
    const on = typeof event?.getModifierState === "function" && event.getModifierState("CapsLock");
    caps.classList.toggle("hidden", !on);
  }

  if (form && button) {
    form.addEventListener("submit", (event) => {
      if (button.disabled) {
        event.preventDefault();
        return;
      }
      setLoading(true);
      window.setTimeout(() => {
        if (!form.isConnected) return;
        setLoading(false);
      }, 15_000);
    });
  }

  toggle?.addEventListener("click", () => {
    if (!password) return;
    const showing = password.type === "text";
    password.type = showing ? "password" : "text";
    toggle.textContent = showing ? "显示" : "隐藏";
    toggle.setAttribute("aria-label", showing ? "显示密码" : "隐藏密码");
    password.focus();
    const end = password.value.length;
    password.setSelectionRange?.(end, end);
  });

  totp?.addEventListener("input", updateTotp);
  totp?.addEventListener("paste", () => window.setTimeout(updateTotp, 0));
  totp?.addEventListener("keydown", updateCaps);
  password?.addEventListener("keydown", updateCaps);
  password?.addEventListener("keyup", updateCaps);
  password?.addEventListener("blur", () => caps?.classList.add("hidden"));

  form?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  if (card && !reduceMotion) {
    let frame = 0;
    card.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${Math.round(event.clientX - rect.left)}px`);
        card.style.setProperty("--my", `${Math.round(event.clientY - rect.top)}px`);
      });
    }, { passive: true });
  }

  if (error && error.textContent.trim()) {
    password?.focus();
    password?.select();
    error.classList.add("shake");
    window.setTimeout(() => error.classList.remove("shake"), 340);
  }

  updateTotp();
})();
