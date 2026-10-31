/* ============================================================
   Login page behaviour.

   If the browser already holds a valid session cookie, the admin is
   sent straight to the dashboard - this is what makes the device
   stay remembered across refreshes and browser restarts.
   ============================================================ */

'use strict';

(function () {
  const form     = document.getElementById('loginForm');
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const submit   = document.getElementById('loginSubmit');
  const errorBox = document.getElementById('loginError');
  const toggle   = document.getElementById('togglePassword');

  /** Show an inline error message. */
  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  /** Hide the inline error message. */
  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  /** Toggle the busy state of the submit button. */
  function setBusy(isBusy) {
    submit.disabled = isBusy;
    const label = submit.querySelector('.btn-label');
    const spinner = submit.querySelector('.spinner');
    if (label) { label.textContent = isBusy ? 'جارٍ التحقق' : 'دخول'; }
    if (spinner) { spinner.hidden = !isBusy; }
  }

  /* Already signed in? Go straight through. */
  api.session()
    .then(function (payload) {
      if (payload.authenticated === true) {
        window.location.replace('index.html');
      }
    })
    .catch(function () {
      /* Not signed in, or the server is unreachable - stay on the form. */
    });

  /* Show / hide the password. */
  if (toggle) {
    toggle.addEventListener('click', function () {
      const showing = password.type === 'text';
      password.type = showing ? 'password' : 'text';
      toggle.setAttribute('aria-label', showing ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور');
      password.focus();
    });
  }

  /* Submit. */
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearError();

    const user = username.value.trim();
    const pass = password.value;

    if (user === '' || pass === '') {
      showError('يرجى إدخال اسم المستخدم وكلمة المرور.');
      return;
    }

    setBusy(true);

    api.login(user, pass)
      .then(function () {
        window.location.replace('index.html');
      })
      .catch(function (error) {
        setBusy(false);
        password.value = '';

        if (error.status === 0) {
          showError('تعذّر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.');
        } else if (error.status === 429) {
          showError('محاولات كثيرة. يُرجى الانتظار قليلاً ثم المحاولة مرة أخرى.');
        } else {
          showError(error.message || 'بيانات الدخول غير صحيحة.');
        }

        password.focus();
      });
  });

  username.focus();
}());
