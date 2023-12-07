const core = require('@actions/core');
const deployGzip = require('./deploy-gzip');
const deployBr = require('./deploy-br');

function getBooleanInput(name) {
  return core.getInput(name).toLowerCase() === 'true';
}

async function run() {
  try {
    const folder = core.getInput('folder');
    const bucket = core.getInput('bucket');
    const bucketRegion = core.getInput('bucket-region');
    const distId = core.getInput('dist-id');
    const invalidation = core.getInput('invalidation') || '/';
    const deleteRemoved = core.getInput('delete-removed') || false;
    const noCache = getBooleanInput('no-cache');
    const private = getBooleanInput('private');
    const immutable = getBooleanInput('immutable');

    const cacheControl = core.getInput('cacheControl');
    const cache = core.getInput('cache') || null;
    const filesToInclude = core.getInput('files-to-include') || null;

    const contentEncoding = core.getInput('content-encoding') || 'gzip';

    if (contentEncoding !== 'br') {
      core.info('Gzipping files...');
      await deployGzip({
        folder,
        bucket,
        bucketRegion,
        distId,
        invalidation,
        deleteRemoved,
        noCache,
        private,
        cache,
        immutable,
        cacheControl,
        filesToInclude,
      });
    } else {
      core.info('Brotling files...');
      await deployBr({
        folder,
        bucket,
        bucketRegion,
        distId,
        invalidation,
        cache,
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
