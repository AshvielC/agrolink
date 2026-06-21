(function () {
  const navToggle = document.querySelector('.nav-toggle');
  const navMenu = document.querySelector('#nav-menu');
  const desktopQuery = window.matchMedia('(min-width: 900px)');

  function closeMenu() {
    if (!navToggle || !navMenu) return;
    navMenu.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('nav-open');
  }

  function openMenu() {
    if (!navToggle || !navMenu) return;
    navMenu.classList.add('is-open');
    navToggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('nav-open');
  }

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', function () {
      const isOpen = navMenu.classList.contains('is-open');
      if (isOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    navMenu.addEventListener('click', function (event) {
      const target = event.target;
      if (target && target.closest('a')) {
        closeMenu();
      }
    });

    document.addEventListener('click', function (event) {
      const target = event.target;
      if (!target || !navMenu.classList.contains('is-open')) return;
      if (!navMenu.contains(target) && !navToggle.contains(target)) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeMenu();
      }
    });

    desktopQuery.addEventListener('change', function (event) {
      if (event.matches) {
        closeMenu();
      }
    });
  }

  const passwordButtons = document.querySelectorAll('[data-password-toggle]');

  passwordButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      const wrapper = button.closest('.password-wrap');
      if (!wrapper) return;

      const input = wrapper.querySelector('input');
      if (!input) return;

      const showPassword = input.type === 'password';
      input.type = showPassword ? 'text' : 'password';
      button.textContent = showPassword ? 'Hide' : 'Show';
      button.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
    });
  });

  const confirmForms = document.querySelectorAll('form[data-confirm]');

  confirmForms.forEach(function (form) {
    form.addEventListener('submit', function (event) {
      const message = form.getAttribute('data-confirm') || 'Are you sure?';
      if (!window.confirm(message)) {
        event.preventDefault();
      }
    });
  });

  const submitConfirmForms = document.querySelectorAll('form');

  submitConfirmForms.forEach(function (form) {
    form.addEventListener('submit', function (event) {
      const submitter = event.submitter;
      if (!submitter) return;

      const message = submitter.getAttribute('data-confirm-submit');
      if (message && !window.confirm(message)) {
        event.preventDefault();
      }
    });
  });

  const printButtons = document.querySelectorAll('[data-print]');

  printButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      const originalText = button.textContent;
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.classList.add('is-processing');
      button.textContent = 'Preparing print...';

      const restore = function () {
        button.disabled = false;
        button.removeAttribute('aria-disabled');
        button.classList.remove('is-processing');
        button.textContent = originalText;
        window.removeEventListener('afterprint', restore);
      };

      window.addEventListener('afterprint', restore);
      window.setTimeout(restore, 2500);
      window.print();
    });
  });



  const notificationBadge = document.querySelector('[data-notification-badge]');
  const notificationLink = document.querySelector('[data-notification-link]');

  function updateNotificationBadge(count) {
    if (!notificationBadge) return;
    const safeCount = Number(count || 0);
    notificationBadge.textContent = safeCount > 9 ? '9+' : String(safeCount);
    notificationBadge.setAttribute('aria-label', `${safeCount} unread notifications`);
    notificationBadge.classList.toggle('is-hidden', safeCount <= 0);
    if (notificationLink) {
      notificationLink.classList.toggle('has-unread', safeCount > 0);
    }
  }

  async function refreshNotificationCount() {
    if (!notificationBadge) return;

    try {
      const response = await fetch('/dashboard/notifications/count', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });

      if (!response.ok) return;
      const data = await response.json();
      updateNotificationBadge(data.unreadNotificationCount);
    } catch (error) {
      // Keep the UI quiet if the browser is offline or the session has expired.
    }
  }

  if (notificationBadge) {
    refreshNotificationCount();
    window.setInterval(refreshNotificationCount, 5000);
    window.addEventListener('focus', refreshNotificationCount);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshNotificationCount();
    });
  }

  const calculators = document.querySelectorAll('[data-order-calculator]');

  function money(value, currency) {
    try {
      return new Intl.NumberFormat('en-FJ', {
        style: 'currency',
        currency: currency || 'FJD',
        maximumFractionDigits: 2
      }).format(Number(value || 0));
    } catch (error) {
      return `${currency || 'FJD'} ${Number(value || 0).toFixed(2)}`;
    }
  }

  function roundMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function calculateTotals(unitPrice, quantity, vatMode, vatRate) {
    const base = Math.max(0, Number(unitPrice || 0)) * Math.max(0, Number(quantity || 0));
    const rate = Math.min(100, Math.max(0, Number(vatRate || 0)));

    if (!rate || vatMode === 'none') {
      return { subtotal: roundMoney(base), vat: 0, total: roundMoney(base) };
    }

    if (vatMode === 'inclusive') {
      const subtotal = base / (1 + rate / 100);
      return { subtotal: roundMoney(subtotal), vat: roundMoney(base - subtotal), total: roundMoney(base) };
    }

    const vat = base * (rate / 100);
    return { subtotal: roundMoney(base), vat: roundMoney(vat), total: roundMoney(base + vat) };
  }

  calculators.forEach(function (calculator) {
    const quantityInput = document.querySelector('#requestedQuantity');
    const subtotalEl = calculator.querySelector('[data-order-subtotal]');
    const vatEl = calculator.querySelector('[data-order-vat]');
    const totalEl = calculator.querySelector('[data-order-total]');
    if (!quantityInput || !subtotalEl || !vatEl || !totalEl) return;

    function updateTotals() {
      const totals = calculateTotals(
        calculator.getAttribute('data-unit-price'),
        quantityInput.value,
        calculator.getAttribute('data-vat-mode') || 'none',
        calculator.getAttribute('data-vat-rate') || 0
      );
      const currency = calculator.getAttribute('data-currency') || 'FJD';
      subtotalEl.textContent = money(totals.subtotal, currency);
      vatEl.textContent = money(totals.vat, currency);
      totalEl.textContent = money(totals.total, currency);
    }

    quantityInput.addEventListener('input', updateTotals);
    updateTotals();
  });


  function setButtonProcessing(button, isProcessing) {
    if (!button) return;

    if (isProcessing) {
      if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent;
      }
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.classList.add('is-processing');
      if (button.type === 'submit') {
        button.textContent = button.dataset.processingText || 'Processing...';
      }
      return;
    }

    button.disabled = false;
    button.removeAttribute('aria-disabled');
    button.classList.remove('is-processing');
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
  }

    const allForms = document.querySelectorAll('form');

    allForms.forEach(function (form) {
        form.addEventListener('submit', function (event) {
            if (event.defaultPrevented) return;

            if (form.dataset.submitting === 'true') {
                event.preventDefault();
                return;
            }

            if (
                typeof form.checkValidity === 'function' &&
                !form.checkValidity()
            ) {
                return;
            }

            form.dataset.submitting = 'true';

            const submitter = event.submitter;

            // When a clicked submit button carries name/value data, preserve that value
            // before disabling buttons for double-submit protection.
            if (
                submitter &&
                submitter.name &&
                submitter.value &&
                !form.querySelector(
                    `input[type="hidden"][data-submit-preserve="${submitter.name}"]`
                )
            ) {
                const preserved = document.createElement('input');
                preserved.type = 'hidden';
                preserved.name = submitter.name;
                preserved.value = submitter.value;
                preserved.setAttribute('data-submit-preserve', submitter.name);
                form.appendChild(preserved);
            }

            const buttons = form.querySelectorAll(
                'button[type="submit"], input[type="submit"]'
            );

            buttons.forEach(function (button) {
                setButtonProcessing(button, true);
            });

            if (form.dataset.disableSubmitTimeoutReset === 'true') {
                return;
            }

            // If the browser stays on this page because a request is blocked or interrupted,
            // make the controls usable again instead of leaving the user stuck.
            window.setTimeout(function () {
                if (document.visibilityState === 'visible') {
                    form.dataset.submitting = 'false';

                    buttons.forEach(function (button) {
                        setButtonProcessing(button, false);
                    });
                }
            }, 12000);
        });
    });

    window.addEventListener('pageshow', function () {
        document.querySelectorAll('form').forEach(function (form) {
            form.dataset.submitting = 'false';
        });

        document.querySelectorAll('button.is-processing').forEach(function (button) {
            setButtonProcessing(button, false);
        });
    });

  if (document.querySelector('[data-auto-print="true"]')) {
    window.addEventListener('load', function () {
      window.print();
    });
  }


  const alerts = document.querySelectorAll('.alert');

  alerts.forEach(function (alert) {
    window.setTimeout(function () {
      alert.classList.add('is-fading');
    }, 5000);
  });
})();
