const ADMIN_ACCESS_TOKEN_KEY = 'cabinet_admin_access_token';

export function getAdminAccessToken() {
  return window.localStorage.getItem(ADMIN_ACCESS_TOKEN_KEY);
}

export function setAdminAccessToken(token: string) {
  window.localStorage.setItem(ADMIN_ACCESS_TOKEN_KEY, token);
}

export function clearAdminAccessToken() {
  window.localStorage.removeItem(ADMIN_ACCESS_TOKEN_KEY);
}
