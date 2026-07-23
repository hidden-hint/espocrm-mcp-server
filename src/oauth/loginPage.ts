export const OAUTH_LOGIN_PATH = "/oauth/login";

export interface LoginPageParams {
  requestToken: string;
  error: string | undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errorBanner(error: string | undefined): string {
  return error === undefined ? "" : `<p class="error">${escapeHtml(error)}</p>`;
}

export function renderLoginPage(params: LoginPageParams): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to EspoCRM</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f4f5f7; margin: 0; display: grid; place-items: center; min-height: 100vh; }
  form { background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.1); width: 320px; }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; }
  label { display: block; margin-bottom: .75rem; font-size: .85rem; color: #333; }
  input[type=text], input[type=password] { width: 100%; padding: .5rem; margin-top: .25rem; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; }
  button { width: 100%; padding: .6rem; border: 0; border-radius: 4px; background: #2563eb; color: #fff; font-size: .95rem; cursor: pointer; }
  .error { color: #b91c1c; font-size: .85rem; margin: 0 0 1rem; }
</style>
</head>
<body>
<form method="post" action="${OAUTH_LOGIN_PATH}">
  <h1>Sign in to EspoCRM</h1>
  ${errorBanner(params.error)}
  <input type="hidden" name="request" value="${escapeHtml(params.requestToken)}">
  <label>Username
    <input type="text" name="username" autocomplete="username" autofocus required>
  </label>
  <label>Password
    <input type="password" name="password" autocomplete="current-password" required>
  </label>
  <button type="submit">Sign in</button>
</form>
</body>
</html>
`;
}
