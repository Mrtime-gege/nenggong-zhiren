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

  if (error && error.textContent.trim()) {
    password?.focus();
    password?.select();
  }
})();
