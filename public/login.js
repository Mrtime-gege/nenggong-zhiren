/* 能工智人 login page. Kept dependency-free and CSP-friendly. */
(() => {
  const form = document.getElementById("login-form");
  const button = document.getElementById("login-submit");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const error = document.querySelector(".login-error");

  if (username && !username.value) username.focus();

  if (form && button) {
    form.addEventListener("submit", () => {
      button.disabled = true;
      button.textContent = "登录中…";
    });
  }

  const toggle = document.getElementById("password-toggle");
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

  if (error && error.textContent.trim()) {
    password?.focus();
    password?.select();
  }
})();
