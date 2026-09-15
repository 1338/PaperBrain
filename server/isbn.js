function normalize(value) {
  return String(value || '').toUpperCase().replace(/[^0-9X]/g, '');
}

export function validIsbn(value) {
  const isbn = normalize(value);
  if (isbn.length === 10) {
    const sum = [...isbn].reduce((total, character, index) => {
      const digit = character === 'X' && index === 9 ? 10 : Number(character);
      return total + digit * (10 - index);
    }, 0);
    return /^\d{9}[\dX]$/.test(isbn) && sum % 11 === 0;
  }
  if (isbn.length === 13 && /^(978|979)\d{10}$/.test(isbn)) {
    const sum = [...isbn.slice(0, 12)].reduce(
      (total, character, index) => total + Number(character) * (index % 2 ? 3 : 1), 0
    );
    return (10 - (sum % 10)) % 10 === Number(isbn[12]);
  }
  return false;
}

export function extractIsbn(text) {
  const source = String(text || '');
  const labelled = source.matchAll(/ISBN(?:-1[03])?\s*:?\s*((?:97[89][\s.-]?)?\d(?:[\dX][\s.-]?){8,12})/gi);
  const candidates = [...labelled].map((match) => match[1]);
  candidates.push(...source.matchAll(/\b(97[89](?:[\s.-]?\d){10})\b/g));
  for (const candidate of candidates) {
    const value = Array.isArray(candidate) ? candidate[1] : candidate;
    const normalized = normalize(value);
    if (validIsbn(normalized)) return normalized;
  }
  return null;
}
