const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const mime = require('mime');
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { CreateInvalidationCommand, CloudFrontClient } = require('@aws-sdk/client-cloudfront');

const extensions = ['.xml', '.html', '.htm', '.js', '.css', '.ttf', '.otf', '.txt'];

const deploy = async function (params) {
  const { folder, bucket, bucketRegion, distId, invalidation, cache } = params;
  try {
    const files = getFiles(folder);
    const ETag = base64Md5(files.toString());
    console.log('► Target S3 bucket: %s (%s region)', bucket, bucketRegion);
    console.log('► Deploying files: %s', files);
    console.log('▼ CloudFront');
    console.log('  ▹ Distribution ID:', distId);
    for (const filePath of files) {
      const file = fs.readFileSync(filePath);
      const compressedFile = compressFile(file);
      fs.writeFileSync(filePath, compressedFile);
      await putInS3(bucketRegion, bucket, filePath, compressedFile, cache, ETag, folder);
      console.log('  ▹ Invalidate files:', filePath);
      invalidateDistribution(distId, filePath);
    }
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

async function putInS3(region, bucket, key, object, cacheControl, ETag, folder) {
  try {
    const client = new S3Client({ region });
    const params = {
      Body: object,
      Bucket: bucket,
      Key: key.startsWith(folder) ? key.replace(`${folder}/`, '') : key,
      StorageClass: 'STANDARD',
      CacheControl: cacheControl ? `max-age=${cacheControl}` : 'max-age=31536000',
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
    const params = {
      DistributionId: distId,
      InvalidationBatch: {
        CallerReference: currentTimeStamp,
        Paths: {
          Items: [invalidation],
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
