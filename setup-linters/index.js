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
      'addlicense', '1.1.1',
      'a44e8ad361baaed0cab3b9b7ed54bb1953fc0d1c908f571c9d983199da53b423'),
  buildifier: buildTool(
      'buildifier', '8.0.1',
      '1976053ed4decd6dd93170885b4387eddc76ec70dc2697b2e91a9af83269418a'),
  googleJavaFormat: buildTool(
      'google-java-format', '1.25.2',
      '25157797a0a972c2290b5bc71530c4f7ad646458025e3484412a6e5a9b8c9aa6',
      '.jar'),
  ktfmt: buildTool(
      'ktfmt', '0.54',
      '5e7eb28a0b2006d1cefbc9213bfc73a8191ec2f85d639ec4fc4ec0cd04212e82',
      '.jar'),
  cue: buildTool(
      'cue', '0.5.0',
      '6b06b37b9826ae030d65cf2a21604634271df839e5f463e99257ad5ea69f16b7'),
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
      const cacheId =
          await tc.cacheFile(this.path, this.basename, this.name, this.version);
      core.info(`Saved ${this.cacheKey} to tool cache`);
      return cacheId;
    },

    async restore() {
      const restoredPath = tc.find(this.name, this.version);
      if (!restoredPath) {
        return false;
      }
      await io.cp(restoredPath, this.path);

      try {
        await this.validate();
      } catch (err) {
        core.warning(err);
        await io.rmRF(this.path);
        return false;
      }
      core.info(`Restored ${this.cacheKey} from tool cache`);
      return true;
    },
  };
}

async function sha256HashFile(path) {
  const hash = crypto.createHash('sha256').setEncoding('hex');
  const inputHandle = await fsPromises.open(path);
  try {
    const input = inputHandle.createReadStream();
    return await new Promise((resolve, reject) => {
      input.on('end', () => {
        hash.end();
        resolve(hash.read());
      });
      input.on('error', reject);
      input.pipe(hash);
    });
  } finally {
    await inputHandle.close();
  }
}

async function installExecutable(tool, url) {
  core.info(`Installing ${tool.name}`);
  if (await tool.restore()) {
    return;
  }

  core.info(`Downloading ${tool.name}`);
  await tc.downloadTool(url, tool.path);
  await fsPromises.chmod(tool.path, EXECUTABLE_MODE);
  await tool.save();
}

async function installExecutableFromArchive(tool, url) {
  core.info(`Installing ${tool.name}`);
  if (await tool.restore()) {
    return;
  }

  // Download archive to temporary directory.
  core.info(`Downloading ${tool.name}`);
  const tmpdir =
      await fsPromises.mkdtemp(path.join(process.env.RUNNER_TEMP, tool.name));
  const archiveName = tool.basename + '.tar.gz';
  const archivePath = path.join(tmpdir, archiveName);
  await tc.downloadTool(url, archivePath);

  // Extract tool from archive.
  await tc.extractTar(archivePath, tmpdir);

  // Copy to linters directory and save.
  await io.cp(path.join(tmpdir, tool.basename), tool.path);
  await tool.save();
}

async function installBuildifier() {
  const tool = tools.buildifier;
  await installExecutable(
      tool,
      `https://github.com/bazelbuild/buildtools/releases/download/v${
          tool.version}/buildifier-linux-amd64`);
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
        `v${tool.version}/google-java-format-${tool.version}-all-deps.jar`;

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
        `https://repo1.maven.org/maven2/com/facebook/ktfmt/${
            tool.version}/ktfmt-${tool.version}-jar-with-dependencies.jar`,
        tool.path);
    await tool.save();
  }

  await writeJarScript(tool);
}

async function installAddlicense() {
  const tool = tools.addlicense;
  await installExecutableFromArchive(
      tool,
      `https://github.com/google/${tool.name}/releases/download/v${
          tool.version}/${tool.name}_${tool.version}_Linux_x86_64.tar.gz`);
}

async function installCue() {
  const tool = tools.cue;
  await installExecutableFromArchive(
      tool,
      `https://github.com/cue-lang/${tool.name}/releases/download/v${
          tool.version}/${tool.name}_v${tool.version}_linux_amd64.tar.gz`);
}

async function run() {
  try {
    await fsPromises.mkdir(LINTERS_PATH, {recursive: true});
    await Promise.all([
      installBuildifier(),
      installKtfmt(),
      installGoogleJavaFormat(),
      installAddlicense(),
      installCue(),
    ]);
    core.addPath(LINTERS_PATH);
  } catch (err) {
    core.setFailed(err);
  }
}

run();
