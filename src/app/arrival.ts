// Read once, as the page starts: did the person just come back from signing in (Google sends them back with a one-time code)?
// If the sign-in service was only told about the site's front page, they land on "/" instead of "/auth": the app sends them on.
const here = typeof window === 'undefined' ? '' : `${window.location.search}${window.location.hash}`;
export const ARRIVED_FROM_SIGN_IN = /[?&#](code|access_token|error_description)=/.test(here);
