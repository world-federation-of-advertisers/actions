/**
 * Copyright 2021 The Cross-Media Measurement Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const cache = require('@actions/cache');
const core = require('@actions/core');
const crypto = require('crypto');
const fs = require('fs');
const io = require('@actions/io');
const path = require('path');
const tc = require('@actions/tool-cache');
const fsPromises = fs.promises;

const LINTERS_PATH = path.join(process.env.HOME, 'lint');
const EXECUTABLE_MODE = 0o755;

const tools = Object.freeze({
  addlicense: buildTool(
      'addlicense', '1.0.0',
      'ac53b538d315abfb1c6e2cec5c6a7886397f1d1738a6b7abe6af2159ce614bee'),
  buildifier: buildTool(
      'buildifier', '4.0.0',
      'db81208c4e6f0f31dc33efaf9373c29c78b5295198cf16e4778e3e9211b57b0b'),
  googleJavaFormat: buildTool(
      'google-java-format', '1.9',
      '1d98720a5984de85a822aa32a378eeacd4d17480d31cba6e730caae313466b97',
      '.jar'),
  ktfmt: buildTool(
      'ktfmt', '0.27',
      '280c86b7a5f7cdbeb32a6890c8c2b4edf1b4eb2d5786a6b074add7dbf2fcfd16',
      '.jar'),
  ktlint: buildTool(
      'ktlint', '0.40.0',
      '4739662e9ac9a9894a1eb47844cbb5610971f15af332eac94d108d4f55ebc19e'),
});

function buildTool(name, version, sha256, ext = '') {
  const basename = name + ext;

  return {
    name: name,
    version: version,
    sha256: sha256,
    basename: basename,
    path: path.join(LINTERS_PATH, basename),
    cacheKey: [basename, version, sha256].join('-'),

    async validate() {
      const actualSha256 = await sha256HashFile(this.path);
      if (this.sha256 !== actualSha256) {
        throw Error(`Expected SHA256 ${this.sha256} for ${this.name}-${
            this.version}, got ${actualSha256}`)
      }
    },

    async save() {
      await this.validate();
      try {
        const cacheId = await cache.saveCache([this.path], this.cacheKey);
        core.info(`Saved ${this.cacheKey} to cache`);
        return cacheId;
      } catch (err) {
        if (err.name === cache.ReserveCacheError.name) {
          core.warning(err);
        } else {
          throw err;
        }
      }
    },

    async restore() {
      const restoredKey = await cache.restoreCache([this.path], this.cacheKey);
      if (!restoredKey) {
        return restoredKey;
      }

      try {
        await this.validate();
      } catch (err) {
        core.warning(err);
        await io.rmRF(this.path);
        return undefined;
      }
      core.info(`Restored ${this.cacheKey} from cache`);
      return restoredKey;
    },
  };
}

function sha256HashFile(path) {
  const hash = crypto.createHash('sha256').setEncoding('hex');
  // TODO(actions/runner#772): Switch to using fs Promises API to create read
  // stream once GitHub's JS actions can be run with Node.js 16+.
  const input = fs.createReadStream(path);
  return new Promise((resolve, reject) => {
    input.on('end', () => {
      hash.end();
      resolve(hash.read());
    });
    input.on('error', reject);
    input.pipe(hash);
  });
}

async function installExecutable(tool, url) {
  if (await tool.restore()) {
    return;
  }

  core.info(`Downloading ${tool.name}`);
  await tc.downloadTool(url, tool.path);
  await fsPromises.chmod(tool.path, EXECUTABLE_MODE);
  await tool.save();
}

async function installBuildifier() {
  const tool = tools.buildifier;
  core.info(`Installing ${tool.name}`);
  await installExecutable(
      tool,
      `https://github.com/bazelbuild/buildtools/releases/download/${
          tool.version}/buildifier-linux-amd64`);
}

async function installKtlint() {
  const tool = tools.ktlint;
  core.info(`Installing ${tool.name}`);
  await installExecutable(
      tool,
      `https://github.com/pinterest/ktlint/releases/download/${
          tool.version}/ktlint`);
}

async function writeJarScript(tool) {
  const script = `#!/usr/bin/env bash
  exec -a ${tool.name} java -jar ${tool.path} "$@"`;
  const scriptPath = path.join(LINTERS_PATH, tool.name);
  await fsPromises.writeFile(scriptPath, script, {mode: EXECUTABLE_MODE});
}

async function installGoogleJavaFormat() {
  const tool = tools.googleJavaFormat;
  core.info(`Installing ${tool.name}`);
  if (!await tool.restore()) {
    core.info(`Downloading ${tool.name}`);
    const url =
        'https://github.com/google/google-java-format/releases/download/' +
        `google-java-format-${tool.version}/` +
        `google-java-format-${tool.version}-all-deps.jar`;

    await tc.downloadTool(url, tool.path);
    await tool.save();
  }

  await writeJarScript(tool);
}

async function installKtfmt() {
  const tool = tools.ktfmt;
  core.info(`Installing ${tool.name}`);
  if (!await tool.restore()) {
    core.info(`Downloading ${tool.name}`);
    await tc.downloadTool(
        `https://search.maven.org/remotecontent?filepath=com/facebook/ktfmt/${
            tool.version}/ktfmt-${tool.version}-jar-with-dependencies.jar`,
        tool.path);
    await tool.save();
  }

  await writeJarScript(tool);
}

async function installAddlicense() {
  const tool = tools.addlicense;
  core.info(`Installing ${tool.name}`);
  if (await tool.restore()) {
    return;
  }

  // Download archive to temporary directory.
  const tmpdir =
      await fsPromises.mkdtemp(path.join(process.env.RUNNER_TEMP, tool.name));
  const archiveName = tool.basename + '.tar.gz';
  const archivePath = path.join(tmpdir, archiveName);
  await tc.downloadTool(
      `https://github.com/google/addlicense/releases/download/v${
          tool.version}/addlicense_${tool.version}_Linux_x86_64.tar.gz`,
      archivePath);

  // Extract tool from archive.
  await tc.extractTar(archivePath, tmpdir);

  // Copy to linters directory and save.
  await io.cp(path.join(tmpdir, tool.basename), tool.path);
  await tool.save();
}

async function run() {
  try {
    await fsPromises.mkdir(LINTERS_PATH, {recursive: true});
    await Promise.all([
      installBuildifier(),
      installKtfmt(),
      installKtlint(),
      installGoogleJavaFormat(),
      installAddlicense(),
    ]);
    core.addPath(LINTERS_PATH);
  } catch (err) {
    core.setFailed(err);
  }
}

run();
