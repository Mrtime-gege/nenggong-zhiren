/*
 * Floating password-strength popover. Length is a hard server rule; the
 * complexity information is advisory and never disables submission.
 */
(function () {
  const COMMON = new Set([
    "123456", "1234567", "12345678", "123456789", "1234567890",
    "000000", "00000000", "111111", "11111111",
    "password", "passw0rd", "passworld", "passw0rld", "passw0rd1",
    "p@ssword", "p@ssw0rd", "p@ssw0rld",
    "qwerty", "qwerty123", "1q2w3e4r", "qazwsx", "asdfgh", "zxcvbn",
    "abc123", "abc12345", "abcdefgh", "letmein", "welcome", "admin",
    "administrator", "iloveyou", "monkey", "dragon", "football",
    "baseball", "sunshine", "princess", "master", "shadow", "superman",
    "trustno1", "whatever", "freedom", "starwars", "hello", "hello123",
    "test1234", "testtest", "changeme", "secret", "login", "root", "toor",
  ]);
  const LEET = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "8": "b", "9": "g" };
  const popovers = new WeakMap();

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[013457@$!89]/g, (char) => LEET[char] || char)
      .replace(/[^a-z0-9]/g, "");
  }

  function isCommon(value) {
    const normalized = normalize(value);
    if (COMMON.has(normalized)) return true;
    if (/(password|passworld|qwerty|letmein|admin|welcome|iloveyou)/.test(normalized)) return true;
    if (/(123456|654321|abcdef|qazwsx|1q2w3e4r)/.test(normalized)) return true;
    return false;
  }

  function assess(value) {
    const password = String(value || "");
    if (!password) {
      return { visible: false, score: 0, level: "empty", label: "", warnings: [] };
    }
    const common = isCommon(password);
    const classes = [
      /[a-z]/.test(password),
      /[A-Z]/.test(password),
      /[0-9]/.test(password),
      /[^A-Za-z0-9]/.test(password),
    ].filter(Boolean).length;
    let score = 0;
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (password.length >= 16) score += 1;
    if (classes >= 2) score += 1;
    if (classes >= 3) score += 1;
    if (classes >= 4) score += 1;

    const warnings = [];
    if (password.length < 8) warnings.push("长度不足 8 位（硬性要求）");
    if (common) warnings.push("常见密码或可预测的替换变体");
    if (/^\d+$/.test(password)) warnings.push("纯数字");
    if (/(.)\1{2,}/.test(password)) warnings.push("重复字符过多");
    if (/^(?:qwerty|asdfgh|zxcvbn|123456|abcdef)/i.test(password)) warnings.push("键盘或字母顺序");
    if (classes < 2 && !common) warnings.push("混合大小写、数字或符号");

    if (common || password.length < 8) score = Math.min(score, 1);
    const level = score <= 2 ? "weak" : score <= 3 ? "medium" : "strong";
    const label = level === "weak" ? "弱" : level === "medium" ? "中" : "强";
    return { visible: true, score, level, label, warnings };
  }

  function ensurePopover(input) {
    let pop = popovers.get(input);
    if (pop) return pop;
    pop = document.createElement("div");
    pop.className = "password-popover hidden";
    pop.setAttribute("role", "status");
    pop.setAttribute("aria-live", "polite");
    const head = document.createElement("div");
    head.className = "password-strength-head";
    const label = document.createElement("span");
    label.className = "password-strength-label";
    head.append(label);
    const meter = document.createElement("div");
    meter.className = "password-meter";
    const fill = document.createElement("span");
    fill.className = "password-meter-fill";
    meter.append(fill);
    const hint = document.createElement("div");
    hint.className = "password-strength-hint";
    pop.append(head, meter, hint);
    document.body.append(pop);
    popovers.set(input, pop);
    return pop;
  }

  function position(input, pop) {
    const rect = input.getBoundingClientRect();
    const width = Math.min(360, Math.max(220, window.innerWidth - 24));
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)}px`;
    const height = pop.offsetHeight;
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 8);
    pop.style.top = `${top}px`;
  }

  function show(input) {
    const pop = ensurePopover(input);
    clearTimeout(input.__ngzrPasswordHideTimer);
    pop.classList.remove("hidden");
    render(input);
    // Let the browser calculate the popover height, then place it.
    position(input, pop);
    requestAnimationFrame(() => pop.classList.add("visible"));
  }

  function hide(input) {
    const pop = popovers.get(input);
    if (!pop) return;
    pop.classList.remove("visible");
    input.__ngzrPasswordHideTimer = setTimeout(() => {
      if (!pop.classList.contains("visible")) pop.classList.add("hidden");
    }, 180);
  }

  function render(input) {
    const pop = popovers.get(input);
    if (!pop) return;
    const result = assess(input.value);
    const label = pop.querySelector(".password-strength-label");
    const fill = pop.querySelector(".password-meter-fill");
    const hint = pop.querySelector(".password-strength-hint");
    if (!input.value) {
      pop.dataset.level = "empty";
      label.textContent = "密码强度：—";
      fill.style.width = "0";
      hint.textContent = "至少 8 位；输入内容后显示复杂度。";
      return;
    }
    pop.dataset.level = result.level;
    label.textContent = `密码强度：${result.label}`;
    fill.style.width = `${result.level === "weak" ? 28 : result.level === "medium" ? 62 : 100}%`;
    hint.textContent = result.warnings.length ? [...new Set(result.warnings)].join("；") : "未发现常见弱密码特征。";
  }

  function mount(input) {
    if (!input || input.dataset.passwordStrengthMounted === "1") return;
    input.dataset.passwordStrengthMounted = "1";
    input.addEventListener("focus", () => show(input));
    input.addEventListener("blur", () => hide(input));
    input.addEventListener("input", () => {
      render(input);
      if (document.activeElement === input) {
        const pop = popovers.get(input);
        if (pop) position(input, pop);
      }
    });
    window.addEventListener("resize", () => {
      const pop = popovers.get(input);
      if (pop?.classList.contains("visible")) position(input, pop);
    });
    window.addEventListener("scroll", () => {
      const pop = popovers.get(input);
      if (pop?.classList.contains("visible")) position(input, pop);
    }, true);
  }

  window.NGZRPasswordStrength = { assess, render, mount, hide };
})();
