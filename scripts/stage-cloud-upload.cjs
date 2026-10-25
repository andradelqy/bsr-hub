const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'cloud-upload-v14');
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(path.join(root, 'cloud', 'main.js'), path.join(output, 'bsr-secure-v14.js'));
fs.copyFileSync(path.join(root, 'cloud', 'rating-engine.js'), path.join(output, 'rating-engine.js'));
fs.copyFileSync(path.join(root, 'cloud', 'rating-policy.js'), path.join(output, 'rating-policy.js'));
fs.copyFileSync(path.join(root, 'cloud', 'rating-publication.js'), path.join(output, 'rating-publication.js'));
fs.copyFileSync(path.join(root, 'cloud', 'rating-calibration.js'), path.join(output, 'rating-calibration.js'));
fs.writeFileSync(path.join(output, 'main.js'), "'use strict';\nrequire('./bsr-secure-v14');\n");
fs.copyFileSync(path.join(root, 'BACK4APP_SETUP.md'), path.join(output, 'BACK4APP_SETUP.md'));
fs.copyFileSync(path.join(root, 'RATINGS_3_1_RELEASE.md'), path.join(output, 'RATINGS_3_1_RELEASE.md'));
console.log(`Cloud Code preparado em ${output}`);
