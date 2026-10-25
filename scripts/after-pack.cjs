const path = require('path');
const rcedit = require('rcedit');

module.exports = async function applyWindowsBranding(context) {
  if (context.electronPlatformName !== 'win32') return;

  const appInfo = context.packager.appInfo;
  const executable = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const icon = path.join(context.packager.projectDir, 'assets', 'foto', 'bsr.ico');

  await rcedit(executable, {
    icon,
    'file-version': appInfo.version,
    'product-version': appInfo.version,
    'version-string': {
      CompanyName: 'Brasil Sim Racing',
      FileDescription: 'BSR Racing Hub',
      InternalName: 'BSR Racing Hub',
      LegalCopyright: 'Copyright © Brasil Sim Racing',
      OriginalFilename: 'BSR Racing Hub.exe',
      ProductName: 'BSR Racing Hub'
    }
  });
};
