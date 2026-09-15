export const AUTH_REQUIRED_EVENT = 'workspace:auth-required'
export const AUTH_REQUIRED_CODE = 'AUTH_REQUIRED'

export function authenticationRequiredError(message = 'Authentication is required.') {
  const error = new Error(message)
  error.code = AUTH_REQUIRED_CODE
  return error
}

export function signalAuthenticationRequired() {
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
}
