// Правила проверки заявки. Один и тот же модуль импортируют форма в браузере и сервер.

const NAME_PATTERN = /^\p{L}[\p{L}\s'’-]*$/u;
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

const MESSAGES = {
  firstName: { empty: 'Укажите имя', invalid: 'Имя: только буквы, пробел и дефис, от 2 до 50 символов' },
  patronymic: { empty: 'Укажите отчество', invalid: 'Отчество: только буквы, пробел и дефис, от 2 до 50 символов' },
  email: { empty: 'Укажите email', invalid: 'Проверьте email, например name@example.ru' },
  phone: { empty: 'Укажите телефон', invalid: 'Проверьте номер: +7 и 10 цифр' },
  consent: { empty: 'Отметьте согласие на обработку персональных данных' },
};

function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Возвращает номер в виде «+7 (999) 123-45-67» или null, если это не российский номер.
export function normalizePhone(value) {
  let digits = cleanText(value).replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) digits = digits.slice(1);
  if (digits.length !== 10 || !/^[3489]/.test(digits)) return null;
  return `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
}

function checkName(field, raw, errors) {
  const value = cleanText(raw);
  if (!value) errors[field] = MESSAGES[field].empty;
  else if (value.length < 2 || value.length > 50 || !NAME_PATTERN.test(value)) errors[field] = MESSAGES[field].invalid;
  return value;
}

export function validateLead(input) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};

  const firstName = checkName('firstName', source.firstName, errors);
  const patronymic = checkName('patronymic', source.patronymic, errors);

  const email = cleanText(source.email).toLowerCase();
  const localPart = email.split('@')[0];
  if (!email) errors.email = MESSAGES.email.empty;
  else if (email.length > 254 || localPart.length > 64 || email.includes('..') || !EMAIL_PATTERN.test(email)) {
    errors.email = MESSAGES.email.invalid;
  }

  const phone = normalizePhone(source.phone);
  if (!cleanText(source.phone)) errors.phone = MESSAGES.phone.empty;
  else if (!phone) errors.phone = MESSAGES.phone.invalid;

  if (source.consent !== true) errors.consent = MESSAGES.consent.empty;

  return { values: { firstName, patronymic, email, phone }, errors, valid: Object.keys(errors).length === 0 };
}
