// Domains/extensions that show up as regex false-positives (retina image
// filenames like "logo@2x.png" match the email pattern) or as boilerplate
// placeholder text rather than a real business contact address.
const IGNORED_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "yourdomain.com",
  "email.com",
  "test.com",
  "acme.com",
  "foo.com",
  "bar.com",
  "sentry.io",
  "wixpress.com",
  "godaddy.com",
]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"]);

export function isPlausibleEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  const tld = domain.split(".").pop() ?? "";
  if (IMAGE_EXTENSIONS.has(tld)) return false;
  if (IGNORED_DOMAINS.has(domain)) return false;
  return true;
}
