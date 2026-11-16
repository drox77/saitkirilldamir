import { validateLead } from './lead-rules.js';

const FIELDS = ['firstName', 'patronymic', 'email', 'phone', 'consent'];
const REQUEST_TIMEOUT_MS = 30_000;

const form = document.querySelector('#lead-form');
const submit = form.querySelector('.lead-form__submit');
const submitText = form.querySelector('.lead-form__submit-text');
const alertBox = form.querySelector('.form-alert');
const success = document.querySelector('.form-success');
const idleLabel = submitText.textContent;

let sending = false;
let csrf = null;

function readForm() {
  return {
    firstName: form.elements.firstName.value,
    patronymic: form.elements.patronymic.value,
    email: form.elements.email.value,
    phone: form.elements.phone.value,
    consent: form.elements.consent.checked,
    website: form.elements.website.value,
  };
}

function showFieldError(name, message) {
  const input = form.elements[name];
  const box = form.querySelector(`#${name}-error`);
  box.textContent = message || '';
  box.hidden = !message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function showErrors(errors) {
  for (const name of FIELDS) showFieldError(name, errors[name]);
  const firstInvalid = FIELDS.find((name) => errors[name]);
  if (firstInvalid) form.elements[firstInvalid].focus();
}

function showAlert(message) {
  alertBox.textContent = message || '';
  alertBox.hidden = !message;
}

function setSending(value) {
  sending = value;
  submit.disabled = value;
  form.classList.toggle('is-sending', value);
  form.setAttribute('aria-busy', String(value));
  submitText.textContent = value ? 'Отправляем…' : idleLabel;
}

// Маска «+7 (999) 123-45-67». Разделитель появляется только перед следующей цифрой,
// поэтому Backspace всегда стирает цифру и курсор не застревает на скобках и дефисах.
function formatPhone(raw, deleting) {
  let digits = raw.replace(/\D/g, '');
  if (digits[0] === '7' || digits[0] === '8') digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (!digits) return deleting ? '' : '+7 ';

  let result = `+7 (${digits.slice(0, 3)}`;
  if (digits.length > 3) result += `) ${digits.slice(3, 6)}`;
  if (digits.length > 6) result += `-${digits.slice(6, 8)}`;
  if (digits.length > 8) result += `-${digits.slice(8)}`;
  return result;
}

form.elements.phone.addEventListener('input', (event) => {
  const deleting = (event.inputType || '').startsWith('delete');
  event.target.value = formatPhone(event.target.value, deleting);
});

// После первой ошибки поле перепроверяется при каждом изменении.
form.addEventListener('input', (event) => {
  const { name } = event.target;
  if (!FIELDS.includes(name) || event.target.getAttribute('aria-invalid') !== 'true') return;
  showFieldError(name, validateLead(readForm()).errors[name]);
});

async function csrfToken(forceNew = false) {
  if (!forceNew && csrf && csrf.expiresAt - Date.now() > 60_000) return csrf.token;
  const response = await fetch('/api/csrf', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('csrf_unavailable');
  csrf = await response.json();
  return csrf.token;
}

async function postLead(payload, forceNewToken = false) {
  const response = await fetch('/api/lead', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken(forceNewToken) },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null);
  if (response.status === 403 && data?.code === 'csrf' && !forceNewToken) return postLead(payload, true);
  return { response, data };
}

form.addEventListener('focusin', () => csrfToken().catch(() => {}), { once: true });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (sending) return;

  const payload = readForm();
  const { errors, valid } = validateLead(payload);
  showErrors(errors);
  showAlert('');
  if (!valid) return;

  setSending(true);
  try {
    const { response, data } = await postLead(payload);
    if (response.ok && data?.ok) {
      form.hidden = true;
      success.hidden = false;
      success.focus();
      return;
    }
    if (data?.errors) showErrors(data.errors);
    showAlert(data?.message || 'Не удалось отправить заявку. Попробуйте ещё раз через минуту.');
  } catch {
    showAlert('Нет связи с сервером. Проверьте интернет и отправьте заявку ещё раз.');
  } finally {
    setSending(false);
  }
});
