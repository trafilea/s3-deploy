/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 142:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const path = __nccwpck_require__(928);
const fs = __nccwpck_require__(896);
const zlib = __nccwpck_require__(106);
const crypto = __nccwpck_require__(982);
const mime = __nccwpck_require__(837);
const { PutObjectCommand, S3Client } = __nccwpck_require__(599);
const { CreateInvalidationCommand, CloudFrontClient } = __nccwpck_require__(62);

const extensions = ['.xml', '.html', '.htm', '.js', '.css', '.ttf', '.otf', '.txt'];

const deploy = async function (params) {
  const { folder, bucket, bucketRegion, distId, invalidation, cache, cacheControl } = params;
  try {
    const files = getFiles(folder);
    const ETag = base64Md5(files.toString());
    console.log('► Target S3 bucket: %s (%s region)', bucket, bucketRegion);
    console.log('► Deploying files: %s', files);
    for (const filePath of files) {
      const file = fs.readFileSync(filePath);
      const compressedFile = compressFile(file);
      fs.writeFileSync(filePath, compressedFile);
      const bucketKey = filePath.startsWith(folder) ? filePath.replace(`${folder}/`, '') : filePath;
      await putInS3(bucketRegion, bucket, bucketKey, compressedFile, cache, cacheControl, ETag);
    }
    console.log('▼ CloudFront');
    console.log('  ▹ Distribution ID:', distId);
    console.log('  ▹ Invalidate files:', invalidation);
    await invalidateDistribution(distId, invalidation);
  } catch (e) {
    throw e;
  }
};

module.exports = deploy;

function compressFile(file) {
  return zlib.brotliCompressSync(file, {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, // Compression mode: text
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11, // Compression quality (0-11, 11 is highest quality)
    },
  });
}

function getFiles(folder) {
  let result = [];
  const filesNames = fs.readdirSync(folder);
  for (const fileName of filesNames) {
    const filePath = path.join(folder, fileName);
    const fileStat = fs.statSync(filePath);
    if (fileStat.isFile()) {
      const fileExtension = path.extname(fileName);
      if (extensions.indexOf(fileExtension) !== -1) {
        result.push(filePath);
      }
      continue;
    }
    if (fileStat.isDirectory()) {
      result = result.concat(getFiles(filePath));
    }
  }
  return result;
}

async function putInS3(region, bucket, key, object, cache, cacheControl, ETag) {
  try {
    const client = new S3Client({ region });
    let cacheControlValue = 'max-age=31536000';
    if (cache) {
      cacheControlValue = `max-age=${cache}`;
    }
    if (cacheControl) {
      cacheControlValue = cacheControl;
    }
    console.log('► Cache control:', cacheControlValue);
    const params = {
      Body: object,
      Bucket: bucket,
      Key: key.startsWith('/') ? key.replace('/', '') : key,
      StorageClass: 'STANDARD',
      CacheControl: cacheControlValue,
      ContentEncoding: 'br',
      ContentType: getContentType(key),

      Metadata: {
        ETag: ETag,
      },
    };
    const command = new PutObjectCommand(params);
    const response = await client.send(command);
    return response;
  } catch (error) {
    console.error(error);
    console.error(`{"error": "${error.message}", "method":"putObject", "bucket": "${bucket}", "key": "${key}"}`);
    throw error;
  }
}

function getContentType(file) {
  const type = mime.lookup(file).replace('-', '');
  const charset = mime.charsets.lookup(type, null);
  if (charset) {
    return `${type}; charset=${charset}`;
  }
  return type;
}

function base64Md5(data) {
  return crypto.createHash('md5').update(data).digest('base64');
}

async function invalidateDistribution(distId, invalidation) {
  try {
    const client = new CloudFrontClient();
    const currentTimeStamp = new Date().getTime().toString();
    invalidation = invalidation.startsWith('/') ? invalidation : `/${invalidation}`;
    const params = {
      DistributionId: distId,
      InvalidationBatch: {
        CallerReference: currentTimeStamp,
        Paths: {
          Quantity: 1,
          Items: [`${invalidation}/*`],
        },
      },
    };
    const command = new CreateInvalidationCommand(params);
    const response = await client.send(command);
    return response;
  } catch (error) {
    console.error(error);
    console.error(
      `{"error": "${error.message}", "method":"CreateInvalidation", "DistributionId": "${distId}", "Items": "${invalidation}"}`,
    );
    throw error;
  }
}


/***/ }),

/***/ 710:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

const path = __nccwpck_require__(928);
const exec = __nccwpck_require__(216);

let deploy = function (params) {
  return new Promise((resolve, reject) => {
    const {
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
    } = params;

    const distIdArg = distId ? `--distId ${distId}` : '';
    const invalidationArg = distId ? `--invalidate "${invalidation}"` : '';
    const deleteRemovedArg =
      deleteRemoved && !/false/i.test(deleteRemoved)
        ? /true/i.test(deleteRemoved)
          ? `--deleteRemoved`
          : `--deleteRemoved ${deleteRemoved}`
        : '';
    const noCacheArg = noCache ? '--noCache' : '';
    const immutableArg = immutable ? '--immutable' : '';
    const cacheControlArg = cacheControl ? `--cacheControl ${cacheControl}` : '';
    const privateArg = private ? '--private' : '';
    const cacheFlag = cache ? `--cache ${cache}` : '';
    const filesRegex = filesToInclude ? filesToInclude : '**';

    try {
      const command = `npx s3-deploy@1.4.0 ./${filesRegex} \
                        --bucket ${bucket} \
                        --region ${bucketRegion} \
                        --cwd ./ \
                        ${distIdArg} \
                        --etag \
                        --gzip xml,html,htm,js,css,ttf,otf,txt \
                        ${cacheFlag} \
                        ${invalidationArg} \
                        ${deleteRemovedArg} \
                        ${noCacheArg} \
                        ${immutableArg} \
                        ${cacheControlArg} \
                        ${privateArg} `;

      const cwd = path.resolve(folder);
      exec.exec(command, [], { cwd }).then(resolve).catch(reject);
    } catch (e) {
      reject(e);
    }
  });
};

module.exports = deploy;


/***/ }),

/***/ 622:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 216:
/***/ ((module) => {

module.exports = eval("require")("@actions/exec");


/***/ }),

/***/ 62:
/***/ ((module) => {

module.exports = eval("require")("@aws-sdk/client-cloudfront");


/***/ }),

/***/ 599:
/***/ ((module) => {

module.exports = eval("require")("@aws-sdk/client-s3");


/***/ }),

/***/ 837:
/***/ ((module) => {

module.exports = eval("require")("mime");


/***/ }),

/***/ 982:
/***/ ((module) => {

"use strict";
module.exports = require("crypto");

/***/ }),

/***/ 896:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 928:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ }),

/***/ 106:
/***/ ((module) => {

"use strict";
module.exports = require("zlib");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
const core = __nccwpck_require__(622);
const deployGzip = __nccwpck_require__(710);
const deployBr = __nccwpck_require__(142);

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

    const cacheControl = core.getInput('cache-control');
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
        cacheControl,
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

module.exports = __webpack_exports__;
/******/ })()
;