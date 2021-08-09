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
const exec = require('@actions/exec');
const io = require('@actions/io');
const path = require('path');
const tc = require('@actions/tool-cache');
const {promises: fsPromises} = require('fs');

const LINTERS_PATH = path.join(process.env.HOME, 'lint');
const EXECUTABLE_MODE = 0o755;

const tools = Object.freeze({
  addlicense: buildTool('addlicense', '0.0.0-20200906110928-a0294312aa76'),
  buildifier: buildTool('buildifier', '4.0.0'),
  googleJavaFormat: buildTool('google-java-format', '1.9', '.jar'),
  ktfmt: buildTool('ktfmt', '0.27', '.jar'),
  ktlint: buildTool('ktlint', '0.40.0'),
});

function buildTool(name, version, ext = '') {
  const basename = name + ext;

  return {
    name: name,
    version: version,
    basename: basename,
    path: path.join(LINTERS_PATH, basename),
    cacheKey: [basename, version].join('-'),

    async save() {
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
      if (restoredKey) {
        core.info(`Restored ${this.cacheKey} from cache`);
      }
      return restoredKey;
    },
  };
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

  // Build tool in temporary directory.
  const tmpdir =
      await fsPromises.mkdtemp(path.join(process.env.RUNNER_TEMP, tool.name));
  const goPackage = 'github.com/google/addlicense';
  core.info(`Downloading ${tool.name} source`);
  const execOptions = {cwd: tmpdir};
  await exec.exec('go', ['mod', 'init', 'temp'], execOptions);
  await exec.exec(
      'go', ['get', '-u', '-d', `${goPackage}@v${tool.version}`], execOptions);
  core.info(`Building ${tool.name}`);
  await exec.exec('go', ['build', '-ldflags=-s', goPackage], execOptions);

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
