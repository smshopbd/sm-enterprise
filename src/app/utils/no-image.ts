/** Neutral built-in placeholder: no external request, no random photo for picture-less records. */
export const NO_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" fill="#e2e8f0"/>' +
      '<path d="M18 42l11-13 7 8 5-6 8 11H18z" fill="#94a3b8"/>' +
      '<circle cx="25" cy="24" r="5" fill="#94a3b8"/>' +
      '</svg>'
  );
