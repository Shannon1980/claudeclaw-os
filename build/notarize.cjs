// electron-builder afterSign hook — notarize the signed .app via Apple's
// notary service (the electron-builder 25.x path; 26.x has built-in
// `notarize: true`, but we are pinned to 25.1.8 per RESEARCH A4).
//
// Reads notary credentials from the build environment only:
//   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
//
// Degrades gracefully:
//   - non-macOS build  -> skip (notarization is mac-only)
//   - creds absent      -> skip with a clear log line, so a local/dev build
//                          still produces an (unsigned) .dmg instead of erroring
//
// Credentials are never echoed (threat T-04-02): only their presence/absence
// is logged, never their values.

const { notarize } = require('@electron/notarize');

module.exports = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    console.log('[notarize] skip — not a macOS build.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      '[notarize] skip — notary credentials absent ' +
        '(APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID). ' +
        'Producing an UNSIGNED dev build; Gatekeeper will block it on a clean Mac (PKG-01 not met).'
    );
    return;
  }

  console.log(`[notarize] submitting ${appName}.app to Apple notary service…`);

  await notarize({
    appBundleId: 'com.claudeclaw.app',
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  console.log('[notarize] notarization successful.');
};
