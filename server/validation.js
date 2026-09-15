const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validEmail(email) {
  return typeof email === 'string' && email.length <= 180 && emailPattern.test(email);
}

export function validPassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 4096;
}

export function validateRegistration({ displayName, email, password, agreeTerms } = {}) {
  if (!displayName?.trim() || displayName.trim().length > 255) {
    return 'Enter a display name of no more than 255 characters.';
  }

  if (!validEmail(email?.trim() || '')) {
    return 'Enter a valid email address.';
  }

  if (!validPassword(password)) {
    return 'Password must be between 6 and 4,096 characters.';
  }

  if (agreeTerms !== true) {
    return 'You must agree to the terms.';
  }

  return null;
}

export function publicUser(user) {
  return user ? {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    roles: user.roles,
    emailVerified: user.email_verified,
    active: user.is_active
  } : null;
}
